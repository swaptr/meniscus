# Proposal

Narrowed on 2026-11-05: this change applies media expiry by `linked_at`, budget pressure and `/api/metrics`. The read-path reuse, acuity intervals, ward default route, web picker and bench moved to `scale-store-followups`.

## Why

- Media expiry walks every media row older than 24 h with eight `NOT EXISTS` checks on each upload.
- Stable beds still read with SAM when half the hourly budget is spent, trays and served-tray comparisons included, leaving less for watch and critical beds.
- Nothing shows how the server and the model budget hold up: no request counts, latencies or refusals by class.

## What Changes

- **Media expiry** (internal). `media.linked_at`, set by a database trigger when an entry, level or meal first names the media (photo, after-emptying photo, tray or served photo, labeled copy), lets expiry, `liveMedia`, the link check and the served-photo lookup read only never-linked media through a partial index. The migration backfills `linked_at` for every row linked today, so no linked media expires. Losing the last link still deletes the media at once (`gcMedia` keeps its exact check). HTTP behaviour is unchanged.
- **Budget pressure** (`capture/read-budget`). Once `BUDGET_PRESSURE_PCT` (default 50) of the cap is in use, a `sam+spark` photo or tray read with no bed, or whose bed's higher of set and suggested acuity is `stable`, makes 1 request in `spark` mode, even with a comparable served photo. Watch and critical beds keep 3, or 5 with a served photo, while they fit.
- **Metrics** (new `server/metrics`): `GET /api/metrics`, matron only: request counts and latencies by route pattern, budget use and remaining by class, actions admitted, refused and downgraded, and store and media sizes. No patient data.

### Upstream model requests per user action (before → after)

| Action | Before | After |
| --- | --- | --- |
| Photo or tray read, `sam+spark`, stable bed or no bed | 3 (5 with a served photo) while they fit, else 1, else 0 | 1 at or above the pressure point; below it unchanged; refused: 0 |
| Photo or tray read, `sam+spark`, watch or critical bed | 3 / 5 while they fit, else 1, else 0 | unchanged |
| Requested `spark`, voice note, text note, Explain | 1 / 2 / 1 / 1 | unchanged |
| Metrics | — | 0 |

### Changed shapes

- HTTP: new `GET /api/metrics` (`OperationalMetrics`, `ModelActionCounts` in `packages/shared`); photo and tray reads may return `mode: "spark"` with a `budget pressure` warning under pressure.
- Config: `BUDGET_PRESSURE_PCT` (integer 1–100, default 50).
- Server internals: `Store.sizes()`; `AiPorts.budget` adds `stats`.
- Schema: migration `0003` adds `media.linked_at` and the partial index `media_unlinked`; custom migration `0004` adds the link trigger and the backfill.

### Out of scope

Everything in `scale-store-followups`; multiple server processes (budget and metrics are per process); a metrics web view.

## Capabilities

### New Capabilities
- `server/metrics`: operational counts with no patient data, for the matron.

### Modified Capabilities
- `capture/read-budget`: **Read mode fits the budget** and **Served tray reads fit the budget** defer to the new **Reads under budget pressure**.
- `charting/media`: not modified; `linked_at` is internal and "Unlinked media expires" holds unchanged.

## Impact

- `apps/server`: `src/db/schema.ts`, `drizzle/0003_*`, `drizzle/0004_*`, `src/store/pg/media.ts`, `src/store/pg/meals.ts`, `src/ai/budget-policy.ts`, `src/config.ts`, new `src/metrics.ts` and `src/routes/metrics.ts`, `src/app.ts`, `.env.example`.
- AGENTS.md request counts (the pressure downgrade). No new dependencies.
