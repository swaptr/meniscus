# Spec Delta

## Purpose

Working with the hospital's dietitians. Covers:
- whether a dietitian covers the patient's ward, and the patient's latest referral, on chart reads;
- the `poor_meal_intake` review prompt from the food chart, and which meals it counts;
- referrals from ward nurses, routed to the dietitians covering the ward, and their lifecycle (open, acknowledged, closed with an outcome), attributed at every step;
- the dietitian's worklist of referrals.

It documents and routes; it never diagnoses. None of it calls a model, except that a bed with this prompt can now be explained.

## ADDED Requirements

### Requirement: Nutrition status on chart reads
Each `GET /api/admissions` item and `GET /api/admissions/:id/entries` SHALL include `nutrition`:
- `dietitian_available`: true when any dietitian's `wards` include the admission's ward;
- `referral`: the admission's latest referral of any status, or null.

It makes no model request.

#### Scenario: Ward pool
- **WHEN** `GET /api/admissions?ward=<3A>` and `GET /api/admissions/<3A bed 6>/entries` are called on a fresh store
- **THEN** 3A bed 6 has `nutrition: { dietitian_available: true, referral: null }` in both, and the upstream received no request

#### Scenario: No dietitian covers the ward
- **WHEN** the store's only dietitian, Sana Mirza, has the `wards` 2C, 5B and HDU
- **THEN** every 3A admission has `dietitian_available: false`, and every 2C admission `dietitian_available: true`

### Requirement: Poor meal intake
An admission SHALL carry `poor_meal_intake` when its latest `POOR_INTAKE_MEALS` (3) counted meals (Meals counted for poor intake) were each eaten `POOR_INTAKE_PORTION` (50%) or less. The message lists them oldest first and ends `Review.`. It is held while nil by mouth is active, and counts in `beds_with_alerts` like any prompt. Working it out makes no model request; explaining a bed whose only prompt it is makes exactly one Spark request.

#### Scenario: Three poor meals
- **WHEN** at 14:00 on 3 Nov, 3A bed 6 has a dinner 25% eaten at 19:00 on 2 Nov, a breakfast 50% at 08:00 and a lunch 0% at 13:00
- **THEN** its alerts include `poor_meal_intake` with the message `Poor meal intake: the last 3 meals were 50% eaten or less (dinner 25%, breakfast 50%, lunch 0%). Review.`

#### Scenario: Counted on the ward list
- **WHEN** a fresh store is opened at 07:00 on 3 Nov, so every bed is admitted at 07:00
- **AND** 3A bed 6 is charted a breakfast 0% at 08:00, a snack 25% at 08:30 and a snack 0% at 09:00, none with a fluid
- **THEN** at 09:30 3A bed 6's alerts are exactly `poor_meal_intake`, with the message `Poor meal intake: the last 3 meals were 50% eaten or less (breakfast 0%, snack 25%, snack 0%). Review.`
- **AND** `GET /api/wards` shows 3A with `beds_with_alerts: 1` and every other ward with 0, and the upstream received no request

#### Scenario: Explained
- **WHEN** in that store at 09:30, the breakfast having the items `idli, sambar`, `POST /api/ai/explain` is sent for 3A bed 6
- **THEN** the response is 200, and the upstream received exactly one request, whose input contains `poor_meal_intake` and contains neither `Priya Iyer` nor `idli`

#### Scenario: Exactly half
- **WHEN** the three meals were each 50% eaten
- **THEN** the alerts include `poor_meal_intake`

#### Scenario: Two meals
- **WHEN** at 14:00 on 3 Nov the bed's only meals are a breakfast 0% at 08:00 and a lunch 0% at 13:00
- **THEN** there is no `poor_meal_intake`

#### Scenario: A better meal breaks the run
- **WHEN** at 19:30 on 3 Nov the bed has a breakfast 25% at 08:00, a lunch 75% at 13:00, a snack 25% at 16:00 and a dinner 0% at 19:00
- **THEN** there is no `poor_meal_intake`
- **AND** after a snack 25% at 21:00, the message is `Poor meal intake: the last 3 meals were 50% eaten or less (snack 25%, dinner 0%, snack 25%). Review.`

#### Scenario: Held while nil by mouth
- **WHEN** the bed with the three poor meals of "Three poor meals" has been nil by mouth since 13:30, and the alerts are read at 14:00
- **THEN** there is no `poor_meal_intake`
- **AND** once nil by mouth is ended at 15:00, the alerts read at 15:00 include it

