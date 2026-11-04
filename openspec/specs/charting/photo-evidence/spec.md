# charting/photo-evidence Specification

## Purpose
Keeping the capture photo with its chart entry so a nurse can check the reading before approving, and discarding it when the entry is rejected.

## Requirements

### Requirement: Attach a photo
`POST /api/entries/:id/photo` SHALL store one JPEG, PNG, WebP or GIF image for a pending entry and mark the entry `has_photo`, making no model request; an entry that already has a photo SHALL get HTTP 409 `photo_exists`, a reviewed entry HTTP 409 `not_pending`, an unknown entry HTTP 404 `not_found`, and bytes that do not match the declared type HTTP 400 `invalid_request`.

#### Scenario: Photo of a pending entry
- **WHEN** a JPEG is posted for a pending entry
- **THEN** the response is 201, the entry list shows `has_photo: true`, and the upstream received no request

#### Scenario: Second photo
- **WHEN** another JPEG is posted for the same entry
- **THEN** the response is 409 with `error: photo_exists`

#### Scenario: Not an image
- **WHEN** the bytes `hello` are posted as `image/jpeg`
- **THEN** the response is 400 with `error: invalid_request`

### Requirement: Serve the photo
`GET /api/entries/:id/photo` SHALL return the stored bytes with their content type and `Cache-Control: no-store`, or HTTP 404 `not_found` when the entry has no photo.

#### Scenario: Stored photo
- **WHEN** the photo of an entry with a stored JPEG is requested
- **THEN** the response is 200 with `Content-Type: image/jpeg`, `Cache-Control: no-store` and the same bytes

#### Scenario: No photo
- **WHEN** the photo of an entry without one is requested
- **THEN** the response is 404 with `error: not_found`

### Requirement: Rejected entries drop their photo
Rejecting an entry SHALL unlink its media and its labeled copy and delete its evidence. Each media itself is deleted once no live record links it, as in `charting/media` "Media goes with its record".

#### Scenario: Reject
- **WHEN** a pending entry with a photo and evidence is rejected
- **THEN** its photo request returns 404 and the entry shows `has_photo: false` and `evidence: null`

#### Scenario: Reject with a labeled copy
- **WHEN** a pending photo entry linking raw media 41 and labeled copy 42 is rejected
- **THEN** `GET /api/media/41` and `GET /api/media/42` both return 404, and the entry shows `media: null` and `labeled_media: null`

### Requirement: Read evidence stored with the entry
`POST /api/admissions/:id/entries` and `POST /api/admissions/:id/levels` SHALL accept an optional `evidence` object, stored on each entry and level created, whose `kind` matches the source: `photo`, `voice` or `text`, none for `manual`. Photo evidence holds the read mode, reading (optional `drink_name` ≤ 40 chars), segmentation, review reasons, trace and liquid colour. Note evidence holds the transcript, `draft_ml` and trace. Entry lists return it as `evidence` or null. No model request is made.

#### Scenario: Photo evidence round trip
- **WHEN** an entry with source `photo` is posted with photo evidence: mode `sam+spark`, reading 450 mL of 2000 mL, container box 100,80–400,900, liquid box 110,520–390,890, fill 0.463, colour `#d9b44a` and a trace of three calls
- **THEN** the entry list returns that same evidence on the entry and the upstream received no request

#### Scenario: Masala chai photo
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has fluid `tea` and `drink_name` `masala chai`
- **THEN** the response is 201 and the entry list returns that evidence with `drink_name: "masala chai"`, and the upstream received no request

#### Scenario: Evidence without a drink name
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has no `drink_name` field, as stored before drink kinds
- **THEN** the response is 201 and the entry list returns that evidence unchanged

#### Scenario: Drink name too long
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has a 41-character `drink_name`
- **THEN** the response is 400 with `error: invalid_request` and nothing is stored

#### Scenario: Level drop keeps evidence
- **WHEN** a water jug level of 1000 mL with photo evidence and then 600 mL with photo evidence are posted
- **THEN** the created 400 mL intake entry carries the second level's evidence
- **AND** the first level keeps its own evidence, which is returned as the entry's `levels.before.evidence`

#### Scenario: Malformed evidence
- **WHEN** an entry is posted whose evidence is any of the following:
  - of kind `photo` without `reading`;
  - has colour `red`;
  - has a transcript longer than 2000 characters;
  - is of kind `voice` on a `photo` entry;
  - is any evidence on a `manual` entry
- **THEN** each response is 400 with `error: invalid_request` and nothing is stored

### Requirement: Segmentation masks in stored evidence
Photo evidence posted to `POST /api/admissions/:id/entries` or `POST /api/admissions/:id/levels` SHALL accept `segmentation.container_mask` and `segmentation.fluid_mask`, each a mask of at most 32 × 32 cells whose `bits` are exactly ⌈width × height / 8⌉ bytes, or null, store them with the evidence and return them unchanged in entry lists. Evidence without them is stored and returned as before. It makes no model request.

#### Scenario: Masks round trip
- **WHEN** an entry with source `photo` is posted with photo evidence whose segmentation has a 12 × 32 `container_mask` and a 24 × 32 `fluid_mask`
- **THEN** the response is 201, the entry list returns both masks unchanged, and the upstream received no request

#### Scenario: Evidence without masks
- **WHEN** photo evidence whose segmentation has no mask fields, as stored before this change, is posted
- **THEN** the response is 201 and the entry list returns that evidence unchanged, with no mask fields added

