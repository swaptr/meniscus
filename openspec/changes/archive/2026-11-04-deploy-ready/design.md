# Design

## Changed types

No `packages/shared` or `@meniscus/meta` type changes. The server's own types:

```ts
// apps/server/src/config.ts
const Env = z.object({
  // removed: MENISCUS_API_TOKEN, and the production refine that required it
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Proxies in front of the server whose X-Forwarded-For / X-Forwarded-Proto entries are trusted. 1 on Render. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  /** The web build to serve. Default: apps/web/dist, resolved from this file, not the cwd. */
  WEB_DIST: z.string().min(1).default(fileURLToPath(new URL('../../web/dist', import.meta.url))),
  /** How long in-flight requests may run after SIGTERM before their connections are closed. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(25_000),
  // …every other variable unchanged
})

// apps/server/src/app.ts
export interface AppOptions {
  ai?: Ai
  statusClient?: StatusClient
  store?: Store
  // removed: apiToken
  rateLimitPerMinute?: number
  now?: () => number
  demoLogin?: boolean
  secureCookie?: boolean
  /** Serve this directory outside /api (server/hosting). Omitted: /api only (tests, dev without a build). */
  webDist?: string | undefined
  /** server/security "Trusted proxy hops" (default 0). */
  trustProxyHops?: number
}

// apps/server/src/serve.ts (new)
export interface Running {
  server: ServerType // from @hono/node-server; a node:http Server here
  /** Idempotent. Stops accepting, drains for graceMs, closes the rest, then the store. */
  shutdown(): Promise<void>
}
export function startServer(o: {
  fetch: (r: Request) => Response | Promise<Response>
  store: Store
  host: string
  port: number
  graceMs: number
  /** Start checks, awaited before listening; a rejection rejects startServer and nothing listens. deploy-ready: the web build check. s3-media adds its HeadBucket. */
  beforeListen?: () => Promise<void>
}): Promise<Running>
```

## Layer ownership

| Module | Layer | Owns |
| --- | --- | --- |
| `src/config.ts` | config | new variables, the token's removal |
| `src/security.ts` | HTTP guards | `clientAddress(c, hops)` and `requestProtocol(c, hops)` (pure over headers plus socket); `rateLimit` and `sameSite` take `hops`. `bearer` is deleted |
| `src/routes/common.ts` | HTTP | `session()` refuses reads too |
| `src/routes/session.ts` | HTTP | `Secure` when `secureCookie` or `requestProtocol` is `https` |
| `src/web.ts` (new) | HTTP | static files, SPA fallback and cache headers, over `serveStatic` from `@hono/node-server/serve-static` |
| `src/app.ts` | composition | root app: headers, then `/api`, then the web |
| `src/serve.ts` (new) | process | start checks (`beforeListen`), listen and shutdown |
| `src/index.ts` | process | config → store → app → `startServer` (web build check in `beforeListen`) → signal handlers |
| `apps/web` | none | only the Vite proxy loses its token header |

## Context

- **Auth today.** `session()` (`routes/common.ts:56`) sets `staff` from the cookie on every request, but returns 401 only for non-GETs. Routes that need a role use `requireRole`. GETs are open to anyone who has the device token, and production requires the token (`config.ts:56`). Only a proxy can add it, because the browser never holds it (`vite.config.ts:62`).
- **The web already reads only when signed in.** `__root.tsx` wraps every route in `SessionGate`. Until `GET /api/session` returns 200, the gate shows the sign-in screen instead of the routes, so no data GET is sent (web/staff "Staff on shift: Nobody chosen" covers the bed link). The only fetch outside the gate is the `/api/health` poll (`use-api-status.ts:26`). A 401 `sign_in_required` from any path except `/api/session` already locks the screen (`lib/session.ts:153`, web/staff "Lock when idle"). `fetch` sends same-origin cookies by default, and `<img src="/api/entries/:id/photo">` does too: `SameSite=Strict` and `Path=/api` both match. **No web code changes.**
- **Proxy view.** `@hono/node-server` builds `c.req.url` from the `Host` header with `http://`, unless the socket is TLS. Behind Render's TLS termination, `new URL(c.req.url).origin` is `http://host`, while the browser's `Origin` is `https://host` (`security.ts:42`). The rate-limit key is the socket address (`security.ts:49-56`), which is the proxy for every client.
- **Type stripping.** Node 24 runs `.ts` files natively, by erasing types. The non-erasable syntax the server loads is parameter properties: `store/store.ts:686`, and in `@meniscus/meta`, which the server loads through `model-api.ts`, the error constructors in `packages/meta/src/errors.ts` (`:30-38`, `:62`, `:72`, `:88-92`, `:102-104`, `:114-115`) and `packages/meta/src/asr.ts:56-57`. `lab/synth.ts:273` has one too, but routes never import it. A trial `import('./src/app.ts')` under Node 24.18 failed only with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (parameter property). Imports already use `.ts` extensions (`allowImportingTsExtensions`), `verbatimModuleSyntax` keeps type-only imports explicit, and nothing imports JSON. The workspace packages resolve through pnpm symlinks to `packages/*/src`, outside `node_modules`, so Node strips them as well. `@meta-sam/parser` ships JS.

