# Spec Delta

## MODIFIED Requirements

### Requirement: Tray evidence stored with the meal
A photo meal's `evidence` SHALL hold the tray read's mode, `image_sha256`, reading, segmentation, comparison, warnings and trace as `POST /api/ai/meal` returned them, within its bounds: at most 12 regions, masks of at most 32 × 32 cells in at most 172 base64 characters, at most 6 warnings of at most 200 characters each, and at most 5 trace steps. Anything else gets 400 `invalid_request`, a body over 64 KB gets 413, and no request changes the evidence once the meal is saved.

#### Scenario: Tray read kept
- **WHEN** a photo lunch is posted with its tray photo's `media_id` and the evidence of a `sam+spark` read with 2 regions, 1 warning and a trace of 3 steps
- **THEN** the response is 201, and the meal and the meals list return that same evidence

#### Scenario: Malformed tray evidence
- **WHEN** a photo meal is posted whose evidence has a mask of 33 × 10 cells, a mask of 200 base64 characters, 13 regions, 6 trace steps, a region with coverage 1.5, a dish with `basis: guessed`, 7 warnings, or a warning of 201 characters
- **THEN** each response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Body too large
- **WHEN** a meal is posted with a 70 KB body
- **THEN** the response is 413 and no meal is stored
- **AND** a valid post with the largest evidence the bounds allow (over 16 KB) returns 201

### Requirement: Tray proof stored with the meal
Saving a `photo` meal with evidence SHALL store a proof the server builds: the tray photo's media id, SHA-256, who uploaded it and when, the same for its served photo as `served` (else null), and the portion, items, fluid mL and dishes as saved, with who saved the meal and when. The meal returns it as `proof`, null for any other meal. No request changes the proof or the evidence afterwards, the database refuses any UPDATE of either, and voiding deletes only the bytes of both photos.

#### Scenario: Lunch proof
- **WHEN** Ravi Kumar (id 1) uploads bed 1's tray photo at 13:09, and saves the lunch from its read at 13:10 with portion 75, items `rice, dal`, 150 mL and dishes rice 100 and dal 50
- **THEN** the meal's `proof.photo` holds that media id, the `sha256` the upload returned, `captured_by` Ravi Kumar and `captured_at` 13:09
- **AND** `proof.confirmed` is portion 75, items `rice, dal`, `fluid_ml: 150` and those two dishes, with `confirmed_by` Ravi Kumar at 13:10
- **AND** `proof.served` is null

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

## ADDED Requirements

### Requirement: Compared read kept as evidence
A photo meal's evidence SHALL keep its `comparison` as the tray read returned it: the served photo's id, `served_sha256` and `served_at`, both photos' sizes, the served segmentation within the region bounds of "Tray evidence stored with the meal", and at most 12 matches, each citing regions 1–12 with `distance2` 0–40 000; and each dish's `model_portion` and `measure`, set exactly when its basis is `measured`. Anything else gets 400 `invalid_request` and stores nothing. It makes no model request.

#### Scenario: Compared read kept
- **WHEN** a photo lunch is posted with its tray photo's `media_id`, its served photo's `served_media_id` and the evidence of a compared read with 2 regions on each photo, 2 matches, one `measured` dish and a trace of 5 steps
- **THEN** the response is 201, and the meal and the meals list return that same evidence, its `comparison` included

#### Scenario: Malformed comparison
- **WHEN** a photo meal is posted whose evidence's `comparison` has 13 served regions, 13 matches, a match citing region 13 or with `distance2: 40001`, or whose `measured` dish has `measure: null`
- **THEN** each response is 400 with `error: invalid_request` and no meal is stored

### Requirement: Served tray photo
A photo uploaded with `served_meal` (`breakfast`, `lunch`, `dinner` or `snack`) SHALL be kept as that bed's served tray for the meal, and every media reference returns `served_meal`: that value, or null for other media and for media stored before served photos were kept. `served_meal` with `kind: voice`, or any other value, gets 400 `invalid_request` and stores nothing. It makes no model request.

