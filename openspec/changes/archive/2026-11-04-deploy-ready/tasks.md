# Tasks

Test first in every group: write the citing test (`[<domain>/<capability>] <Requirement>: <Scenario>`), see it fail, then implement. No task sends a model request. Tests use a fake `fetch` or an unreachable base URL and assert 0 upstream requests where the scenario says so.

## 1. Erasable TypeScript (no spec)

- [x] 1.1 Add `"erasableSyntaxOnly": true` to `packages/config/tsconfig/base.json`. Rewrite the parameter properties at `apps/server/src/store/store.ts:686`, `apps/server/src/lab/synth.ts:273`, `packages/meta/src/errors.ts` (`:30-38`, `:62`, `:72`, `:88-92`, `:102-104`, `:114-115`) and `packages/meta/src/asr.ts:56-57` as declared fields with assignments, and fix any other hit `tsc` reports. `@meniscus/meta` loads through `model-api.ts`, so Node strips it too. Before the rewrite, `grep -nE '^ {4}readonly |constructor\(readonly ' packages/meta/src/errors.ts packages/meta/src/asr.ts apps/server/src/store/store.ts apps/server/src/lab/synth.ts` lists the 20 constructor parameters; after it, it lists none, and `erasableSyntaxOnly` makes `tsc` refuse any that is left. Verify: `pnpm typecheck` passes, and `node -e "import('./apps/server/src/app.ts').then(() => console.log('ok'))"` prints `ok` under Node 24 (no `.env`, no request sent; design D6).

## 2. Configuration

- [x] 2.1 Tests in `config.test.ts` (or `security.test.ts`, where the config tests live today): [server/security] Loopback by default: Default host, Default port, Hosted; [server/security] Trusted proxy hops: Bad setting. Then, in `src/config.ts`, remove `MENISCUS_API_TOKEN` and its production refine, and add `TRUST_PROXY_HOPS`, `WEB_DIST` (default resolved from the file) and `SHUTDOWN_GRACE_MS` (design "Changed types"). Delete the tests citing [server/security] API access token and [server/security] Production requires a token. Verify: server tests and `pnpm spec:check` pass.

## 3. Sessions on every read; token removed

- [x] 3.1 Change `testApp().request` in `src/testing.ts` to sign in for GET and HEAD too, except to `/api/session` and `/api/health` (design D10). Verify: `pnpm --filter @meniscus/server test` still passes before any app change, and `git diff` shows no assertion changed.
- [x] 3.2 Tests: [server/security] Signed-in reads: Reads without a session, Ended session, Signed in; [server/security] Signed-in changes: Reads stay open (rewrite the test at `src/session.test.ts:329` to the new scenario: `/api/session` and `/api/health` with no cookie; its bearer-token `/api/wards` and `/api/staff` assertions go); [charting/model-accuracy] Model accuracy summary: No session; [web/bed-qr] Bed link needs sign-in: Token alone. Each test asserts 0 upstream requests, `GET /api/ai/status` included. Then drop the GET/HEAD exemption in `session()` (`src/routes/common.ts`). Remove `bearer` and `apiToken` from `src/security.ts`, `src/app.ts` and `src/index.ts`, keeping the guard order `noStore`, `session`, `sameSite` (design D3). Rewrite the `apiToken` uses in `security.test.ts` and `session.test.ts`: [server/security] Staff sign-in: Secure in production; [server/security] Demo accounts and sign-in: Production refuses demo passwords. Verify: server tests and spec:check pass.
- [x] 3.3 Web tests in `apps/web/src/lib/*.test.ts` against a fake `fetch`: [web/bed-qr] Bed link needs sign-in: Scanned while signed out; [web/staff] Lock when idle: A refresh after the session ended. No web code is expected to change (design "Context"). If a test fails, fix the web code it points at. Remove the token header and the `loadEnv` call from `apps/web/vite.config.ts`, and correct the comment at `apps/web/src/lib/api.ts:2`. Verify: `pnpm --filter @meniscus/web test` and typecheck pass.