### Requirement: Meals counted for poor intake
`poor_meal_intake` SHALL count the meals not voided and charted at or after now − `POOR_INTAKE_WINDOW_H` (24 h), snacks included, leaving out a meal charted while a nil-by-mouth order was in force (from its start, included, to its end, excluded) and a drink-only snack (a snack 0% eaten with a fluid). It makes no model request.

#### Scenario: Window edge
- **WHEN** at 14:00 on 3 Nov the bed has a breakfast 0% at 08:00, a lunch 0% at 13:00, and a dinner 0% at 14:00 on 2 Nov
- **THEN** the alerts include `poor_meal_intake`
- **AND** with that dinner at 13:59 on 2 Nov instead, there is none

#### Scenario: Voided meal left out
- **WHEN** at 20:00 on 3 Nov the bed has a breakfast 25% at 08:00, a lunch 100% at 13:00 voided as `wrong bed`, a snack 50% at 16:00 and a dinner 0% at 19:00
- **THEN** the message is `Poor meal intake: the last 3 meals were 50% eaten or less (breakfast 25%, snack 50%, dinner 0%). Review.`

#### Scenario: Charted under nil by mouth
- **WHEN** nil by mouth ran from 09:00 to 12:00 on 3 Nov, and at 14:00 the bed has a breakfast 100% at 08:00, a snack 0% with no fluid at 10:00, a lunch 25% at 13:00 and a snack 0% with no fluid at 13:30
- **THEN** there is no `poor_meal_intake`: the 10:00 snack is not counted
- **AND** with that snack charted at 12:00 instead, the message is `Poor meal intake: the last 3 meals were 50% eaten or less (snack 0%, lunch 25%, snack 0%). Review.`

#### Scenario: Drink-only snack
- **WHEN** at 14:00 on 3 Nov the bed has a dinner 100% at 19:00 on 2 Nov, a breakfast 25% at 08:00, a snack 0% with 150 mL of tea at 10:30, and a lunch 0% at 13:00
- **THEN** there is no `poor_meal_intake`: the tea is not a refused meal
- **AND** with that snack charted with no fluid instead, the message is `Poor meal intake: the last 3 meals were 50% eaten or less (breakfast 25%, snack 0%, lunch 0%). Review.`

### Requirement: Prompt while referred
While an admission has an open or acknowledged referral, `poor_meal_intake` SHALL NOT be raised for it. Once its latest referral is closed, only meals charted after the close, not at the same instant, count towards the prompt. It makes no model request.

#### Scenario: Referred
- **WHEN** 3A bed 6 has the three poor meals of "Three poor meals", and at 14:05 Anita Thomas refers it with `{ reason: "poor_intake" }`
- **THEN** its alerts no longer include `poor_meal_intake`, and its `nutrition.referral` has `status: "open"`
- **AND** after Sana Mirza acknowledges the referral at 14:30, there is still no `poor_meal_intake`

#### Scenario: Closed, then poor again
- **WHEN** Sana Mirza closes that referral at 15:00 with `{ outcome: "monitoring" }`, and a snack 0% with no fluid is charted at 15:00
- **THEN** at 15:00 there is no `poor_meal_intake`
- **AND** at 21:30, after a dinner 25% at 19:00 and a snack 0% with no fluid at 21:00, there is still no `poor_meal_intake`
- **AND** after a breakfast 50% at 08:00 on 4 Nov, the alerts at 08:30 on 4 Nov include `poor_meal_intake` with the message `Poor meal intake: the last 3 meals were 50% eaten or less (dinner 25%, snack 0%, breakfast 50%). Review.`

### Requirement: Refer to a dietitian
`POST /api/admissions/:id/referrals` with `{ reason, note? }` SHALL store an open referral by the signed-in person and return 201 with it, never logging its note. After the sign-in checks, errors change nothing, in order: 403 unless a nurse or matron, before the admission or body; 404; 400 for a reason outside `REFERRAL_REASONS`, or a note not 1–200 characters once trimmed; 409 `no_dietitian` if no dietitian covers the ward; 409 `referral_open` if one is open or acknowledged. No model request.

