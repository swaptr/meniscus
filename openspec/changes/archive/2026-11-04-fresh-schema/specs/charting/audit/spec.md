## ADDED Requirements

### Requirement: Entry event history
Every entry SHALL keep an append-only history of `recorded`, `approved`, `corrected` (approved at another volume), `rejected` and `amended` events, each with its time and staff member or null. Corrections hold the volume before and after; amendments the volume, type and reason; rejections the reason. `GET /api/entries/:id/events` returns them oldest first, or 404 `not_found`.

#### Scenario: Corrected then amended
- **WHEN** a 450 mL urine entry is recorded by staff 1, approved as 400 mL by staff 4, and then amended to 380 mL by staff 4 with reason `re-measured with jug`
- **THEN** its events are, in order:
  - `recorded` with `to_ml` 450 by staff 1;
  - `corrected` 450 → 400 by staff 4;
  - `amended` 400 → 380 with reason `re-measured with jug` by staff 4

#### Scenario: Unknown entry
- **WHEN** `GET /api/entries/999/events` is requested
- **THEN** the response is 404 with `error: not_found`

## REMOVED Requirements

### Requirement: Entry history
**Reason**: The store no longer upgrades older files (charting/entries "Store schema version"), so the behaviour for files from before this requirement is gone. The rest of the requirement is unchanged and continues as "Entry event history", without the scenario about older store files.
**Migration**: Tests cite "Entry event history". Delete the data directory (`DATA_DIR`, `apps/server/data/` by default) and restart, or re-seed it with `scripts/demo-history.ts`.
