# charting/care-plan Specification

## Purpose
Per-admission care orders that change how a fluid chart is read: nil by mouth, thickened fluids (IDDSI drink levels), a fluid limit, a minimum intake target and a catheter. Each order is a time range with its history, set and ended by a nurse or matron. Limits and targets count the chart day. Every kind raises review prompts on the chart, and a catheter gets a daily necessity review. Orders never block a save or end on their own, and none of it calls a model.

## Requirements

### Requirement: Set a care order
`PUT /api/admissions/:id/care/:kind` with a valid value SHALL start an order of that kind from now, recorded with the signed-in person, and return 201 with it. The active order of that kind, if any, ends at the same instant in the same transaction. A value equal to the active one gets 200 with that order and changes nothing. An unknown admission or kind gets 404 `not_found`. It makes no model request.

#### Scenario: Start a fluid limit
- **WHEN** at 10:00 on 3 Nov, signed in as Nikhil Bose (id 7), `PUT /api/admissions/<HDU bed 3>/care/fluid_limit` is sent with `{ ml: 1000, scope: "total" }`
- **THEN** the response is 201 with:
  - `kind: "fluid_limit"` and `value: { ml: 1000, scope: "total" }`;
  - `start_at` 10:00 and `end_at: null`;
  - `set_by` `{ id: 7, name: "Nikhil Bose", role: "nurse" }` and `ended_by: null`
- **AND** the upstream received no request

#### Scenario: Change the value
- **WHEN** at 12:00 the same bed's limit is set to `{ ml: 1200, scope: "total" }`
- **THEN** the response is 201 with a new order starting at 12:00
- **AND** the bed's `care.orders` holds exactly one `fluid_limit`, with `ml: 1200`
- **AND** the 1000 mL order now has `end_at` 12:00 and `ended_by` Nikhil Bose

#### Scenario: Same value again
- **WHEN** at 12:30 `{ ml: 1200, scope: "total" }` is sent again
- **THEN** the response is 200 with the order that started at 12:00, and the bed's `care_history` still holds 2 orders

#### Scenario: Unknown admission or kind
- **WHEN** a nurse sends `PUT /api/admissions/999/care/fluid_limit` with `{ ml: 1000, scope: "total" }`, and `PUT /api/admissions/<HDU bed 3>/care/fluid_restriction` with the same body
- **THEN** both responses are 404 with `error: not_found`, and nothing is stored

#### Scenario: Unknown admission before the body
- **WHEN** a nurse sends `PUT /api/admissions/999/care/fluid_limit` with `{ ml: -5 }`
- **THEN** the response is 404 with `error: not_found`, not 400

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

### Requirement: End a care order
`DELETE /api/admissions/:id/care/:kind` SHALL end the active order of that kind now, recording the signed-in person, and return 200 with the ended order. When none is active, or the admission or kind is unknown, it gets 404 `not_found` and changes nothing. For a `catheter` order, that `end_at` is the only record of its removal. It makes no model request.

#### Scenario: Lift nil by mouth
- **WHEN** Meera Pillai (id 6) set nil by mouth on 2C bed 1 at 06:00, and at 12:00, signed in as Meera Pillai, `DELETE /api/admissions/<2C bed 1>/care/nil_by_mouth` is sent
- **THEN** the response is 200 with the order, `end_at` 12:00 and `ended_by` `{ id: 6, name: "Meera Pillai", role: "nurse" }`
- **AND** the bed's `care.orders` holds no `nil_by_mouth`

#### Scenario: Nothing to end
- **WHEN** `DELETE /api/admissions/<2C bed 1>/care/nil_by_mouth` is sent again, and `DELETE /api/admissions/<2C bed 1>/care/catheter` for a bed that never had a catheter order
- **THEN** both responses are 404 with `error: not_found`, and the bed's `care_history` is unchanged

### Requirement: Care orders need a nurse
After the sign-in checks, setting or ending a care order and recording a catheter review SHALL get 403 `forbidden` unless the signed-in person is a nurse or a matron, or, for a `diet` order only, a dietitian. The role is checked before the admission, the kind or the body, and a refused request changes nothing. It makes no model request.

#### Scenario: Attendant changes an order
- **WHEN** signed in as Ravi Kumar (id 1, attendant), each of these is sent:
  - `PUT /api/admissions/<3A bed 4>/care/fluid_limit` with `{ ml: 1500, scope: "total" }`;
  - `PUT /api/admissions/999/care/fluid_limit` with `{ ml: -5 }`;
  - `DELETE /api/admissions/<2C bed 1>/care/nil_by_mouth`;
  - `POST /api/admissions/<HDU bed 1>/care/catheter/review`
- **THEN** each response is 403 with `error: forbidden`, and no order or review is stored or ended

