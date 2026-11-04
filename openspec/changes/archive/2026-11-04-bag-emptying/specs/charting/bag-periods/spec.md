# Spec Delta

## Purpose

Charting urine, stoma and drain bags from the photos staff take when they check, empty or change them. Each reading charts the rise in the bag's level since its baseline, never the raw level. Periods run between emptyings, and falls, missed emptyings and late readings are handled without double counting. A reading-due prompt comes from the readings and the clock. None of it calls a model.

## ADDED Requirements

### Requirement: Record a bag reading
`POST /api/admissions/:id/bag-readings` SHALL store a reading of a `urine_bag`, `stoma_bag` or `drain_bag` and return 201 with it and the entry it charted, or `entry: null`. A reading has a level (0–5000 mL), an event (`check`, `emptied` or `bag_changed`), a source (`photo`, optionally with a photo and read evidence, or `manual`), its staff member and a `charted_at` as for late entries. An invalid body gets 400 `invalid_request`, an unknown admission 404 `not_found`. No model request is made.

#### Scenario: Normal emptying
- **WHEN** at 08:00 on 3 Nov, signed in as Ravi Kumar (id 1), `{ container: "urine_bag", event: "emptied", volume_ml: 600, source: "photo", media_id: <a photo of 3A bed 3> }` is posted for 3A bed 3, whose bag has no earlier reading
- **THEN** the response is 201 with a reading that has `event: emptied`, `volume_ml: 600`, `baseline_ml: 0`, `rise_ml: 600`, `media` that photo and `created_by` `{ id: 1, name: "Ravi Kumar", role: "attendant" }`
- **AND** its entry is `out` / `urine`, 600 mL, `pending`, created by Ravi Kumar, with the same photo as `media`
- **AND** the upstream received no request

#### Scenario: Photo with the level typed
- **WHEN** signed in as Ravi Kumar (id 1), `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "photo", media_id: <a photo of 3A bed 3> }`, with no `evidence` or `confidence`, is posted for 3A bed 3
- **THEN** the response is 201 with a reading that has `source: photo`, `media` that photo and `evidence: null`, and its entry has the same photo as `media`
- **AND** the upstream received no request

#### Scenario: Not a bag reading
- **WHEN** each of these is posted for 3A bed 3:
  - `{ container: "urinal", event: "check", volume_ml: 300, source: "manual" }`;
  - `{ container: "water_jug", event: "check", volume_ml: 600, source: "manual" }`;
  - a urine bag reading without `event`;
  - a urine bag reading with `event: "refilled"`;
  - a urine bag reading of 5001 mL;
  - a stoma bag reading with `urine_colour: "yellow"`;
  - a `manual` urine bag reading with a `media_id`
- **THEN** each response is 400 with `error: invalid_request`, and nothing is stored

#### Scenario: Unknown admission
- **WHEN** a valid urine bag reading is posted for admission 999
- **THEN** the response is 404 with `error: not_found`

### Requirement: Output is the rise since the baseline
A bag reading SHALL chart its level minus its baseline as one pending output entry of the bag's category (urine, stoma or drain). The baseline is the previous reading's level when that was a `check`, or the residual recorded after the previous emptying (0 if none), however old the previous reading is. With no earlier reading of that bag, the baseline is 0. A rise of 0 charts nothing. Each kind of bag has its own readings.

#### Scenario: Hourly checks, then emptied
- **WHEN** 3A bed 3's urine bag is emptied at 600 mL at 08:00, then checked at 150 mL at 09:00 and at 260 mL at 10:00, and emptied at 380 mL at 11:00
- **THEN** the 09:00, 10:00 and 11:00 readings chart pending urine entries of 150, 110 and 120 mL, which add up to the 380 mL the bag held
- **AND** the upstream received no request

#### Scenario: Emptied before it was full
- **WHEN** the bag emptied at 600 mL at 08:00 is emptied again at 10:30, before a transfer, at 220 mL
- **THEN** the 10:30 reading charts a 220 mL urine entry

#### Scenario: Level unchanged
- **WHEN** the bag is checked at 300 mL at 10:02 and again at 300 mL at 10:13
- **THEN** the second response is 201 with `rise_ml: 0` and `entry: null`