#### Scenario: Served lunch
- **WHEN** Ravi Kumar uploads a PNG for bed 1 at 12:40 with `kind: photo` and `served_meal: lunch`
- **THEN** the response is 201 with `kind: photo`, `served_meal: "lunch"`, `created_at` 12:40 and a `sha256`
- **AND** the upstream received no request

#### Scenario: Not a served photo
- **WHEN** WebM bytes are uploaded with `kind: voice` and `served_meal: lunch`, and a PNG with `kind: photo` and `served_meal: brunch`
- **THEN** both responses are 400 with `error: invalid_request`, and no media is stored

### Requirement: Served tray of a bed
`GET /api/admissions/:id/served-tray` SHALL return 200 `{ media }`: the bed's newest photo uploaded with any `served_meal` at or after now − 4 h and linked by no record, as a media reference, else `media: null`. It never returns another bed's photo, an unknown admission gets 404 `not_found`, and it makes no model request.

#### Scenario: Lunch waiting
- **WHEN** at 15:10 bed 1 has a served lunch photo 41 from 14:30 and a served lunch photo from 14:50 that a lunch saved at 15:00 links, and bed 2 has a served snack photo from 15:05
- **THEN** `GET /api/admissions/1/served-tray` returns 200 with `media.id: 41` and `media.served_meal: "lunch"`
- **AND** the upstream received no request

#### Scenario: Nothing waiting
- **WHEN** at 15:10 bed 1's only served photo was uploaded at 11:09, and `GET /api/admissions/9999/served-tray` is sent
- **THEN** bed 1's served tray is `media: null`, and admission 9999 gets 404 with `error: not_found`

### Requirement: Served photo linked to the meal
A photo meal SHALL accept as `served_media_id` only a served photo of the same admission whose `served_meal` is the meal's `meal`, that no other meal links, and that is neither its tray photo nor of the tray photo's `sha256`; its `media_id` is never a served photo. The meal returns it as `served_media`, and `proof.served` holds its media id, SHA-256, who uploaded it and when. Anything else gets 400 `invalid_request` and stores nothing. It makes no model request.

#### Scenario: Lunch with its served tray
- **WHEN** Ravi Kumar uploads bed 1's served lunch photo (media 41) at 12:40 and its collected tray photo (media 42) at 13:30, and saves the lunch at 13:32 with `media_id: 42`, `served_media_id: 41` and the evidence of the compared read
- **THEN** the response is 201, and the meal's `served_media` has `id: 41`, `kind: photo` and `served_meal: "lunch"`
- **AND** `proof.served` holds `media_id: 41`, the `sha256` the upload of 41 returned, `captured_by` Ravi Kumar and `captured_at` 12:40, and `proof.photo` holds media 42
- **AND** the upstream received no request

#### Scenario: Wrong served photo
- **WHEN** a photo lunch is posted for bed 1:
  - with a served breakfast photo of bed 1 as `served_media_id`;
  - with bed 2's served lunch photo;
  - with a served lunch photo already linked by another meal;
  - with `served_media_id` equal to its `media_id`;
  - with a photo uploaded without `served_meal`;
  - with a served lunch photo as its `media_id`
- **THEN** each response is 400 with `error: invalid_request`, and no meal is stored

#### Scenario: Same bytes uploaded twice
- **WHEN** bed 1's served lunch photo 41 and its tray photo 42 hold the same bytes, and the lunch is posted with `media_id: 42`, `served_media_id: 41` and evidence whose `comparison` names 41 with its `sha256`
- **THEN** the response is 400 with `error: invalid_request` and an issue at `served_media_id`, and no meal is stored
- **AND** the upstream received no request

#### Scenario: By-hand meal with a served photo
- **WHEN** a `manual` lunch is posted with a `served_media_id`
- **THEN** the response is 400 with `error: invalid_request`

