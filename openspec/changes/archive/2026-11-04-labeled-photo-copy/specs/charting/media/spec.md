# Spec Delta

## MODIFIED Requirements

### Requirement: Media goes with its record
Rejecting an entry and voiding a meal SHALL unlink their media: an entry its photo or recording and its labeled copy, a meal its tray photo, its served photo and its labeled copy. When that removes the media's last link, so no entry, level or meal links it any more, the media is deleted. Media that was never linked is not deleted by this; it expires as in "Unlinked media expires". Levels are never deleted, so a level's photos are kept.

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

#### Scenario: Rejected entry with its labeled copy
- **WHEN** a pending urine bag entry linking raw photo 41 and labeled copy 42 is rejected
- **THEN** `GET /api/media/41` and `GET /api/media/42` both return 404

#### Scenario: Level keeps its labeled copy
- **WHEN** a water jug level links photo 43 and labeled copy 44, and the 400 mL entry it created is rejected
- **THEN** `GET /api/media/43` and `GET /api/media/44` still return the photos

### Requirement: Unlinked media expires
Media that no record links within 24 hours of its upload SHALL be deleted and no longer served. A record links media as its `media_id`, `served_media_id`, `labeled_media_id` or proof photo.

#### Scenario: Never saved
- **WHEN** a photo is uploaded at 09:00 on 2 Nov and never linked
- **THEN** it is served at 08:59 on 3 Nov and returns 404 at 09:01 on 3 Nov

#### Scenario: Labeled copy in use
- **WHEN** a labeled copy uploaded at 09:00 on 2 Nov is linked as `labeled_media_id` by an entry saved at 09:01
- **THEN** `GET /api/media/<it>` still returns it at 09:01 on 3 Nov

#### Scenario: Labeled copy never saved
- **WHEN** a labeled copy is uploaded at 09:00 on 2 Nov and its entry post then fails
- **THEN** it returns 404 at 09:01 on 3 Nov

### Requirement: Media SHA-256 fingerprint
Storing media SHALL record the SHA-256 of its bytes as 64 lowercase hex characters and return it as `sha256` in the upload response and in every media reference (entries, levels, meals, and their labeled copies). It makes no model request.

#### Scenario: Fingerprint of the served bytes
- **WHEN** a JPEG is uploaded for bed 1 with `kind: photo` and linked from a photo entry
- **THEN** the upload response's `sha256` is the SHA-256 of the uploaded bytes, in lowercase hex
- **AND** the SHA-256 of the bytes `GET /api/media/<id>` returns equals it, and the entry's `media.sha256` is the same value
- **AND** the upstream received no request

#### Scenario: Labeled copy fingerprint
- **WHEN** a raw JPEG and its labeled JPEG are uploaded for bed 1 and linked from one photo entry
- **THEN** the entry's `labeled_media.sha256` is the SHA-256 of the labeled bytes and differs from its `media.sha256`
