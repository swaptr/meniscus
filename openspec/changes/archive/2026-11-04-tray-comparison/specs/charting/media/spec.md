# Spec Delta

## MODIFIED Requirements

### Requirement: Upload media
`POST /api/admissions/:id/media` with a `file`, a `kind` and an optional `duration_ms` SHALL store the file and return 201 `{ id, kind, mime, size, duration_ms, created_at, sha256, served_meal }`.
- `photo`: JPEG, PNG, WebP or GIF, up to 15 MB.
- `voice`: WebM, Ogg, MP4/M4A, WAV or MP3, up to 25 MB.

The type is checked against the bytes. A wrong, empty or over-limit file gets 400 `invalid_request`, a body over 26 MB 413, and an unknown admission 404 `not_found`. No model request is made.

#### Scenario: Voice recording
- **WHEN** WebM bytes are posted with `kind: voice` and `duration_ms: 4200` for bed 1
- **THEN** the response is 201 with `kind: voice`, `mime: audio/webm`, `duration_ms: 4200` and `served_meal: null`
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

### Requirement: Media goes with its record
Rejecting an entry and voiding a meal SHALL unlink their media: a meal both its tray photo and its served photo. When that removes the media's last link, so no entry, level or meal links it any more, the media is deleted. Media that was never linked is not deleted by this; it expires as in "Unlinked media expires". Levels are never deleted, so a level's photos are kept.

#### Scenario: Shared recording
- **WHEN** two entries link one recording, and the first is rejected
- **THEN** the recording is still served
- **AND** once the second is rejected too, `GET /api/media/<id>` returns 404

#### Scenario: Voided tray
- **WHEN** a meal linked to a tray photo is voided
- **THEN** the tray photo returns 404, and the meal returns `media: null`

#### Scenario: Voided tray with its served photo
- **WHEN** a lunch linked to tray photo 42 and served photo 41 is voided
- **THEN** `GET /api/media/42` and `GET /api/media/41` both return 404
- **AND** the meal returns `media: null` and `served_media: null`, and its `proof.photo` and `proof.served` keep their fingerprints

#### Scenario: Served photo in use
- **WHEN** a served lunch photo uploaded at 12:40 on 2 Nov is linked by a lunch saved at 13:32
- **THEN** `GET /api/media/<id>` still returns it at 13:00 on 3 Nov
