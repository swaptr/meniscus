# Proposal

## Why

AI reads produce drafts that vanish: nothing is charted, nothing reaches a nurse, no balance exists. The core loop (capture at the bed → pending entry → nurse approves → running balance) needs a store and an API before any attendant or nurse screen can work.

## What Changes

- SQLite store (Node's built-in `node:sqlite`, no new dependency) at `DATA_DIR/meniscus.db`; schema created on start.
- A demo ward of six fictional admissions is seeded when the store is empty, each with an unguessable bed QR token.
- New endpoints, no model requests:
  - `GET /api/admissions`: ward list with 24 h totals and pending count.
  - `GET /api/beds/:token`: resolve a bed QR token to its admission.
  - `POST /api/admissions/:id/entries`: record a pending entry (the confirmed AI draft or a manual one).
  - `GET /api/admissions/:id/entries`: entries newest first, plus 24 h totals.
  - `POST /api/entries/:id/review`: approve (optionally correcting the volume) or reject a pending entry.
- 24 h totals count approved entries only; pending volume is reported separately.
- The API token now protects every `/api/*` route except `/api/health`, and `Cache-Control: no-store` covers them too (patient data). The rate limit stays on `/api/ai/*` (it protects model credits).
- Photos and audio are not stored (privacy; out of scope).

## Capabilities

### New Capabilities
- `charting/entries`: admissions, bed QR lookup, entry recording, nurse review, 24 h totals.

### Modified Capabilities
- `server/security`: "API access token" and "Security headers" widen from `/api/ai/*` to all of `/api/*` except `/api/health`.

## Impact

- `apps/server`: new `src/store/` (schema, seed, queries), new `src/routes/chart.ts`, `src/app.ts` (store option, wider guards), `src/config.ts` (`DATA_DIR`), `src/index.ts`.
- `packages/shared`: `Admission`, `Entry`, `Totals`, request/response shapes.
- `.gitignore`: `data/`.

Out of scope: staff login and attribution to a person, photo storage, before/after pairing, alerts, the web screens (next change).