#### Scenario: Malformed mask
- **WHEN** an entry is posted whose photo evidence has a `container_mask` of 33 × 10 cells, or a `fluid_mask` whose `bits` are not exactly ⌈width × height / 8⌉ bytes
- **THEN** each response is 400 with `error: invalid_request` and nothing is stored

### Requirement: Liquid region volume in stored evidence
Photo evidence posted to `POST /api/admissions/:id/entries` or `POST /api/admissions/:id/levels` SHALL accept `segmentation.fluid_volume_ml`, null or the evidence's own `fill_fraction` × reading `capacity_ml` rounded to the nearest 10 mL, store it with the evidence and return it unchanged in entry lists. Any other value is HTTP 400 `invalid_request`. Evidence without the field is stored and returned without it. It makes no model request.

#### Scenario: Volume round trip
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has capacity 2000 mL and whose segmentation has fill 0.463 and `fluid_volume_ml: 930`
- **THEN** the response is 201, the entry list returns `fluid_volume_ml: 930` unchanged, and the upstream received no request

#### Scenario: Null without a capacity
- **WHEN** photo evidence whose reading has `capacity_ml: null` is posted with `fluid_volume_ml: null`
- **THEN** the response is 201 and the entry list returns `fluid_volume_ml: null`

#### Scenario: Evidence without a volume
- **WHEN** photo evidence whose segmentation has no `fluid_volume_ml` field, as stored before this change, is posted
- **THEN** the response is 201 and the entry list returns that evidence with no `fluid_volume_ml` field added

#### Scenario: Volume that does not match the fill
- **WHEN** photo evidence with capacity 2000 mL and fill 0.463 is posted with `fluid_volume_ml` 920, or with 930 and `capacity_ml: null`
- **THEN** each response is 400 with `error: invalid_request` and nothing is stored

### Requirement: Photo evidence bound to its photo
Photo evidence posted to `POST /api/admissions/:id/entries`, `/levels` or `/bag-readings` SHALL accept `image_sha256`, 64 lowercase hex characters, which, when the post also has a `media_id`, equals that media's `sha256`, else HTTP 400 `invalid_request` and nothing is stored. It is returned unchanged in entry lists. Evidence without it is stored and returned as before. It makes no model request.

#### Scenario: Read and photo of the same bytes
- **WHEN** a JPEG is read by `POST /api/ai/read`, the same bytes are uploaded as photo media for bed 1, and a photo entry is posted with that `media_id` and evidence carrying the read's `image_sha256`
- **THEN** the response is 201, the entry's `evidence.image_sha256` equals its `media.sha256`, and saving made no upstream request

#### Scenario: Read of another photo
- **WHEN** photos A and B are uploaded for bed 1, and a photo entry is posted with B's `media_id` and evidence whose `image_sha256` is A's
- **THEN** the response is 400 with `error: invalid_request` and no entry is stored

#### Scenario: Malformed fingerprint
- **WHEN** photo evidence is posted with `image_sha256` `ABC`
- **THEN** the response is 400 with `error: invalid_request`

#### Scenario: Evidence without a fingerprint
- **WHEN** photo evidence with no `image_sha256` field, as stored before this change, is posted with a `media_id`
- **THEN** the response is 201 and the entry list returns that evidence with no field added

### Requirement: Labeled copy linked with the photo
Entry, level and bag-reading posts SHALL accept `labeled_media_id`: photo media of the same admission, other than `media_id`, with no served meal and never linked by any record, sent with a `media_id` and photo evidence whose segmentation is not null. They link it and return it as `labeled_media` with its `sha256` (null when none), on the entry, a level and the entry's `levels.after`. Anything else gets 400 `invalid_request` and stores nothing. It makes no model request.

#### Scenario: Urine bag entry with its copy
- **WHEN** for bed 1 a raw JPEG is uploaded (media 41) and its labeled JPEG (media 42), and a photo entry is posted with `media_id: 41`, `labeled_media_id: 42` and `sam+spark` evidence with segmentation
- **THEN** the response is 201 with `media.id: 41` and `labeled_media.id: 42`, whose `sha256` is the SHA-256 of the labeled bytes
- **AND** `GET /api/media/42` returns those bytes with `Content-Type: image/jpeg` and `Cache-Control: no-store`, and the upstream received no request

#### Scenario: Jug level with its copy
- **WHEN** a water jug level of 600 mL is posted with `media_id: 43`, `labeled_media_id: 44` and segmented evidence, after a 1000 mL level
- **THEN** the level returns `labeled_media.id: 44`, and the 400 mL entry it created returns `levels.after.labeled_media.id: 44`

#### Scenario: Refused links
- **WHEN** a photo entry is posted with `labeled_media_id` and each of the following:
  - no `media_id`;
  - `labeled_media_id` equal to `media_id`;
  - a labeled copy uploaded for bed 2;
  - a voice recording as the labeled copy;
  - photo media already linked to another entry;
  - a served-tray photo (`served_meal: lunch`);
  - evidence with `segmentation: null`;
  - no evidence
- **THEN** each response is 400 with `error: invalid_request` and no entry is stored

#### Scenario: Without a copy
- **WHEN** a `spark` photo entry is posted with `media_id: 45` and no `labeled_media_id`
- **THEN** the response is 201 with `labeled_media: null`

#### Scenario: Retried save
- **WHEN** a photo entry with `media_id: 41`, `labeled_media_id: 42`, segmented evidence and `read_id: 7` is saved (201), and the same post is sent again, and likewise for a bag reading
- **THEN** each second response is 400 `invalid_request` with the issue `read_id` `already linked`, not one on `labeled_media_id`, and one record of each is stored
