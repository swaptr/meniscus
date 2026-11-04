# Spec Delta

## MODIFIED Requirements

### Requirement: Nutrition status on chart reads
Each `GET /api/admissions` item and `GET /api/admissions/:id/entries` SHALL include `nutrition`:
- `dietitian_available`: true when a dietitian is assigned to the admission, or any dietitian's `wards` include the admission's ward;
- `dietitian`: the current assignment (the dietitian, who assigned them and when), or null;
- `referral`: the admission's latest referral of any status, or null.

It makes no model request.

#### Scenario: Ward pool
- **WHEN** `GET /api/admissions?ward=<3A>` and `GET /api/admissions/<3A bed 6>/entries` are called on a fresh store
- **THEN** 3A bed 6 has `nutrition: { dietitian_available: true, dietitian: null, referral: null }` in both, and the upstream received no request

#### Scenario: No dietitian covers the ward
- **WHEN** the store's only dietitian, Sana Mirza, has the `wards` 2C, 5B and HDU
- **THEN** every 3A admission has `dietitian_available: false`, and every 2C admission `dietitian_available: true`

#### Scenario: Assigned across wards
- **WHEN** in that store, at 14:40, signed in as Anita Thomas (id 4), Sana Mirza is assigned to 3A bed 6
- **THEN** 3A bed 6 has `dietitian_available: true` and a `dietitian` with `staff` `{ id: 11, name: "Sana Mirza", role: "dietitian" }`, `assigned_by` Anita Thomas and `assigned_at` 14:40, in both reads
- **AND** every other 3A admission still has `dietitian_available: false` and `dietitian: null`

### Requirement: Refer to a dietitian
`POST /api/admissions/:id/referrals` with `{ reason, note? }` SHALL store an open referral by the signed-in person and return 201 with it, never logging its note. After the sign-in checks, errors change nothing, in order: 403 unless a nurse or matron, before the admission or body; 404; 400 for a reason outside `REFERRAL_REASONS`, or a note not 1–200 characters once trimmed; 409 `no_dietitian` if `dietitian_available` is false; 409 `referral_open` if one is open or acknowledged. No model request.

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

#### Scenario: Assigned dietitian available
- **WHEN** no dietitian covers 3A, Sana Mirza is assigned to 3A bed 6, and Anita Thomas refers it with `{ reason: "poor_intake" }`
- **THEN** the response is 201 with `status: "open"`
- **AND** referring 3A bed 5, which has no dietitian assigned, still gets 409 with `error: no_dietitian`

#### Scenario: Unknown admission or no session
- **WHEN** Anita Thomas sends `POST /api/admissions/999/referrals` with `{ reason: "poor_intake" }`, and the same for 3A bed 6 is sent with no session
- **THEN** the responses are 404 with `error: not_found` and 401 with `error: sign_in_required`

### Requirement: Referral routing
`GET /api/nutrition/worklist` SHALL list an admission with an open or acknowledged referral for the dietitian assigned to it, and, when none is assigned, for every dietitian whose `wards` include the admission's ward; for no other dietitian. It follows the assignment and the `wards` at the time of the read. It makes no model request.

#### Scenario: Ward pool
- **WHEN** the roster also has Joel Mathew (id 12, dietitian, `wards` 3A), and 3A bed 6 has an open referral
- **THEN** both Sana Mirza's and Joel Mathew's worklists list 3A bed 6

#### Scenario: Another ward
- **WHEN** 2C bed 3 also has an open referral
- **THEN** Sana Mirza's worklist lists it, and Joel Mathew's does not

#### Scenario: Closed
- **WHEN** Sana Mirza closes the 3A bed 6 referral
- **THEN** neither worklist lists 3A bed 6

#### Scenario: Assigned dietitian first
- **WHEN** 3A bed 6 has an open referral and Joel Mathew is assigned to it
- **THEN** Joel Mathew's worklist lists 3A bed 6 in `patients`, and Sana Mirza's does not list it
- **AND** after Joel Mathew hands it back, both worklists list it again

