## REMOVED Requirements

### Requirement: Pre-care stores
**Reason**: The store no longer upgrades older files (charting/entries "Store schema version"); a file from before care orders has an older schema version and is refused.
**Migration**: Delete the data directory (`DATA_DIR`, `apps/server/data/` by default) and restart, or re-seed it with `scripts/demo-history.ts`.