#### Scenario: Nurse refers
- **WHEN** at 14:05 on 3 Nov, signed in as Anita Thomas (id 4), `POST /api/admissions/<3A bed 6>/referrals` is sent with `{ reason: "poor_intake" }`
- **THEN** the response is 201 with:
  - `status: "open"`, `reason: "poor_intake"` and `note: null`;
  - `created_by` `{ id: 4, name: "Anita Thomas", role: "nurse" }` and `created_at` 14:05;
  - `acknowledged_by`, `closed_by`, `outcome` and `next_review` all null
- **AND** the upstream received no request

#### Scenario: Note kept, never logged
- **WHEN** Anita Thomas refers 3A bed 5 with `{ reason: "other", note: "  Asks for vegetarian meals  " }`
- **THEN** the response is 201 with `note: "Asks for vegetarian meals"`
- **AND** nothing the server wrote to its log contains `vegetarian`

#### Scenario: Attendant or dietitian cannot refer
- **WHEN** `POST /api/admissions/<3A bed 6>/referrals` with `{ reason: "poor_intake" }`, and `POST /api/admissions/999/referrals` with `{ reason: "hungry" }`, are each sent signed in as Ravi Kumar (id 1, attendant) and as Sana Mirza (id 11, dietitian)
- **THEN** each response is 403 with `error: forbidden`, and no referral is stored

#### Scenario: Invalid referrals
- **WHEN** Anita Thomas sends, for 3A bed 6, each of `{ reason: "hungry" }`, `{}`, `{ reason: "other", note: "   " }`, `{ reason: "other", note: "<201 characters>" }` and `{ reason: "poor_intake", urgent: true }`
- **THEN** each response is 400 with `error: invalid_request`, and the bed has no referral

#### Scenario: Already referred
- **WHEN** 3A bed 6 has an open referral and Anita Thomas refers it again, and again after Sana Mirza acknowledges it
- **THEN** both responses are 409 with `error: referral_open`, and the bed has one referral

#### Scenario: No dietitian available
- **WHEN** no dietitian covers 3A, and Anita Thomas refers 3A bed 6 with `{ reason: "poor_intake" }`
- **THEN** the response is 409 with `error: no_dietitian`, and no referral is stored

#### Scenario: Unknown admission or no session
- **WHEN** Anita Thomas sends `POST /api/admissions/999/referrals` with `{ reason: "poor_intake" }`, and the same for 3A bed 6 is sent with no session
- **THEN** the responses are 404 with `error: not_found` and 401 with `error: sign_in_required`

### Requirement: Referral routing
`GET /api/nutrition/worklist` SHALL list an admission with an open or acknowledged referral for every dietitian whose `wards` include the admission's ward, and for no other dietitian, following their `wards` at the time of the read. It makes no model request.

#### Scenario: Ward pool
- **WHEN** the roster also has Joel Mathew (id 12, dietitian, `wards` 3A), and 3A bed 6 has an open referral
- **THEN** both Sana Mirza's and Joel Mathew's worklists list 3A bed 6

#### Scenario: Another ward
- **WHEN** 2C bed 3 also has an open referral
- **THEN** Sana Mirza's worklist lists it, and Joel Mathew's does not

#### Scenario: Closed
- **WHEN** Sana Mirza closes the 3A bed 6 referral
- **THEN** neither worklist lists 3A bed 6

### Requirement: Acknowledge a referral
`POST /api/referrals/:id/acknowledge` SHALL mark an open referral acknowledged by the signed-in person at now, and return 200 with it. After the sign-in checks, errors change nothing, in order: 403 `forbidden` unless a dietitian, before the referral is looked up; 404 `not_found`; 409 `not_open` when it is already acknowledged or closed. It makes no model request.

#### Scenario: Sana acknowledges
- **WHEN** at 14:30, signed in as Sana Mirza (id 11), 3A bed 6's open referral is acknowledged
- **THEN** the response is 200 with `status: "acknowledged"`, `acknowledged_by` `{ id: 11, name: "Sana Mirza", role: "dietitian" }` and `acknowledged_at` 14:30
- **AND** the upstream received no request

#### Scenario: Twice
- **WHEN** Sana Mirza acknowledges it again at 14:40
- **THEN** the response is 409 with `error: not_open`, and `acknowledged_at` is still 14:30

#### Scenario: Not a dietitian
- **WHEN** signed in as Anita Thomas (id 4), the open referral is acknowledged, and `POST /api/referrals/999/acknowledge` is sent
- **THEN** both responses are 403 with `error: forbidden`, and the referral is still open

