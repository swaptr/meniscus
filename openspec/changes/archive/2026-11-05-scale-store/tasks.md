# Tasks

Narrowed to media expiry by `linked_at`, budget pressure and `/api/metrics` (proposal). Every test is written first and seen failing. Server tests use `await testApp()` and a fake `fetch`, and assert exact upstream counts, 0 where none is expected. No task sends a live model request.

## 1. Baseline

- [x] 1.1 Confirm `apps/server/drizzle/meta/_journal.json`'s latest entry is `0002_labeled_media`, and that the MODIFIED blocks of [capture/read-budget] Read mode fits the budget and Served tray reads fit the budget copy the live text with only this change's edits. Verify: `pnpm exec openspec validate scale-store --strict` passes.
- [x] 1.2 Add `BUDGET_PRESSURE_PCT` (integer 1–100, default 50) to `apps/server/src/config.ts` and `.env.example`. Verify: a config test titled `[capture/read-budget] Reads under budget pressure: point from config` shows the default 50 and 0 and 101 rejected naming the variable.

## 2. Budget pressure

- [x] 2.1 Write the citing tests and see them fail: every scenario of [capture/read-budget] Reads under budget pressure. Update in place, keeping their titles, the tests of Read mode fits the budget: Room for three (now 5B bed 1, `watch`) and of every Served tray reads fit the budget scenario (now 5B bed 1 with a served lunch photo). Each asserts exact SAM and Spark counts.
- [x] 2.2 `plan()` in `apps/server/src/ai/budget-policy.ts` gains the pressure rule ahead of the served and fit rules (design §2); `withBudget` passes the action's status and reuses `BUDGET_PRESSURE`; `AiPorts.budget` adds `stats`. Add per-class `{ admitted, refused, downgraded }` counters. Verify: the 2.1 tests pass; `budget-policy.test.ts` gains the 59/60 edges.
- [x] 2.3 Regression. Verify: the existing [capture/read-budget] Budget class of a model action and Whole action admitted up front tests and the [capture/meal-reading] Tray segmentation degrades tests pass unchanged.

## 3. Media expiry by `linked_at`

- [x] 3.1 Write the tests and see them fail: `[charting/media] Unlinked media expires: same rows as before` (the exact `NOT EXISTS` predicate and `linked_at IS NULL` select the same ids over entry, level, proof, tray, served and labeled-copy links, old and new unlinked rows) and `[charting/media] Unlinked media expires: linked row survives the migration` (a database migrated to `0002`, with a linked media row older than 24 h, migrated to the latest, keeps that row through expiry).
- [x] 3.2 `media.linked_at` and the partial index `media_unlinked` in `apps/server/src/db/schema.ts`; `drizzle-kit generate` writes `0003`. A custom `0004` adds `meniscus.mark_media_linked()`, its triggers on `entry`, `level` and `meal`, and the backfill (design §1).
- [x] 3.3 `expireMedia`, `liveMedia`, the link check and `servedPhoto` use `linked_at IS NULL`; `gcMedia` keeps the exact check. Verify: the 3.1 tests pass; the existing [charting/media] Unlinked media expires, Media goes with its record and Objects go with their last media row tests and [charting/meals] Served tray of a bed tests pass unchanged; [server/storage] Schema migrated on start and Tables closed to Supabase's APIs: Every table pass.

## 4. Metrics

- [x] 4.1 Write the citing tests in `apps/server/src/metrics.test.ts` and see them fail: every scenario of [server/metrics] Operational metrics, Metrics are for the matron and Metrics hold no patient data.
- [x] 4.2 Docs first: confirm `matchedRoutes` in the pinned `hono` (`node_modules/hono/dist/helper/route/index.js`) and what it returns for an unmatched request; note it beside its use.
- [x] 4.3 The metrics middleware, first in `createApp`, and `apps/server/src/routes/metrics.ts` (matron check, `budget.stats()`, the policy counters, sizes from `pg_total_relation_size` and `meniscus.media`). Verify: the 4.1 tests pass with 0 upstream requests from the metrics route.

## 5. Docs and gates

- [x] 5.1 AGENTS.md request counts: a stable or bedless `sam+spark` photo or tray read makes 1 under pressure. README: at most a three-line Scaling note naming `BUDGET_PRESSURE_PCT` and `/api/metrics`.
- [ ] 5.2 `pnpm verify` passes.
