# Tasks: s3-media

Requirements and their tests:
- [charting/media]: Media kept in an object store, Objects go with their last media row, Media store unavailable, Media store logs nothing identifying, and Serve media (modified).
- [charting/media] Media kept in an object store also covers "Refused by the chart before the PUT".
- [server/storage]: Media store settings, Production media store, Bucket checked at start, and Orphaned objects swept.

## 0. Preconditions

- [x] 0.1 Confirm that drink-types and deploy-ready are archived. Re-read the live `charting/media` "Serve media" requirement, and re-copy it into this delta if an earlier change edited it. Confirm that `STORE_SCHEMA_VERSION` is 7, and stop if it is not. Re-find the `store.ts` references in design §Context by name: `insertMedia`, `mediaBytes`, `expireMedia`, `UNLINKED`, `attachPhoto`. Verify: `pnpm exec openspec validate s3-media --strict` passes.

## 1. Dev S3 and dependency

- [x] 1.1 Add `supabase/config.toml` (design §2) and the root scripts `dev:s3` and `dev:s3:stop`. Check without starting anything that `pnpm dlx supabase@3.0.0 --version` runs. If dlx cannot install the binary, switch the scripts to a documented global `supabase` and note the install in README. Verify: `pnpm dlx supabase@3.0.0 --version` prints 3.0.0, or the README fallback is written.
- [x] 1.2 `pnpm --filter @meniscus/server add aws4fetch@1.0.20 --save-exact` (approved: the one S3 client). Verify: `pnpm install --frozen-lockfile` passes and `pnpm why aws4fetch` shows only `@meniscus/server`.

## 2. Config

- [x] 2.1 Write tests in `apps/server/src/config.test.ts` for every scenario of [server/storage] Media store settings (`Missing keys`, `S3 defaults`, `Memory outside production`) and [server/storage] Production media store (`Memory in production`, `Plain HTTP in production`, `Supabase endpoint`, `Local stack in a production smoke test`). Each test passes a literal env with `NODE_ENV` set explicitly (`config.ts:19` defaults it to `development`). See them fail.
- [x] 2.2 Add `MEDIA_STORE` and the `S3_*` variables to `src/config.ts` (design §0): default `memory` unless `NODE_ENV=production`; production requires `s3` and an `https://` endpoint unless its host is `127.0.0.1`, `localhost` or `::1`; and add the commented block with local and Supabase values to `.env.example`. Verify: 2.1 passes, and `pnpm typecheck` passes.

## 3. Media store port and adapters