#### Scenario: No session
- **WHEN** `PUT /api/admissions/<3A bed 4>/care/intake_target` is sent with `{ ml: 1600 }` and no session
- **THEN** the response is 401 with `error: sign_in_required`, and no order is stored

#### Scenario: Matron sets an order
- **WHEN** signed in as Lakshmi Iyer (id 10, matron), `PUT /api/admissions/<3A bed 4>/care/intake_target` is sent with `{ ml: 1600 }`
- **THEN** the response is 201 with `set_by` `{ id: 10, name: "Lakshmi Iyer", role: "matron" }`

#### Scenario: Attendant reads orders
- **WHEN** 3A bed 4 has an intake target, and `GET /api/admissions/<3A bed 4>/entries` is sent signed in as Ravi Kumar
- **THEN** the response is 200, and `care.orders` holds the intake target

#### Scenario: Dietitian sets and ends a diet
- **WHEN** at 10:00, signed in as Sana Mirza (id 11, dietitian), `PUT /api/admissions/<HDU bed 3>/care/diet` is sent with `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }`, and at 12:00 `DELETE /api/admissions/<HDU bed 3>/care/diet`
- **THEN** the responses are 201 with `set_by` `{ id: 11, name: "Sana Mirza", role: "dietitian" }`, and 200 with `end_at` 12:00 and `ended_by` Sana Mirza

#### Scenario: Dietitian and other orders
- **WHEN** signed in as Sana Mirza (id 11, dietitian), each of these is sent:
  - `PUT /api/admissions/<3A bed 4>/care/fluid_limit` with `{ ml: 1500, scope: "total" }`;
  - `PUT /api/admissions/999/care/intake_target` with `{ ml: -5 }`;
  - `PUT /api/admissions/<3A bed 4>/care/fluid_restriction` with `{}`;
  - `DELETE /api/admissions/<2C bed 1>/care/nil_by_mouth`;
  - `POST /api/admissions/<HDU bed 1>/care/catheter/review`
- **THEN** each response is 403 with `error: forbidden`, and no order or review is stored or ended

#### Scenario: Nurse or attendant and a diet
- **WHEN** `PUT /api/admissions/<5B bed 6>/care/diet` is sent with `{ type: "regular", texture: 6 }` signed in as Ravi Kumar (id 1, attendant), and then as Grace Lee (id 5, nurse)
- **THEN** Ravi Kumar's response is 403 with `error: forbidden`
- **AND** Grace Lee's is 201 with `set_by` `{ id: 5, name: "Grace Lee", role: "nurse" }`

### Requirement: Care order history
`GET /api/admissions/:id/entries` SHALL return `care_history`: the admission's orders of every kind, active and ended, newest start first and at most `CARE_HISTORY_LIMIT` (50). Each has its value, `start_at`, `end_at`, `set_by` and `ended_by`. Orders are never deleted or changed in place, apart from being ended. It makes no model request.

#### Scenario: Replaced, then lifted
- **WHEN** on 2C bed 1:
  - Meera Pillai (id 6) sets nil by mouth `{ until: <14:00> }` at 06:00;
  - she sets `{ until: <16:00> }` at 09:00;
  - Lakshmi Iyer (id 10) ends it at 12:00
- **THEN** `care_history` holds, in order:
  - until 16:00, from 09:00 to 12:00, set by Meera Pillai and ended by Lakshmi Iyer;
  - until 14:00, from 06:00 to 09:00, set and ended by Meera Pillai

#### Scenario: Long history
- **WHEN** 55 `thickened_fluids` orders are set on one bed, one minute apart, alternating levels 1 and 2
- **THEN** `care_history` holds the 50 newest, the newest first

### Requirement: Target within the limit
Setting an `intake_target` above the active `fluid_limit`'s mL, or a `fluid_limit` below the active `intake_target`'s mL, SHALL get 400 `invalid_request` with an issue at `ml` that names the other order's mL, and change nothing. Equal values are accepted. It makes no model request.

#### Scenario: Target above the limit
- **WHEN** a bed has an active fluid limit `{ ml: 1500, scope: "total" }`, and its intake target is set to `{ ml: 1600 }`
- **THEN** the response is 400 with `error: invalid_request` and an issue at `ml` whose message contains `1500 mL`
- **AND** the bed has no intake target

#### Scenario: Limit below the target
- **WHEN** a bed has an active intake target of 1600 mL, and its fluid limit is set to `{ ml: 1500, scope: "oral" }`
- **THEN** the response is 400 with an issue at `ml` whose message contains `1600 mL`

#### Scenario: Equal, or the limit ended
- **WHEN** a bed with an active 1500 mL limit gets a 1500 mL target, and another bed, whose 1500 mL limit was ended, gets a 1600 mL target
- **THEN** both responses are 201