#### Scenario: Assigned across wards
- **WHEN** HDU bed 3, outside Joel Mathew's `wards`, has an open referral and Joel Mathew is assigned to it
- **THEN** Joel Mathew's worklist lists HDU bed 3, and Sana Mirza's, though she covers HDU, does not

### Requirement: Dietitian worklist
`GET /api/nutrition/worklist` SHALL return to a signed-in dietitian `{ since, patients, assigned, diets }`, each patient once: `patients` with a referral routed to them, open first, oldest first; `assigned`, the rest assigned to them; `diets`, the rest routed to them with a diet order; these two by ward and bed. Each has `nutrition`, `diet` and `intake`: meals of the last 24 h (`since`), not voided or drink-only, and those 50% eaten or less. No session 401, other roles 403. No model request.

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

#### Scenario: Your patients and diet orders
- **WHEN** in that store at 15:00 the roster also has Joel Mathew (id 12, dietitian, `wards` 3A), and:
  - Sana Mirza is assigned to 2C bed 3 (with its open referral) and to 2C bed 2 (no referral, no diet order);
  - HDU bed 3 has a renal diet order, and 5B bed 6 a `{ type: "regular", texture: 6 }` diet order, neither assigned;
  - 3A bed 4 has a diet order and Joel Mathew is assigned to it
- **THEN** Sana Mirza's `patients` still lists 3A bed 6, 2C bed 3 and 3A bed 7, in that order
- **AND** her `assigned` lists only 2C bed 2, with `diet: null`
- **AND** her `diets` lists 5B bed 6 then HDU bed 3, each with its diet order as `diet`
- **AND** Joel Mathew's `assigned` lists 3A bed 4 with its diet order as `diet`, his `diets` is empty, and Sana Mirza's `assigned` and `diets` list no 3A bed

#### Scenario: Not a dietitian or nobody signed in
- **WHEN** `GET /api/nutrition/worklist` is sent signed in as Anita Thomas (id 4), and with no session
- **THEN** the responses are 403 with `error: forbidden` and 401 with `error: sign_in_required`

## ADDED Requirements

### Requirement: Assign a dietitian
`PUT /api/admissions/:id/dietitian` with `{ staff_id }` SHALL assign that dietitian from now, by the signed-in person, ending any other's at that instant, and return 201 with it; the same dietitian again gets 200 and changes nothing. After the sign-in checks, errors change nothing, in order: 403 unless a nurse, matron or dietitian, before the admission or body; 404; 403 for a nurse or matron whose `wards` lack the bed's ward; 400 unless `staff_id` is a dietitian. No model request.

#### Scenario: Nurse assigns Sana
- **WHEN** at 14:40 on 3 Nov, signed in as Anita Thomas (id 4, `wards` 3A, 5B), `PUT /api/admissions/<3A bed 6>/dietitian` is sent with `{ staff_id: 11 }`
- **THEN** the response is 201 with:
  - `staff` `{ id: 11, name: "Sana Mirza", role: "dietitian" }`;
  - `assigned_by` `{ id: 4, name: "Anita Thomas", role: "nurse" }` and `assigned_at` 14:40;
  - `ended_at: null` and `ended_by: null`
- **AND** 3A bed 6's `nutrition.dietitian` is that assignment in both chart reads, and the upstream received no request

#### Scenario: Same dietitian again
- **WHEN** at 14:50 the same request is sent again
- **THEN** the response is 200 with the assignment made at 14:40, and `GET /api/admissions/<3A bed 6>/nutrition` lists one assignment

#### Scenario: Another dietitian takes over
- **WHEN** the roster also has Joel Mathew (id 12, dietitian, `wards` 3A), and at 15:00, signed in as Joel Mathew, `{ staff_id: 12 }` is sent for 3A bed 6
- **THEN** the response is 201 with `staff` Joel Mathew
- **AND** the 14:40 assignment now has `ended_at` 15:00 and `ended_by` Joel Mathew, and `nutrition.dietitian.staff` is Joel Mathew

