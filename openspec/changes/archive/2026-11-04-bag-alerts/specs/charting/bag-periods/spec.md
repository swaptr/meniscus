# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