### Requirement: Care status on chart reads
Each `GET /api/admissions` item and `GET /api/admissions/:id/entries` SHALL include `care`:
- `orders`: the active orders, at most one per kind, in the order acuity, nil by mouth, thickened fluids, fluid limit, intake target, catheter, stoma, drain, voiding, diet;
- `fluid_limit`, `intake_target` and `catheter`: their progress, each null without its order.

It is computed without any model request.

#### Scenario: Fresh store
- **WHEN** `GET /api/admissions` is called on a fresh store
- **THEN** every admission has `care: { orders: [], fluid_limit: null, intake_target: null, catheter: null }`, and the upstream received no request

#### Scenario: Display order
- **WHEN** a catheter order, then a fluid limit, then nil by mouth, then acuity `watch` are set on one bed
- **THEN** that bed's `care.orders` kinds read `acuity`, `nil_by_mouth`, `fluid_limit`, `catheter`, in both reads

#### Scenario: Device kinds before the diet
- **WHEN** a diet, then a `{ method: "commode" }` voiding order, then a drain, then a catheter, then a stoma are set on one bed
- **THEN** that bed's `care.orders` kinds read `catheter`, `stoma`, `drain`, `voiding`, `diet`, in both reads

### Requirement: Care prompts join the alerts
Care prompts SHALL be listed in each admission's `alerts`, after the existing prompts, wherever those are used: the chart reads, `beds_with_alerts` and the input of `POST /api/ai/explain`. Each has a stable `kind`, and its message ends `Review.` and never names the patient. Explaining a bed whose only prompts are care prompts makes exactly one Spark request. Working them out makes no model request.

#### Scenario: Only a catheter review
- **WHEN** at 09:00 on 3 Nov, HDU bed 1's only prompt is `catheter_review`
- **THEN** `GET /api/wards` shows HDU with `beds_with_alerts: 1`
- **AND** `POST /api/ai/explain` for that bed is 200, and the upstream received exactly one request, whose input contains `catheter_review` and not `Nadia Rahman`

#### Scenario: Wording
- **WHEN** a bed raises each of `fluid_limit_near`, `fluid_limit_reached`, `nil_by_mouth_intake`, `nil_by_mouth_overdue`, `drink_too_thin`, `drink_consistency_unrecorded`, `intake_target_behind` and `catheter_review`, in the scenarios of this capability
- **THEN** every one of their messages ends with `Review.`, and none contains the patient's name

### Requirement: Entries judged by the order then in force
`nil_by_mouth_intake`, `drink_too_thin` and `drink_consistency_unrecorded` SHALL judge each entry or meal charted in the last 24 hours against the order of their kind in force at its charted time, whether or not that order is still active. An order is in force from its start, included, to its end, excluded.

#### Scenario: Lifted after the drink
- **WHEN** nil by mouth ran from 06:00 to 12:00 on 3 Nov, and at 15:00 the alerts are read for a pending 150 mL water entry charted at 10:00
- **THEN** the alerts include `nil_by_mouth_intake` with `entry_ids` holding that entry

#### Scenario: Start and end
- **WHEN** nil by mouth ran from 06:00 to 12:00, and water entries were charted at 05:59, 06:00 and 12:00
- **THEN** `nil_by_mouth_intake` lists only the 06:00 entry

#### Scenario: Level changed
- **WHEN** thickened fluids were ordered at level 3 from 06:00 to 10:00 and at level 1 from 10:00, and level-2 drinks were charted at 09:00 and 11:00
- **THEN** `drink_too_thin` lists only the 09:00 drink

