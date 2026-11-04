# Spec Delta

## MODIFIED Requirements

### Requirement: Decisions need a nurse
When someone who is not a nurse or matron (an attendant or a dietitian) is signed in, the bed review, entry details and meals SHALL hide Approve, Reject, Amend, the high-confidence batch approval and meal "Void…", and the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.` instead. Nurses and matrons see the buttons as before. It makes no model request.

#### Scenario: Attendant on the bed review
- **WHEN** Ravi Kumar (attendant) is signed in and opens a bed with 2 pending entries and a meal
- **THEN** no approve, reject, amend, batch or void button is shown
- **AND** the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.`

#### Scenario: Nurse or matron
- **WHEN** Anita Thomas (nurse) or Lakshmi Iyer (matron) is signed in
- **THEN** Approve and Reject are shown for each pending entry, and "Void…" for each meal not voided

#### Scenario: Dietitian on the bed review
- **WHEN** Sana Mirza (dietitian) is signed in and opens a bed with 2 pending entries and a meal
- **THEN** no approve, reject, amend, batch or void button is shown
- **AND** the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.`

## ADDED Requirements

### Requirement: Nutrition on the bed review
The bed review SHALL show a "Nutrition" section from the bed's `nutrition`:
- `Dietitian: ward dietitians`, or `No dietitian covers <ward name>`;
- the latest referral: reason, who made it and when, its acknowledgement or its close (outcome, next review), and any note;
- the meals of the last 24 h as "Meals on the bed review" lists them, with no other dish list or tray overlay.

It sends no request beyond the bed review's own load, and no model request.

#### Scenario: Acknowledged referral
- **WHEN** at 15:00 on 3 Nov the bed's `nutrition` has `dietitian_available: true` and a `poor_intake` referral made at 14:05 by Anita Thomas and acknowledged at 14:30 by Sana Mirza
- **THEN** the section reads `Dietitian: ward dietitians` and `Referred 14:05 by Anita T. · Poor intake · Acknowledged 14:30 · Sana M.`

#### Scenario: Closed with an outcome
- **WHEN** at 10:00 on 3 Nov the latest referral, `weight_loss` with the note `Lost weight at home`, was made at 09:00 on 1 Nov by Meera Pillai and closed at 17:00 on 1 Nov by Sana Mirza with `supplements_started` and `next_review: "2026-11-05"`
- **THEN** the section reads `Referred 1 Nov 09:00 by Meera P. · Weight loss` and `Closed 1 Nov 17:00 by Sana M. · Supplements started · next review 5 Nov`
- **AND** the note reads `Lost weight at home`

#### Scenario: No dietitian
- **WHEN** a bed on Medical Ward 3A has `nutrition: { dietitian_available: false, referral: null }`
- **THEN** the section reads `No dietitian covers Medical Ward 3A`

#### Scenario: Meals in the section
- **WHEN** Sana Mirza opens a bed with a lunch at 13:10 today from a tray photo, half eaten, items "rice, dal"
- **THEN** the Nutrition section lists the lunch as `13:10`, `Lunch`, `Half` with 2 of 4 parts filled and `rice, dal`
- **AND** no tray photo or dish overlay is loaded

#### Scenario: No extra request
- **WHEN** the bed review of a bed with an acknowledged referral and 3 meals is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

### Requirement: Referral actions on the bed review
In the Nutrition section, a dietitian SHALL be offered "Acknowledge" on an open referral and "Close…" on an open or acknowledged one, with an outcome (Diet changed, Supplements started, Monitoring, No action needed) and an optional next review date from today to 28 days on. Each sends one request, then reloads the bed review. Others see the referral without these actions. It makes no model request.

#### Scenario: Acknowledge
- **WHEN** Sana Mirza (id 11) taps "Acknowledge" on the open referral 5 of admission 11
- **THEN** the requests are, in order:
  1. `POST /api/referrals/5/acknowledge` with `X-Staff-Id: 11`;
  2. `GET /api/admissions/11/entries` and `GET /api/admissions/11/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Close
