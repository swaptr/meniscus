# web/dietitian Specification

## Purpose
The dietitian's screen. A worklist (`/d`) of the referrals routed to the signed-in dietitian, in one "Referrals" section, each row opening the existing bed review. Shown to dietitians only. Over HTTP only, with no model request.

## Requirements

### Requirement: Dietitian worklist
`/d` SHALL show the signed-in dietitian's worklist from one `GET /api/nutrition/worklist`, in the server's order, in up to three sections: "Referrals", "Your patients" and "Diet orders", leaving out empty ones. Each row gives the bed and patient, its referral, assignment or diet order, and `<n> of <m> meals 50% eaten or less · last 24 h`, or `No meals charted · last 24 h` when there are none, and opens `/d/<admission id>`. It refreshes every 30 s, paused while locked. It makes no model request.

#### Scenario: Sana's worklist
- **WHEN** at 15:00 on 3 Nov the worklist's `patients` lists:
  - 3A bed 6, Priya Iyer: a `poor_intake` referral made at 14:05 by Anita Thomas, 3 meals, all 3 eaten 50% or less;
  - 3A bed 7, Hugo Martin: a `poor_intake` referral made at 12:30 by Anita Thomas, acknowledged at 13:30 by Sana Mirza, and no meals
- **THEN** "Referrals" lists 3A bed 6 then 3A bed 7
- **AND** 3A bed 6's row reads `3A-6 · Priya Iyer`, `Referred 14:05 by Anita T. · Poor intake` and `3 of 3 meals 50% eaten or less · last 24 h`
- **AND** 3A bed 7's row reads `Referred 12:30 by Anita T. · Poor intake · Acknowledged 13:30 · Sana M.` and `No meals charted · last 24 h`

#### Scenario: Your patients and diet orders
- **WHEN** the worklist's `assigned` lists 2C bed 3, Deepa Rao, assigned at 09:00 by Sana Mirza, with no diet order and 2 meals, none eaten 50% or less
- **AND** its `diets` lists 5B bed 6, Kofi Mensah, with `{ type: "regular", texture: 6 }` set by Grace Lee, then HDU bed 3, Elena Novak, with `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }` set by Sana Mirza
- **THEN** "Your patients" lists `2C-3 · Deepa Rao`, `Assigned 09:00 by Sana M.` and `0 of 2 meals 50% eaten or less · last 24 h`
- **AND** "Diet orders" lists 5B bed 6 with `Diet · Regular · IDDSI 6 Soft & bite-sized · set by Grace L.`, then HDU bed 3 with `Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein · set by Sana M.`

#### Scenario: Opens the bed review
- **WHEN** Sana Mirza taps 3A bed 6's row (admission 11)
- **THEN** the app opens `/d/11`, whose only request is `GET /api/admissions/11/nutrition`

#### Scenario: Requests
- **WHEN** Sana Mirza opens `/d` at 15:00:00 and it is still open at 15:00:30
- **THEN** the requests are `GET /api/nutrition/worklist`, then one more `GET /api/nutrition/worklist` at 15:00:30, and no `/api/ai` request

#### Scenario: Nothing to do
- **WHEN** the worklist's `patients`, `assigned` and `diets` are all empty
- **THEN** `/d` reads `Nothing on your worklist`, with no section
- **AND** when only `diets` has patients, only "Diet orders" is shown

### Requirement: Worklist for dietitians only
The navigation SHALL show "Nutrition", linking to `/d`, to dietitians only. Anyone else who opens `/d` sees `The nutrition worklist is for dietitians.` with a link to their landing page, and anyone else at `/d/<id>` sees `The nutrition view is for dietitians.` with a link to the bed review `/n/<id>`; neither sends a nutrition request. It makes no model request.

#### Scenario: Navigation
- **WHEN** Sana Mirza (dietitian), Anita Thomas (nurse) and Ravi Kumar (attendant) are each signed in
- **THEN** only Sana Mirza's navigation shows "Nutrition", linking to `/d`

#### Scenario: Nurse opens the worklist
- **WHEN** Anita Thomas (nurse) opens `/d`
- **THEN** the page reads `The nutrition worklist is for dietitians.` with a link to `/n`
- **AND** no request is sent after `GET /api/session`

#### Scenario: Nurse opens a patient view
- **WHEN** Anita Thomas opens `/d/11`
- **THEN** the page reads `The nutrition view is for dietitians.` with a link to `/n/11`
- **AND** no request is sent after `GET /api/session`