### Requirement: Chart day
Fluid limit and intake target progress SHALL count entries charted in the current chart day: from `CHART_DAY_START` (by default the first shift's start, 08:00 server local time) to the same time the next day. Their `since` gives the start. Every other total and prompt keeps its own window.

#### Scenario: Across the start
- **WHEN** at 10:00 on 3 Nov a bed has an active `{ ml: 1000, scope: "total" }` limit, and approved water of 300 mL charted at 07:59 and 500 mL at 08:00
- **THEN** `care.fluid_limit` has `ml: 500` and `since` 08:00 on 3 Nov
- **AND** `totals.in_ml` is 800

#### Scenario: Before the day's start
- **WHEN** at 07:30 on 3 Nov the same bed has approved water of 400 mL charted at 09:00 on 2 Nov
- **THEN** `care.fluid_limit` has `since` 08:00 on 2 Nov and counts the 400 mL

#### Scenario: Clock change
- **WHEN** the server runs in Europe/London, where clocks go back at 02:00 on 25 Oct 2026, and a bed with an active `{ ml: 1000, scope: "total" }` limit has approved water of 300 mL charted at 08:00 on 24 Oct
- **THEN** at 07:59 on 25 Oct, 24 h 59 min later, `care.fluid_limit` has `since` 08:00 on 24 Oct and `ml: 300`: that chart day lasts 25 h
- **AND** at 08:00 on 25 Oct, `since` is 08:00 on 25 Oct and `ml` is 0

### Requirement: Counted intake
Fluid limit and intake target progress SHALL count pending and approved intake, give the pending part as `pending_ml`, and leave out rejected entries, including a voided meal's pending fluid. The existing totals and prompts keep counting approved volumes only.

#### Scenario: Mixed statuses
- **WHEN** a bed with an active `{ ml: 1000, scope: "total" }` limit has, today:
  - approved water, 500 mL;
  - pending tea, 200 mL;
  - rejected water, 300 mL;
  - a voided dinner whose 150 mL soup was pending
- **THEN** `care.fluid_limit` has `ml: 700` and `pending_ml: 200`, and `totals.in_ml` is 500

### Requirement: Fluid limit progress
An active `fluid_limit` SHALL give `care.fluid_limit`, `{ since, ml, pending_ml, of_ml, percent, left_ml, scope }`, and raise review prompts. `oral` counts water and food, and `total` also IV. `percent` is rounded down, and `left_ml` is never below 0. `fluid_limit_near` is raised from `FLUID_LIMIT_WARN` (80%) of the limit; from 100%, `fluid_limit_reached` is raised instead.

#### Scenario: Near the limit
- **WHEN** HDU bed 3 has a `{ ml: 1000, scope: "total" }` limit, and today approved water 400 mL, approved IV 220 mL and pending tea 200 mL
- **THEN** `care.fluid_limit` has `ml: 820`, `pending_ml: 200`, `percent: 82` and `left_ml: 180`
- **AND** the alerts include `fluid_limit_near` with the message `Fluid limit: 820 of 1000 mL total intake (incl. 200 mL pending) today since 08:00, 82%, 180 mL left. Review.`
- **AND** they do not include `fluid_limit_reached`

#### Scenario: Exactly 80 percent
- **WHEN** a `{ ml: 1000, scope: "total" }` limit has 800 mL approved today, and another has 799 mL
- **THEN** the first raises `fluid_limit_near`, and the second has `percent: 79` and no fluid limit prompt

#### Scenario: Exactly 100 percent
- **WHEN** a `{ ml: 1000, scope: "total" }` limit has 1000 mL approved today
- **THEN** the alerts include `fluid_limit_reached` with the message `Fluid limit reached: 1000 of 1000 mL total intake today since 08:00, 100%, 0 mL left. Review.`, and not `fluid_limit_near`

#### Scenario: Over the limit
- **WHEN** the same limit has 1150 mL approved today
- **THEN** `care.fluid_limit` has `percent: 115` and `left_ml: 0`, and the alerts include `fluid_limit_reached`

#### Scenario: Oral leaves out IV
- **WHEN** a `{ ml: 1000, scope: "oral" }` limit has approved water 600 mL and approved IV 1000 mL today
- **THEN** `care.fluid_limit` has `ml: 600` and `percent: 60`, and there is no fluid limit prompt

#### Scenario: Started mid-day
- **WHEN** a `{ ml: 1000, scope: "total" }` limit is set at 15:00 on a bed with 900 mL approved since 08:00
- **THEN** at 15:00 `care.fluid_limit` has `ml: 900`, and the alerts include `fluid_limit_near`

### Requirement: Nil by mouth intake
An admission SHALL carry `nil_by_mouth_intake` when, in the last 24 hours, a pending or approved water or food entry, or a meal not voided with some portion eaten, was charted while nil by mouth was in force. It lists them in `entry_ids` and `meal_ids`. Its message counts a listed meal's own fluid entry with that meal, not as an entry. IV fluids are not counted, and nothing is refused: such an entry is saved as usual.

#### Scenario: Drink while fasting
- **WHEN** 2C bed 1 is nil by mouth from 06:00 until 14:00, and at 10:00 a 150 mL water entry is posted for it
- **THEN** the response is 201 with `status: pending`
- **AND** the alerts include `nil_by_mouth_intake` with the message `Intake charted while nil by mouth: 1 entry (150 mL). Review.` and `entry_ids` holding that entry

#### Scenario: Meals and IV
- **WHEN** while nil by mouth, the bed has:
  - an approved IV entry of 1000 mL;
  - a lunch with portion 50 and no fluid;
  - a breakfast with portion 0;
  - a voided snack with portion 100;
  - a rejected 200 mL water entry
- **THEN** the alerts include `nil_by_mouth_intake` with the message `Intake charted while nil by mouth: 1 meal. Review.`, `meal_ids` holding the lunch, and empty `entry_ids`

#### Scenario: Entries and a meal
- **WHEN** while nil by mouth, the bed has a pending 150 mL water entry and a dinner with portion 75 and 200 mL soup
- **THEN** the message is `Intake charted while nil by mouth: 1 entry (150 mL), 1 meal (200 mL). Review.`
- **AND** `entry_ids` holds the water and the soup entries, and `meal_ids` the dinner

#### Scenario: Tea with no food
- **WHEN** while nil by mouth, a snack with portion 0 and 150 mL tea is posted
- **THEN** the message is `Intake charted while nil by mouth: 1 entry (150 mL). Review.`, with `entry_ids` holding the tea's entry and empty `meal_ids`

### Requirement: Nil by mouth past its planned end
An active `nil_by_mouth` order whose `until` has passed SHALL raise `nil_by_mouth_overdue`, naming the planned end, and stay active until a nurse ends it. An order without `until` never raises it.

#### Scenario: At the planned end
- **WHEN** nil by mouth was set until 14:00 on 3 Nov, and the alerts are read at 13:59 and at 14:00
- **THEN** at 13:59 there is no `nil_by_mouth_overdue`
- **AND** at 14:00 there is, with the message `Nil by mouth past its planned end of 14:00 and still active. Review.`, and `care.orders` still holds the order

#### Scenario: A day later
- **WHEN** nil by mouth was set until 14:00 on 2 Nov and is still active at 09:00 on 3 Nov
- **THEN** the message is `Nil by mouth past its planned end of 2 Nov 14:00 and still active. Review.`

#### Scenario: No planned end
- **WHEN** nil by mouth was set at 06:00 with `{}`, and the alerts are read at 23:00
- **THEN** there is no `nil_by_mouth_overdue`

### Requirement: Thickened fluids
A pending or approved water entry charted in the last 24 hours under a `thickened_fluids` order SHALL raise `drink_too_thin` when its current `iddsi_level` is below the ordered level, and `drink_consistency_unrecorded` when it has none. Each lists its drinks in `entry_ids`. A drink at or above the ordered level raises neither, so amending a drink's level to meet the order clears its prompt.

#### Scenario: Thinner, same and thicker
- **WHEN** 5B bed 6 has thickened fluids at level 2, and today drinks at `iddsi_level` 0, 2 and 3 and a 150 mL food entry
- **THEN** the alerts include `drink_too_thin` with the message `Drink consistency: 1 drink thinner than ordered. Review.`, and `entry_ids` holding only the level-0 drink
- **AND** they do not include `drink_consistency_unrecorded`

#### Scenario: Not recorded
- **WHEN** the same bed also has an approved 400 mL intake entry from a water jug's level drop, with no `iddsi_level`
- **THEN** the alerts also include `drink_consistency_unrecorded` with the message `Drink consistency: 1 drink with no consistency recorded. Review.`, and `entry_ids` holding only the jug drink

#### Scenario: Recorded afterwards
- **WHEN** Anita Thomas (id 4) amends that jug drink with `{ iddsi_level: 2, reason: "checked the cup" }`
- **THEN** the response is 200 with `iddsi_level: 2`
- **AND** the alerts no longer include `drink_consistency_unrecorded`, and still include `drink_too_thin` for the level-0 drink
- **AND** the upstream received no request

#### Scenario: Rejected or no order
- **WHEN** a rejected level-0 drink and a rejected drink with no level were charted under the order, and a level-0 drink on another bed with no thickened-fluids order
- **THEN** none of them raises `drink_too_thin` or `drink_consistency_unrecorded`

### Requirement: Catheter day
An active `catheter` order SHALL give `care.catheter.day`, counting the insertion's calendar date in server local time as day 1, so a catheter inserted before admission counts from its insertion.

#### Scenario: Inserted before admission
- **WHEN** HDU bed 1 was admitted on 1 Nov at 10:00, and a catheter `{ type: "urethral", inserted_at: <11:00 on 29 Oct> }` was set at 10:30 that day
- **THEN** at 09:00 on 3 Nov, `care.catheter.day` is 6

#### Scenario: Midnight
- **WHEN** a catheter was inserted at 23:30 on 3 Nov
- **THEN** `care.catheter.day` is 1 at 23:59 and 2 at 00:00 on 4 Nov

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

### Requirement: Intake target progress
An active `intake_target` SHALL give `care.intake_target` (counted oral intake: water and food, the target, `percent` and `next_check`), and raise `intake_target_behind` from each `INTAKE_TARGET_CHECKS` time today not before the order's start, when intake is below that check's expected mL: its fraction of the target rounded up, as `next_check.ml` gives it. It is held while nil by mouth is active. `logging_gap` still applies as in charting/alerts.

#### Scenario: Behind at 14:00
- **WHEN** 3A bed 4 has had a 1600 mL target since 2 Nov, and 600 mL of approved water today
- **THEN** at 13:59 there is no `intake_target_behind`, and `next_check` is `{ at: <14:00>, ml: 800 }`
- **AND** at 14:00 the alerts include `intake_target_behind` with the message `Behind intake target: 600 of 1600 mL oral intake by 14:00, expected 800. Review.`
- **AND** `next_check` is then `{ at: <20:00>, ml: 1200 }`

#### Scenario: Caught up, then behind again
- **WHEN** a further 250 mL drink is approved at 15:00, and the alerts are read at 15:00 and at 20:00
- **THEN** there is no `intake_target_behind` at 15:00
- **AND** at 20:00 the message is `Behind intake target: 850 of 1600 mL oral intake by 20:00, expected 1200. Review.`

#### Scenario: Pending and IV
- **WHEN** the bed has 600 mL of approved water, a pending 100 mL tea and 1000 mL of approved IV today, and the alerts are read at 14:00
- **THEN** `care.intake_target` has `ml: 700` and `pending_ml: 100`
- **AND** the message is `Behind intake target: 700 of 1600 mL oral intake (incl. 100 mL pending) by 14:00, expected 800. Review.`

#### Scenario: Rounded up
- **WHEN** a bed has a 1550 mL target and 1162 mL of approved water today, and the alerts are read at 19:59 and at 20:00
- **THEN** at 19:59 `next_check` is `{ at: <20:00>, ml: 1163 }`
- **AND** at 20:00 the message is `Behind intake target: 1162 of 1550 mL oral intake by 20:00, expected 1163. Review.`

#### Scenario: Set after a check
- **WHEN** a 1600 mL target is set at 15:00 on a bed with 300 mL drunk today
- **THEN** there is no `intake_target_behind` at 15:00, and there is one at 20:00

#### Scenario: Held while nil by mouth
- **WHEN** at 14:00 the bed with 600 mL drunk has been nil by mouth since 12:00, and its last drink was at 10:00
- **THEN** the alerts include none of `intake_target_behind`, `logging_gap` and `nil_by_mouth_intake`, as no drink was charted while nil by mouth

### Requirement: Diet order
A `diet` order SHALL hold `{ type, texture, kcal, protein_g }`, as "Diet order values" accepts it, with each target null when left out. It follows the care-order rules for setting, ending and history, and is listed in `care.orders` after every other kind. It adds no progress to `care`, raises no prompt, and adds nothing to the input of `POST /api/ai/explain`. It makes no model request.

#### Scenario: Renal diet
- **WHEN** at 10:00 on 3 Nov, signed in as Sana Mirza (id 11), `PUT /api/admissions/<HDU bed 3>/care/diet` is sent with `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }`
- **THEN** the response is 201 with:
  - `kind: "diet"` and `value: { type: "renal", texture: 7, kcal: 1800, protein_g: 60 }`;
  - `start_at` 10:00 and `end_at: null`;
  - `set_by` `{ id: 11, name: "Sana Mirza", role: "dietitian" }`
- **AND** the upstream received no request

#### Scenario: Listed last, no prompt
- **WHEN** HDU bed 3 has its `{ ml: 1000, scope: "total" }` fluid limit, and the renal diet is set
- **THEN** its `care.orders` kinds read `fluid_limit`, `diet`, in both chart reads
- **AND** its `care` has only the keys `orders`, `fluid_limit`, `intake_target` and `catheter`, and its alerts are the same as just before the diet was set

#### Scenario: Targets left out
- **WHEN** Grace Lee (id 5) sets 5B bed 6's diet with `{ type: "regular", texture: 6 }`, and then sends `{ type: "regular", texture: 6, kcal: null, protein_g: null }`
- **THEN** the first response is 201 with `value: { type: "regular", texture: 6, kcal: null, protein_g: null }`
- **AND** the second is 200 with that same order, and the bed's `care_history` holds one diet order

#### Scenario: Not in Explain
- **WHEN** HDU bed 3 has the renal diet and raises `fluid_limit_near`, and `POST /api/ai/explain` is sent for it
- **THEN** the response is 200, and the upstream received exactly one request, whose input contains `fluid_limit_near` and contains neither `renal` nor `kcal`

### Requirement: Diet order values
A `diet` order SHALL accept only `{ type, texture, kcal?, protein_g? }`: `type` one of `DIET_TYPES`, `texture` an IDDSI food level, an integer 3–7, `kcal` an integer 800–4000 and `protein_g` an integer 20–200, each target optional or null. Anything else gets 400 `invalid_request` and changes nothing. Like acuity's, its value is not listed in "Care order values". It makes no model request.

#### Scenario: Diet boundaries accepted
- **WHEN** at 10:00 on 3 Nov, signed in as Sana Mirza (id 11, dietitian), `PUT /api/admissions/<HDU bed 3>/care/diet` is sent with `{ type: "renal", texture: 3, kcal: 800, protein_g: 20 }`, then `{ type: "gluten_free", texture: 7, kcal: 4000, protein_g: 200 }`, then `{ type: "regular", texture: 7 }`
- **THEN** each response is 201, and the last order has `value: { type: "regular", texture: 7, kcal: null, protein_g: null }`

#### Scenario: Invalid diet values
- **WHEN** signed in as Sana Mirza, `PUT /api/admissions/<5B bed 2>/care/diet` is sent, for a bed with no orders, with each of:
  - `{ type: "keto", texture: 7 }`, `{ type: "renal" }` and `{ texture: 7 }`;
  - `{ type: "renal", texture: 2 }`, `{ type: "renal", texture: 8 }` and `{ type: "renal", texture: "7" }`;
  - `{ type: "renal", texture: 7, kcal: 750 }`, `{ type: "renal", texture: 7, kcal: 4050 }` and `{ type: "renal", texture: 7, kcal: 1800.5 }`;
  - `{ type: "renal", texture: 7, protein_g: 15 }` and `{ type: "renal", texture: 7, protein_g: 210 }`;
  - `{ type: "renal", texture: 7, sodium_mg: 2000 }`
- **THEN** each response is 400 with `error: invalid_request`, and the bed has no order

### Requirement: Diet targets need a dietitian
A `diet` order whose `kcal` or `protein_g` (null when left out) differ from the active diet order's (null when there is none) SHALL get 403 `forbidden` unless set by a dietitian, and change nothing; ending a diet order that has either target gets 403 the same way. Nurses and the matron may set or change the type and texture, sending the targets unchanged. This is checked after the admission is found and before the value is validated. It makes no model request.

#### Scenario: Nurse changes the texture
- **WHEN** Sana Mirza set HDU bed 3's diet to `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }` at 10:00, and at 11:00, signed in as Divya Kapoor (id 8, nurse), `{ type: "renal", texture: 6, kcal: 1800, protein_g: 60 }` is sent
- **THEN** the response is 201 with `value: { type: "renal", texture: 6, kcal: 1800, protein_g: 60 }` and `set_by` Divya Kapoor
- **AND** the 10:00 order has `end_at` 11:00 and `ended_by` Divya Kapoor
- **AND** the upstream received no request

#### Scenario: Nurse cannot change or drop targets
- **WHEN** signed in as Divya Kapoor, HDU bed 3's diet (1800 kcal, 60 g protein) is sent as `{ type: "renal", texture: 6, kcal: 2000, protein_g: 60 }`, as `{ type: "renal", texture: 6 }` and as `{ type: "renal", texture: 6, kcal: 1800 }`
- **THEN** each response is 403 with `error: forbidden`
- **AND** the active diet order is still the one with 1800 kcal and 60 g protein

#### Scenario: Nurse or matron cannot add targets
- **WHEN** 5B bed 6 has no diet order, and `{ type: "regular", texture: 6, kcal: 1600 }` is sent signed in as Grace Lee (id 5) and as Lakshmi Iyer (id 10, matron)
- **THEN** both responses are 403 with `error: forbidden`, and the bed has no diet order
- **AND** `{ type: "regular", texture: 6 }` from Grace Lee then gets 201

#### Scenario: Ending targets needs a dietitian
- **WHEN** signed in as Divya Kapoor, `DELETE /api/admissions/<HDU bed 3>/care/diet` is sent while its diet has 1800 kcal and 60 g protein
- **THEN** the response is 403 with `error: forbidden`, and the diet order is still active
- **AND** the same `DELETE` signed in as Sana Mirza gets 200 with `ended_by` Sana Mirza
- **AND** after that, `{ type: "renal", texture: 7 }` from Divya Kapoor gets 201 with `kcal: null` and `protein_g: null`

#### Scenario: No targets to keep
- **WHEN** Grace Lee set 5B bed 6's diet to `{ type: "regular", texture: 6 }`, and she sends `DELETE /api/admissions/<5B bed 6>/care/diet`
- **THEN** the response is 200 with `ended_by` Grace Lee

#### Scenario: Order of checks
- **WHEN** signed in as Divya Kapoor, `PUT /api/admissions/999/care/diet` is sent with `{ type: "renal", texture: 7, kcal: 2000 }`, and `PUT /api/admissions/<HDU bed 3>/care/diet` with `{ type: "renal", texture: 9, kcal: 2000, protein_g: 60 }`
- **THEN** the responses are 404 with `error: not_found`, then 403 with `error: forbidden`
- **AND** signed in as Sana Mirza, `{ type: "renal", texture: 9, kcal: 2000, protein_g: 60 }` for HDU bed 3 gets 400 with `error: invalid_request`

### Requirement: Output device orders
`stoma`, `drain` and `voiding` orders SHALL say how an admission's output is collected, with the active `catheter` order meaning a catheter and urine bag. They hold the values "Output device order values" accepts, follow the care-order rules for setting, ending, history and who may change them, and are listed in `care.orders` after `catheter` and before `diet`. They raise no prompt of their own and add nothing to the input of `POST /api/ai/explain`. They make no model request.

#### Scenario: Ileostomy
- **WHEN** at 10:00 on 3 Nov, signed in as Meera Pillai (id 6, nurse), `PUT /api/admissions/<2C bed 3>/care/stoma` is sent with `{ type: "ileostomy" }`
- **THEN** the response is 201 with `kind: "stoma"`, `value: { type: "ileostomy" }`, `start_at` 10:00, `end_at: null` and `set_by` `{ id: 6, name: "Meera Pillai", role: "nurse" }`
- **AND** the upstream received no request

#### Scenario: Listed after the catheter
- **WHEN** a voiding order `{ method: "commode" }`, then a drain `{ site: "abdominal" }`, then a catheter, then a stoma are set on one bed
- **THEN** that bed's `care.orders` kinds read `catheter`, `stoma`, `drain`, `voiding`, in both chart reads

#### Scenario: Changed and ended
- **WHEN** at 12:00 the commode order is changed to `{ method: "bedpan" }`, and at 14:00 `DELETE /api/admissions/<id>/care/drain` is sent
- **THEN** the first response is 201 with a new order from 12:00, and the commode order has `end_at` 12:00
- **AND** the second is 200 with the drain order and `end_at` 14:00, and `care_history` holds all five orders, the commode and bedpan orders both

#### Scenario: Not by an attendant
- **WHEN** signed in as Ravi Kumar (id 1, attendant), `PUT /api/admissions/<3A bed 5>/care/voiding` is sent with `{ method: "commode" }`
- **THEN** the response is 403 with `error: forbidden`, and nothing is stored

#### Scenario: No prompt
- **WHEN** 2C bed 3's only orders are its ileostomy and a `{ method: "toilet" }` voiding order, and `POST /api/ai/explain` is sent for it with one other prompt
- **THEN** its alerts hold no prompt from either order
- **AND** the upstream received exactly one request, whose input contains neither `ileostomy` nor `toilet`

### Requirement: Output device order values
A `stoma`, `drain` or `voiding` order SHALL accept only its own value: `stoma` `{ type }`, `colostomy` or `ileostomy`; `drain` `{ site }`, `abdominal`, `chest`, `pelvic` or `wound`; `voiding` `{ method }`, `urinal`, `bedpan`, `commode`, `toilet` or `pads`. Anything else gets 400 `invalid_request` and changes nothing. Like acuity's and diet's, these values are not listed in "Care order values". It makes no model request.

#### Scenario: Every value
- **WHEN** a nurse sets, on one bed each, `stoma` `{ type: "colostomy" }`, `drain` `{ site: "chest" }`, and `voiding` with each of `urinal`, `bedpan`, `commode`, `toilet` and `pads` in turn
- **THEN** each response is 201

#### Scenario: Invalid values
- **WHEN** a nurse sends each of:
  - `stoma` with `{ type: "urostomy" }`, `{}` and `{ type: "ileostomy", site: "abdominal" }`;
  - `drain` with `{ site: "neck" }` and `{ site: "chest", count: 2 }`;
  - `voiding` with `{ method: "catheter" }`, `{ method: "urine_bag" }` and `{ method: "Commode" }`
- **THEN** each response is 400 with `error: invalid_request`, and the bed has no order of that kind

### Requirement: Output devices on chart reads
Each `GET /api/admissions` item and `GET /api/admissions/:id/entries` SHALL include `devices`: `urine` (`catheter` with an active catheter order, else the active voiding order's method, else `urinal`), `urine_from` (`catheter`, `voiding` or `default`), `urine_measured` (false only for `toilet` and `pads`) and `bags`, the bags on record in the order urine, stoma, drain: `urine_bag` with a catheter, `stoma_bag` with a stoma and `drain_bag` with a drain. It is computed without any model request.

#### Scenario: Fresh store
- **WHEN** `GET /api/admissions` is called on a fresh store
- **THEN** every admission has `devices: { urine: "urinal", urine_from: "default", urine_measured: true, bags: [] }`, and the upstream received no request

#### Scenario: Catheter over the voiding order
- **WHEN** 3A bed 5 has a `{ method: "commode" }` voiding order, and at 10:00 a catheter order is set
- **THEN** at 09:59 its `devices` has `urine: "commode"`, `urine_from: "voiding"` and `bags: []`
- **AND** at 10:00 it has `urine: "catheter"`, `urine_from: "catheter"`, `urine_measured: true` and `bags: ["urine_bag"]`
- **AND** after the catheter order is ended at 16:00, it is back to `urine: "commode"` and `bags: []`

#### Scenario: Stoma and drain
- **WHEN** 2C bed 2 has a catheter, a `{ site: "abdominal" }` drain and a `{ type: "ileostomy" }` stoma
- **THEN** its `devices.bags` is `["urine_bag", "stoma_bag", "drain_bag"]` in both chart reads

#### Scenario: Toilet
- **WHEN** 3A bed 7 has a `{ method: "toilet" }` voiding order and no catheter
- **THEN** its `devices` is `{ urine: "toilet", urine_from: "voiding", urine_measured: false, bags: [] }`
