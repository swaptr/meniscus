# Spec Delta

## MODIFIED Requirements

### Requirement: Care order values
Each kind SHALL accept only its own value, else 400 `invalid_request`, changing nothing:
- `nil_by_mouth`: `{ until? }`, after now, at most 48 h ahead;
- `thickened_fluids`: `{ level }`, 1–4;
- `fluid_limit`: `{ ml, scope }`, an integer 500–3000, `oral` or `total`;
- `intake_target`: `{ ml }`, an integer 500–3000;
- `catheter`: `{ type, inserted_at }`, `urethral` or `suprapubic`, inserted no later than 1 minute from now and within 365 days, optional `measure_every_h` 1, 2, 4, 6, 8, 12 or null.

#### Scenario: Every kind
- **WHEN** at 10:00 on 3 Nov a nurse sets on one bed:
  - `nil_by_mouth` `{ until: <14:00 on 3 Nov> }`;
  - `thickened_fluids` `{ level: 2 }`;
  - `intake_target` `{ ml: 1600 }`;
  - `catheter` `{ type: "urethral", inserted_at: <11:00 on 29 Oct> }`
- **AND** on another bed `nil_by_mouth` with `{}` and `catheter` with `{ type: "suprapubic", inserted_at: <09:00 on 3 Nov>, measure_every_h: 2 }`
- **THEN** each response is 201, and the second bed's nil-by-mouth order has `value: { until: null }`
- **AND** the first bed's catheter order has `measure_every_h: null`, and the second bed's `measure_every_h: 2`

#### Scenario: Boundaries accepted
- **WHEN** at 10:00 on 3 Nov a nurse sends:
  - `fluid_limit` `{ ml: 500, scope: "oral" }`, then `{ ml: 3000, scope: "oral" }`;
  - `nil_by_mouth` `{ until: <10:00 on 5 Nov> }`;
  - `catheter` `{ type: "suprapubic", inserted_at: <10:01 on 3 Nov> }`, then `{ type: "suprapubic", inserted_at: <10:00 on 3 Nov 2025> }`, exactly 365 days earlier;
  - `catheter` `{ type: "urethral", inserted_at: <29 Oct>, measure_every_h: 1 }`, then the same with `measure_every_h: 12`
- **THEN** each response is 201

#### Scenario: Invalid values
- **WHEN** at 10:00 on 3 Nov a nurse sends each of:
  - `fluid_limit` with `{ ml: 450, scope: "total" }`, `{ ml: 3050, scope: "total" }`, `{ ml: 1000.5, scope: "total" }`, `{ ml: 1000, scope: "iv" }` and `{ ml: 1000 }`;
  - `thickened_fluids` with `{ level: 0 }` and `{ level: 5 }`;
  - `intake_target` with `{ ml: 400 }`;
  - `nil_by_mouth` with `{ until: <09:59 on 3 Nov> }`, `{ until: <10:00 on 3 Nov> }` (now), `{ until: <10:01 on 5 Nov> }`, `{ until: "14:00" }` and `{ reason: "theatre" }`;
  - `catheter` with `{ type: "condom", inserted_at: <29 Oct> }`, `{ type: "urethral", inserted_at: <10:02 on 3 Nov> }` and `{ type: "urethral", inserted_at: <2 Nov 2025> }`;
  - `catheter` `{ type: "urethral", inserted_at: <29 Oct> }` with `measure_every_h` 0, 3, 24, 1.5 and `"2"`
- **THEN** each response is 400 with `error: invalid_request`, and the bed has no order

#### Scenario: No interval, sent either way
- **WHEN** a bed's active catheter order is `{ type: "urethral", inserted_at: <29 Oct> }`, and the same is sent with `measure_every_h: null`
- **THEN** the response is 200 with the active order, and the bed's `care_history` holds one catheter order

### Requirement: Catheter necessity review
From `CATHETER_REVIEW_FROM` (08:00) each chart day, an active catheter set before that chart day SHALL raise `catheter_review`. A catheter is its active order and those it replaced of the same `type` and `inserted_at`. It lasts until `POST /api/admissions/:id/care/catheter/review` records a review, which returns 201 `{ id, order_id, at, by }`, once per catheter and chart day. A second review gets 409 `already_reviewed`, and no active catheter order 404 `not_found`. It makes no model request.

#### Scenario: Review due
- **WHEN** HDU bed 1's catheter order was set on 1 Nov, inserted on 29 Oct, and at 09:00 on 3 Nov no review is recorded for that chart day
- **THEN** the alerts include `catheter_review` with the message `Catheter day 6: is it still needed? Review.`
- **AND** `care.catheter.review_due` is true

#### Scenario: Reviewed
- **WHEN** at 09:10, signed in as Nikhil Bose (id 7), `POST /api/admissions/<HDU bed 1>/care/catheter/review` is sent
- **THEN** the response is 201 with `at` 09:10 and `by` `{ id: 7, name: "Nikhil Bose", role: "nurse" }`
- **AND** the alerts no longer include `catheter_review`, `review_due` is false, and `care.catheter.last_review` is that review
- **AND** the upstream received no request

#### Scenario: Once a chart day
- **WHEN** the same review is posted again at 15:00 on 3 Nov, and the alerts are read at 07:59 and at 08:00 on 4 Nov
- **THEN** the 15:00 response is 409 with `error: already_reviewed`
- **AND** at 07:59 there is no `catheter_review`, and at 08:00 there is
- **AND** a review posted at 08:05 on 4 Nov gets 201

#### Scenario: Set today
- **WHEN** a catheter order is set at 10:00 on 3 Nov
- **THEN** there is no `catheter_review` on 3 Nov, and there is one at 08:00 on 4 Nov

#### Scenario: No catheter
- **WHEN** a review is posted for 2C bed 1, which has no active catheter order
- **THEN** the response is 404 with `error: not_found`

#### Scenario: Interval changed while due
- **WHEN** at 09:00 on 3 Nov HDU bed 1's catheter `{ type: "urethral", inserted_at: <11:00 on 29 Oct> }`, set on 1 Nov, has `catheter_review`, and at 09:05 Nikhil Bose sets `{ type: "urethral", inserted_at: <11:00 on 29 Oct>, measure_every_h: 1 }`
- **THEN** the response is 201, and at 09:06 the alerts still include `catheter_review` with the message `Catheter day 6: is it still needed? Review.`
- **AND** a review posted at 09:10 gets 201 with the new order's id as `order_id`, and the alerts then have no `catheter_review`

#### Scenario: Reviewed, then interval changed
- **WHEN** HDU bed 1's catheter was reviewed at 08:30 on 3 Nov, and at 09:00 its order is replaced by one with the same type and insertion time and `measure_every_h: 1`
- **THEN** at 09:01 there is no `catheter_review`, `review_due` is false, and `care.catheter.last_review` is the 08:30 review
- **AND** a review posted at 09:05 gets 409 with `error: already_reviewed`

#### Scenario: Another catheter
- **WHEN** at 10:00 on 3 Nov HDU bed 1's catheter is replaced by `{ type: "suprapubic", inserted_at: <09:30 on 3 Nov> }`
- **THEN** there is no `catheter_review` on 3 Nov, `care.catheter.day` is 1 and `last_review` is null
- **AND** there is a `catheter_review` at 08:00 on 4 Nov