## Decisions

### D1. One Render Web Service, native Node runtime; Node serves the web

**Chosen.** Hono serves `apps/web/dist` and `/api` on one origin, on Render's `node` runtime:
- build `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build`;
- start `node apps/server/src/index.ts`.

**Why not Caddy in Docker** (the doc's old recommendation)? It existed only to add the bearer token. With the token gone (D2), it adds a second process, a Dockerfile, a Caddyfile, a start script and an image build, and it still needs D4 (the rate-limit key behind Render's own proxy). Without Docker, Render's native runtime picks Node from `.node-version` ([Node version](https://render.com/docs/node-version)).

**Why not a Static Site plus an API service?** It needs CORS, a configurable API base URL and a `SameSite=None` cookie (`docs/deployment.md` §5). Out of scope.

`--prod=false`: Render sets `NODE_ENV=production` for the build too, because the Blueprint sets it, and pnpm then skips devDependencies. Vite is one of them. The runtime needs none: start uses plain `node` (D6).

### D2. Remove the device token; the session is the boundary

**Chosen.** Delete `MENISCUS_API_TOKEN`, `bearer()` and the production refine. Every `/api` route except `/api/session` and `/api/health` needs a session (server/security "Signed-in reads", "Signed-in changes"). zod strips unknown keys, so a leftover `MENISCUS_API_TOKEN` in an environment is ignored.

**Alternatives:**
- *Keep it for machine clients.* There are no HTTP machine clients: `eval`, `synth` and `demo` work on the store and the Meta client in-process, and an HTTP client needs a session anyway. A token that the browser can't send would also have to be off for browser requests, so it would guard nothing.
- *Keep it optional, as an extra gate for a proxy deploy.* That keeps two auth paths and a footgun (set it, and the same-origin web breaks). It can return as a change if a proxy deploy is ever wanted.

### D3. Session on reads

`session()` drops the `GET`/`HEAD` exemption. `/api/session` stays exempt (sign-in, and its own 401 body with `hospital` and `demo_accounts`), and `/api/health` stays outside the guarded group (`except('/api/health', …)`). Order in `/api`: `noStore`, `session`, `sameSite`, then the limiters. That matches today minus `bearer`: callers without a session can't use up anyone's rate-limit quota, as before. A read refreshes the session's idle clock, as today.

`GET /api/ai/status` now needs a session before its one `models.list` request, so an anonymous caller can no longer spend model budget. `requireRole` checks stay as they are.

### D4. Trusted proxy hops

`TRUST_PROXY_HOPS = n` (0–3, default 0; Render 1).