#### Scenario: Matron and dietitians on any ward
- **WHEN** Lakshmi Iyer (id 10, matron) assigns Sana Mirza to HDU bed 3, Sana Mirza assigns herself to 2C bed 3, and Joel Mathew (`wards` 3A) assigns himself to 5B bed 2
- **THEN** each response is 201

#### Scenario: Not allowed
- **WHEN** `{ staff_id: 11 }` is sent for 3A bed 6 and for admission 999 signed in as Ravi Kumar (id 1, attendant), and for HDU bed 3 signed in as Grace Lee (id 5, `wards` 5B, 3A)
- **THEN** each response is 403 with `error: forbidden`, and no assignment is stored

#### Scenario: Invalid or unknown
- **WHEN** signed in as Anita Thomas, `{ staff_id: 11 }` is sent for admission 999, and 3A bed 6 is sent each of `{ staff_id: 4 }` (a nurse), `{ staff_id: 999 }`, `{}`, `{ staff_id: "11" }` and `{ staff_id: 11, note: "renal" }`
- **AND** signed in as Grace Lee, `{ staff_id: 11 }` is sent for admission 999
- **THEN** the admission 999 responses are 404 with `error: not_found`, and each of the others is 400 with `error: invalid_request`
- **AND** 3A bed 6 has no assignment, and the same request with no session gets 401 with `error: sign_in_required`

### Requirement: Hand back a patient
`DELETE /api/admissions/:id/dietitian` SHALL end the admission's assignment now, recording the signed-in person, and return 200 with it; the patient is routed to the ward's dietitians again, and its referrals are unchanged. After the sign-in checks and the role, 404 and ward checks of assigning, errors change nothing: 409 `not_assigned` when none is assigned; 409 `no_dietitian` when an open or acknowledged referral would be left with no dietitian. No model request.

#### Scenario: Sana hands back
- **WHEN** 3A bed 6 is assigned to Sana Mirza and has an open referral, and at 16:00, signed in as Sana Mirza, `DELETE /api/admissions/<3A bed 6>/dietitian` is sent
- **THEN** the response is 200 with `ended_at` 16:00 and `ended_by` `{ id: 11, name: "Sana Mirza", role: "dietitian" }`
- **AND** the bed's `nutrition.dietitian` is null, its `nutrition.referral` is still open, and Sana Mirza's worklist still lists it in `patients`, as she covers 3A
- **AND** the upstream received no request

#### Scenario: Nothing to hand back
- **WHEN** the same `DELETE` is sent again
- **THEN** the response is 409 with `error: not_assigned`

#### Scenario: Open referral with nobody to take it
- **WHEN** no dietitian covers 3A, Sana Mirza is assigned to 3A bed 6, its referral is acknowledged, and she sends `DELETE /api/admissions/<3A bed 6>/dietitian`
- **THEN** the response is 409 with `error: no_dietitian`, and she is still assigned
- **AND** once she has closed the referral, the same `DELETE` gets 200

#### Scenario: Not allowed
- **WHEN** HDU bed 3 is assigned to Sana Mirza, and `DELETE /api/admissions/<HDU bed 3>/dietitian` is sent signed in as Ravi Kumar (id 1) and as Grace Lee (id 5, `wards` 5B, 3A)
- **THEN** both responses are 403 with `error: forbidden`, and Sana Mirza is still assigned

### Requirement: Patient nutrition read
`GET /api/admissions/:id/nutrition` SHALL return the admission, its `nutrition`, its active `diet` order, its `diet_history` and `assignments` (each newest first, at most `NUTRITION_HISTORY_LIMIT`, 20), its meals since `since`, 00:00 on the first of the last `FOOD_CHART_DAYS` (3) local dates, newest first, and `days`: one per local date, newest first, counting the meals not voided or drink-only and those 50% eaten or less. Unknown: 404. No model request.