- [x] 3.1 Add `src/store/media/port.ts` with the types from design §0. Verify: `pnpm --filter @meniscus/server typecheck`.
- [x] 3.2 Write `src/store/media/contract.ts` (design §8) and `media-store.test.ts`. It runs the contract for `memory`, for `s3` over the in-process fake S3 (`src/store/media/fake-s3.ts`), and for `s3` against `S3_TEST_ENDPOINT` when that is set (otherwise `t.skip`). Include the timeout and fault cases, and: a 503 and a 429 from the fake S3 each make exactly 1 request and throw `MediaStoreError` (no retry); `head` of an absent key resolves `undefined`. See them fail.
- [x] 3.3 Implement `memory.ts`, then `s3.ts` with `aws4fetch` as a signer only. Requirements for `s3.ts`:
  - sign each request with `aws.sign(url, init)` (or `new AwsV4Signer(...).sign()`), then send it once with the injected `fetch`; never call `aws.fetch`, which in 1.0.20 retries up to 10 times on 5xx and 429 and uses the global `fetch` (design §3);
  - `service: 's3'` and `region` set explicitly;
  - path-style URLs;
  - `x-amz-content-sha256` set to the hash;
  - a 10 s timeout through the injectable `timeoutSignal` factory (default `AbortSignal.timeout`);
  - no retries, no SSE headers and no Content-MD5;
  - `MediaStoreError` carrying only `op` and `status`, as declared fields (no parameter properties: deploy-ready's `erasableSyntaxOnly`).

  Add `lock.ts` with its unit test (two callers on one hash run in order; different hashes run in parallel). Verify: 3.2 passes offline, and the fake S3 records exactly one request per call.

## 4. Store schema and media rows

- [x] 4.1 Write the failing tests, citing [charting/media] Media kept in an object store (`Photo stored as an object`, `Same bytes for two beds`, `Refused upload writes nothing`, `Refused by the chart before the PUT`) and Serve media (`Recording served`, `No such media`, `Large recording served`). They use `createApp({ store, media: fakeS3Store })` and assert on the bucket's contents, the request counts and that no file under a temp `DATA_DIR` holds the photo's middle 64 bytes.
- [x] 4.2 Schema 8: `media` without `bytes`, `sha256 TEXT NOT NULL`, the `media_sha256` index, and `STORE_SCHEMA_VERSION` 7 → 8 (stop if the live value is not 7). `addMedia` and `attachPhoto` take `sha256` and `size`. `media(id)` and `photo(id)` return refs. Add `hasMediaSha`. Add `onMediaGone`, with `RETURNING sha256` on every media delete (reject, void, expiry on open and on upload). Verify: [charting/entries] Store schema version tests pass with version 8, and the existing [charting/media] and [charting/photo-evidence] tests pass with the memory media store.
- [x] 4.3 Routes (`routes/media.ts`, `routes/chart.ts` entry photo) and `createApp({ media })`: validation, then the admission, `not_pending` and `photo_exists` checks before any S3 request, then hash, then `withShaLock` around PUT and insert, then the streamed `Response` with `Content-Length` (design §4). Verify: 4.1 passes, and [charting/media] Upload media, Link media to records, Entry photo routes and Media SHA-256 fingerprint pass unchanged.

## 5. Deletes, failures and logs

- [x] 5.1 Write the failing tests for every scenario of [charting/media] Objects go with their last media row. "Same bytes uploaded during a delete" uses a deferred fake-S3 PUT that is resolved after the reject.
- [x] 5.2 Implement `src/media-gc.ts` and its middleware: hashes collected per request, then one DELETE each under the lock, awaited before the response, with failures logged and swallowed. Verify: 5.1 passes, and [charting/media] Media goes with its record and Unlinked media expires pass unchanged.
- [x] 5.3 Write the failing tests for every scenario of [charting/media] Media store unavailable and Media store logs nothing identifying, with a captured log. Then map `MediaStoreError` to 503 `{"error":"media_unavailable"}` in both upload routes and both read routes, and add the log line `media <op> <status> <ms>ms media=<id>`. Verify: the tests pass, and [server/security] Internal errors stay internal passes unchanged.

## 6. Start check and sweep

- [x] 6.1 Write the failing tests for every scenario of [server/storage] Bucket checked at start, through deploy-ready's `startServer({ fetch, store, host: '127.0.0.1', port: 0, graceMs, beforeListen })` with `beforeListen: startChecks(config, media, store)` and the fake S3: a rejection rejects `startServer` and nothing listens. Configs set `NODE_ENV` and `MEDIA_STORE` explicitly; a production case uses a fake `https://` S3 behind the injected `fetch` and a built `WEB_DIST` fixture, and checks that the web build check runs first (an empty `WEB_DIST` fails with 0 S3 requests). "Unreachable endpoint" uses a real `fetch` to `127.0.0.1:9`, which is loopback and refused.
- [x] 6.2 Move the web build check (`webBuildCheck`, now in `index.ts`) into a new `src/start-checks.ts` with no side effects, and export `startChecks(config, media, store)` from it; `index.ts` imports it and passes it to `startServer` as `beforeListen`. Tests import `start-checks.ts`, never `index.ts`, because importing `index.ts` opens the store and listens. `startChecks` runs the web build check (production) first, then one HeadBucket, then the deletes for hashes from expiry on open; the messages from design §5, the `pnpm dev:s3` hint outside production, and a warning for `MEDIA_STORE=memory` outside `NODE_ENV=test`. Update deploy-ready's spawn tests (`apps/server/src/process.test.ts`, not `hosting.test.ts`) to set their env explicitly: `MEDIA_STORE=memory` with `NODE_ENV=development`; the production spawn ("Build missing in production") sets every `S3_*` variable explicitly (none come from `.env`): `MEDIA_STORE=s3`, `S3_ENDPOINT=http://127.0.0.1:9/storage/v1/s3` (loopback, so config accepts it), `S3_REGION=local`, `S3_BUCKET=meniscus-media` and fake `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, and still fails on `WEB_DIST` with 0 S3 requests, because the web build check runs before HeadBucket. deploy-ready's local production smoke test (its 8.1) adds `MEDIA_STORE=s3` and the loopback local stack's `S3_*` values. Verify: 6.1 passes, and deploy-ready's [server/hosting] Health check, Production needs the web build and Graceful shutdown tests pass unchanged.
- [x] 6.3 Write the failing tests for every scenario of [server/storage] Orphaned objects swept over the fake S3 (its ListObjectsV2 XML and HeadObject, with `LastModified` dates), including `Re-uploaded during the sweep: not deleted` (a hook between listing and the re-check rewrites the object and inserts a row), and assert 1 HEAD + 1 DELETE per deleted orphan. Implement `openStore(path, { readOnly: true })` (no expiry on open, no writes), then `src/lab/media-sweep.ts` (list, then per candidate re-check `hasMediaSha` and HeadObject, delete only when still unnamed and over 1 h old), and `scripts/media-sweep.ts` as `media:sweep` in `apps/server/package.json`. Verify: the tests pass.

## 7. Seed, scripts, docs

- [x] 7.1 `scripts/demo-history.ts` writes media through `media.put` plus `store.addMedia` under the lock, using `createMediaStore(config)`. `src/lab/fake-server.ts` passes the configured media store through. Verify: a unit test seeds a temp `DATA_DIR` with the memory media store, and every media row's object exists with a matching SHA-256.
- [x] 7.2 README "Run it": `pnpm dev:s3`, pasting the four `S3_*` values from `supabase status` into `.env` by hand, `pnpm dev`, and `pnpm dev:s3:stop`. "Sources and kept media": media lives in the `S3_BUCKET` bucket, not `DATA_DIR`; there is no migration from older stores (delete `DATA_DIR` and re-seed); and `media:sweep`. Update AGENTS.md's Commands table with `dev:s3` and `media:sweep`. Verify: the commands match `package.json`.

## 8. Local check, browser check, verify

- [x] 8.1 Local S3 check (run by the main agent on 2026-11-04: contract 7/7 against the Supabase CLI stack, demo seed exit 0 with explicit env, `media:sweep` `orphans 0 of 154`). The agent runs it if Docker is present (it is on this machine), and otherwise the user does. It sends **0 model requests**.
  1. `pnpm dev:s3`.
  2. The user pastes the `S3_*` values into `.env`. The agent never reads `.env`.
  3. Run `S3_TEST_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3 S3_TEST_REGION=local S3_TEST_BUCKET=meniscus-media S3_TEST_ACCESS_KEY_ID=… S3_TEST_SECRET_ACCESS_KEY=… pnpm --filter @meniscus/server test -- --test-name-pattern 'media store contract'`. The key values are copied from `supabase status` output in the terminal.
  4. `DATA_DIR=$(mktemp -d) pnpm --filter @meniscus/server demo`, then `pnpm --filter @meniscus/server media:sweep`.

  Verify: the real-endpoint contract run passes, the demo seed exits 0, and `media:sweep` prints `orphans 0 of <n>`.
- [x] 8.2 Browser check at 390 and 1100 px, with `pnpm --filter @meniscus/server fake` (fake model upstream) on a fresh temp `DATA_DIR` against the local Supabase S3, through the Vite proxy. Playwright aborts every `/api/ai/**` route, so **0 real model requests** are sent. Check:
  - a photo entry and a voice entry upload, and their photo and recording play back from `GET /api/media/:id` (200, `no-store`, `Content-Length`);
  - rejecting the photo entry removes its object, as `media:sweep` shows `orphans 0`;
  - with `pnpm dev:s3:stop`, an upload shows the capture screen's existing upload error (503 `media_unavailable` in the network log), and the server restart exits 1 with `unreachable`.
  - Done 2026-11-04: `npx tsx scripts/fake-server.ts` with explicit `MEDIA_STORE=s3`, `S3_*` from `supabase status -o json` and a `mktemp -d` `DATA_DIR` (no `.env`), web dev server through the Vite proxy, Playwright aborting `/api/ai/**` (0 AI requests made, 0 model requests). The photo (PNG) and voice (WAV) were uploaded through `POST /api/admissions/10/media` from the page (201) and linked as entries, since a capture read needs `/api/ai`. Both objects appeared in `meniscus-media`. At 390 and 1100 px the entry details showed the photo and played the recording: `GET /api/media/1` 200 `no-store`, `Content-Length: 9413`, `GET /api/media/2` 200 `no-store`, `Content-Length: 64044`. Rejecting the photo entry ("Duplicate") removed its object from the bucket, and the recording's stayed. `media-sweep.ts` (explicit env) reports `orphans 153 of 154`: the local bucket is shared with other agents' `DATA_DIR`s, so their objects count as orphans here and `--delete` was not run. The only object this store names is the recording, which is present.
  - Skipped: the `pnpm dev:s3:stop` step (the 503 `media_unavailable` upload and the `unreachable` restart). Other agents use the stack, so it was not stopped; that step stays covered by the route and store tests.
