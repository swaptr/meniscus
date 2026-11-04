# charting/bag-periods Specification

## Purpose
Charting urine, stoma and drain bags from the photos staff take when they check, empty or change them. Each reading charts the rise in the bag's level since its baseline, never the raw level. Periods run between emptyings, and falls, missed emptyings and late readings are handled without double counting. A reading-due prompt comes from the readings and the clock. None of it calls a model.

## Requirements

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
`GET /api/admissions/:id/entries` SHALL return `bags`: the reading interval and, per bag, its periods with a reading charted in the last 24 hours, newest first. A period gives the emptying or bag change that opened and closed it, or null, its readings oldest first with each one's baseline, rise and entry, its total and its rate in mL/h, null when its start is unknown or it lasts under 15 minutes. The ward list carries no `bags`. It makes no model request.

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

#### Scenario: Too short to rate
- **WHEN** a bag emptied at 08:00 is emptied at 450 mL at 08:10, then at 100 mL at 08:25
- **THEN** the 08:00 → 08:10 period has `total_ml: 450` and `rate_ml_h: null`
- **AND** the 08:10 → 08:25 period has `total_ml: 100` and `rate_ml_h: 400`

### Requirement: Reading interval
A bed's reading interval SHALL be its active catheter order's `measure_every_h` when that is set, with `bags.interval_from: catheter`; otherwise 1 hour on the HDU ward (code `HDU`) and 4 hours on every other ward, with `bags.interval_from: default`. It is returned as `bags.interval_h`. It makes no model request.

#### Scenario: Ward defaults
- **WHEN** the entries of HDU bed 1 and of 3A bed 3 are read
- **THEN** HDU bed 1 has `interval_h: 1` and 3A bed 3 `interval_h: 4`, both with `interval_from: default`

#### Scenario: Catheter interval
- **WHEN** 3A bed 3 has a catheter order `{ type: "urethral", inserted_at: <29 Oct>, measure_every_h: 1 }`, set at 07:00, and its newest urine-bag reading is an emptying at 08:00
- **THEN** its entries read has `interval_h: 1` and `interval_from: catheter`
- **AND** at 09:00 there is no reading prompt, at 09:01 the alerts include `bag_reading_due`, and at 10:00 `bag_reading_overdue`
- **AND** the upstream received no request

#### Scenario: Longer than the ward's
- **WHEN** HDU bed 1 has a catheter order with `measure_every_h: 4`, set at 08:00, and its newest urine-bag reading is a check at 09:00
- **THEN** it has `interval_h: 4` and `interval_from: catheter`
- **AND** at 13:00 there is no reading prompt, and at 13:01 the alerts include `bag_reading_due`

#### Scenario: Not set
- **WHEN** 3A bed 3's catheter order has `measure_every_h: null`
- **THEN** it has `interval_h: 4` and `interval_from: default`

#### Scenario: Order ended
- **WHEN** the 1-hour catheter order on 3A bed 3 is ended at 09:30
- **THEN** at 09:31 the bed has `interval_h: 4` and `interval_from: default`, and no reading prompt

### Requirement: Urine bag reading due
An admission with an active catheter order SHALL raise `bag_reading_due` once more than its reading interval has passed since the later of its newest urine-bag reading and the catheter's start, the first `start_at` of its active order and those it replaced of the same `type` and `inserted_at`, and `bag_reading_overdue` instead from twice the interval. A time on another day reads `D Mon HH:MM`. Without the order neither is raised. Working them out makes no model request and captures nothing.

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

#### Scenario: Interval changed while overdue
- **WHEN** 3A bed 3's catheter `{ type: "urethral", inserted_at: <29 Oct> }`, ordered on 2 Nov, has its newest urine-bag reading at 06:00 on 3 Nov, so at 14:00 the alerts include `bag_reading_overdue`, and at 14:30 a nurse sets the same catheter with `measure_every_h: 2`
- **THEN** at 14:31 the alerts still include `bag_reading_overdue` with the message `Urine bag reading overdue (last 06:00). Review.`
- **AND** on 3A bed 5, whose catheter was ordered at 06:00 on 3 Nov with no urine-bag reading since and changed the same way at 14:30, the message at 14:31 is `Urine bag reading overdue (no reading since the catheter order at 06:00). Review.`
- **AND** the upstream received no request