#### Scenario: Priya's food chart
- **WHEN** at 15:00 on 3 Nov, 3A bed 6 has:
  - on 3 Nov, a breakfast 50% at 08:00, a snack 0% with 150 mL of tea at 10:30 and a lunch 0% at 13:00;
  - on 2 Nov, a dinner 25% at 19:00;
  - on 1 Nov, a lunch 100% at 13:00, voided as `wrong bed`;
  - on 31 Oct, a breakfast 100% at 08:00
- **AND** `GET /api/admissions/<3A bed 6>/nutrition` is sent
- **THEN** the response is 200 with `since` 00:00 on 1 Nov
- **AND** `meals` lists the lunch, the snack and the breakfast of 3 Nov, the dinner of 2 Nov and the voided lunch of 1 Nov, in that order, and not the 31 Oct breakfast
- **AND** `days` is `{ date: "2026-11-03", meals: 2, poor_meals: 2 }`, `{ date: "2026-11-02", meals: 1, poor_meals: 1 }` and `{ date: "2026-11-01", meals: 0, poor_meals: 0 }`
- **AND** the upstream received no request

#### Scenario: Diet and assignments
- **WHEN** HDU bed 3 had Sana Mirza assigned at 09:00 by Divya Kapoor, then Joel Mathew assigned at 11:00, and has a renal diet set at 10:00 by Sana Mirza and changed to texture 6 at 12:00 by Divya Kapoor
- **THEN** its nutrition read has `diet` the texture 6 order, and `diet_history` that order then the 10:00 one
- **AND** `assignments` lists Joel Mathew's assignment (current), then Sana Mirza's, ended at 11:00 by Joel Mathew
- **AND** `nutrition.dietitian.staff` is Joel Mathew

#### Scenario: Nothing yet
- **WHEN** the nutrition read of 5B bed 1, with no meals, diet order, assignment or referral, is sent on a fresh store
- **THEN** it has `diet: null`, `diet_history: []`, `assignments: []`, `meals: []`, three `days` each with `meals: 0`, and `nutrition: { dietitian_available: true, dietitian: null, referral: null }`

#### Scenario: Long diet history
- **WHEN** HDU bed 3's diet order was set 25 times, one a day, each replacing the last
- **THEN** its nutrition read's `diet_history` holds the 20 newest, the newest first, and `diet` is the first of them, the active one

#### Scenario: Unknown admission
- **WHEN** `GET /api/admissions/999/nutrition` is sent
- **THEN** the response is 404 with `error: not_found`

### Requirement: Referral history
`GET /api/admissions/:id/nutrition` SHALL return the admission's `referrals` of every status, newest `created_at` first, at most `NUTRITION_HISTORY_LIMIT` (20), each with who and when at every step, its outcome, `next_review` and note. No note is ever logged. It makes no model request.

#### Scenario: Two referrals
- **WHEN** 3A bed 6 has a `weight_loss` referral made at 09:00 on 1 Nov by Meera Pillai with the note `Lost weight at home`, acknowledged and closed at 17:00 that day by Sana Mirza with `supplements_started` and `next_review: "2026-11-05"`, and a `poor_intake` referral made at 14:05 on 3 Nov by Anita Thomas, still open
- **THEN** its nutrition read's `referrals` lists the open referral, then the closed one with `note: "Lost weight at home"`, `closed_by` Sana Mirza, `outcome: "supplements_started"` and `next_review: "2026-11-05"`
- **AND** `nutrition.referral` is the open one, and nothing the server wrote to its log contains `Lost weight`

#### Scenario: Long history
- **WHEN** 25 referrals of 3A bed 6 were each made and closed, one a day
- **THEN** `referrals` holds the 20 newest, the newest first
