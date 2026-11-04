# Proposal

## Why

Meniscus is going to run on Render as one public web service, and later on Supabase through postgres-store. Today anyone with the URL can read every ward's chart, because GET reads need no session (`apps/server/src/routes/common.ts:56`). The only outer guard is a bearer token that only a proxy can add (`config.ts:56-59`, `security.ts:21-30`). The server also serves only `/api` (`app.ts:55`), binds to loopback, can't see through Render's proxy, and has no SIGTERM handler (`index.ts:18`). `docs/deployment.md` lists these gaps.

## What Changes

- **Topology: one Render Web Service, on the native Node runtime.** The Node server serves the web build itself, on the same origin as `/api`. There is no Caddy, no Docker and no Static Site. `docs/deployment.md` is rewritten to match.
- **BREAKING (HTTP): every `/api` read needs a signed-in session.** Every GET and HEAD under `/api`, except `/api/session` and `/api/health`, answers 401 `sign_in_required` without a live session. This includes `GET /api/beds/:token`: a bed QR token identifies the bed and the session authorises. The web app already sends every data read after sign-in (web/staff "Staff on shift"), so no web code changes.
- **BREAKING (config): the device token is removed.** `MENISCUS_API_TOKEN` and its bearer check go. Production no longer needs it, and the server ignores the variable when it is set. The session cookie (`HttpOnly; SameSite=Strict; Path=/api`, `Secure` in production) is the browser's only credential. No machine client needs the token: scripts use the store, and curl signs in like the web does. The Vite dev and preview proxy stops adding the header.
- **The web build is served from Hono.** Files come from `WEB_DIST` (default `apps/web/dist`). Unknown non-API paths without a file extension fall back to `index.html`. Hashed `/assets/*` files are cached as immutable, and everything else gets `no-cache`. `/api` paths are never answered with the web app. In production the server refuses to start without the build.
- **Behind a proxy.** `TRUST_PROXY_HOPS` (default 0) sets how many proxies to trust. It is 1 on Render. With 1 or more, the client address for rate limits comes from `X-Forwarded-For` at that hop. `X-Forwarded-Proto` then sets the request's own origin for the CSRF check, and adds `Secure` to the session cookie over HTTPS.
- **Bind and port.** `HOST` (default `127.0.0.1`) and `PORT` (default `8787`) are unchanged. The Render config sets `HOST=0.0.0.0`, and Render provides `PORT`.
- **Health.** `GET /api/health` answers exactly `{"ok":true}`. It needs no session, reads no store and makes 0 model requests. It no longer returns `categories`, which nothing reads.
- **Graceful shutdown.** On SIGTERM or SIGINT the server stops accepting connections and lets in-flight requests finish within `SHUTDOWN_GRACE_MS` (default 25 000, under Render's 30 s). It then closes the remaining connections and the store, and exits 0.
- **Tooling (no spec).**
  - Node 24 is pinned: `engines` `>=24 <25`, `.node-version`, and `packageManager` through corepack.
  - Production runs `node apps/server/src/index.ts` with Node's built-in type stripping, with no `tsx` and no build step. The parameter properties in `apps/server/src/store/store.ts`, `apps/server/src/lab/synth.ts`, `packages/meta/src/errors.ts` and `packages/meta/src/asr.ts` become fields, and `erasableSyntaxOnly` guards against new ones.
  - The root `build` script builds the web.
  - A `render.yaml` Blueprint keeps the request-budget variables.
- **postgres-store fix (in that change).** The server creates its tables on first start in a `meniscus` schema that has no tables, which is what the bootstrap SQL leaves. A schema that has tables but no `schema_version` is still refused. That change also gets a task to close its pools through this change's shutdown.

## Capabilities

### New Capabilities

- `server/hosting`: how the one server process runs in production: the health check, serving the web build (files, SPA fallback, cache headers, `/api` never served as the app, build required in production) and graceful shutdown.

### Modified Capabilities

- `server/security`:
  - REMOVED "API access token" and "Production requires a token".
  - MODIFIED "Loopback by default" (adds the `PORT` default and an explicit `HOST`), "Security headers" (covers web build responses), "Staff sign-in" (`Secure` over HTTPS, no token in the scenario), "Signed-in changes" (no device-token step; its "Reads stay open" scenario keeps its name, because OpenSpec 1.16 refuses a MODIFIED block that drops a scenario name, and now covers only the two reads that stay open, `/api/session` and `/api/health`; `GET /api/wards` without a session is 401 under "Signed-in reads"), "Cross-site form posts" (own origin follows the trusted protocol) and "Demo accounts and sign-in" (no token in the scenario).
  - ADDED "Signed-in reads", "Trusted proxy hops" and "Forwarded protocol".
- `charting/model-accuracy`: MODIFIED "Model accuracy summary": it needs a session (it said "needs no session").
- `web/bed-qr`: ADDED "Bed link needs sign-in".
- `web/staff`: MODIFIED "Lock when idle" (adds a scenario: a read that answers 401 locks the screen).

## Upstream model requests per user action

None change. Photo read 3 (1 in `spark` mode), text note 1, voice note 2, Explain 1, meal tray photo 3 (5 with a served photo, 1 in `spark` mode). `GET /api/ai/status` without a session now makes 0 requests and answers 401 (before, it made 1). Health, static files and shutdown make 0.

## Shared types and HTTP shapes

- `GET /api/health`: `{ ok: true, categories }` becomes `{ ok: true }`. No `packages/shared` type describes it, and the web reads only the status code (`apps/web/src/lib/use-api-status.ts:26`). It is not BREAKING for the web.
- **BREAKING** for any client that read without signing in: every `/api` GET except `/api/session` and `/api/health` answers 401 `{ error: "sign_in_required" }` without a session. The web is unaffected.
- **BREAKING** for clients of the device token: the 401 `{ error: "unauthorized" }` from a missing bearer token no longer exists.
- No `packages/shared` or `@meniscus/meta` type changes (the `@meniscus/meta` error classes keep the same public fields).

## Out of scope

- A split-origin deploy (Render Static Site plus API): CORS, a configurable API base URL and cross-site cookies.
- Docker, Caddy, Kubernetes or any other host than Render.
- Postgres and Supabase Storage. They stay in postgres-store, apart from the bootstrap fix and the shutdown task above.
- Per-ward read authorisation: any signed-in staff member may still read any ward, as today. Changes are role-checked as today.
- Rate limits on reads, and HSTS or CSP tuning.
- Actually deploying. The user creates the Render service; no agent deploys.

## Impact

- `apps/server`:
  - changed: `config.ts` (drop `MENISCUS_API_TOKEN`; add `TRUST_PROXY_HOPS`, `WEB_DIST`, `SHUTDOWN_GRACE_MS`), `security.ts` (drop `bearer`; forwarded client and protocol), `routes/common.ts` (session on reads), `routes/session.ts` (Secure over HTTPS), `app.ts` (root app: `/api`, then the web), `index.ts` (production start and shutdown), `testing.ts` (signs in for reads too), `store/store.ts:686` and `lab/synth.ts:273` (fields instead of parameter properties), `package.json` (`start:prod`);
  - new: `web.ts` (static and SPA), `serve.ts` (listen and shutdown);
  - tests: `security.test.ts`, `session.test.ts`, every server test that reads without a cookie (through `testApp`), and new `hosting.test.ts`.
- `apps/web`: `vite.config.ts` drops the token header. `lib/api.ts:2` comment. No behaviour change.
- `packages/meta`: `src/errors.ts` and `src/asr.ts` (fields instead of parameter properties; no type or behaviour change).
- Root: `package.json` (`engines`, `build`, `start`), `.node-version`, `render.yaml`, `.env.example`, `README.md`, `docs/deployment.md`. `packages/config/tsconfig/base.json` gets `erasableSyntaxOnly`.
- Order: drink-types → **deploy-ready** → s3-media → ui-polish → labeled-photo-copy → scale-store → postgres-store → read-queue. drink-types modifies none of these requirements. Later changes keep working; design.md "Later changes" lists what each must pick up.