## 4. Behind a proxy

- [x] 4.1 Tests: [server/security] Trusted proxy hops: One hop, No hops trusted (password-check bucket; supply the socket address through the test request's `env` the way `getConnInfo` reads it, or through an injectable address function); [server/security] Forwarded protocol: Behind TLS termination, Secure cookie over HTTPS; [server/security] Cross-site form posts: Photo upload from another site (still passes). Then implement `clientAddress` and `requestProtocol` in `src/security.ts`, use them in `rateLimit`, `sameSite` and sign-in's cookie (`src/routes/session.ts`), and pass `trustProxyHops` from config through `createApp` (design D4). Verify: server tests pass with 0 upstream requests.

## 5. Health and the web build

- [x] 5.1 Tests in a new `src/hosting.test.ts`: [server/hosting] Health check: Healthy server, Store unavailable (a store whose methods throw); [server/security] Security headers: Health and AI responses, Patient data is not cached. Then make `/api/health` return exactly `{ ok: true }` and touch nothing (design D8). Verify: tests pass.
- [x] 5.2 Tests over a temp `webDist` fixture (`index.html`, `sw.js`, `manifest.webmanifest`, `assets/index-BQlYVns6.js`): [server/hosting] Web build served: Index and an asset, Outside the build; [server/hosting] Web app routes fall back to index.html: Bed link and ward dashboard, Missing asset; [server/hosting] Web cache headers: Hashed and unhashed; [server/hosting] API paths are never the web app: Unknown API path, Post to a web path; [server/security] Security headers: Web build. Then add `src/web.ts` (serveStatic, onFound cache headers, extension-less fallback, `/api` skipped), and restructure `createApp` as a root app (headers, `/api` with a JSON `notFound`, then the web when `webDist` is set; design D5). Verify: tests pass, and `typeof app` still typechecks where `AppType` is used.

## 6. Process: start and shutdown

- [x] 6.1 Tests: [server/hosting] Graceful shutdown: Request in flight, Grace limit, in-process against `startServer` on `127.0.0.1:0` with a held `fetch` and a store spy (design D7); and a `beforeListen` that rejects makes `startServer` reject with nothing listening. Then add `src/serve.ts` with `startServer({ fetch, store, host, port, graceMs, beforeListen })`. Verify: tests pass and leave no open handle (`node --test` exits).
- [x] 6.2 Tests that spawn `node src/index.ts` with `env -i`-style env, every variable the scenario needs set explicitly: `PATH`, `NODE_ENV` (`development`, or `production` with a built `WEB_DIST` fixture where the scenario says so), a temp `DATA_DIR`, `MODEL_API_BASE_URL=http://127.0.0.1:9/v1`, `MODEL_API_KEY=fake`, a free `PORT` and no `.env`. They cover [server/hosting] Production needs the web build: Build missing in production, Development without a build; and the exit-code half of [server/hosting] Graceful shutdown: Request in flight (SIGTERM, then exit code 0) and Grace limit (`SHUTDOWN_GRACE_MS=100`, a raw socket holding a `POST /api/session` whose body is still being sent, then SIGTERM: the socket is closed and the process exits with code 0 within 1 s). Then make `src/index.ts` load config, open the store, build the app with `webDist` and `trustProxyHops`, call `startServer` with the web build check as `beforeListen` in production (on failure, log the message and exit 1), and register `SIGTERM`/`SIGINT` once. Add `"start:prod": "node src/index.ts"` to `apps/server/package.json`. Verify: tests pass, and no spawned process outlives its test.

## 7. Deploy files and docs (no spec)

- [x] 7.1 Root `package.json`: `engines.node` `">=24 <25"`, `build` as `pnpm --filter @meniscus/web build`, `start` as `node apps/server/src/index.ts`. Keep `packageManager` `pnpm@12.5.1`. Add `.node-version` (`24`). Update `.env.example`: drop `MENISCUS_API_TOKEN`; add `TRUST_PROXY_HOPS`, `WEB_DIST` and `SHUTDOWN_GRACE_MS`, commented. Verify: `pnpm build` writes `apps/web/dist/index.html`, and `pnpm install --frozen-lockfile --offline` reports the lockfile up to date (no install of anything new).
- [x] 7.2 Add `render.yaml` at the repo root with the fields in design D9, the budget variables included (`MODEL_API_MAX_REQUESTS_PER_HOUR`, `MODEL_API_MAX_CONCURRENT`, `CRITICAL_RESERVE_PCT`, `AI_RATE_LIMIT_PER_MINUTE`), secrets only as `sync: false`, and the Phase B variables commented. Verify: every key is in the [Blueprint spec](https://render.com/docs/blueprint-spec), and it matches `docs/deployment.md` §3 and §9 byte for byte where the doc quotes it.
- [x] 7.3 Update `README.md`: drop the token lines (`:173`, `:203`, `:269`, `:285`); describe the session as the boundary; production-like run as `pnpm build && NODE_ENV=production MENISCUS_DEMO_LOGIN=1 pnpm start`; the quality curl (`:165`) signs in with a cookie jar first. Check that `docs/deployment.md` still matches what was built (variables, commands, smoke test), including §6 (`:297`), which must not cite the `vite.config.ts:10` `loadEnv` this change removes. Verify: `grep -rn MENISCUS_API_TOKEN README.md docs apps packages .env.example` finds nothing outside archived changes, and `grep -n loadEnv docs/deployment.md apps/web/vite.config.ts` finds nothing.

## 8. Integration

- [x] 8.1 Local production-mode smoke test, 0 model requests. Never read `.env`, and send each curl once (no loops):
  ```sh
  pnpm build
  D=$(mktemp -d)
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production MENISCUS_DEMO_LOGIN=1 DATA_DIR="$D" PORT=8799 \
    MODEL_API_BASE_URL=http://127.0.0.1:9/v1 MODEL_API_KEY=fake node apps/server/src/index.ts &
  curl -sS -i http://127.0.0.1:8799/api/health          # 200 {"ok":true}
  curl -sS -i http://127.0.0.1:8799/n/w/2               # 200 text/html, Cache-Control: no-cache (SPA fallback)
  curl -sSI http://127.0.0.1:8799/sw.js                 # Cache-Control: no-cache
  curl -sS -i http://127.0.0.1:8799/api/wards           # 401 {"error":"sign_in_required"}
  kill -TERM %1; wait %1; echo "exit $?"                # exit 0
  ```
  Verify: the outputs are as commented, the server log has no request bodies, and nothing listened on port 9.
- [x] 8.2 `pnpm verify` passes (format, lint, `openspec validate --all --strict`, spec:check, typecheck, tests).

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply` and before `/opsx:archive`.
- User-run on Render (no agent deploys): create the service from `render.yaml`, set `MODEL_API_KEY` and run `docs/deployment.md` §7's smoke test. Then check the proxy hop count (design "Open Questions"): send 21 wrong sign-ins, each with a different made-up leftmost `X-Forwarded-For` entry. With `TRUST_PROXY_HOPS=1` right, the 21st is 429 `rate_limited`. If it is 401, the server is trusting a client-chosen entry: Render appended no entry, so the value is too high; lower it or ask Render support. A 429 shows the key isn't client-chosen. It doesn't prove the key isn't a shared edge address; if all users hit 429 together, raise the value by one. This makes 0 model requests.
- postgres-store's shutdown task (its tasks 4.10) builds on 6.1 here.
- s3-media (next in order) builds on 6.1 and 5.1 here (design "Later changes"): its bucket check joins the web build check in `startServer`'s `beforeListen`, `/api/health` stays off S3, and the shutdown grace covers its in-flight S3 deletes. Nothing to do in this change.
- Archive with `openspec archive deploy-ready --yes` after `pnpm verify` passes.