- **Client address.** With `n = 0`, it is the socket address (today's rule). With `n ≥ 1`, split `X-Forwarded-For` on commas and trim each entry. With at least `n` entries, the client is entry `length − n` (the n-th from the right); with fewer, the socket address. Every entry to its left is client-supplied, so it is never used. This is the same rule as Express's numeric `trust proxy`.
- **Protocol.** With `n ≥ 1`, the last comma-separated value of `X-Forwarded-Proto`, if it is `http` or `https`; otherwise, and with `n = 0`, `https` on a TLS socket and `http` otherwise.
- **Uses.** `sameSite()` compares `Origin` against `${protocol}://${Host}`, plus the dev origin. Sign-in sets `Secure` when `secureCookie` is on (production) or the protocol is `https`. The rate limiters key on the client address.
- **`Host`** is used as received. Render forwards it, and the CSRF check only needs it to match the browser's `Origin`, which an attacker can't choose.

Render's docs don't say how many entries its proxy appends. A Render community thread reports that the proxy keeps the incoming header and appends one entry, which matches `n = 1` (Open Questions).

### D5. Web serving (`src/web.ts`)

The root app has three parts. `headers()` runs for every path. Then `.route('/api', api)`, whose `notFound` answers `{"error":"not_found"}` as JSON. Then the web handler for GET (Hono answers HEAD through GET). Everything else falls to the root `notFound`, a plain 404.

- **Files.** `serveStatic({ root: webDist })` answers the files that exist. Its `onFound` sets `Cache-Control`: `public, max-age=31536000, immutable` under `/assets/` and `no-cache` everywhere else, which is the vite-plugin-pwa guidance for `sw.js`, `index.html` and the manifest ([deployment](https://vite-pwa-org.netlify.app/deployment/)). `serveStatic` refuses paths that leave `root`, and `allowPercentInPath` stays false.
- **SPA fallback.** If no file matches and the last segment has no `.`, the handler answers `index.html` with `no-cache`. `/a/bed/<token>`, `/n/w/2` and `/n/10/print` have no dot. A QR token is base64url, so it has no `.` either. A missing `/assets/x.js` gets 404, never HTML, so a stale chunk fails cleanly and the service worker fetches the new `index.html`.
- **Mounting.** `/api` is mounted before the web handler, and the handler skips `/api` and `/api/*` explicitly, so it can never answer them.
- **Root `notFound`.** Plain 404 for non-GET web paths.
- **Security headers** now apply to web responses too. `secureHeaders` sets no CSP by default, and the defaults it does set (COOP and CORP `same-origin`, `X-Frame-Options: DENY`) don't affect a same-origin PWA.
- **`index.html` is read per request** through `serveStatic`, not cached in memory, so a disk swap is not an issue. Render replaces the instance on deploy anyway.
- **Production check.** When `NODE_ENV=production`, `index.ts` passes `startServer` a `beforeListen` that checks that `${WEB_DIST}/index.html` exists. Otherwise it throws `WEB_DIST: no web build at <path>/index.html; run pnpm build` (server/hosting "Production needs the web build"). Without it, Render's health check would pass on a server with no UI.

### D6. Production start without tsx

**Chosen:** `node apps/server/src/index.ts`, through Node 24's type stripping.
- Rewrite the parameter properties at `store/store.ts:686`, `lab/synth.ts:273`, `packages/meta/src/errors.ts` (`:30-38`, `:62`, `:72`, `:88-92`, `:102-104`, `:114-115`) and `packages/meta/src/asr.ts:56-57` as declared fields plus assignments.
- Add `"erasableSyntaxOnly": true` to `packages/config/tsconfig/base.json`, so `tsc` refuses enums, namespaces and parameter properties from now on.
- Add the server script `"start:prod": "node src/index.ts"` and the root script `"start": "node apps/server/src/index.ts"`.
- The dev scripts (`dev`, `start` with `--env-file-if-exists`, tests) keep `tsx`.

**Alternatives:**
- *Move `tsx` to dependencies.* One more runtime dependency, an esbuild binary, in production, for no gain.
- *Add an esbuild or tsc build step.* An emit config, a `dist/` and source maps. More moving parts than a small field refactor.

### D7. Graceful shutdown (`src/serve.ts`)

`startServer` first awaits `beforeListen` when given; if it rejects, `startServer` rejects with that error, nothing listens, and `index.ts` logs the message and exits 1. Then it calls `serve({ fetch, hostname, port })` and resolves once the server is listening. `shutdown()` is idempotent:
1. `server.close()` stops accepting new connections, then `server.closeIdleConnections()`.
2. Wait for close, or `graceMs`, whichever comes first.
3. On timeout, `server.closeAllConnections()`.
4. `store.close()`.

`index.ts` registers `process.once('SIGTERM' | 'SIGINT', () => running.shutdown().then(() => process.exit(0)))`.

The 25 s default stays under Render's `maxShutdownDelaySeconds` default of 30, after which Render sends SIGKILL ([Blueprint spec](https://render.com/docs/blueprint-spec)). A photo read can take longer: `MODEL_API_TIMEOUT_MS` is 90 s. A read cut off at the limit loses its answer, and the web shows the network error and keeps the photo (web/capture). Nothing is retried. Lowering `MODEL_API_TIMEOUT_MS` is not part of this change.

Tests:
- **Draining** is tested in-process. `startServer` is given a `fetch` that holds a response until the test releases it, on `127.0.0.1:0`.
- **Exit code** is tested by spawning `node src/index.ts` with `NODE_ENV=development` set explicitly, a temp `DATA_DIR`, `MODEL_API_BASE_URL=http://127.0.0.1:9/v1` (nothing listens there), a free `PORT` and an empty `WEB_DIST` in development. The test waits for the listen line, sends SIGTERM and expects exit 0. No model request can be sent, because the test makes none.

### D8. Health

The handler returns `c.json({ ok: true })` and closes over nothing, with no store and no clock. `ENTRY_CATEGORIES` leaves the body. The web reads only `r.ok`, and nothing else reads `categories`. It stays outside `noStore` (security headers scenario).

### D9. Tooling

- `package.json` (root):
  - `engines.node` becomes `">=24 <25"`, an upper bound as Render advises ([Node version](https://render.com/docs/node-version)).
  - `packageManager` stays `pnpm@12.5.1`, through corepack, which Node 24 bundles.
  - `build` becomes `pnpm --filter @meniscus/web build` (today `pnpm -r build` builds the web only by accident).
  - add `start` (see D6).
- `.node-version`: `24`.
- `render.yaml` at the repo root, a Blueprint ([spec](https://render.com/docs/blueprint-spec)):
  - `runtime: node`, the build and start commands of D1, `healthCheckPath: /api/health`, `numInstances: 1`, `maxShutdownDelaySeconds: 30`, `autoDeployTrigger: checksPass`;
  - the Phase A disk at `/var/data`;
  - `envVars`: `NODE_ENV=production`, `HOST=0.0.0.0`, `TRUST_PROXY_HOPS=1`, `DATA_DIR=/var/data`, `MENISCUS_DEMO_LOGIN`, `MODEL_API_KEY` (`sync: false`), and the budget variables `MODEL_API_MAX_REQUESTS_PER_HOUR=120`, `MODEL_API_MAX_CONCURRENT=4`, `CRITICAL_RESERVE_PCT=30` and `AI_RATE_LIMIT_PER_MINUTE=20`;
  - no `PORT`: Render sets it (default 10000; [web services](https://render.com/docs/web-services));
  - the Phase B variables, commented, as in `docs/deployment.md`.
- `.env.example`: drop `MENISCUS_API_TOKEN`; add `TRUST_PROXY_HOPS`, `WEB_DIST` and `SHUTDOWN_GRACE_MS`, commented, with their defaults.
- `vite.config.ts`: drop the `MENISCUS_API_TOKEN` header and the `loadEnv` call.
- `README.md`: rewrite the "Outer boundary", token and "Production-like" lines; the quality curl signs in with a cookie jar.

### D10. Test harness

`testApp().request` signs in for every request that carries no cookie, except to `/api/session` and `/api/health`, GETs included (today: non-GETs only). `cookie: null` still sends none. Existing assertions stay unchanged. Tests that built `createApp` with `apiToken` are rewritten against the requirements that replace it. Tests citing the two removed requirements are deleted with them, so spec:check passes. A citing test for a removed requirement would fail it.

## Later changes (order: drink-types → deploy-ready → s3-media → ui-polish → labeled-photo-copy → scale-store → postgres-store → read-queue)

- **drink-types** (applying now) touches none of these requirements. Its delta to charting/model-accuracy adds drink requirements but leaves "Model accuracy summary" as it is, so this change's MODIFIED copy is the live text. Its new server tests that read without a cookie pass once D10 lands. If drink-types archives after this change is applied, check them anyway.
- **ui-polish** must pick up:
  - the server tests of 6.6 (`bag_levels` on `GET /api/admissions`) and 6.7 (`hourly`, `worst_tone` on `GET /api/wards`) go through `testApp`, or must send a cookie;
  - task 9.2 starts the server with `node src/index.ts` (no `.env`), and after `pnpm build` it may use the built web at the same port instead of Vite;
  - the sidebar, quick jump, Next up and entry peeks run only inside `SessionGate`. Their GETs (`/api/wards`, the worklist, `/api/media/<id>`) carry the cookie. A 401 locks the screen (web/staff "Lock when idle"), and the peek's media cache must not cache a 401 as a photo;
  - no new GET may run outside `SessionGate`, except `/api/health`.
- **labeled-photo-copy**: nothing beyond D10 for its server tests.
- **scale-store**: `GET /api/metrics` is already session-only, so nothing changes. Its store version bump (9 → 10) means deleting `/var/data/meniscus.db*` on Render (`docs/deployment.md` §3.3), as do s3-media's (7 → 8) and labeled-photo-copy's (8 → 9). This change bumps no `STORE_SCHEMA_VERSION`.
- **postgres-store** (edited in this change's scope):
  - the schema bootstrap fix;
  - a task to close its pools and session client in `store.close()`, which `serve.ts`'s shutdown already awaits;
  - health stays store-free, so a database outage doesn't fail Render's health check;
  - its start checks (schema, RLS) run in `index.ts` before `startServer`.
- **read-queue** must pick up:
  - its worker stops (no new claims, release its `LISTEN` client) inside `shutdown()` before `store.close()`; it adds that step to `serve.ts`;
  - `POST /api/ai/read-again` is guarded by the session, not the removed bearer token (its design "Read again"); the read states it adds to `GET /api/admissions/:id/entries` and `GET /api/metrics` need a session like every read; its server tests go through `testApp` or send a cookie.
- **s3-media** (applies next, after this change is archived). When it lands:
  - its bucket check (one HeadBucket) joins the web build check in the `beforeListen` that `index.ts` passes to `startServer`, after it, and a failure exits 1 without listening;
  - `GET /api/health` stays off S3, as it stays off the store ("reads no store"), so an S3 outage shows as 503s on media requests and never fails Render's health check;
  - the spawn tests of 6.2 and the smoke test of 8.1 set its media variables explicitly: `MEDIA_STORE=memory` in development; in production, the loopback local stack or a fake https S3 behind the injected `fetch`;
  - its object deletes after a reject, void or expiry run inside the request, so `shutdown()`'s `SHUTDOWN_GRACE_MS` drain covers in-flight S3 deletes; there is no media client to close.

## Risks / Trade-offs

- [Render appends a different number of `X-Forwarded-For` entries than 1] → the rate-limit key would be a Render or edge address (a shared bucket, as today), or, with a hop count that is too high, a client-chosen value. Mitigation: a user-run check before real use (tasks.md "Workflow follow-up"). `TRUST_PROXY_HOPS` is config only.
- [A deploy cuts off a model read in flight after 25 s] → its credits are spent and the answer is lost. The read isn't retried. Mitigation: deploy outside busy hours, and the web keeps the photo for a manual retry.
- [A stale service worker serves an old `index.html` that names deleted chunks] → `no-cache` on `sw.js` and `index.html`, `registerType: 'autoUpdate'`, and a missing asset is a 404, not HTML.
- [Node's type stripping is still marked experimental in some 24.x releases and may print an `ExperimentalWarning`] → harmless on stderr. Pinning Node 24 keeps the behaviour fixed, and the smoke test runs on the same major.
- [Every read now needs a session] → a kiosk or ward display that reads without signing in would break. None exists: every route is behind `SessionGate`.
- [Removing the token removes a second factor in front of the API] → the token was a shared secret in a proxy, not a per-user factor. Sessions expire with the shift or after 30 idle minutes, are `HttpOnly`, `SameSite=Strict` and `Secure`, and sign-in is rate-limited per client (now the real client, D4).

## Migration Plan

1. Apply and archive. Locally, `pnpm build && NODE_ENV=production MENISCUS_DEMO_LOGIN=1 pnpm start` serves the app at `http://127.0.0.1:8787`. Production sets `Secure`, so use `localhost`; a LAN address over plain HTTP needs HTTPS.
2. The user creates the Render service from `render.yaml` (Blueprint) or the dashboard, following `docs/deployment.md`, and sets `MODEL_API_KEY`. No agent deploys.
3. Rollback: redeploy the previous commit. Phase A data on the disk is unaffected, because this change does not touch the store schema.

## Open Questions

- **How many proxy entries Render appends.** Its docs don't say. The user-run check in tasks.md "Workflow follow-up" confirms `TRUST_PROXY_HOPS=1` or finds that a different value is needed. Changing the value is config only.