#### Scenario: Unknown referral
- **WHEN** signed in as Sana Mirza, `POST /api/referrals/999/acknowledge` is sent
- **THEN** the response is 404 with `error: not_found`

### Requirement: Close a referral
`POST /api/referrals/:id/close` with `{ outcome, next_review? }` SHALL close an open or acknowledged referral, recording who, when, the outcome and `next_review`, and return 200 with it. After the sign-in checks, errors change nothing, in order: 403 unless a dietitian, before the referral or body; 404; 400 for an outcome outside `REFERRAL_OUTCOMES` or a `next_review` not a local date from today to `REFERRAL_REVIEW_MAX_DAYS` (28) days on; 409 `already_closed`. No model request.

#### Scenario: Supplements started
- **WHEN** at 15:00 on 3 Nov, signed in as Sana Mirza (id 11), the acknowledged referral of 3A bed 6 is closed with `{ outcome: "supplements_started", next_review: "2026-11-06" }`
- **THEN** the response is 200 with `status: "closed"`, `closed_by` Sana Mirza, `closed_at` 15:00, `outcome: "supplements_started"` and `next_review: "2026-11-06"`
- **AND** 3A bed 6's `nutrition.referral` is that referral, and the upstream received no request

#### Scenario: Closed straight from open
- **WHEN** an open referral that nobody acknowledged is closed with `{ outcome: "no_action_needed" }`
- **THEN** the response is 200 with `status: "closed"`, `acknowledged_by: null` and `next_review: null`

#### Scenario: Review date bounds
- **WHEN** on 3 Nov, two referrals are closed with `{ outcome: "monitoring", next_review: "2026-11-03" }` and `{ outcome: "monitoring", next_review: "2026-12-01" }`
- **AND** a third is sent `{ outcome: "fed" }`, `{}`, and `{ outcome: "monitoring" }` with `next_review` `"2026-11-02"`, `"2026-12-02"` and `"6/11/2026"`
- **THEN** the first two responses are 200
- **AND** each of the others is 400 with `error: invalid_request`, and the third referral is still open

#### Scenario: Unknown referral before the body
- **WHEN** signed in as Sana Mirza, `POST /api/referrals/999/close` is sent with `{ outcome: "fed" }`
- **THEN** the response is 404 with `error: not_found`

#### Scenario: Role checked first
- **WHEN** signed in as Anita Thomas (id 4), `POST /api/referrals/999/close` is sent with `{ outcome: "fed" }`
- **THEN** the response is 403 with `error: forbidden`

#### Scenario: Twice or not a dietitian
- **WHEN** Sana Mirza closes the 3A bed 6 referral again, and Anita Thomas (id 4) closes another open referral
- **THEN** the responses are 409 with `error: already_closed` and 403 with `error: forbidden`, and the other referral is still open

### Requirement: Dietitian worklist
`GET /api/nutrition/worklist` SHALL return, for a signed-in dietitian, `{ since, patients }`: each admission with a referral routed to them, once, with its `nutrition` and `intake`, the meals not voided and not drink-only snacks charted since `since` (now − 24 h), and how many were eaten 50% or less. Order: open referrals oldest first, then acknowledged ones oldest first. No session gets 401 `sign_in_required`, another role 403 `forbidden`. No model request.

#### Scenario: Sana's worklist
- **WHEN** at 15:00 on 3 Nov, signed in as Sana Mirza:
  - 3A bed 7 has a referral made at 10:00 on 2 Nov and acknowledged;
  - 3A bed 6 an open referral made at 14:05, and 3 meals in the last 24 h, each 50% eaten or less;
  - 2C bed 3 an open referral made at 14:30;
  - 5B bed 2 a closed referral
- **THEN** `patients` lists, in order:
  - 3A bed 6 (`intake: { meals: 3, poor_meals: 3 }`);
  - 2C bed 3;
  - 3A bed 7
- **AND** `since` is 15:00 on 2 Nov, no other admission is listed, and the upstream received no request

#### Scenario: Not a dietitian or nobody signed in
- **WHEN** `GET /api/nutrition/worklist` is sent signed in as Anita Thomas (id 4), and with no session
- **THEN** the responses are 403 with `error: forbidden` and 401 with `error: sign_in_required`