- **WHEN** on 3 Nov Sana Mirza taps "Close…" on referral 5, picks "Supplements started" and the next review 6 Nov, and confirms
- **THEN** the date picker allows 3 Nov to 1 Dec, and confirming is disabled until an outcome is picked
- **AND** the requests are `POST /api/referrals/5/close` with `{ outcome: "supplements_started", next_review: "2026-11-06" }`, then the reload
- **AND** with no date picked, the body is `{ outcome: "supplements_started" }`

#### Scenario: Nurse looks
- **WHEN** Anita Thomas (nurse) or Lakshmi Iyer (matron) opens a bed with an open referral
- **THEN** the referral is shown with no "Acknowledge" or "Close…"

### Requirement: Refer to dietitian
A nurse or matron SHALL be offered "Refer to dietitian" on a `poor_meal_intake` prompt and in the Nutrition section when `dietitian_available` is true and no referral is open or acknowledged. It asks for a reason (Poor intake, Weight loss, Swallowing, Diet query, Other) and an optional note of up to 200 characters, then sends one `POST /api/admissions/<id>/referrals` and reloads the bed review. It makes no model request.

#### Scenario: Anita refers
- **WHEN** Anita Thomas (id 4) taps "Refer to dietitian" on the `poor_meal_intake` prompt of 3A bed 6 (admission 11), picks "Poor intake" and sends
- **THEN** the requests are, in order:
  1. `POST /api/admissions/11/referrals` with `{ reason: "poor_intake" }` and `X-Staff-Id: 4`;
  2. `GET /api/admissions/11/entries` and `GET /api/admissions/11/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Reason and note
- **WHEN** the dialog is open
- **THEN** "Send" is disabled until a reason is picked, and while the note is over 200 characters
- **AND** with "Other" and the note `Asks for vegetarian meals`, the body is `{ reason: "other", note: "Asks for vegetarian meals" }`, and an empty note is left out of the body

#### Scenario: No dietitian available
- **WHEN** a bed has a `poor_meal_intake` prompt and `dietitian_available: false`, and Anita Thomas opens it
- **THEN** the prompt reads `Poor meal intake` with the status `Review`, and neither it nor the Nutrition section offers "Refer to dietitian"

#### Scenario: Who may refer
- **WHEN** a bed with `dietitian_available: true` and no referral is opened by Ravi Kumar (attendant), by Sana Mirza (dietitian), and by Lakshmi Iyer (matron)
- **THEN** only Lakshmi Iyer is offered "Refer to dietitian"

#### Scenario: Already referred
- **WHEN** the bed's latest referral is open or acknowledged
- **THEN** "Refer to dietitian" is not offered
- **AND** when it is closed, it is offered again

### Requirement: Nutrition on bed cards
Each ward dashboard bed card SHALL show `Referred to dietitian` while the bed's referral is open or acknowledged, with ` · <short name>` of the dietitian who acknowledged it. A `poor_meal_intake` prompt reads `Poor meal intake`, amber (`Review`). None of it adds a request, and it makes no model request.

#### Scenario: Referral chip
- **WHEN** one bed has an open referral, a second a referral acknowledged by Sana Mirza, and a third only a closed referral
- **THEN** the first shows `Referred to dietitian`, the second `Referred to dietitian · Sana M.`, and the third no referral chip

#### Scenario: Prompt colour
- **WHEN** a bed's only prompt is `poor_meal_intake`
- **THEN** its prompt chip reads `Poor meal intake` and its status chip `Review`, in amber, on the dashboard and on the bed review

#### Scenario: No extra request
- **WHEN** Anita Thomas opens the 3A dashboard (ward id 2), whose beds have referrals
- **THEN** exactly two requests are made: `GET /api/admissions?ward=2` and `GET /api/wards/2/team`
