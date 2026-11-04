# Proposal: model-api-guards

## Why

A docs review on 2026-11-04 against https://dev.meta.ai/docs found four places where Meniscus can waste a model request, or send patient content somewhere Meta keeps or trains on:

- A voice recording of 10 to 17 minutes passes our local checks, takes a budget slot, and then gets a `400` from speech-to-text, which caps a clip at 10 minutes.
- A `*-contributor` Spark model id would be accepted at startup. Contributor mode trains on content and is rejected under zero data retention.
- `store: false` does not turn off prompt caching. The optional 24 h cache retention must never be asked for.
- We mark an upstream `502` retryable. The docs list only 429, 500 and 503 as transient.

## What Changes

In product terms:

- **A recording over 10 minutes is refused at the bed, for free.** Staff see `Recording over 10 minutes. Record a shorter note.` No model request is made and no budget slot is held, even when the budget is spent. The server answers HTTP 422 `audio_too_long`, beside the existing 422 `invalid_audio`. The client measures the length from the WAV data, so the same refusal protects every caller of `@meniscus/meta`.
- **The server will not start on a contributor-mode model.** If `SPARK_MODEL`, `SAM_MODEL` or `ASR_MODEL` ends in `-contributor`, in any case, config loading fails and names the variable. Nothing is sent.
- **Prompts are never cached for 24 hours.** No Responses API request (Spark or SAM) carries `prompt_cache_retention`, even when a caller passes it, so the upstream uses its in-memory default.
- **Only documented transient errors are called retryable.** `retryable` is true for upstream 429, 500 and 503 only, in `@meniscus/meta` and in the server's `model_api_error` responses. An upstream 502 becomes `retryable: false`. Budget refusals stay retryable, as acuity-budget made them. The client still never retries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-api/client`: MODIFIED "Typed upstream errors" (no longer retryable for 502) and "Audio checked locally" (10-minute limit, `AudioTooLongError`). ADDED "No extended prompt cache".
- `model-api/http-errors`: ADDED "Retry verdict passes through".
- `capture/notes`: ADDED "Recording length limit".
- `web/capture`: ADDED "Recording too long".
- `server/security`: ADDED "No contributor models".

## Upstream model requests

| Action                                    | Before                                        | After                                   |
| ----------------------------------------- | --------------------------------------------- | --------------------------------------- |
| Voice note, clip over 10 min (≤ 32 MB WAV) | 1 (speech-to-text answers 400), slot held     | 0, no slot held                         |
| Voice note, clip of 10 min or less        | 2                                             | 2 (unchanged)                           |
| Every other action                        | unchanged                                     | unchanged                               |
| Server start with a `-contributor` model  | starts; every Spark call fails or trains      | does not start, 0 requests              |

## Shared types and HTTP shapes

- `packages/shared`: new `AudioTooLong` body `{ error: "audio_too_long"; message: string; retryable: false; duration_ms: number; limit_ms: 600000 }` for HTTP 422 from `POST /api/ai/voice-note`. This is a new error the web app handles, not a changed shape, so it is not BREAKING.
- The `retryable` field of a `model_api_error` body changes value for upstream 502 only (true → false). The type does not change. The web app does not branch on `retryable` (`apps/web/src/lib/api.ts:163-169` only stores it), so this is not BREAKING.
- `@meniscus/meta`: new export `AudioTooLongError extends InvalidAudioError` with `durationMs` and `limitMs`. `MetaApiError.retryable` changes for status 502.

## Out of scope

- The web recorder's own 1:00 limit (`apps/web/src/lib/recorder.ts:2`) does not change. The 10-minute refusal guards uploads from other clients and future longer recordings.
- Splitting long clips into 10-minute parts. That would cost more requests per action.
- Wire type additions, `x-ratelimit-*` headers and log lines: these are in `meta-wire-types-refresh`.
- Retries of any kind, and any SQLite schema change.

## Impact

- `packages/meta/src/asr.ts`, `errors.ts`, `responses.ts`, `index.ts`, `client.test.ts`.
- `apps/server/src/config.ts`, `ai/pipeline.ts`, `routes/ai.ts`, `testing.ts`, tests in `ai/ai.test.ts` and `security.test.ts`.
- `apps/web/src/lib/api.ts` (`errorText`) and its test.
- `packages/shared/src/index.ts` (`AudioTooLong`).
