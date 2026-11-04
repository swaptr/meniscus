# Proposal

## Why

The API that turns patient photos and voice notes into chart entries is open: anyone who can reach the server can call `/api/ai/*`, spend the team's model credits (exhausting the hourly budget for real users) and send arbitrary bytes to Meta labelled as images. Responses carry no security headers, may be cached, and the server listens on every interface. Patient data must not be exposed even in a hackathon build.

## What Changes

- `/api/ai/*` requires `Authorization: Bearer <MENISCUS_API_TOKEN>` when a token is configured; production refuses to start without a ≥ 32-character token. `/api/health` stays public.
- Per-client rate limit on `/api/ai/*` (default 20 per rolling minute), answered with 429 `rate_limited` and `Retry-After` before any model request.
- Image uploads must match their declared type's file signature.
- Security headers on every response; `Cache-Control: no-store` on `/api/ai/*`.
- Server binds `127.0.0.1` unless `HOST` is set.
- Unexpected errors answer `{ "error": "internal_error" }` only.
- Upstream model requests per user action: unchanged. Rejected requests (401, 429, bad upload) make none.
- BREAKING (dev only): the web dev server must send the token. The Vite proxy adds it from `MENISCUS_API_TOKEN`, so the browser bundle never contains it.

## Capabilities

### New Capabilities
- `server/security`: who may call the API, how often, what it accepts, and what it reveals.

### Modified Capabilities
None.

## Impact

- `apps/server/src/config.ts` (new env: `HOST`, `NODE_ENV`, `MENISCUS_API_TOKEN`, `AI_RATE_LIMIT_PER_MINUTE`), `apps/server/src/app.ts`, `apps/server/src/index.ts`, new `apps/server/src/security.ts`, `apps/server/src/routes/ai.ts` (signature check), `apps/web/vite.config.ts` (proxy header), `.env.example`.

Out of scope: staff login/PINs and per-user sessions (PLAN §5), TLS termination (deployment), persistent storage encryption (no storage yet).