### Requirement: Bag prompts join the alerts
`bag_reading_due`, `bag_reading_overdue`, `bag_level_fell` and `bag_nearly_full` SHALL be listed in each admission's `alerts` wherever those are used: the chart reads, `beds_with_alerts` and the input of `POST /api/ai/explain`. Every message ends `Review.` and never names the patient. Explaining a bed whose only prompt is a bag prompt makes exactly one Spark request.

#### Scenario: Only a fall
- **WHEN** 2C bed 6's only prompt is `bag_level_fell`
- **THEN** `GET /api/wards` shows 2C with `beds_with_alerts: 1`
- **AND** `POST /api/ai/explain` for that bed is 200, and the upstream received exactly one request, whose input contains `bag_level_fell` and not `Fatima Khan`

#### Scenario: Only nearly full
- **WHEN** 2C bed 2's only prompt is `bag_nearly_full`, and no other 2C bed has a prompt
- **THEN** `GET /api/wards` shows 2C with `beds_with_alerts: 1`
- **AND** `POST /api/ai/explain` for that bed is 200, and the upstream received exactly one request, whose input contains `bag_nearly_full` and not `Grace Okafor`

### Requirement: Bag readings keep their proof
Every bag reading SHALL keep and return its photo, its after-emptying photo, its read evidence, its event, who saved it, its charted and recorded times and `late`. Rejecting the entry it charted keeps all of them, as levels are never deleted. It makes no model request.

#### Scenario: Rise rejected
- **WHEN** a photo reading at 12:00 charted 150 mL, and a nurse rejects that entry with reason `wrong_volume`
- **THEN** `GET /api/media/<its photo>` still returns 200
- **AND** the bag's period still lists the reading with its photo, and its entry with `status: rejected`

#### Scenario: Saved late
- **WHEN** Ravi Kumar (id 1) saves at 10:00 a reading charted for 08:00
- **THEN** the reading has `created_at` 08:00, `recorded_at` 10:00, `late: true` and `created_by` Ravi Kumar

### Requirement: Duplicate bag reading
`POST /api/admissions/:id/bag-readings` SHALL answer 409 `duplicate_reading` with the nearest match as `duplicate_of`, storing and linking nothing, when the same bag has a reading of the same event within 25 mL and 10 minutes of it. Sent with `confirm_duplicate_of` that reading's id, it is saved with `confirmed_duplicate_of`; any other id gets the 409. A different event is never a duplicate. It runs after the read link checks and an attendant's missed-emptying 403. It makes no model request.

#### Scenario: Emptying saved twice
- **WHEN** 3A bed 3's urine bag was checked at 260 mL at 10:00, signed in as Ravi Kumar (id 1), `{ container: "urine_bag", event: "emptied", volume_ml: 380, source: "manual" }` is posted at 11:00 (201, a 120 mL entry), and the same body is posted again at 11:02
- **THEN** the second response is 409 with `error: duplicate_reading` and `duplicate_of` `{ id: <the 11:00 reading>, event: "emptied", volume_ml: 380, created_at: <11:00> }`
- **AND** the bag still holds two readings and one 120 mL entry
- **AND** the upstream received no request

#### Scenario: Saved anyway
- **WHEN** that body is then posted at 11:03 with `confirm_duplicate_of` the 11:00 reading's id
- **THEN** the response is 201 with `confirmed_duplicate_of` that id, `rise_ml: 380` and a pending 380 mL urine entry
- **AND** a reading posted with `confirm_duplicate_of: 5` that repeats no reading is 201 with `confirmed_duplicate_of: null`

#### Scenario: Response lost, tapped again
- **WHEN** the 11:03 response is lost, and the same body, still with `confirm_duplicate_of` the 11:00 reading's id, is posted again at 11:04
- **THEN** the response is 409 with `duplicate_of` `{ id: <the 11:03 reading>, event: "emptied", volume_ml: 380, created_at: <11:03> }`, now the nearest match
- **AND** the bag holds exactly one reading saved anyway, the 11:03 one, and one 380 mL entry from it
- **AND** the upstream received no request

