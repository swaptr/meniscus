# Tasks

## 1. Rules

- [x] 1.1 `Alert` types and thresholds in `packages/shared`; pure `alertsFor()` in `apps/server/src/chart/alerts.ts`; rule tests pass (low output, mismatch, overload, logging gap, appearance)

## 2. API

- [x] 2.1 Alerts on `GET /api/admissions` and `GET /api/admissions/:id/entries`; test `[charting/alerts] Alerts on chart reads` passes
- [x] 2.2 `POST /api/ai/explain` (1 Spark request); test `[charting/alerts] Explain alerts` passes

## 3. Verify

- [x] 3.1 `pnpm verify` passes

## Workflow follow-up

- Archive with `openspec archive alerts --yes`.