#### Scenario: Two days apart
- **WHEN** 3A bed 3's urine bag was checked at 400 mL at 08:00 on 1 Nov, with no reading since, and is checked at 700 mL at 09:00 on 3 Nov
- **THEN** the 3 Nov reading has `baseline_ml: 400` and charts 300 mL

#### Scenario: Bags kept apart
- **WHEN** the bed's stoma bag is checked at 120 mL and then at 200 mL, while its urine bag reads 380 mL
- **THEN** the second stoma reading charts an 80 mL `stoma` entry, and no urine reading changes

### Requirement: Emptying and bag change start a new period
After an `emptied` reading, the bag's next reading SHALL take as its baseline the residual recorded for that emptying, 0 when none is; after a `bag_changed` reading, 0. Each closes the bag's period, and charts its own rise as any reading does.

#### Scenario: Bag changed
- **WHEN** a urine bag is emptied at 500 mL at 06:00, checked at 300 mL at 08:00, changed at 12:00 with the old bag at 900 mL, and the new bag is checked at 100 mL at 13:00
- **THEN** the entries are 300 mL at 08:00, 600 mL at 12:00 and 100 mL at 13:00

#### Scenario: Residual left in the bag
- **WHEN** the bag emptied at 600 mL at 08:00 had a residual of 30 mL recorded, and it is checked at 200 mL at 10:00
- **THEN** the 10:00 reading has `baseline_ml: 30` and charts 170 mL

### Requirement: Level fell with no emptying recorded
A bag reading below its baseline SHALL be saved with `fell: true` and `fell_from_ml` (that baseline), chart its whole level as output from an unknown baseline, start a new period, and raise `bag_level_fell` while it is charted in the last 24 hours, listing its entry in `entry_ids`. The drop itself is not charted, as nobody measured it. Nothing is refused, however old the previous reading is.

#### Scenario: Emptied but not recorded
- **WHEN** 2C bed 6's urine bag is checked at 500 mL at 09:00 and at 150 mL at 12:00
- **THEN** the 12:00 response is 201 with `fell: true`, `fell_from_ml: 500` and a pending 150 mL urine entry
- **AND** the alerts include `bag_level_fell` with the message `Urine bag level fell from 500 to 150 mL with no emptying recorded. Was it emptied? Review.`, and `entry_ids` holding that entry
- **AND** the upstream received no request

#### Scenario: Fell to empty
- **WHEN** the bag is checked at 500 mL at 09:00 and at 0 mL at 12:00
- **THEN** the 12:00 response has `entry: null`, and the alerts include `bag_level_fell` with empty `entry_ids`

#### Scenario: Below the residual
- **WHEN** a bag emptied at 08:00 had a 30 mL residual recorded, and it is checked at 20 mL at 09:00
- **THEN** the 09:00 reading has `fell_from_ml: 30` and charts 20 mL, and the message is `Urine bag level fell from 30 to 20 mL with no emptying recorded. Was it emptied? Review.`

#### Scenario: Two days apart
- **WHEN** a urine bag checked at 500 mL at 08:00 on 1 Nov, with no reading since, is checked at 150 mL at 09:00 on 3 Nov
- **THEN** the 3 Nov reading has `fell: true` and `fell_from_ml: 500` and charts 150 mL, and the alerts include `bag_level_fell`

#### Scenario: A day later
- **WHEN** the 12:00 reading that fell from 500 mL was charted 24 hours and 1 minute ago
- **THEN** the alerts do not include `bag_level_fell`

### Requirement: Add a missed emptying
An `emptied` reading charted strictly between a fall reading and the reading before it SHALL chart its level minus the fall's `fell_from_ml` when at or above it, clear that fall's `bag_level_fell`, and leave the fall's entry as it is; below it, it is a fall itself and charts its whole level. An `emptied` or `bag_changed` reading posted there by an attendant gets 403 `forbidden` and stores nothing. It makes no model request.

#### Scenario: Emptied at 10:30
- **WHEN** 2C bed 6's bag fell from 500 mL at 09:00 to 150 mL at 12:00, and at 13:00 Anita Thomas (id 4, nurse) posts `{ container: "urine_bag", event: "emptied", volume_ml: 550, source: "manual", charted_at: <10:30> }`
- **THEN** the response is 201 with a pending 50 mL urine entry charted at 10:30 with `late: true`
- **AND** the alerts no longer include `bag_level_fell`
- **AND** the 12:00 entry is still 150 mL with its status and history unchanged, and the 12:00 reading now has `baseline_ml: 0`, `fell: false` and `fell_from_ml: null`
- **AND** the upstream received no request

