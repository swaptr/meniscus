## ADDED Requirements

### Requirement: Entry photo routes
`POST /api/entries/:id/photo` and `GET /api/entries/:id/photo` SHALL work through media. The POST keeps its live rules, including any pending entry whatever its source; an entry that already links media of any kind gets 409 `photo_exists`.

#### Scenario: Photo route on other sources
- **WHEN** a JPEG is posted to `/api/entries/<id>/photo` for a pending `manual` entry, and another for a pending `voice` entry that links a recording
- **THEN** the first response is 201 and that entry shows `has_photo: true`, as before
- **AND** the second response is 409 with `error: photo_exists`, and that entry still links its recording

### Requirement: Media SHA-256 fingerprint
Storing media SHALL record the SHA-256 of its bytes as 64 lowercase hex characters and return it as `sha256` in the upload response and in every media reference (entries, levels, meals). It makes no model request.

#### Scenario: Fingerprint of the served bytes
- **WHEN** a JPEG is uploaded for bed 1 with `kind: photo` and linked from a photo entry
- **THEN** the upload response's `sha256` is the SHA-256 of the uploaded bytes, in lowercase hex
- **AND** the SHA-256 of the bytes `GET /api/media/<id>` returns equals it, and the entry's `media.sha256` is the same value
- **AND** the upstream received no request

## REMOVED Requirements

### Requirement: Stored photos become media
**Reason**: The store no longer upgrades older files (charting/entries "Store schema version"), so the behaviour for files from before this requirement is gone. The rest of the requirement is unchanged and continues as "Entry photo routes", without the scenario about older store files.
**Migration**: Tests cite "Entry photo routes". Delete the data directory (`DATA_DIR`, `apps/server/data/` by default) and restart, or re-seed it with `scripts/demo-history.ts`.

### Requirement: Media fingerprint
**Reason**: The store no longer upgrades older files (charting/entries "Store schema version"), so the behaviour for files from before this requirement is gone. The rest of the requirement is unchanged and continues as "Media SHA-256 fingerprint", without the scenario about older store files.
**Migration**: Tests cite "Media SHA-256 fingerprint". Delete the data directory (`DATA_DIR`, `apps/server/data/` by default) and restart, or re-seed it with `scripts/demo-history.ts`.
