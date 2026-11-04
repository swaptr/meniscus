# Design: model-api-guards

See proposal.md for the why. The specs in this change hold the behaviour; this file covers types, layers, decisions and overlaps.

## Docs checked (2026-11-04)

| Item | Page | What it says |
| --- | --- | --- |
| Voice length | https://dev.meta.ai/docs/speech-to-text | File transcription takes "a RIFF/WAVE container with mono, 16-bit integer PCM at 16 kHz or 24 kHz". Audio over 10 minutes returns `400` ("Split the recording into clips of 10 minutes or less"). A body over 32 MB returns `413`. |
| Voice schema | https://dev.meta.ai/docs/api-reference/voice/schemas | It states no duration limit. The buffered reply carries `audioDurationMs`. No retention field. |
| Contributor mode | https://dev.meta.ai/docs/models, https://dev.meta.ai/docs/pricing-rate-limits | The ids are `muse-spark-1.3-contributor` and `muse-spark-1.2-contributor`. Content "may be used to train future Meta models, in exchange for a lower price". Muse Voice Transcribe has no contributor mode. |
| Contributor under ZDR | https://dev.meta.ai/help/policies-and-privacy/zero-data-retention | Contributor mode, "including Contributor-mode variants on Meta Model API", is unavailable under ZDR, and "requests that use them are rejected". No status code is given. |
| Prompt cache | https://dev.meta.ai/docs/prompt-caching | The values are `in_memory` ("Keep the cache in memory (the default behavior)") and `24h`. Caching "is independent of the Responses API `store` parameter", and `store: false` "does not disable caching". |
| Prompt cache schema | https://dev.meta.ai/docs/api-reference/responses/schemas | `prompt_cache_retention: enum ('in_memory', '24h') \| null`, optional, no default listed. |
| Retryable | https://dev.meta.ai/docs/error-handling | "For transient errors (429, 500, 503), use exponential backoff". 502 is not documented, and 504 is "Do not simply retry". |

## Changed types first

```ts
// packages/meta/src/asr.ts (transport; exported from index.ts)
export const MAX_AUDIO_MS = 600_000
export class AudioTooLongError extends InvalidAudioError {
  override name = 'AudioTooLongError'
  constructor(readonly durationMs: number, readonly limitMs: number = MAX_AUDIO_MS) { super(`audio is ${durationMs} ms; limit is ${limitMs} ms`) }
}

// packages/meta/src/errors.ts
// MetaApiError: this.retryable = status === 429 || status === 500 || status === 503

// packages/shared/src/index.ts (HTTP 422 body of POST /api/ai/voice-note)
export interface AudioTooLong {
  error: 'audio_too_long'
  message: string
  retryable: false
  duration_ms: number
  limit_ms: 600000
}
```

`ResponseCreateParams` gets no `prompt_cache_retention` field. Leaving it out of the type is the guard callers see at compile time. The runtime strip below is the guard for casts and plain JS.

## Layers

| Module | Layer | Change |
| --- | --- | --- |
| `packages/meta/src/asr.ts` | transport | `checkWav` parses the header, then measures duration, then checks size. |
| `packages/meta/src/responses.ts` | transport | `create` drops `prompt_cache_retention` from the JSON body. |
| `packages/meta/src/errors.ts` | transport | 502 is removed from `retryable`. |
| `apps/server/src/config.ts` | server config | Zod refinement on the three model ids. |
| `apps/server/src/ai/pipeline.ts` | domain | `voiceNote` calls `checkWav(audio)` after `toWav` and before `withBudget`. |
| `apps/server/src/routes/ai.ts` | HTTP | `aiErrorStatus` maps `AudioTooLongError` to 422 `audio_too_long`, ahead of the `InvalidAudioError` branch. |
| `apps/web/src/lib/api.ts` | web | `errorText` maps `audio_too_long` to the spec'd sentence. |

## Decisions

### 1. Length measured from the `data` chunk, before the budget

`durationMs = floor(min(declared data size, bytes present after the chunk header) × 1000 / (rate × 2))`, for mono 16-bit audio. Taking the smaller of the two means a streamed WAV header (`0xFFFFFFFF`) or a truncated file cannot inflate or hide the length. The check runs before the 32 MB size check, so a 20-minute 24 kHz clip gets the length message that staff can act on, and not a size message.

On the server, the check runs on the converted WAV and **before** `withBudget` reserves anything. A long clip therefore holds no slot, and a spent budget cannot turn it into a 429 (scenario "Too long while the budget is spent"). `transcribe` still calls `checkWav` itself, so every other caller of `@meniscus/meta` (eval, lab) gets the same guard for 0 requests.

Alternative rejected: an `ffprobe` duration on the compressed upload. That is a second process, it disagrees with the API on edge cases, and the API measures the WAV we actually send.

### 2. HTTP 422 `audio_too_long`

The existing `http-errors` and `capture/notes` specs use 422 `invalid_audio` for audio we cannot use, and 413 is not used anywhere in our API. 422 is right: the request is well formed, but its content cannot be processed. A separate code, not `invalid_audio` with a new message, lets the web app show a fixed, actionable sentence. `retryable: false`, because sending the same clip again gives the same answer.

