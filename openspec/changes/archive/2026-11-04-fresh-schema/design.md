# Design

## Types

No `packages/shared` or `@meniscus/meta` type changes. `apps/server/src/store/store.ts` exports:

```ts
/** Bumped by every change that alters SCHEMA. A file at another version fails to open. */
export const STORE_SCHEMA_VERSION = 1
```

## Opening a store (apps/server/src/store, server layer)

1. `PRAGMA busy_timeout` (connection only).
2. Read `PRAGMA user_version` and count the file's own tables (`sqlite_master`, names not starting `sqlite_`), before any pragma that writes the header (`journal_mode = WAL`).
   - No tables: run `SCHEMA` and `PRAGMA user_version = STORE_SCHEMA_VERSION` in one transaction.
   - Tables and `user_version === STORE_SCHEMA_VERSION`: open as is.
   - Otherwise: close the handle and throw `Error("Store file <path> has schema version <v>; this build needs version <V>. It is not migrated: delete the data directory (DATA_DIR) or re-seed it with scripts/demo-history.ts.")`.
3. `foreign_keys`, `journal_mode = WAL`, then the demo seeds (`seedStaff`, `seed`, `seedTeams`), which only insert what a store lacks.

`user_version` is used instead of `schema_version` because SQLite bumps `schema_version` on every DDL, so it cannot identify a build.

## Deleted

`migrate`, `migrateMedia`, `addColumns`, `migrateCare`, `migrateBags`, `migrateTray`, `backfill` (history for entries saved before history), `rebuildStaff` and `normaliseDdl` (staff table from before roles and credentials), the `columns` helper, and `normaliseMealEvidence` with `OlderMealEvidence` in `src/ai/meal.ts` (evidence from before dishes). The indexes `entry_media`, `level_media`, `meal_media`, `level_proof_media`, `entry_level` and the trigger `meal_evidence_fixed` move into `SCHEMA`.

## Rule for later changes

A change that adds or alters a table or column edits `SCHEMA` and bumps `STORE_SCHEMA_VERSION` by one. It never adds an upgrade step. Developers delete `DATA_DIR` or re-run `scripts/demo-history.ts` after pulling it.

## Tests

Tests that built an older file by hand and opened it (pre-ward, pre-media photo table, pre-fingerprint, pre-team, pre-care, pre-bag, pre-read-log, pre-dishes, pre-history, pre-credentials, pre-urine-colour) are deleted with their requirements or scenarios. `chart.test.ts` gains the three "Store schema version" scenarios. Citations of renamed requirements are updated.