### Requirement: Comparison bound to its photos
A photo meal SHALL send `served_media_id` exactly when its evidence has a `comparison`, whose `served_media_id` equals it and whose `served_sha256` equals that media's `sha256`, as its `image_sha256` equals the tray photo's ("Tray evidence bound to its photo"). Otherwise the post gets 400 `invalid_request` and stores nothing. Both fingerprints are checked against the stored media, and it makes no model request.

#### Scenario: Both photos bound
- **WHEN** bed 1's lunch is read by `POST /api/ai/meal` with its served photo 41, the same collected bytes are uploaded as media 42, and the lunch is posted with `media_id: 42`, `served_media_id: 41` and the read as evidence
- **THEN** the response is 201
- **AND** `evidence.comparison.served_sha256`, `served_media.sha256` and `proof.served.sha256` are the same value, as are `evidence.image_sha256`, `media.sha256` and `proof.photo.sha256`
- **AND** saving made no upstream request

#### Scenario: Comparison without its served photo
- **WHEN** a photo lunch is posted with evidence whose `comparison` names media 41, and no `served_media_id`
- **THEN** the response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Served photo without a comparison
- **WHEN** a photo lunch is posted with `served_media_id: 41` and evidence whose `comparison` is null, and another with `served_media_id: 41` and no evidence
- **THEN** both responses are 400 with `error: invalid_request` and no meal is stored

#### Scenario: Another served photo
- **WHEN** bed 1 has served lunch photos 41 and 43, and a lunch is posted with `served_media_id: 43` and evidence whose `comparison` names 41
- **THEN** the response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Served fingerprint differs
- **WHEN** a lunch is posted with `served_media_id: 41` and evidence whose `comparison.served_sha256` is not media 41's `sha256`
- **THEN** the response is 400 with `error: invalid_request` and no meal is stored

### Requirement: Amend a meal
`POST /api/meals/:id/amend` SHALL change a meal's `portion`, `items` or `dishes` under the rules of "Record a meal" and "Dishes on a meal", given a 3–200 character `reason`, changing at least one of them. It sets `amended_at` and returns 200 with the meal. A voided meal gets 409 `voided`, an unknown one 404 `not_found`, anything else 400 `invalid_request`, and nothing changes. It makes no model request.

#### Scenario: Rice finished after all
- **WHEN** signed in as Anita Thomas (id 4), a lunch with portion 75, items `rice, dal`, 150 mL and dishes rice 50 and dal 100 is amended to `{ dishes: [{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }, { index: 2, name: "dal", dish_kind: "dal_lentils", portion: 100 }], reason: "tray rechecked" }`
- **THEN** the response is 200 with those dishes, items `rice, dal`, portion 75 and `amended_at` set
- **AND** its `evidence`, `proof`, `fluid_ml` (150), fluid entry and media are unchanged
- **AND** the upstream received no request

#### Scenario: Portion only
- **WHEN** a `manual` breakfast with portion 50, items `toast` and no dishes is amended to `{ portion: 25, reason: "half the toast left" }`
- **THEN** the response is 200 with portion 25 and items `toast`

#### Scenario: Amended portion counts
- **WHEN** a bed's last three meals were each 25 % eaten, so its alerts include `poor_meal_intake`, and the latest is amended to `{ portion: 100, reason: "patient ate it later" }`
- **THEN** the bed's alerts no longer include `poor_meal_intake`

#### Scenario: Refused amendments
- **WHEN** the lunch from "Rice finished after all" is amended:
  - with reason `ok`;
  - with no change, `{ portion: 75, reason: "checked again" }`;
  - with a dish of kind `pizza`, or with portion 40;
  - with `fluid_ml: 200`
- **THEN** each response is 400 with `error: invalid_request` and nothing changes
- **AND** amending a voided meal gets 409 with `error: voided`, and `/api/meals/9999/amend` gets 404 with `error: not_found`

