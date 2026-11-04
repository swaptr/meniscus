# Spec Delta

## MODIFIED Requirements

### Requirement: Reading interval
A bed's reading interval SHALL be its active catheter order's `measure_every_h` when that is set, with `bags.interval_from: catheter`; otherwise its acuity's `interval_h` (charting/acuity "Reading interval by acuity"), 1 hour for `critical`, 2 for `watch` and 4 for `stable`, where a bed without an acuity order takes its ward's `default_acuity`, with `bags.interval_from: acuity`. It is returned as `bags.interval_h`. It makes no model request.

#### Scenario: Ward defaults
- **WHEN** the entries of HDU bed 1 and of 3A bed 3 are read, neither bed having an acuity order
- **THEN** HDU bed 1 has `interval_h: 1` and 3A bed 3 `interval_h: 4`, both with `interval_from: acuity`

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
- **THEN** it has `interval_h: 4` and `interval_from: acuity`

#### Scenario: Order ended
- **WHEN** the 1-hour catheter order on 3A bed 3 is ended at 09:30
- **THEN** at 09:31 the bed has `interval_h: 4` and `interval_from: acuity`, and no reading prompt

#### Scenario: Acuity order
- **WHEN** 3A bed 3 has a catheter order `{ type: "urethral", inserted_at: <29 Oct> }` with no interval, its newest urine-bag reading is an emptying at 08:00, and at 09:00 a nurse sets its acuity to `watch`
- **THEN** the bed has `interval_h: 2` and `interval_from: acuity`
- **AND** at 10:00 there is no reading prompt, and at 10:01 the alerts include `bag_reading_due`

#### Scenario: Back to the ward default
- **WHEN** that acuity order is ended at 10:30
- **THEN** the bed has `interval_h: 4` and `interval_from: acuity`, and at 10:31 the alerts hold no reading prompt

#### Scenario: Catheter before acuity
- **WHEN** 5B bed 1 (order `watch`) has a catheter order with `measure_every_h: 1`, set at 07:00, and its newest urine-bag reading is a check at 08:00, and HDU bed 2 (ward `critical`) has a catheter order with `measure_every_h: 6`
- **THEN** 5B bed 1 has `interval_h: 1` and HDU bed 2 `interval_h: 6`, both with `interval_from: catheter`
- **AND** 5B bed 1's alerts include `bag_reading_due` at 09:01, not at 10:01 as its acuity's 2 hours would give

## ADDED Requirements

### Requirement: Reading interval on the bed lookup
`GET /api/beds/:token` SHALL include `reading_interval` `{ h, from }`, the bed's reading interval and its source as its entries read gives them in `bags.interval_h` and `bags.interval_from` ("Reading interval"), so a bed found by its QR card has its interval with no further request. It makes no model request.

#### Scenario: Three beds
- **WHEN** the QR tokens of HDU bed 1 (ward `critical`), 5B bed 1 (order `watch`) and 3A bed 3 (catheter `measure_every_h: 1`) are looked up
- **THEN** their `reading_interval` are `{ h: 1, from: "acuity" }`, `{ h: 2, from: "acuity" }` and `{ h: 1, from: "catheter" }`
- **AND** each equals `bags.interval_h` and `bags.interval_from` on that bed's `GET /api/admissions/:id/entries`
- **AND** the upstream received no request
