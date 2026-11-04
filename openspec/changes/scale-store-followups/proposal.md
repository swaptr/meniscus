# Proposal

Split out of `scale-store` on 2026-11-05 (hackathon deadline): the parts of the original scale-store plan that were not applied. `scale-store` kept media expiry by `linked_at`, budget pressure and `/api/metrics`. **Not applied yet.** Before `/opsx:apply`, rewrite `design.md` and `tasks.md` (copied from the original plan) for the Drizzle store: schema edits in `apps/server/src/db/schema.ts` plus a generated migration, triggers and new tables in a custom migration with RLS and the revoke block, no `SCHEMA_VERSION`, no schema drop; store modules are `store/pg/{entries,levels,care,meals,media,dashboards,staff,wards,store}.ts`; `INDIRECT_TABLES` lives in `src/db`; store size from `pg_total_relation_size`.

## Why

The 500-bed measurements (acuity-budget design §1) show list reads are slow on Node's single thread, reading intervals follow ward codes rather than acuity, and the attendant picker loads the whole hospital.

## What Changes

- **Read path** (`charting/alerts`): a bed's alerts, care, acuity and nutrition reused on lists for at most 30 s, dropped at once by database version triggers on any write to the bed or its ward.
- **Acuity follow-ups** (`charting/acuity`, `charting/bag-periods`): `PUT /api/wards/:id/default-acuity` (matron); `acuity.interval_h` (1, 2 or 4 h) gives the reading interval unless a catheter order sets one; `GET /api/beds/:token` carries `reading_interval`.
- **Web** (`web/capture`, `web/ward`, `web/ward-round`): ward-first attendant bed picker; watch-bed bag readings start at "Check"; the care plan reads `· By acuity`; fingerprints drop their null branch.
- **Bench**: `pnpm --filter @meniscus/server bench` with a query plan guard.

## Capabilities

### Modified Capabilities
- `charting/alerts`: Alerts on chart reads (bounded reuse).
- `charting/acuity`: Set a ward's default acuity; Reading interval by acuity.
- `charting/bag-periods`: Reading interval; Reading interval on the bed lookup.
- `web/capture`, `web/ward`, `web/ward-round`: picker, fingerprint, interval wording.

## Impact

`packages/shared`, `apps/server` (chart view, acuity, bags, routes, store, a new migration), `apps/web` (picker, bags, round, care). No change to model request counts.
