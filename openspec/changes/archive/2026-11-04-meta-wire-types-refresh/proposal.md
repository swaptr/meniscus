# Proposal: meta-wire-types-refresh

## Why

The 2026-11-04 docs review found that `@meniscus/meta`'s wire types are missing fields the API now documents. It also found that the operator cannot see how much upstream rate limit remains: Meta sends `x-ratelimit-*` headers on every token-based reply, and our logs only show our own local budget. When the upstream limit is close, a nurse's read fails with a 429 that nobody saw coming.

## What Changes

In product terms:

- **The server log shows Meta's headroom.** After each upstream request, the server's one log line adds the requests and tokens Meta says remain, for example `upstream 149/150 req 2990000/3000000 tok`. The operator can then see an upstream limit coming before staff hit it.
- **Log lines hold less.** A failed request is logged with its error class and upstream error code only, never the upstream's error message, which can echo what was sent. This covers every server log line: the request line, the `[ai]` error line and the unhandled-error line. Today `app.ts:73` appends `err.message` to the `[ai]` line, so a 400 that echoes `bed 4 had coconut water` reaches the log. Lines hold only method, path, model, status, timing, error code and class, budget counts and headroom numbers.
- Type-only additions, mirrored from the docs. Nothing new is sent, so nothing changes in behaviour:
  - `reasoning.summary` (`auto | concise | detailed | null`);
  - usage `video_frames_processed`;
  - `text.format` `{ type: "json_object" }`;
  - the speech-to-text config fields `partialMode` (`CUMULATIVE | DELTA`) and `emitAudioProgress`. These apply only to streamed replies, and we stay buffered, so the client never sends them.

Logs are an observable edge: the patient-data rule limits what they may hold. So this change specs the hook and the server log lines in `model-api/client`, and does not use `skip_specs`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-api/client`: ADDED "Upstream headroom on the request hook" and "Server log lines".

## Upstream model requests

None change (0 new). Headers are read from replies the client already receives.

## Shared types and HTTP shapes

- `packages/shared`: no change. No HTTP response shape the web app consumes changes.
- `@meniscus/meta` exports (server and scripts only, not BREAKING; every addition is optional):
  - `RequestEvent.rateLimit?: RateLimitHeadroom` (new exported type);
  - `ResponseCreateParams.reasoning.summary?`;
  - `ResponseCreateParams.text.format` gains `{ type: 'json_object' }`;
  - `Usage.video_frames_processed?`;
  - new `TranscribeStreamConfig` type (`partialMode?`, `emitAudioProgress?`), not accepted by `transcribe`.

## Out of scope

- Streaming speech-to-text or Responses (`text/event-stream`, realtime WebSocket). We stay buffered.
- Sending `reasoning.summary`, `json_object` or any new field from a pipeline. The types only make the fields available.
- `prompt_cache_retention`, which stays out of `ResponseCreateParams` (model-api-guards); and `prompt_cache_key`.
- Budget decisions based on upstream headroom. Our local budget stays the only gate. Headroom is for logs only, so there is no adaptive throttling, polling or retry.
- Exposing headroom over HTTP (for example in `/api/metrics`, which read-queue and scale-store own).
- Any SQLite schema change.

## Impact

- `packages/meta/src/transport.ts` (headers parsed into `RequestEvent`), `responses.ts`, `asr.ts`, `index.ts`, `client.test.ts`.
- `apps/server/src/model-api.ts` (the log line becomes a pure, tested function), `apps/server/src/app.ts` (the `onError` `[ai]` line drops `err.message`), `apps/server/src/testing.ts` (the test client uses the same hook), and a server test.