### Requirement: Patient nutrition view
`/d/<id>` SHALL show, from one `GET /api/admissions/<id>/nutrition`, the bed and patient, the dietitian line, the diet order, the referrals newest first, and a food chart: per day of `days`, `<n> meals · <p> eaten 50% or less` or `No meals charted`, with that day's meals as the bed review's Nutrition section lists them. It links to the bed review, which links a dietitian back. It refreshes every 30 s, paused while locked, hidden or awaiting a reason. It makes no model request.

#### Scenario: Priya's food chart
- **WHEN** at 15:00 on Tue 3 Nov Sana Mirza opens `/d/11`, and its read gives 3A bed 6, Priya Iyer, on Medical Ward 3A, with a breakfast 50% at 08:00 and a lunch 0% at 13:00 on 3 Nov, a dinner 25% at 19:00 on 2 Nov, and `days` 3 Nov (2 meals, 2 poor), 2 Nov (1, 1) and 1 Nov (0, 0)
- **THEN** the view reads `3A-6 · Priya Iyer` and `Medical Ward 3A`
- **AND** the food chart reads `Tue 3 Nov · 2 meals · 2 eaten 50% or less`, with the lunch then the breakfast; `Mon 2 Nov · 1 meal · 1 eaten 50% or less`, with the dinner; and `Sun 1 Nov · No meals charted`
- **AND** the lunch's row reads `13:00`, `Lunch` and `None` with 0 of 4 parts filled

#### Scenario: Dietitian, diet and referrals
- **WHEN** the read has Sana Mirza assigned at 14:40 by Anita Thomas, the diet `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }`, an open `poor_intake` referral made at 14:05 by Anita Thomas, and a `weight_loss` referral made at 09:00 on 1 Nov by Meera Pillai, with the note `Lost weight at home`, closed at 17:00 that day by Sana Mirza with `supplements_started` and `next_review: "2026-11-05"`
- **THEN** the view reads `Dietitian: Sana M. · assigned 14:40 by Anita T.` and `Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein`
- **AND** its referrals read `Referred 14:05 by Anita T. · Poor intake`, then `Referred 1 Nov 09:00 by Meera P. · Weight loss`, `Closed 1 Nov 17:00 by Sana M. · Supplements started · next review 5 Nov` and `Lost weight at home`

#### Scenario: Requests
- **WHEN** Sana Mirza opens `/d/11` at 15:00:00 and it is still open at 15:00:30
- **THEN** the requests are `GET /api/admissions/11/nutrition` at 15:00:00 and again at 15:00:30, and no `/api/media` or `/api/ai` request
- **AND** while the page is hidden from 15:00:40 to 15:02:00, no request is sent

#### Scenario: Links
- **WHEN** the view of admission 11 is open
- **THEN** it links `Bed review` to `/n/11`
- **AND** Sana Mirza's bed review of admission 11 links `Nutrition view` to `/d/11`, and Anita Thomas's has no such link

### Requirement: Patients outside the dietitian's wards
When a dietitian opens `/d/<id>` for a patient whose ward is not in their `wards`, the view SHALL show nothing of the patient but the dialog of "Reason to open another ward" until one `POST /api/wards/<id>/access` accepts a reason and their password, which records who opened the ward, why and when. The ward then opens for that shift, the bed review included. An assignment does not waive it. Cancel goes back, or to `/d` with no page to go back to. It makes no model request.

#### Scenario: Joel opens HDU
- **WHEN** Joel Mathew (id 12, dietitian, `wards` 3A), with no reason given this shift, opens `/d/21` at 10:00, and its first load, `GET /api/admissions/21/nutrition`, names ward 4
- **THEN** only a dialog for a reason and a password is shown, and that GET is the only request sent, still at 10:01
- **AND** after the reason `Renal diet review` and his password are accepted by `POST /api/wards/4/access` with `X-Staff-Id: 12`, the view opens with the next `GET /api/admissions/21/nutrition`

#### Scenario: Cancel
- **WHEN** Joel Mathew came to `/d/21` from his worklist `/d`, and cancels the reason
- **THEN** no request is sent after the first `GET /api/admissions/21/nutrition`, HDU still needs a reason, and the app goes back one page, to `/d`
- **AND** when he opened `/d/21` by direct link, with no page to go back to, cancelling goes to `/d`

#### Scenario: Assigned is not enough
- **WHEN** Joel Mathew is assigned to HDU bed 3 and opens `/d/21` on the next shift
- **THEN** the reason dialog is shown again

#### Scenario: Own wards
- **WHEN** Sana Mirza (`wards` 2C, 3A, 5B, HDU) opens `/d/21`
- **THEN** no reason dialog is shown, and no access request is sent

#### Scenario: Once a shift, both views
- **WHEN** Joel Mathew gave a reason for HDU at 10:15, and at 14:00 opens `/n/21`
- **THEN** no reason dialog is shown, and no access request is sent

