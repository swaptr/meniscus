# Tasks

## 1. Fail-fast schema version

- [x] 1.1 Write the [charting/entries] Store schema version tests in `apps/server/src/chart.test.ts` (Fresh file, Unversioned older file, Other version) and see them fail.
- [x] 1.2 Fold every upgrade step's columns, indexes and trigger into `SCHEMA`; stamp new files with `STORE_SCHEMA_VERSION`; refuse other versions before any write ([charting/entries] Store schema version).

## 2. Remove upgrade code and its tests

- [x] 2.1 Delete `migrate`, `migrateMedia`, `migrateCare`, `migrateBags`, `migrateTray`, `backfill`, `rebuildStaff`, `normaliseDdl`, `addColumns`, `columns` and `normaliseMealEvidence`.
- [x] 2.2 Delete the tests citing removed requirements and scenarios ([charting/bag-periods] Pre-bag stores, [charting/model-accuracy] Older stores keep their records out, [charting/staffing] Pre-team stores, [charting/care-plan] Pre-care stores, [charting/wards] Pre-ward stores, [charting/meals] Older meals read as dishes, the older-file scenarios of the renamed requirements, and the urine-colour upgrade test under [charting/entries] Persistent store).
- [x] 2.3 Re-cite renamed requirements: [charting/audit] Entry event history, [charting/media] Entry photo routes, [charting/media] Media SHA-256 fingerprint, [server/security] Demo accounts and sign-in.
- [x] 2.4 `scripts/demo-history.ts` runs on an empty temp `DATA_DIR` and its guards pass.

## 3. In-flight changes

- [x] 3.1 Edit dietitian, acuity-budget, tray-comparison, bag-alerts, accuracy-views, dietitian-care, scale-store, postgres-store, read-queue and ui-polish: columns and tables go into `SCHEMA` with a `STORE_SCHEMA_VERSION` bump and no upgrade path; drop blocks that MODIFY removed requirements and retarget renamed ones; postgres-store's importer accepts only the fresh-schema version. Each stays valid under `openspec validate --strict`.

## 4. Verify

- [x] 4.1 `pnpm verify` passes (format, lint, typecheck, tests, specs, traces).
