# Proposal

## Why

Every local database has been deleted (`apps/server/data/` is empty). The store still carries upgrade code for every older file shape (`migrate`, `migrateMedia`, `migrateCare`, `migrateBags`, `migrateTray`, the staff rebuild and the history backfill), and the live specs still require upgrading older files. With no older files left, that code is dead weight, and every later change would add another upgrade step. The project restarts from one clean schema.

## What Changes

- **One schema.** `SCHEMA` creates the current final shape directly, including the indexes and the meal trigger the upgrade steps used to add. All upgrade code is deleted.
- **Schema version.** A new file is stamped with the build's schema version (`PRAGMA user_version`). A file that has tables and a different or missing version fails to open with an error that names both versions and says to delete the data directory or re-seed it. It is never migrated and is left unchanged. A change that alters `SCHEMA` later bumps the version, so older files fail fast instead of being upgraded.
- **Specs**:
  - ADDED `charting/entries` **Store schema version**.
  - REMOVED upgrade-only requirements: `charting/bag-periods` **Pre-bag stores**, `charting/model-accuracy` **Older stores keep their records out**, `charting/staffing` **Pre-team stores**, `charting/care-plan` **Pre-care stores**, `charting/wards` **Pre-ward stores**, `charting/meals` **Older meals read as dishes**.
  - Requirements that keep their behaviour but lose an older-file scenario are REMOVED and ADDED under a new name, as OpenSpec refuses a MODIFIED block that drops a scenario: `charting/audit` **Entry history** → **Entry event history**; `charting/media` **Stored photos become media** → **Entry photo routes** and **Media fingerprint** → **Media SHA-256 fingerprint**; `server/security` **Demo sign-in in production** → **Demo accounts and sign-in**.
- **In-flight changes** (dietitian, acuity-budget, tray-comparison, bag-alerts, accuracy-views, dietitian-care, scale-store, postgres-store, read-queue, ui-polish) are edited so their columns and tables go into `SCHEMA` directly with a version bump and no upgrade path; their blocks that modify a removed or renamed requirement are dropped or retargeted. postgres-store's importer accepts only a SQLite file at the fresh-schema version.

## Out of scope

- Any change to HTTP routes, response shapes or stored values in a fresh store.
- `apps/server/data/` contents, the demo seed and `scripts/demo-history.ts` behaviour (it still runs on an empty `DATA_DIR`).
- The `charting/staffing` Purpose text still mentions older store files; OpenSpec deltas cannot change a Purpose.

## Upstream model requests per user action (before → after)

None. No code path here calls the model API.

## Changed shapes

- `packages/shared`: none. HTTP: none. `@meniscus/meta`: none.
- Store files: a file without the current `PRAGMA user_version` no longer opens. **BREAKING** for any surviving older file (there are none).