#### Scenario: Level not known
- **WHEN** the missed emptying is posted at 500 mL instead
- **THEN** the response is 201 with `entry: null`, and the alerts no longer include `bag_level_fell`

#### Scenario: From the residual
- **WHEN** a bag emptied at 600 mL at 08:00 had a 30 mL residual recorded and fell to 20 mL at 09:00, and Anita Thomas posts an emptying at 40 mL charted for 08:30
- **THEN** the response is 201 with a 10 mL urine entry, and the alerts no longer include `bag_level_fell`

#### Scenario: Below the floor
- **WHEN** the 10:30 missed emptying of the 500 → 150 mL fall is posted by Anita Thomas at 450 mL instead
- **THEN** the response is 201 with `fell: true`, `fell_from_ml: 500` and a 450 mL urine entry
- **AND** the alerts include one `bag_level_fell`, with the message `Urine bag level fell from 500 to 450 mL with no emptying recorded. Was it emptied? Review.`, and the 12:00 reading has `fell: false`

#### Scenario: Not by an attendant
- **WHEN** Ravi Kumar (id 1, attendant) posts the 10:30 emptying, and then a bag change charted for 10:30
- **THEN** both responses are 403 with `error: forbidden`, nothing is stored, and the alerts still include `bag_level_fell`

### Requirement: Late readings never change a charted entry
A reading charted before the bag's newest reading SHALL chart only the output not already charted for the readings around it, so the bag's charted total equals what the same readings would chart in time order. No existing entry's volume, status or history changes. Each reading's own rise is recomputed on every read.

#### Scenario: Check added between two readings
- **WHEN** a bag was emptied at 600 mL at 08:00, checked at 150 mL at 09:00 (150 mL charted) and emptied at 380 mL at 11:00 (230 mL charted), and at 11:30 a check at 260 mL charted for 10:00 is posted
- **THEN** the response is 201 with `rise_ml: 110` and `entry: null`
- **AND** the 11:00 entry is still 230 mL, with no new history event
- **AND** the bag's readings now show rises of 150, 110 and 120 mL, and the 11:00 reading keeps its 230 mL entry

#### Scenario: Emptying added between two checks
- **WHEN** a bag was checked at 150 mL at 09:00 (150 mL charted) and at 380 mL at 11:00 (230 mL charted), and Anita Thomas posts an emptying at 260 mL charted for 10:00
- **THEN** the response has a 260 mL entry charted at 10:00
- **AND** the bag's entries add up to 640 mL, as the readings in time order give: 150 + 110 + 380 mL

#### Scenario: After the newest reading
- **WHEN** a bag's newest reading is a check at 150 mL at 09:00, and at 11:15 a check at 260 mL charted for 10:00 is posted
- **THEN** it charts a 110 mL entry with `late: true`

#### Scenario: Out of range
- **WHEN** at 14:10 a reading is posted with `charted_at` 14:12 the same day, and another 25 hours earlier
- **THEN** both responses are 400 with `error: invalid_request`, and nothing is stored