#### Scenario: Match changed
- **WHEN** instead, after the 11:02 refusal, Meera Pillai saves a 380 mL emptying of the same bag charted at 11:01 with `confirm_duplicate_of` the 11:00 reading's id, and at 11:03 Ravi's body is posted with `confirm_duplicate_of` the 11:00 reading's id
- **THEN** Meera's response is 201, and Ravi's is 409 with `duplicate_of` the 11:01 reading, the nearest match, storing nothing

#### Scenario: Bounds
- **WHEN** at 11:15 each of these urine-bag emptyings is posted for a bed whose only urine-bag reading is an emptying at 380 mL charted at 11:00:
  - 405 mL charted at 11:10;
  - 355 mL charted at 10:50;
  - 406 mL charted at 11:00;
  - 380 mL charted at 11:11;
  - 380 mL charted at 10:49
- **THEN** the first two responses are 409 with `error: duplicate_reading`, and the other three are 201

#### Scenario: Different event or bag
- **WHEN** 3A bed 3's urine bag is checked at 380 mL at 11:00, emptied at 380 mL at 11:01 and changed at 0 mL at 11:02, and its stoma bag is checked at 380 mL at 11:03
- **THEN** all four responses are 201

#### Scenario: Posted again with its read
- **WHEN** signed in as Ravi Kumar, the 380 mL emptying saved at 11:00 with `read_id: 47` is posted again at 11:02 with `read_id: 47`
- **THEN** the response is 400 with the issue `{ path: "read_id", message: "already linked" }`, not 409
- **AND** the bag still holds one emptying at 380 mL

#### Scenario: Refused, then saved with its read
- **WHEN** after the 11:00 emptying, photo read 49 at 11:02 reads the bag at 380 mL, and `{ container: "urine_bag", event: "emptied", volume_ml: 380, source: "photo", media_id: <its photo>, evidence: <the read's>, read_id: 49 }` is posted
- **THEN** the response is 409 with `error: duplicate_reading`, and read 49 is linked to nothing
- **AND** the same body with `confirm_duplicate_of` the 11:00 reading's id is 201, and read 49 is linked to the new reading

#### Scenario: Not a way past the nurse
- **WHEN** 2C bed 6's urine bag fell from 500 mL at 09:00 to 150 mL at 12:00, and at 13:00 Ravi Kumar (attendant) posts an emptying at 550 mL charted for 10:30 with `confirm_duplicate_of` the 09:00 reading's id
- **THEN** the response is 403 with `error: forbidden`, and nothing is stored

#### Scenario: Invalid confirmation
- **WHEN** a urine-bag reading is posted with `confirm_duplicate_of` set to `"yes"`, `true`, `0` or `1.5`
- **THEN** each response is 400 with `error: invalid_request`, and nothing is stored

### Requirement: Bag nearly full
A bag whose newest reading is a `check` at or above 80% of its capacity, charted in the last 24 hours, SHALL raise `bag_nearly_full` with the message `<Bag> nearly full: <level> of <capacity> mL at <time>. Review.` The capacities are 2000 mL for a urine bag, 500 mL for a stoma bag and 1000 mL for a drain bag. An emptying or bag change as the newest reading raises none, and no catheter order is needed. Working it out makes no model request.

#### Scenario: At 80%
- **WHEN** 3A bed 3's urine bag is checked at 1599 mL at 10:00 and at 1600 mL at 10:30
- **THEN** at 10:15 the alerts have no `bag_nearly_full`
- **AND** at 10:31 they include `bag_nearly_full` with the message `Urine bag nearly full: 1600 of 2000 mL at 10:30. Review.`
- **AND** the upstream received no request

#### Scenario: Stoma and drain
- **WHEN** 2C bed 2, with no catheter order, has its stoma bag checked at 400 mL and its drain bag at 790 mL, both at 09:00
- **THEN** at 09:30 the alerts include one `bag_nearly_full`, with the message `Stoma bag nearly full: 400 of 500 mL at 09:00. Review.`
- **AND** after the drain bag is checked at 800 mL at 10:00, they also include `Drain bag nearly full: 800 of 1000 mL at 10:00. Review.`

#### Scenario: Emptied
- **WHEN** the urine bag checked at 1600 mL at 10:30 is emptied at 1650 mL at 10:45
- **THEN** at 10:46 the alerts have no `bag_nearly_full`