### 3. Prompt cache: the field is never sent

The options were to assert the field is absent or to pin `in_memory`. **Chosen: absent, and stripped if a caller passes it.**
- The prompt-caching guide describes `in_memory` as "the default behavior", so leaving the field out gives in-memory caching.
- SAM shares `POST /v1/responses` through `responses.create`. Nothing in the docs says `sam-3.1` accepts `prompt_cache_retention`. Pinning it could turn every SAM call into a `400` that still costs budget, and we cannot verify that without live requests.
- Stripping it in one place (`create`) covers `generateObject`, `callTool` and `sam.segment`.

Risk: Meta changes the default to `24h`. The schema lists no default, so this is possible. Mitigation: the docs-first rule. If a future docs check shows a new default, pin `in_memory` for Spark models through a new change.

### 4. Contributor refusal at config parse

This is a Zod `refine` on `SPARK_MODEL`, `SAM_MODEL` and `ASR_MODEL`: `!/-contributor$/i.test(v)`. The error names the variable, never echoes other env values, and never reads `.env` in tests. It lives in the server, not `@meniscus/meta`. Choosing a model is configuration, and the client stays transport-only with no policy. Scripts (`eval`, `synth`) import the same `config`, so they refuse too. All three variables are covered, even though Meta lists contributor ids only for Spark. It costs nothing and holds if Meta adds more.

### 5. Retryable statuses

`MetaApiError.retryable` drops 502. `MetaBudgetError.retryable` stays `true` (acuity-budget). `MetaConnectionError` and `MetaTimeoutError` keep their current verdicts. No requirement covers them, and the docs say nothing about network failures. The server's `model_api_error.retryable` passes through `err.retryable` (`routes/ai.ts:211`), so the HTTP change follows with no code change there. It is pinned by the new http-errors requirement.

Citations of 502-as-retryable, checked:
- `openspec/specs/model-api/client/spec.md` "Typed upstream errors". This change modifies it.
- `packages/meta/src/errors.ts:43`. Code, changed in task 2.1.
- `openspec/changes/archive/2026-11-03-image-synthesis/design.md:8`. Archived history, left as written.
- No test asserts a 502 is retryable. The 502s in `apps/server/src/ai/ai.test.ts:244,253` are our own status for upstream 401/403, and they do not change.
- No in-flight change cites 502 as retryable. read-queue's "Upstream failures are not retried" never retries any status, so it is unaffected.

## Overlaps with in-flight changes (apply order: bag-alerts → accuracy-views → dietitian-care → **model-api-guards** → meta-wire-types-refresh → ui-polish → scale-store → postgres-store → read-queue)

- **`model-api/*`**: no in-flight change has a `model-api` delta. The two MODIFIED blocks copy the current `openspec/specs/model-api/client/spec.md` text.
- **`capture/*`**:
  - accuracy-views modifies `capture/meal-reading`.
  - scale-store and read-queue modify `capture/read-budget`.
  - read-queue adds `capture/read-queue`.
  - None touches `capture/notes`. This change only ADDs to it.
- **`web/capture`**: bag-alerts, accuracy-views, scale-store and read-queue have deltas. This change ADDs one requirement, "Recording too long", whose name none of them uses.
- **`server/security`**: no in-flight delta.
- **Code overlaps (no spec conflict)**:
  - read-queue splits `withBudget` into `admit`/`run`, and queues `/voice-note` with `Prefer: respond-async` after storing the recording in the `MediaStore`. When read-queue is applied, the length check must stay ahead of `admitOrQueue` and ahead of the media write. A too-long clip answers 422 and is neither queued nor stored. Its "Read again" never meets a long clip, because one is never queued.
  - read-queue also makes `RequestBudget` async in `packages/meta`. This change does not touch `budget.ts`.
  - scale-store (`BUDGET_PRESSURE_PCT`), postgres-store (`DATABASE_*`) and read-queue (`READ_QUEUE_*`) add env vars to `config.ts`. The model-id refinement is independent of them.
  - meta-wire-types-refresh comes next and edits `responses.ts`, `asr.ts` and `transport.ts`. It must keep `prompt_cache_retention` out of `ResponseCreateParams`.
- **SQLite schema**: no change. `audio_too_long` stores no read (`logged()` runs only after the pipeline returns).

## Risks / Trade-offs

- [The web recorder stops at 1:00, so the web path rarely meets the 10-minute refusal] → It still guards the API for other clients and for any future longer recorder. The web test drives it with a fake `fetch`.
- [A 10-minute 16 kHz test WAV is 19.2 MB] → Tests build it once per file as a zero-filled buffer. Client tests use a header that declares a large `data` chunk only where the scenario says the file holds less.
- [Upstream measures length slightly differently from bytes ÷ rate] → We accept exactly 600,000 ms. A clip within a few ms of the limit might still get a 400. That costs 1 request, the same as today, and is never retried.

## Migration Plan

No data migration. Deploys that set `SPARK_MODEL` to a contributor id stop at startup with a clear error. Set it to `muse-spark-1.3`. Rollback is a revert.