### Requirement: After-emptying record
`POST /api/bag-readings/:id/after-emptying` with a `media_id` (a proof photo of the bag after emptying), a `residual_ml`, or both, SHALL store them on an `emptied` reading, or the photo only on a `bag_changed` reading, and return 200 with the reading. The residual (0 to the reading's level) becomes the next reading's baseline. It is accepted once, while no later reading of the bag exists. An id that is not a bag reading gets 404 `not_found`. No model request is made.

#### Scenario: Proof photo
- **WHEN** after the 08:00 emptying of 3A bed 3's bag (reading 31), a JPEG is uploaded for that bed and `{ media_id: <it> }` is posted to `/api/bag-readings/31/after-emptying`
- **THEN** the response is 200 with `proof_media` of `kind: photo`, and `GET /api/media/<it>` returns the photo
- **AND** it is still served 25 hours later
- **AND** the upstream received no request

#### Scenario: Residual
- **WHEN** `{ residual_ml: 30 }` is posted for reading 31, and the bag is then checked at 200 mL
- **THEN** the first response has `residual_ml: 30`, and the check charts 170 mL

#### Scenario: Closed
- **WHEN** a second after-emptying record is posted for reading 31, and one is posted for an emptying followed by a later reading of its bag
- **THEN** both responses are 409 with `error: after_emptying_closed`, and nothing changes

#### Scenario: Invalid
- **WHEN** each of these is posted:
  - `{ residual_ml: 20 }` for a `check` reading;
  - `{ residual_ml: 700 }` for an emptying at 600 mL;
  - `{ residual_ml: 20 }` for a `bag_changed` reading;
  - `{}`;
  - a `media_id` uploaded for another bed
- **THEN** each response is 400 with `error: invalid_request`, and nothing changes

#### Scenario: Not a bag reading
- **WHEN** `{ residual_ml: 30 }` is posted to `/api/bag-readings/9999/after-emptying`, and to the id of a water jug level
- **THEN** both responses are 404 with `error: not_found`, and nothing changes

### Requirement: Bag periods on the chart read
`GET /api/admissions/:id/entries` SHALL return `bags`: the reading interval and, per bag, its periods with a reading charted in the last 24 hours, newest first. A period gives the emptying or bag change that opened and closed it, or null, its readings oldest first with each one's baseline, rise and entry, its total and its rate in mL/h, null when its start is unknown or it has no length. The ward list carries no `bags`. It makes no model request.

#### Scenario: One period closed
- **WHEN** a bag was emptied at 600 mL at 08:00 with no reading before it, checked at 150 mL at 10:00 and at 260 mL at 11:00, and emptied at 380 mL at 12:00
- **THEN** its newest period has `start_at` 08:00, `end_at` 12:00, `closed_by: emptied`, `total_ml: 380`, `rate_ml_h: 95`, and readings at 10:00, 11:00 and 12:00 with `rise_ml` 150, 110 and 120
- **AND** the next period has `start_at: null`, `end_at` 08:00, one reading, `total_ml: 600` and `rate_ml_h: null`
- **AND** the upstream received no request

#### Scenario: Emptied early
- **WHEN** a bag emptied at 08:00 is emptied again at 220 mL at 10:30
- **THEN** that period has `total_ml: 220` and `rate_ml_h: 88`, from its own 2.5 hours

#### Scenario: Open period
- **WHEN** after the 12:00 emptying the bag is checked at 150 mL at 13:00
- **THEN** the newest period has `start_at` 12:00, `end_at: null`, `closed_by: null` and `total_ml: 150`

#### Scenario: No length
- **WHEN** a bag emptied at 08:00 is changed at 0 mL, charted at the same 08:00
- **THEN** that period has `start_at` and `end_at` 08:00, `total_ml: 0` and `rate_ml_h: null`

#### Scenario: No bag
- **WHEN** a bed has only urinal entries
- **THEN** its `bags.periods` is empty

#### Scenario: Not on the ward list
- **WHEN** 3A bed 3 has bag readings, and `GET /api/admissions?ward=<3A>` is read
- **THEN** no item in the response has a `bags` field

### Requirement: Reading interval
A bed's reading interval SHALL be 1 hour on the HDU ward (code `HDU`) and 4 hours on every other ward. It is returned as `bags.interval_h`, with `bags.interval_from: default`. It makes no model request.

#### Scenario: Ward defaults
- **WHEN** the entries of HDU bed 1 and of 3A bed 3 are read
- **THEN** HDU bed 1 has `interval_h: 1` and 3A bed 3 `interval_h: 4`, both with `interval_from: default`

### Requirement: Urine bag reading due
An admission with an active catheter order SHALL raise `bag_reading_due` once more than its reading interval has passed since the later of its newest urine-bag reading and the order's start, and `bag_reading_overdue` instead from twice the interval. A time on another day reads `D Mon HH:MM`. Without the order neither is raised. Working them out makes no model request and never captures anything.

#### Scenario: At the interval
- **WHEN** 3A bed 3 has a catheter order and its newest urine-bag reading is an emptying at 08:00
- **THEN** at 12:00 there is no reading prompt
- **AND** at 12:01 the alerts include `bag_reading_due` with the message `Urine bag reading due (last 08:00). Review.`

#### Scenario: Twice the interval
- **WHEN** no reading follows, and the alerts are read at 15:59 and at 16:00
- **THEN** at 15:59 they include `bag_reading_due`
- **AND** at 16:00 they include `bag_reading_overdue` with the message `Urine bag reading overdue (last 08:00). Review.`, and not `bag_reading_due`

#### Scenario: HDU hourly
- **WHEN** HDU bed 1 has a catheter order and its newest urine-bag reading is a check at 09:00
- **THEN** at 10:00 there is no reading prompt, and at 10:01 the alerts include `bag_reading_due`

#### Scenario: No reading since the order
- **WHEN** at 10:00 a catheter order is set on 3A bed 5, whose newest urine-bag reading was at 06:00
- **THEN** at 14:00 there is no reading prompt
- **AND** at 14:01 the message is `Urine bag reading due (no reading since the catheter order at 10:00). Review.`

#### Scenario: Overnight
- **WHEN** 3A bed 3 has a catheter order and its newest urine-bag reading is at 22:00 on 2 Nov, and the alerts are read at 06:00 on 3 Nov
- **THEN** they include `bag_reading_overdue` with the message `Urine bag reading overdue (last 2 Nov 22:00). Review.`

#### Scenario: Reading taken
- **WHEN** 3A bed 3 has a catheter order and its newest urine-bag reading is at 08:29, so at 12:30 the alerts include `bag_reading_due`, and a check is posted at 12:31
- **THEN** at 12:32 there is no reading prompt

#### Scenario: No catheter order
- **WHEN** 2C bed 6 has urine-bag readings, the newest at 08:00, and no catheter order, and a bed with only urinal entries has none either
- **THEN** at 20:00 neither bed has `bag_reading_due` or `bag_reading_overdue`, and the upstream received no request

### Requirement: Bag prompts join the alerts
`bag_reading_due`, `bag_reading_overdue` and `bag_level_fell` SHALL be listed in each admission's `alerts` wherever those are used: the chart reads, `beds_with_alerts` and the input of `POST /api/ai/explain`. Every message ends `Review.` and never names the patient. Explaining a bed whose only prompt is a bag prompt makes exactly one Spark request.

#### Scenario: Only a fall
- **WHEN** 2C bed 6's only prompt is `bag_level_fell`
- **THEN** `GET /api/wards` shows 2C with `beds_with_alerts: 1`
- **AND** `POST /api/ai/explain` for that bed is 200, and the upstream received exactly one request, whose input contains `bag_level_fell` and not `Fatima Khan`

### Requirement: Bag readings keep their proof
Every bag reading SHALL keep and return its photo, its after-emptying photo, its read evidence, its event, who saved it, its charted and recorded times and `late`. Rejecting the entry it charted keeps all of them, as levels are never deleted. It makes no model request.

#### Scenario: Rise rejected
- **WHEN** a photo reading at 12:00 charted 150 mL, and a nurse rejects that entry with reason `wrong_volume`
- **THEN** `GET /api/media/<its photo>` still returns 200
- **AND** the bag's period still lists the reading with its photo, and its entry with `status: rejected`

#### Scenario: Saved late
- **WHEN** Ravi Kumar (id 1) saves at 10:00 a reading charted for 08:00
- **THEN** the reading has `created_at` 08:00, `recorded_at` 10:00, `late: true` and `created_by` Ravi Kumar

### Requirement: Pre-bag stores
A store file created before bag readings existed SHALL open with its levels, entries and media kept: jug levels and their entries behave as before, urine entries stay entries outside any bag period, and a bag's first reading after it starts from baseline 0. Opening it a second time leaves its schema unchanged. It makes no model request.

#### Scenario: Older store
- **WHEN** a store file whose `level` table has no event, residual, recorded time, staff, proof photo or source column, holding a water jug level of 1000 mL and an approved 400 mL urine entry from a bag photo, is opened
- **THEN** `GET /api/admissions/<that bed>/levels` lists the jug at 1000 mL, the urine entry is listed with `levels: null`, and `bags.periods` is empty
- **AND** a urine bag check at 300 mL then charts 300 mL

#### Scenario: Opened again
- **WHEN** that upgraded file is closed and opened a second time
- **THEN** its `PRAGMA schema_version` is the same before and after the second open
