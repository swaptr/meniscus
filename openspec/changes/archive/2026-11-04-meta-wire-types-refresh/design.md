# Design: meta-wire-types-refresh

See proposal.md for the why, and `specs/model-api/client/spec.md` for the two requirements ("Upstream headroom on the request hook" and "Server log lines").

## Docs checked (2026-11-04)

| Item | Page | What it says |
| --- | --- | --- |
| `reasoning.summary` | https://dev.meta.ai/docs/api-reference/responses/schemas | `summary: enum ('auto', 'concise', 'detailed') \| null`. `generate_summary` is deprecated in favour of it. |
| `text.format` | same | `ResponseFormatText \| TextResponseFormatJsonSchema \| ResponseFormatJsonObject`. `json_object` is "the older JSON mode", and `json_schema` is preferred. |
| Usage | same | `video_frames_processed`: integer, optional, "present only for video segmentation responses". `images_processed` (already typed) is for image segmentation. |
| Voice stream fields | https://dev.meta.ai/docs/api-reference/voice/schemas, https://dev.meta.ai/docs/speech-to-text | `partialMode: enum ('CUMULATIVE', 'DELTA')`, default `CUMULATIVE`, and `emitAudioProgress: boolean`, default `true`. Both apply "to `text/event-stream` responses only". |
| Rate-limit headers | https://dev.meta.ai/docs/pricing-rate-limits | `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-limit-requests` and `x-ratelimit-remaining-requests` are on "every successful token-based response". "Transcription responses don't include these headers." No value format is given. |
| Errors | https://dev.meta.ai/docs/error-handling | It documents `Retry-After`. It mentions rate limit headers in passing and links to the pricing page, but does not name them there. |

Not stated by the docs, so it is an assumption, marked in code comments: the headers are plain decimal integers, and they may also appear on error replies. We parse them whenever they are present and drop anything that is not a whole number.

## Changed types first (`packages/meta`, transport only)

```ts
// transport.ts
/** Upstream's own rate-limit window, from x-ratelimit-* (https://dev.meta.ai/docs/pricing-rate-limits). Each field only when sent as a whole number. */
export interface RateLimitHeadroom {
  limitRequests?: number
  remainingRequests?: number
  limitTokens?: number
  remainingTokens?: number
}
export interface RequestEvent {
  method: string
  path: string
  model?: string
  status?: number
  ms: number
  error?: MetaError
  /** Absent when the reply carried no readable x-ratelimit-* header (always for speech-to-text). */
  rateLimit?: RateLimitHeadroom
}

// responses.ts
export interface ResponseCreateParams {
  // …unchanged…
  text?: {
    format:
      | { type: 'json_schema'; name: string; schema: JsonSchema; strict?: boolean; description?: string }
      | { type: 'json_object' } // legacy JSON mode; prefer json_schema
      | { type: 'text' }
  }
  reasoning?: { effort?: ReasoningEffort; summary?: 'auto' | 'concise' | 'detailed' | null }
  // still no prompt_cache_retention (model-api-guards "No extended prompt cache")
}
export interface Usage {
  // …unchanged…
  /** Video segmentation only. */
  video_frames_processed?: number
}

// asr.ts
/** Streamed (`Accept: text/event-stream`) replies only. Typed for completeness; transcribe() is buffered and never sends these. */
export interface TranscribeStreamConfig {
  partialMode?: 'CUMULATIVE' | 'DELTA'
  emitAudioProgress?: boolean
}
```

`TranscribeParams` does not extend `TranscribeStreamConfig`. A caller cannot pass the stream fields to `transcribe`. The existing "Valid upload" scenario pins the exact multipart `request` part, so any leak would fail it.

## Layers

| Module | Layer | Change |
| --- | --- | --- |
| `packages/meta/src/transport.ts` | transport | `headroom(res.headers)` is a pure function. It is set on the event in `finally` whenever a `Response` arrived, for success or `!res.ok` alike. |
| `packages/meta/src/responses.ts`, `asr.ts`, `index.ts` | transport | Types and exports only. |
| `apps/server/src/model-api.ts` | server | `requestLogLine(e, stats)` is a pure function returning the line. `onRequest` calls `console.log(requestLogLine(...))`. |
| `apps/server/src/app.ts` | server HTTP | The `onError` `[ai]` line becomes `[ai] <status> <body.error> <err.name>[ <code>]`, with no `err.message`. The unhandled-error line already prints only the name and stack frames, and is unchanged. |
| `apps/server/src/testing.ts` | server tests | The fake-upstream client is built with the same `onRequest`, with an injectable `log`, so tests can capture lines. |

