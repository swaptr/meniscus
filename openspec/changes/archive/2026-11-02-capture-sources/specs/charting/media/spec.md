# Spec Delta

## Purpose

Keeping the source a chart record came from: the photo or voice recording, stored once per capture, linked from the entries, levels and meals it produced, served for review, and deleted with the record or when never used. Source kinds are data, so a new kind (video) is one more entry. None of it calls a model.

## ADDED Requirements

### Requirement: Upload media
`POST /api/admissions/:id/media` with a `file`, a `kind` and an optional `duration_ms` SHALL store the file and return 201 `{ id, kind, mime, size, duration_ms, created_at }`.
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

### Requirement: Link media to records
Entry, level and meal posts SHALL accept `media_id` and return `media` (the upload's reference) or null. The media must belong to the same admission. Its kind must match the source: photo media for a photo entry, level or meal, and voice media for a voice entry. Text and manual records take none. Several records may link the same media. An entry linked to photo media SHALL show `has_photo: true`. A mismatch gets 400 `invalid_request`.

#### Scenario: One recording, two entries
- **WHEN** one voice recording is uploaded, and two voice entries (200 mL tea, 300 mL urine) are posted with its `media_id`
- **THEN** both entries return `media` with that id and `kind: voice`

#### Scenario: Another bed's media
- **WHEN** a photo uploaded for bed 1 is linked from an entry posted for bed 2
- **THEN** the response is 400 with `error: invalid_request`, and no entry is created

#### Scenario: Kind mismatch
- **WHEN** a voice recording is linked from a photo entry
- **THEN** the response is 400 with `error: invalid_request`

### Requirement: Serve media
`GET /api/media/:id` SHALL return the stored bytes with their content type and `Cache-Control: no-store`, or 404 `not_found`.

#### Scenario: Recording served
- **WHEN** a stored WebM recording is requested
- **THEN** the response is 200, with `Content-Type: audio/webm`, `Cache-Control: no-store` and the same bytes

#### Scenario: No such media
- **WHEN** `GET /api/media/9999` is requested
- **THEN** the response is 404 with `error: not_found`

### Requirement: Media goes with its record
Rejecting an entry and voiding a meal SHALL unlink their media. When that removes the media's last link, so no entry, level or meal links it any more, the media SHALL be deleted. Media that was never linked is not deleted by this; it expires as in "Unlinked media expires". Levels are never deleted, so a level's photo is kept.

#### Scenario: Shared recording
- **WHEN** two entries link one recording, and the first is rejected
- **THEN** the recording is still served
- **AND** once the second is rejected too, `GET /api/media/<id>` returns 404

#### Scenario: Voided tray
- **WHEN** a meal linked to a tray photo is voided
- **THEN** the tray photo returns 404, and the meal returns `media: null`

### Requirement: Unlinked media expires
Media that no record links within 24 hours of its upload SHALL be deleted and no longer served.

#### Scenario: Never saved
- **WHEN** a photo is uploaded at 09:00 on 2 Nov and never linked
- **THEN** it is served at 08:59 on 3 Nov and returns 404 at 09:01 on 3 Nov

### Requirement: Stored photos become media
A store with photos in the old per-entry photo table SHALL move each one to media linked to its entry. `POST /api/entries/:id/photo` and `GET /api/entries/:id/photo` SHALL keep working through media. The POST keeps its live rules, including any pending entry whatever its source; an entry that already links media of any kind gets 409 `photo_exists`.

#### Scenario: Older store
- **WHEN** a store file with an entry and its stored JPEG in the old photo table is opened
- **THEN** `GET /api/entries/<id>/photo` returns the same bytes, and the entry returns `media` with `kind: photo`

#### Scenario: Photo route on other sources
- **WHEN** a JPEG is posted to `/api/entries/<id>/photo` for a pending `manual` entry, and another for a pending `voice` entry that links a recording
- **THEN** the first response is 201 and that entry shows `has_photo: true`, as before
- **AND** the second response is 409 with `error: photo_exists`, and that entry still links its recording