### Requirement: Referral actions in the patient view
In the patient view, a dietitian SHALL be offered "Acknowledge" on an open referral and "Close…" on an open or acknowledged one, with the outcomes and review dates of "Referral actions on the bed review". Each sends one request, then reloads the view with one `GET /api/admissions/<id>/nutrition`. It makes no model request.

#### Scenario: Acknowledge
- **WHEN** Sana Mirza (id 11) taps "Acknowledge" on the open referral 5 in `/d/11`
- **THEN** the requests are `POST /api/referrals/5/acknowledge` with `X-Staff-Id: 11`, then `GET /api/admissions/11/nutrition`
- **AND** no `/api/ai` request is sent

#### Scenario: Close
- **WHEN** on 3 Nov she taps "Close…" on referral 5, picks "Monitoring" and no date, and confirms
- **THEN** the requests are `POST /api/referrals/5/close` with `{ outcome: "monitoring" }`, then `GET /api/admissions/11/nutrition`

### Requirement: Assignment from the patient view
In the patient view, a dietitian SHALL be offered "Take on" when the patient is assigned to nobody, "Take over…" when assigned to another dietitian (confirming `Take over from <short name>?`), "Hand back…" when assigned to them (confirming `Hand back to the ward dietitians?`), and "Assign…", which opens the bed review's dietitian dialog. Each sends one request, then reloads the view. It makes no model request.

#### Scenario: Take on
- **WHEN** Sana Mirza (id 11) taps "Take on" in `/d/11`, whose patient is assigned to nobody
- **THEN** the requests are `PUT /api/admissions/11/dietitian` with `{ staff_id: 11 }` and `X-Staff-Id: 11`, then `GET /api/admissions/11/nutrition`

#### Scenario: Take over
- **WHEN** the patient is assigned to Joel Mathew, and Sana Mirza taps "Take over…"
- **THEN** it asks `Take over from Joel M.?`, and confirming sends the same `PUT`, then the reload

#### Scenario: Hand back
- **WHEN** the patient is assigned to Sana Mirza, and she taps "Hand back…" and confirms
- **THEN** the requests are `DELETE /api/admissions/11/dietitian`, then the reload
- **AND** when it answers 409 `no_dietitian`, the view shows `No dietitian covers Medical Ward 3A to take the referral.` and nothing more is sent

#### Scenario: Assign to a colleague
- **WHEN** Sana Mirza taps "Assign…", picks Joel Mathew (id 12) and taps "Assign"
- **THEN** the requests are `GET /api/staff`, `PUT /api/admissions/11/dietitian` with `{ staff_id: 12 }`, then `GET /api/admissions/11/nutrition`

### Requirement: Diet order from the patient view
In the patient view, a dietitian SHALL be able to add, change or end the diet order with the form and rules of "Diet order from the bed review", targets included, and see the diet orders' history as the care plan words it, newest first. Each change sends one request, then reloads the view. It makes no model request.

#### Scenario: Set targets
- **WHEN** Sana Mirza (id 11) opens `/d/21` (HDU bed 3), adds a diet with "Renal", "IDDSI 7 Regular", 1800 kcal and 60 g protein, and saves
- **THEN** the requests are `PUT /api/admissions/21/care/diet` with `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }` and `X-Staff-Id: 11`, then `GET /api/admissions/21/nutrition`

#### Scenario: History and end
- **WHEN** the read's `diet_history` holds that order, active since 10:00 and set by Sana Mirza
- **THEN** the history reads `Diet renal, IDDSI 7, 1800 kcal, 60 g protein · 10:00–now · set by Sana M.`
- **AND** "End…" asks `End diet?`, then sends `DELETE /api/admissions/21/care/diet` and the reload

### Requirement: Next up on the worklist
`/d` SHALL open with a Next up list of at most 3 referrals the dietitian has not acknowledged, oldest first, each reading `<ward>-<bed> · <patient>`, `Referred <time> · <reason>` and how long ago, and opening `/d/<admission id>`, above the worklist's sections and from the same `GET /api/nutrition/worklist`. With none open it is not shown.

#### Scenario: Two open referrals
- **WHEN** at 15:00 the worklist lists 3A bed 6 referred at 14:05 and 3A bed 7 referred at 12:30, neither acknowledged
- **THEN** Next up lists `3A-7 · Hugo Martin` (`Referred 12:30 · Poor intake · 2 h ago`) then `3A-6 · Priya Iyer`, and only `GET /api/nutrition/worklist` was requested

#### Scenario: All acknowledged
- **WHEN** every referral on the worklist is acknowledged
- **THEN** no Next up list is shown
