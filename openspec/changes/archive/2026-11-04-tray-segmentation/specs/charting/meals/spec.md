# Spec Delta

## ADDED Requirements

### Requirement: Dishes on a meal
`POST /api/admissions/:id/meals` SHALL accept optional `dishes`, at most 20 of `{ index, name, dish_kind, portion }` (index 0–12, name 1–80 characters, a known dish kind, portion 0, 25, 50, 75 or 100), store them, and return them as the meal's `dishes`, `[]` when none; anything else gets 400 `invalid_request` and stores nothing. It makes no model request.

#### Scenario: Lunch with two dishes
- **WHEN** a photo lunch is posted for bed 1 with portion 75 and dishes `[{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }, { index: 2, name: "dal", dish_kind: "dal_lentils", portion: 50 }]`
- **THEN** the response is 201 and the meal and the meals list return those two dishes in that order
- **AND** the upstream received no request

#### Scenario: Invalid dishes
- **WHEN** meals are posted with a dish of kind `pizza`, a dish with portion 40, a dish with an empty name, a dish with index 13, and 21 dishes
- **THEN** each response is 400 with `error: invalid_request` and no meal is stored

### Requirement: Tray evidence stored with the meal
A photo meal's `evidence` SHALL hold the tray read's mode, `image_sha256`, reading, segmentation, warnings and trace as `POST /api/ai/meal` returned them, within its bounds: at most 12 regions, masks of at most 32 × 32 cells in at most 172 base64 characters, at most 6 warnings of at most 200 characters each, and at most 3 trace steps. Anything else gets 400 `invalid_request`, a body over 48 KB gets 413, and no request changes the evidence once the meal is saved.

#### Scenario: Tray read kept
- **WHEN** a photo lunch is posted with its tray photo's `media_id` and the evidence of a `sam+spark` read with 2 regions, 1 warning and a trace of 3 steps
- **THEN** the response is 201, and the meal and the meals list return that same evidence

#### Scenario: Malformed tray evidence
- **WHEN** a photo meal is posted whose evidence has a mask of 33 × 10 cells, a mask of 200 base64 characters, 13 regions, 4 trace steps, a region with coverage 1.5, 7 warnings, or a warning of 201 characters
- **THEN** each response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Body too large
- **WHEN** a meal is posted with a 50 KB body
- **THEN** the response is 413 and no meal is stored
- **AND** a valid post with the largest evidence the bounds allow (over 16 KB) returns 201

### Requirement: Tray evidence bound to its photo
A photo meal posted with `evidence` needs its tray photo as `media_id`, and the evidence's `image_sha256` SHALL be 64 lowercase hex equal to that media's `sha256`; media without a fingerprint cannot carry evidence. Otherwise the post gets 400 `invalid_request` and stores nothing. It makes no model request.

#### Scenario: Read and photo of the same bytes
- **WHEN** a tray photo is read by `POST /api/ai/meal`, the same bytes are uploaded as photo media for bed 1, and a lunch is posted with that `media_id` and the read as evidence
- **THEN** the response is 201, and the meal's `evidence.image_sha256`, `media.sha256` and `proof.photo.sha256` are the same value
- **AND** saving made no upstream request

#### Scenario: Read of another photo
- **WHEN** photos A and B are uploaded for bed 1, and a lunch is posted with B's `media_id` and the evidence of a read of A
- **THEN** the response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Evidence without its photo
- **WHEN** a photo lunch is posted with evidence and no `media_id`
- **THEN** the response is 400 with `error: invalid_request` and no meal is stored

### Requirement: Tray proof stored with the meal
Saving a `photo` meal with evidence SHALL store a proof the server builds: the tray photo's media id, SHA-256, who uploaded it and when, and the portion, items, fluid mL and dishes as saved, with who saved the meal and when. The meal returns it as `proof`, null for any other meal. No request changes the proof or the evidence afterwards, the database refuses any UPDATE of either, and voiding deletes only the photo's bytes.

#### Scenario: Lunch proof
- **WHEN** Ravi Kumar (id 1) uploads bed 1's tray photo at 13:09, and saves the lunch from its read at 13:10 with portion 75, items `rice, dal`, 150 mL and dishes rice 100 and dal 50
- **THEN** the meal's `proof.photo` holds that media id, the `sha256` the upload returned, `captured_by` Ravi Kumar and `captured_at` 13:09
- **AND** `proof.confirmed` is portion 75, items `rice, dal`, `fluid_ml: 150` and those two dishes, with `confirmed_by` Ravi Kumar at 13:10

#### Scenario: Proof outlives a void
- **WHEN** that lunch is voided with reason `wrong bed`
- **THEN** `GET /api/media/<id>` for its photo returns 404, and the meal returns `media: null`
- **AND** its `proof` and `evidence` are byte-identical to when it was saved, and `proof.photo.sha256` still holds the fingerprint

#### Scenario: Database refuses changes
- **WHEN** `UPDATE meal SET evidence = '{}'` and then `UPDATE meal SET proof = NULL` are run directly on that lunch's row in the store file
- **THEN** SQLite aborts each statement with an error, and the lunch still returns the same `evidence` and `proof`

#### Scenario: Meal by hand
- **WHEN** a `manual` breakfast is posted
- **THEN** it returns `proof: null`

### Requirement: Older meals read as dishes
A meal stored before dishes were kept SHALL return `dishes: []` and `proof: null`. Its evidence reads as mode `spark` with `image_sha256: null`, no segmentation and no warnings; its items become dishes with index 0, kind `other`, basis `model`, no box and no coverage; and its fluids get index 0 and kind `other`. The stored row is not rewritten.

#### Scenario: Older store
- **WHEN** a store file whose meal table has no dish columns holds a photo lunch with evidence items rice (portion 50) and fluid soup 150 mL, and the server opens it
- **THEN** the lunch returns `dishes: []` and `proof: null`, and its evidence has mode `spark`, `image_sha256: null`, `segmentation: null`, the dish rice with index 0, kind `other`, portion 50 and basis `model`, and the fluid soup with index 0 and kind `other`
- **AND** the row's stored `evidence` text is unchanged
