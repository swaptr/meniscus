# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Rejected entries drop their photo
Rejecting an entry SHALL unlink its media and its labeled copy and delete its evidence. Each media itself is deleted once no live record links it, as in `charting/media` "Media goes with its record".

#### Scenario: Reject
- **WHEN** a pending entry with a photo and evidence is rejected
- **THEN** its photo request returns 404 and the entry shows `has_photo: false` and `evidence: null`

#### Scenario: Reject with a labeled copy
- **WHEN** a pending photo entry linking raw media 41 and labeled copy 42 is rejected
- **THEN** `GET /api/media/41` and `GET /api/media/42` both return 404, and the entry shows `media: null` and `labeled_media: null`
