# Design

Shapes first: `OperationalMetrics` and `ModelActionCounts` in `packages/shared` (the `/api/metrics` body), `Store.sizes()`, `AiPorts.budget` gains `stats`, `plan()` takes the action's `AcuityStatus` instead of its class, and `actionCounts(budget)` in `ai/budget-policy.ts`.

The store is Drizzle over Postgres (postgres-store, archived): the schema is `apps/server/src/db/schema.ts`, the migrations in `apps/server/drizzle/` are the version (server/storage "Schema migrated on start"), and the latest before this change is `0002_labeled_media`.

## 1. Media expiry by `linked_at`

- `media.linked_at timestamptz` (NULL until linked) and the partial index `media_unlinked ON meniscus.media (created_at) WHERE linked_at IS NULL`, in `schema.ts`; `drizzle-kit generate` writes `0003_*`.
- **Set by a trigger, not by each write.** Custom migration `0004_*` (`drizzle-kit generate --custom`) adds `meniscus.mark_media_linked()` and `AFTER INSERT OR UPDATE` row triggers on `entry` (`media_id`, `labeled_media_id`), `level` (`media_id`, `proof_media_id`, `labeled_media_id`) and `meal` (`media_id`, `served_media_id`, `labeled_media_id`): it sets `linked_at = now()` on each named media row whose `linked_at` is NULL. No link site can be missed, including future ones on these columns.
- **Backfill** in the same migration: `UPDATE meniscus.media SET linked_at = created_at WHERE linked_at IS NULL AND <the NOT EXISTS predicate is false>`, i.e. every row today's `unlinked()` treats as linked. A test migrates a database with a linked row older than 24 h through `0004` and sees it survive expiry.
- **Readers.** `expireMedia`, `liveMedia`, the link check in `media.ts` and `servedPhoto` in `meals.ts` use `linked_at IS NULL` (`unlinkedFast`). `expireMedia` keeps `RETURNING sha256`, so s3-media's object delete is unchanged.
- **`gcMedia` keeps the exact `NOT EXISTS` check** for its one id: media losing its last link is deleted on the spot, so a linked-then-unlinked row never lingers with `linked_at` set.
- Equivalence: a test over seeded media (entry, level, proof, tray, served, labeled copy, unlinked old and new) shows both predicates select the same ids.
- No new table, so no RLS change; `0004` runs no `GRANT`.

## 2. Budget pressure

- `BUDGET_PRESSURE_PCT` (integer 1–100, default 50) in `config.ts`; P = ⌊cap · pct / 100⌋, passed to the policy with the budget.
- `plan()` gains one rule, first for `read` and `meal`: `wanted === 'sam+spark'`, `used ≥ P`, and the action names no bed or `max(level, suggested)` is `stable` → `spark`, 1 request, `downgraded` (the `BUDGET_PRESSURE` warning). `withBudget` passes the action's `AcuityStatus` (null with no bed) to `plan()`.
- A tray read's served photo is still looked up by the route, so `comparison` names it with `served: null`; nothing is sent on it.
- The rule reads the hourly use only (`budget.stats().used`, sent plus held). The in-flight check then applies to the chosen mode, so a pressure read needs 1 slot ("Pressure, not concurrency").
- **Counters.** Per class `{ admitted, refused, downgraded }` in the policy: `admitted` when `reserve` succeeds, `refused` when it throws, `downgraded` when the plan makes fewer requests than its mode wants (pressure 3/5 → 1, fit 3 → 1, served 5 → 3).

## 3. Metrics

- **Collection.** One middleware, first in `createApp`, records method, route pattern, status and duration after `next()`. The pattern is the path of the last route `matchedRoutes(c)` (`hono/route`) lists with a method other than `ALL`; a request only middleware matched is counted under `unmatched`. Counters in a `Map`; a ring of 1,000 latencies per method and route, p50 and p95 on read.
- **Model numbers** from `budget.stats()` (`limit`, `used`, `held`, `remaining.high` → `critical`, `remaining.normal` → `routine`) and the policy counters.
- **Sizes.** `store.bytes`: `SELECT sum(pg_total_relation_size(c.oid))` over relations in schema `meniscus`; `media`: `count(*)` and `sum(size)` from `meniscus.media`.
- **The route** `GET /api/metrics`: 401 `sign_in_required` with no session (the existing guard), 403 `forbidden` for any role but matron.
- **Never holds** concrete paths, ids, tokens, bodies or query strings.

## 4. Tests

Every test runs on the in-process test database (`await testApp()`), fake `fetch`, exact upstream counts. `PG_TEST_URL` is not involved; the existing opt-in tests are unchanged.

## 5. Risks

- Pressure lowers stable-bed accuracy when half the budget is spent; low confidence still gates review and the response names the mode.
- A future link column on another table needs its trigger; the equivalence test lists every link column and fails on a new `*_media_id` column without one.