### Requirement: Amended dishes set the items
When an amendment sends `dishes`, the meal's `items` SHALL become their names in the order sent, joined by ", " and cut to 200 characters, as a tray read's draft joins them. `items` sent with `dishes`, or alone on a meal that has dishes, gets 400 `invalid_request` and changes nothing. It makes no model request.

#### Scenario: Dish renamed
- **WHEN** the lunch with dishes rice and dal is amended to the same dishes with dal renamed `sambar`, reason `it was sambar`
- **THEN** the response is 200 and its items are `rice, sambar`

#### Scenario: List order kept
- **WHEN** a lunch whose dishes are, in order, rice (index 1, portion 50) and dal (index 0, portion 100), with items `rice, dal`, is amended to the same dishes with rice at 100, reason `tray rechecked`
- **THEN** the response is 200 and its items are `rice, dal`, not `dal, rice`

#### Scenario: Items with dishes
- **WHEN** the lunch from "Dish renamed" is amended with `items: "rice"` and its dishes together, and then with `items: "rice"` alone
- **THEN** both responses are 400 with `error: invalid_request`, and its items stay `rice, sambar`

### Requirement: Meal amendments need a nurse
When the signed-in staff member is not a nurse or matron (an attendant or a dietitian), `POST /api/meals/:id/amend` SHALL get 403 `forbidden` before the body or the meal is checked, and change nothing: no amendment and no new value. Nurses and matrons may amend. It makes no model request.

#### Scenario: Attendant amends
- **WHEN** signed in as Ravi Kumar (id 1, attendant), a lunch is amended to `{ portion: 100, reason: "all eaten" }`
- **THEN** the response is 403 with `error: forbidden`, and the lunch keeps its portion with `amendments: []`

#### Scenario: Role checked first
- **WHEN** signed in as Sunita Devi (id 2, attendant), `POST /api/meals/9999/amend` is sent with `{}`
- **THEN** the response is 403 with `error: forbidden`

#### Scenario: Dietitian amends
- **WHEN** signed in as Sana Mirza (id 11, dietitian), a lunch is amended to `{ portion: 100, reason: "all eaten" }`
- **THEN** the response is 403 with `error: forbidden`, and the lunch is unchanged

#### Scenario: Matron amends
- **WHEN** signed in as Lakshmi Iyer (id 10, matron), the same lunch is amended
- **THEN** the response is 200, and its amendment is `by` Lakshmi Iyer

### Requirement: Meal amendment history
Each meal amendment SHALL be kept with the meal's portion, items and dishes before and after, its reason, who made it and when, and returned by every meal read as the meal's `amendments`, oldest first. The database refuses any UPDATE or DELETE of a kept amendment, and voiding the meal keeps them. It makes no model request.

#### Scenario: Two amendments
- **WHEN** that lunch is amended at 14:30 by Anita Thomas (rice 50 → 100, reason `tray rechecked`) and at 15:10 by Lakshmi Iyer (portion 75 → 100, reason `patient finished it`)
- **THEN** its `amendments` hold, in that order:
  - `{ at: 14:30, by: Anita Thomas, reason: "tray rechecked" }`, with `before` portion 75, items `rice, dal`, dishes rice 50 and dal 100, and `after` the same with rice 100;
  - `{ at: 15:10, by: Lakshmi Iyer, reason: "patient finished it" }`, with `before` portion 75 and `after` portion 100, both with dishes rice 100 and dal 100
- **AND** its `amended_at` is 15:10

#### Scenario: Database refuses changes
- **WHEN** `UPDATE meal_event SET reason = 'x'` and then `DELETE FROM meal_event` are run directly on the store file
- **THEN** SQLite aborts each statement with an error, and the lunch still returns the same two amendments

#### Scenario: Kept after a void
- **WHEN** that lunch is voided with reason `wrong bed`
- **THEN** it still returns both amendments, with `voided_at` set
