# Spec Delta

## ADDED Requirements

### Requirement: Labeled tray copy kept
`POST /api/admissions/:id/meals` SHALL accept `labeled_media_id`: photo media of the same admission, other than `media_id` and `served_media_id`, with no served meal and never linked by any record, sent with the tray's `media_id` and evidence whose segmentation is not null. The meal returns it as `labeled_media` with its `sha256` (null when none), and voiding unlinks it with the tray photo. Anything else gets 400 `invalid_request` and stores nothing. It makes no model request.

#### Scenario: Lunch with its labeled tray
- **WHEN** for bed 1 a tray photo (media 42) and its labeled copy (media 43) are uploaded, and a photo lunch is posted with `media_id: 42`, `labeled_media_id: 43` and the evidence of a `sam+spark` read with 2 regions
- **THEN** the response is 201, and the meal and the meals list return `labeled_media.id: 43` with the labeled bytes' `sha256`
- **AND** the lunch's fluid entry returns `labeled_media: null`, and the upstream received no request

#### Scenario: Voided lunch
- **WHEN** that lunch is voided with reason `wrong bed`
- **THEN** `GET /api/media/42` and `GET /api/media/43` both return 404, and the meal returns `media: null` and `labeled_media: null`
- **AND** its `evidence` and `proof` are unchanged

#### Scenario: Refused copies
- **WHEN** photo meals are posted with `labeled_media_id` and each of: no `media_id`; the served photo's id; media already linked to an entry; a `spark` read's evidence with `segmentation: null`; `source: manual`
- **THEN** each response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Retried save
- **WHEN** a photo lunch with `media_id: 42`, `labeled_media_id: 43`, segmented evidence and `read_id: 7` is saved (201), and the same post is sent again
- **THEN** the second response is 400 `invalid_request` with the issue `read_id` `already linked`, not one on `labeled_media_id`, and one meal is stored