#### Scenario: Overnight
- **WHEN** a urine bag's newest reading is a check at 1700 mL at 22:00 on 2 Nov, and the alerts are read at 06:00 on 3 Nov
- **THEN** they include `Urine bag nearly full: 1700 of 2000 mL at 2 Nov 22:00. Review.`

#### Scenario: A day later
- **WHEN** the 1600 mL check at 10:30 is still the bag's newest reading 24 hours and 1 minute later
- **THEN** the alerts have no `bag_nearly_full`

### Requirement: Bag reading without the device
An admission SHALL raise one `bag_without_device` per bag with a reading charted in the last 24 h at a time no order for that bag was in force (a catheter for the urine bag, a stoma or drain order for theirs), while no such order is active. The reading is saved and charted as any other. The message names the bag, the newest such reading's time and the missing order, and ends `Review.`. It joins the alerts as the bag prompts do and makes no model request.

#### Scenario: Urine bag on a bed with no catheter
- **WHEN** 3A bed 5 has no catheter order, and at 10:30 Ravi Kumar (id 1) posts `{ container: "urine_bag", event: "check", volume_ml: 300, source: "photo", media_id: <a photo of 3A bed 5> }`
- **THEN** the response is 201 with the reading and a pending 300 mL urine entry
- **AND** the alerts include `bag_without_device` with the message `Urine bag reading at 10:30, but no catheter is on the care plan. Review.`
- **AND** the upstream received no request

#### Scenario: Catheter added
- **WHEN** at 11:00 Anita Thomas (id 4) sets a catheter order on 3A bed 5
- **THEN** the alerts no longer include `bag_without_device`, and the 10:30 reading and its entry are unchanged

#### Scenario: Readings while the catheter was in
- **WHEN** 3A bed 3's urine bag was read at 08:00 and 12:00 under a catheter order ended at 13:00, and the alerts are read at 14:00
- **THEN** they do not include `bag_without_device`
- **AND** after a urine-bag check posted at 15:00 they include it, with the message `Urine bag reading at 15:00, but no catheter is on the care plan. Review.`

#### Scenario: Stoma and drain
- **WHEN** 2C bed 2 has a catheter and no other order, and its stoma bag is checked at 09:00 and its drain bag at 10:00
- **THEN** the alerts include two `bag_without_device`, in the order stoma then drain, with the messages `Stoma bag reading at 09:00, but no stoma is on the care plan. Review.` and `Drain bag reading at 10:00, but no drain is on the care plan. Review.`

#### Scenario: A day later
- **WHEN** 3A bed 5's only urine-bag reading with no catheter was charted 24 hours and 1 minute ago
- **THEN** the alerts do not include `bag_without_device`

#### Scenario: Explained
- **WHEN** 3A bed 5's only prompt is `bag_without_device`
- **THEN** `GET /api/wards` shows 3A with `beds_with_alerts: 1`
- **AND** `POST /api/ai/explain` for that bed is 200, and the upstream received exactly one request, whose input contains `bag_without_device` and not `Joseph Mwangi`

### Requirement: Bag levels on the bed list
Each item of `GET /api/admissions` SHALL carry `bag_levels`: one per bag container with a reading charted in the last 24 hours, in `urine_bag`, `stoma_bag`, `drain_bag` order, holding `container`, `level_ml` (the newest reading's level: a check's volume, an emptying's residual or 0, 0 after a bag change), `capacity_ml`, `read_at` and `due_at` (when "Urine bag reading due" would raise `bag_reading_due`, or null). It makes no model request.

#### Scenario: Urine bag on a catheter
- **WHEN** 3A bed 4 has a catheter order with a 4-hour interval and its newest urine-bag reading is a check of 1680 mL at 18:20
- **THEN** its `bag_levels` is `[{ container: "urine_bag", level_ml: 1680, capacity_ml: 2000, read_at: <18:20>, due_at: <22:20> }]`

#### Scenario: Emptied and changed
- **WHEN** a bed's newest stoma-bag reading is an emptying with no residual and its newest drain-bag reading a bag change
- **THEN** its `bag_levels` holds the stoma bag at `level_ml: 0` of 500 and the drain bag at `level_ml: 0` of 1000, both with `due_at: null`

#### Scenario: No recent reading
- **WHEN** a bed's only urine-bag reading was charted 30 hours ago
- **THEN** its `bag_levels` is `[]`, and the upstream received no request
