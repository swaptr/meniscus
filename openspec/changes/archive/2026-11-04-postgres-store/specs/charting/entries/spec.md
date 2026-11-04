# Spec Delta

## MODIFIED Requirements

### Requirement: Persistent store
Admissions and entries SHALL be stored in the Postgres database at `DATABASE_URL` and survive a server restart. The server, `demo`, `media:sweep` and `db:migrate` refuse to start when `DATABASE_URL` is unset, with a message naming it and `pnpm dev:stack`, and they never fall back to a local file.

#### Scenario: Restart keeps entries
- **WHEN** an entry of 200 mL water is recorded, and the server is stopped and started again with the same `DATABASE_URL`
- **THEN** the admission's entry list contains that 200 mL entry

#### Scenario: No database configured
- **WHEN** the server starts with `DATABASE_URL` unset
- **THEN** it exits with status 1 and a message naming `DATABASE_URL` and `pnpm dev:stack`, before it listens
- **AND** the upstream received no request

## REMOVED Requirements

### Requirement: Store schema version
**Reason**: The server no longer keeps a SQLite file: the chart lives in Postgres, whose schema follows the committed migrations of server/storage "Schema migrated on start".
**Migration**: None for data: there is no production data to move. Delete any old `DATA_DIR` and start on an empty database. The tests citing this requirement are removed with the SQLite store.
