# charting/meals Specification

## Purpose
The food chart beside the fluid chart: meals per admission with the portion eaten, the items and the fluid served with them, who recorded them and how, and voiding a wrong record. The fluid in a meal reaches the fluid chart only as a pending entry a nurse approves. None of it calls a model.

## Requirements

### Requirement: Record a meal
`POST /api/admissions/:id/meals` SHALL store a meal: `meal` (`breakfast`, `lunch`, `dinner`, `snack`), `portion` eaten (0, 25, 50, 75 or 100), optional `items` (≤ 200 characters) and integer `fluid_ml` (1–5000), `source` (`manual` or `photo`), optional `confidence` and, for photos only, the read evidence. `charted_at`, `late` and `X-Staff-Id` follow the entry rules. It returns 201 with the meal, 400 `invalid_request` or 404 `not_found`, and makes no model request.

#### Scenario: Lunch by hand
- **WHEN** `{ meal: "lunch", portion: 50, items: "rice, dal", source: "manual" }` is posted for bed 1 with `X-Staff-Id: 1`
- **THEN** the response is 201 with `meal: "lunch"`, `portion: 50`, `items: "rice, dal"`, `fluid_ml: null`, `entry_id: null`, `late: false`, `created_by` Ravi Kumar, and the upstream received no request

#### Scenario: Invalid meals
- **WHEN** meals are posted with `portion: 40`, `meal: "brunch"`, `fluid_ml: 0`, `fluid_ml: 150.5`, evidence on a `manual` meal, `charted_at` 25 hours ago, and `X-Staff-Id: 999`
- **THEN** each response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Unknown admission
- **WHEN** a meal is posted for admission 9999
- **THEN** the response is 404 with `error: not_found`

### Requirement: Meal fluid becomes a pending entry
A meal posted with `fluid_ml` SHALL also create a pending intake entry: category `food`, that volume, the meal's charted time, source and staff, no confidence (so it is never batch-approved), and item `<Meal>: <items>` (or the meal alone) cut to 200 characters. The meal SHALL return its `entry_id` and that entry's `entry_status`. The volume counts in the 24 h totals only once the entry is approved.

#### Scenario: Soup with dinner
- **WHEN** `{ meal: "dinner", portion: 75, items: "soup, roti", fluid_ml: 200, source: "manual" }` is posted for bed 2
- **THEN** the bed's entries include a pending `in` / `food` entry of 200 mL with item `Dinner: soup, roti` and `confidence: null`, the meal's `entry_id` is that entry's id with `entry_status: "pending"`, and the bed's `pending_ml` rises by 200 while `in_ml` is unchanged

#### Scenario: Long items
- **WHEN** a breakfast with 200 characters of items and 100 mL is posted
- **THEN** its entry's item starts with `Breakfast: ` and is exactly 200 characters long

### Requirement: Meals of the last day
`GET /api/admissions/:id/meals` SHALL return the admission's meals charted in the last 24 hours, newest charted first, each with its staff, linked entry status and void details, and `404 not_found` for an unknown admission. It makes no model request.

#### Scenario: Two meals
- **WHEN** a breakfast is charted 6 hours ago, a lunch 1 hour ago and a dinner 25 hours ago for bed 3
- **THEN** the list holds the lunch then the breakfast (marked late), and not the dinner

### Requirement: Void a meal
`POST /api/meals/:id/void` with a `reason` of 3 to 200 characters SHALL mark the meal voided with the time, reason and the signed-in person, keeping the record. If its fluid entry is pending, that entry SHALL be rejected with reason `other` and the void reason as its note; an approved fluid entry stays. Voiding twice SHALL get 409 `already_voided`, an unknown meal 404 `not_found`, a short reason or unknown staff 400 `invalid_request`. It makes no model request.

#### Scenario: Wrong bed
- **WHEN** the dinner with 200 mL soup (pending) is voided with reason `wrong bed` and `X-Staff-Id: 4`
- **THEN** the meal returns `voided_at` set, `void_reason: "wrong bed"`, `voided_by` Anita Thomas, `entry_status: "rejected"`, it is still listed, and the soup entry is rejected with reason `other` and note `wrong bed` by Anita Thomas

#### Scenario: Fluid already approved
- **WHEN** a lunch with 150 mL whose entry a nurse approved is voided with reason `wrong bed`
- **THEN** the meal is voided with `entry_status: "approved"` and the bed's `in_ml` is unchanged

#### Scenario: Void refused
- **WHEN** a voided meal is voided again, meal 9999 is voided, a meal is voided with reason `x`, and a meal is voided with `X-Staff-Id: 999`
- **THEN** the responses are 409 `already_voided`, 404 `not_found`, 400 `invalid_request` and 400 `invalid_request`, and the last two meals are not voided

### Requirement: Tray photo kept
A meal with `source: photo` MAY link its tray photo with `media_id`. The meal SHALL return it as `media`, and voiding the meal unlinks it, so it is deleted as in `charting/media` "Media goes with its record". The fluid entry a photo meal creates SHALL link no media (`media: null`); only the meal links the tray. A meal with `source: manual` and a `media_id` SHALL get 400 `invalid_request`. It makes no model request.

#### Scenario: Lunch with its tray
- **WHEN** a tray photo is uploaded for bed 1, and a photo lunch with `fluid_ml: 150` is posted with its `media_id`
- **THEN** the meal and the meals list return `media` with `kind: photo`
- **AND** the lunch's 150 mL fluid entry returns `media: null` and `has_photo: false`
- **AND** `GET /api/media/<id>` returns the photo

#### Scenario: By-hand meal with a photo
- **WHEN** a `manual` breakfast is posted with a `media_id`
- **THEN** the response is 400 with `error: invalid_request`

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
- **WHEN** `UPDATE meniscus.meal SET evidence = '{}'` and then `UPDATE meniscus.meal SET proof = NULL` are run on that lunch's row as the server's own database role
- **THEN** each statement fails with SQLSTATE `P0001`, and the lunch still returns the same `evidence` and `proof`

#### Scenario: Meal by hand
- **WHEN** a `manual` breakfast is posted
- **THEN** it returns `proof: null`

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
- **WHEN** `UPDATE meniscus.meal_event SET reason = 'x'` and then `DELETE FROM meniscus.meal_event` are run as the server's own database role
- **THEN** each statement fails with SQLSTATE `P0001`, and the lunch still returns the same two amendments

#### Scenario: Kept after a void
- **WHEN** that lunch is voided with reason `wrong bed`
- **THEN** it still returns both amendments, with `voided_at` set

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
