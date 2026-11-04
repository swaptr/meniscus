# Spec Delta

## ADDED Requirements

### Requirement: Media fingerprint
Storing media SHALL record the SHA-256 of its bytes as 64 lowercase hex characters and return it as `sha256` in the upload response and in every media reference (entries, levels, meals), with `sha256: null` for media stored before fingerprints were kept. It makes no model request.

#### Scenario: Fingerprint of the served bytes
- **WHEN** a JPEG is uploaded for bed 1 with `kind: photo` and linked from a photo entry
- **THEN** the upload response's `sha256` is the SHA-256 of the uploaded bytes, in lowercase hex
- **AND** the SHA-256 of the bytes `GET /api/media/<id>` returns equals it, and the entry's `media.sha256` is the same value
- **AND** the upstream received no request

#### Scenario: Media from before fingerprints
- **WHEN** a store file whose media table has no fingerprint column holds a photo linked to an entry, and the server opens it
- **THEN** the entry's `media.sha256` is null and `GET /api/media/<id>` still returns the photo

## MODIFIED Requirements

### Requirement: Upload media
`POST /api/admissions/:id/media` with a `file`, a `kind` and an optional `duration_ms` SHALL store the file and return 201 `{ id, kind, mime, size, duration_ms, created_at, sha256 }`.
- `photo`: JPEG, PNG, WebP or GIF, up to 15 MB.
- `voice`: WebM, Ogg, MP4/M4A, WAV or MP3, up to 25 MB.

The type is checked against the bytes. A wrong, empty or over-limit file gets 400 `invalid_request`, a body over 26 MB 413, and an unknown admission 404 `not_found`. No model request is made.

#### Scenario: Voice recording
- **WHEN** WebM bytes are posted with `kind: voice` and `duration_ms: 4200` for bed 1
- **THEN** the response is 201 with `kind: voice`, `mime: audio/webm` and `duration_ms: 4200`
- **AND** the upstream received no request

#### Scenario: Wrong file
- **WHEN** JPEG bytes are posted with `kind: voice`, and the text `hello` with `kind: photo`
- **THEN** both responses are 400 with `error: invalid_request`

#### Scenario: MP4 brands
- **WHEN** MP4 files with the brand `M4A ` and with the brand `heic` are posted with `kind: voice`
- **THEN** the `M4A ` file gets 201 with `mime: audio/mp4`
- **AND** the `heic` file, a phone photo, gets 400 with `error: invalid_request`

#### Scenario: Unknown bed
- **WHEN** a JPEG is posted for admission 9999
- **THEN** the response is 404 with `error: not_found`

#### Scenario: Too large
- **WHEN** a 20 MB JPEG is posted with `kind: photo`, and then a 30 MB request body
- **THEN** the first response is 400 with `error: invalid_request`, the second is 413, and nothing is stored
