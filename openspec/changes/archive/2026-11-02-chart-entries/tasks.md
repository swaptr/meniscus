# Tasks

## 1. Store

- [x] 1.1 Shared types `Admission`, `Entry`, `Totals`, `EntryInput`, `ENTRY_SOURCES`, `CATEGORY_DIRECTION` in `packages/shared`
- [x] 1.2 `openStore` with schema, seed and queries; `DATA_DIR` config; `data/` ignored; test `[charting/entries] Persistent store` passes

## 2. API

- [x] 2.1 `GET /api/admissions` and `GET /api/beds/:token`; tests `[charting/entries] Demo ward` and `[charting/entries] Bed QR lookup` pass
- [x] 2.2 `POST` and `GET /api/admissions/:id/entries`; tests `[charting/entries] Record an entry` and `[charting/entries] 24-hour totals` pass
- [x] 2.3 `POST /api/entries/:id/review`; test `[charting/entries] Nurse review` passes
- [x] 2.4 Widen token and `no-store` guards to `/api/*` except health; modified `[server/security]` tests pass

## 3. Verify

- [x] 3.1 `pnpm verify` passes

## Workflow follow-up

- Archive with `openspec archive chart-entries --yes`.