## Decisions

### 1. Log line format

`[model-api] <METHOD> <path> <model> <status|—> <ms>ms (#<total>, <lastHour>/<perHour> per h)[ upstream <remReq>/<limReq> req <remTok>/<limTok> tok][ ✗ <ErrorName>[ <code>]]`

- The `upstream` part shows each pair when at least one of its numbers is present; a missing number prints `?`. A lone remaining value prints as `<remReq>/? req`, so a 429 with only `x-ratelimit-remaining-requests: 0` logs `upstream 0/? req`.
- The error part keeps `error.name`, and `code` for `MetaApiError` (the `[ai]` line also prints `MetaResponseError`'s code). The unhandled-error line keeps only lines that are stack frames (`at …`), since a multi-line message spans several stack lines. It drops `error.message`. Today's line appends `e.error.message` (`model-api.ts:34`). For a non-JSON error body, that message holds up to 500 characters of the upstream reply (`transport.ts` `apiError`), which can echo the note or transcript. The HTTP response to our own caller still carries the message, which is unchanged and out of scope.
- The same rule applies to `app.ts` `onError`. Today it logs `[ai] ${status} ${error}: ${err.message}` (`app.ts:73`), so the same upstream text would reach `console.error` even with a clean request line. It becomes `[ai] 502 model_api_error MetaApiError invalid_value`: status, our error code, class name and, for `MetaApiError`, the upstream code.
- Alternative rejected: structured JSON logs. That would be a format change for no reader we have today.

### 2. Headroom is only reported

Headroom goes on the hook and into the log. Nothing reads it to admit, delay or retry a request. Using it for admission would make request counts depend on upstream state. The local budget (`MODEL_API_MAX_REQUESTS_PER_HOUR`) stays the only gate.

### 3. Spec'd rather than `skip_specs`

The patient-data rule ("never logged … log paths, models, statuses, timings") makes log content observable and testable. Both requirements live in `model-api/client`, where the request hook and its log line already belong, and the existing "No upstream retention" scenario already asserts what the request hook reports.

## Overlaps with in-flight changes (apply order: bag-alerts → accuracy-views → dietitian-care → model-api-guards → **meta-wire-types-refresh** → ui-polish → scale-store → postgres-store → read-queue)

- **`model-api/client`**: model-api-guards, applied just before, MODIFIES "Typed upstream errors" and "Audio checked locally" and ADDs "No extended prompt cache". This change only ADDs two new requirement names, so no block needs copying. If model-api-guards is not archived first, this change still archives cleanly, because ADDED blocks do not depend on it.
- **Code**:
  - model-api-guards edits `asr.ts` (`checkWav`, `AudioTooLongError`), `responses.ts` (prompt-cache strip) and `errors.ts`. This change adds types beside those edits and must keep `prompt_cache_retention` out of `ResponseCreateParams`.
  - read-queue later makes `RequestBudget` async and changes `src/model-api.ts` (shared budget store). It must keep `requestLogLine` as the only log path. Its `stats()` stays per process (read-queue design), so the `(#n, x/y per h)` part keeps its meaning.
  - scale-store and read-queue add `/api/metrics` fields. Headroom is not added there.
- **No in-flight change has a `capture/*` delta that touches this change**: no capture behaviour changes. No SQLite schema change.

## Risks / Trade-offs

- [The header format is undocumented] → We parse strictly (`/^\d+$/`) and drop anything else. The worst case is a missing `upstream` part, not a wrong number.
- [Dropping the error message makes debugging harder] → The status, error class and upstream code identify every documented error (https://dev.meta.ai/docs/error-handling). The full message still reaches our own HTTP caller.
- [`json_object` in the union could be picked by mistake] → `generateObject` always sends `json_schema` strict, and `callTool` sends tools. Only a direct `create` could send `json_object`, and no pipeline does.

## Migration Plan

None. These are additive types and a log-format change. Rollback is a revert.
