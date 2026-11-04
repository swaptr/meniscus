## ADDED Requirements

### Requirement: Store schema version
Opening a store file SHALL create the current schema in a file with no tables and stamp it with the build's schema version. A file that has tables and a different or missing version fails to open with an error naming both versions and saying to delete the data directory or re-seed it. Such a file is never migrated and is left unchanged. It makes no model request.

#### Scenario: Fresh file
- **WHEN** a store is opened on a new file in an empty `DATA_DIR`, closed, and opened again
- **THEN** both opens succeed, the file's `PRAGMA user_version` is the build's schema version, and the second open leaves its `PRAGMA schema_version` unchanged
- **AND** `GET /api/wards` lists the demo wards

#### Scenario: Unversioned older file
- **WHEN** a file with `PRAGMA user_version` 0 holding an `entry` table with one row is opened
- **THEN** opening fails with an error that names version 0 and the build's version and mentions deleting the data directory or re-seeding
- **AND** the file's tables, rows, `PRAGMA schema_version` and `PRAGMA user_version` are the same as before

#### Scenario: Other version
- **WHEN** a store file made by this build has its `PRAGMA user_version` set to 99 and is opened again
- **THEN** opening fails with an error that names version 99 and the build's version, and the file's `PRAGMA user_version` is still 99
