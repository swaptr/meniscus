# Tasks: meta-wire-types-refresh

Test first in every task. Write the citing test, see it fail, then implement. Tests use a fake `fetch` with `createMetaClient` and assert exact request counts. No live model calls.

## 1. Wire types (`@meniscus/meta`, types only)

- [x] 1.1 Add `reasoning.summary`, the `{ type: 'json_object' }` format and `Usage.video_frames_processed` to `packages/meta/src/responses.ts`, and `TranscribeStreamConfig` to `packages/meta/src/asr.ts`, each with a doc comment citing its page (design "Docs checked"). Export the new types from `index.ts`. Keep `prompt_cache_retention` out of `ResponseCreateParams`. Verify: `pnpm typecheck` passes. Then re-run `[model-api/client] Audio checked locally: Valid upload` unchanged, so the multipart `request` part still has no `partialMode` or `emitAudioProgress`, and re-run `[model-api/client] No extended prompt cache` unchanged.
- [x] 1.2 Add `RateLimitHeadroom` and `RequestEvent.rateLimit?` to `packages/meta/src/transport.ts` and export the type. Verify: `pnpm typecheck` passes. Behaviour lands in 2.1.

## 2. Headroom on the request hook (transport)

- [x] 2.1 [model-api/client] Upstream headroom on the request hook. In `packages/meta/src/client.test.ts`, add `[model-api/client] Upstream headroom on the request hook: Spark reading with headroom`, `... : Rate limited with none left`, `... : Transcription has no headers` and `... : Unreadable value`. Each collects `onRequest` events and asserts exactly one fetch call. See them fail, then parse the four headers in `createTransport` (a pure `headroom(headers)`, whole numbers only) and set `rateLimit` on the event whenever a `Response` arrived and at least one value was read. Verify: `pnpm --filter @meniscus/meta test`, with the existing `[model-api/client] No upstream retention: Structured reading` hook assertion unchanged.

## 3. Server log lines

- [x] 3.1 [model-api/client] Server log lines. Extract a pure `requestLogLine(e, stats)` in `apps/server/src/model-api.ts` (design §1), and build the `apps/server/src/testing.ts` fake-upstream client with the same `onRequest`, an injectable `log` and an hourly cap of 120 for these tests. In `apps/server/src/ai/ai.test.ts`, add `[model-api/client] Server log lines: Line format from given inputs` (calls `requestLogLine` directly, exact string), `... : Note with headroom` (line matched with `<ms>` as `\d+`, one request), `... : Failure without the upstream message` (line ends `✗ MetaApiError invalid_value`, one request) and `... : App error line without the upstream message` (`POST /api/ai/note`, 502 `model_api_error`, exact `[ai]` line, one request). The three request tests replace `console.log`, `console.info`, `console.warn`, `console.error` and `console.debug` with capturing stubs for the whole request, restore them after, and assert that no captured line contains `coconut`. See them fail, then implement, and drop `err.message` from both the request line's error part and the `[ai]` line in `apps/server/src/app.ts` `onError` (design §1). Verify: `pnpm --filter @meniscus/server test`.

## 4. Verify

- [x] 4.1 Run `pnpm spec:check`. Both new requirements are cited, and no citation is stale. Then run `pnpm verify`, which must pass (format, lint, `openspec validate --all --strict`, spec:check, typecheck, tests).

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply`, and again before `/opsx:archive`.
- Archive with `openspec archive meta-wire-types-refresh --yes` after model-api-guards and before ui-polish.
