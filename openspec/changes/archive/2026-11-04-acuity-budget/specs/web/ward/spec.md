# Spec Delta

## MODIFIED Requirements

### Requirement: Beds needing attention first
The ward dashboard SHALL list beds in acuity groups, placing each bed by the higher of its `acuity.level` and `acuity.suggested`: critical, then watch, then stable. Within each group, beds with alerts come first (most alerts first), then beds with pending entries, then the rest, each in bed order.

#### Scenario: Mixed ward
- **WHEN** every bed is `stable` with no suggestion, bed 3 has 2 alerts, bed 5 has 1 alert, bed 2 has 4 pending entries and beds 1, 4, 6 have nothing
- **THEN** the order is 3, 5, 2, 1, 4, 6

#### Scenario: Acuity first
- **WHEN** on a six-bed ward:
  - bed 6 has an acuity order `critical` and nothing else;
  - bed 4 is `stable` with `low_urine_output` and `mismatch` (suggested `critical`);
  - bed 1 has an acuity order `watch` and 3 pending entries;
  - bed 3 is `stable` with `catheter_review` and `drink_consistency_unrecorded`;
  - bed 2 is `stable` with 4 pending entries;
  - bed 5 is `stable` with nothing
- **THEN** the order is 4, 6, 1, 3, 2, 5

### Requirement: Care plan on the bed review
The bed review SHALL show a "Care plan" section:
- each active order except acuity, in the order of `care.orders`;
- progress bars for a fluid limit and an intake target;
- the catheter day and its last review, as `Reviewed today` when it falls in the current chart day (since 08:00);
- under "History", the `CARE_HISTORY_SHOWN` (10) newest orders of `care_history`, with "Show all".

With no such order it reads `No care orders`. It sends no request beyond the bed review's own load.

#### Scenario: Limit and target
- **WHEN** the bed's `care` has:
  - a `{ ml: 1000, scope: "total" }` fluid limit at `ml: 820`, `pending_ml: 200`, `percent: 82` and `left_ml: 180`, since 08:00;
  - a 1600 mL intake target at `ml: 600` and `percent: 37`, with `next_check` 20:00 and 1200 mL
- **THEN** the limit row reads `Fluid limit · 1000 mL total intake`, with a bar at 82% captioned `820 of 1000 mL today since 08:00 · 82% · 180 mL left · incl. 200 mL pending`
- **AND** the target row reads `Intake target · 1600 mL oral intake`, with a bar at 37% captioned `600 of 1600 mL today since 08:00 · 37% · next check 20:00: 1200 mL`

#### Scenario: Limit bar colours
- **WHEN** a fluid limit is at 79%, at 80% and at 100%
- **THEN** its bar is neutral, amber and red respectively, and its caption always gives the percent as text

#### Scenario: Catheter
- **WHEN** the bed's `care` has a urethral catheter inserted on 29 Oct, `day: 6` and `review_due: true`, last reviewed on 2 Nov at 09:10 by Nikhil Bose
- **THEN** its row reads `Urethral catheter · inserted 29 Oct · Catheter day 6` and `Last reviewed 2 Nov 09:10 · Nikhil B.`
- **AND** after a review at 09:10 on 3 Nov by Nikhil Bose, at 10:00 that day it reads `Reviewed today 09:10 · Nikhil B.`
- **AND** a review at 07:30 on 3 Nov, before that chart day began at 08:00, reads at 10:00 `Last reviewed 07:30 · Nikhil B.`, and "Reviewed today" is still offered

#### Scenario: Nil by mouth and thickened fluids
- **WHEN** the bed's `care` has nil by mouth since 06:00 until 14:00, and thickened fluids at level 2
- **THEN** the rows read `Nil by mouth · since 06:00 · until 14:00` and `Thickened fluids · IDDSI 2 Mildly thick`
- **AND** nil by mouth with no `until` reads `Nil by mouth · since 06:00 · no planned end`

#### Scenario: History
- **WHEN** `care_history` holds:
  - nil by mouth until 16:00, from 09:00 today and active, set by Meera Pillai;
  - nil by mouth until 14:00, from 06:00 to 09:00 today, set and ended by Meera Pillai
- **THEN** the History rows read, in order:
  - `Nil by mouth until 16:00 · 09:00–now · set by Meera P.`
  - `Nil by mouth until 14:00 · 06:00–09:00 · set by Meera P. · ended by Meera P.`

#### Scenario: Nothing ordered
- **WHEN** the bed's `care.orders` and `care_history` are empty
- **THEN** the section reads `No care orders` and shows no History

#### Scenario: Acuity in its own row
- **WHEN** the bed's only active order is acuity `critical`, set at 10:00 today by Anita Thomas
- **THEN** the section's order rows read `No care orders`
- **AND** its History row reads `Acuity critical · 10:00–now · set by Anita T.`

#### Scenario: No extra request
- **WHEN** the bed review of a bed with all five kinds of order is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

### Requirement: Change care orders from the bed review
On the bed review, a nurse or matron SHALL be able to:
- add an order of a kind other than acuity that is not active;
- change or end an active order other than acuity (acuity is changed on its own row);
- record the catheter's "Reviewed today".

Each sends one request, then reloads the bed review. Attendants see the section without these actions. The forms load on first use. None of this makes a model request.

#### Scenario: Add a fluid limit
- **WHEN** Nikhil Bose (id 7) adds a fluid limit on HDU bed 3 (admission 21), sets 1000 mL and "Total intake", and saves
- **THEN** the requests are, in order:
  1. `PUT /api/admissions/21/care/fluid_limit` with `{ ml: 1000, scope: "total" }` and `X-Staff-Id: 7`;
  2. `GET /api/admissions/21/entries` and `GET /api/admissions/21/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Form defaults
- **WHEN** each kind's form is opened on a bed with no orders
- **THEN** the forms start as follows:
  - fluid limit at 1500 mL and "Total intake", stepping by 50 mL between 500 and 3000 mL;
  - intake target at 1600 mL;
  - nil by mouth with "No planned end";
  - catheter "Urethral", inserted today;
  - thickened fluids with no level picked, and Save disabled until one is
- **AND** on a bed with an active 1500 mL fluid limit, the intake target form starts at 1500 mL, the lower of 1600 mL and the limit

#### Scenario: Planned end of nil by mouth
- **WHEN** at 10:00 Meera Pillai sets nil by mouth on 2C bed 1 with "Until" 14:00, and at 22:00 another nurse sets it on another bed with "Until" 07:00
- **THEN** the first request's `until` is 14:00 today and the second's 07:00 tomorrow, local time

#### Scenario: Catheter insertion date
- **WHEN** a catheter is set with "Inserted" 29 Oct
- **THEN** the request's `inserted_at` is 00:00 on 29 Oct, local time

#### Scenario: End an order
- **WHEN** Meera Pillai ends nil by mouth on 2C bed 1 and confirms `End nil by mouth?`
- **THEN** the requests are `DELETE /api/admissions/<id>/care/nil_by_mouth`, then the reload
- **AND** ending a catheter asks `Catheter removed?` instead

#### Scenario: Reviewed today
- **WHEN** Nikhil Bose taps "Reviewed today" on HDU bed 1 (admission 19)
- **THEN** the requests are `POST /api/admissions/19/care/catheter/review`, then the reload
- **AND** when it answers 409 `already_reviewed`, the screen shows `Already reviewed today` and sends nothing more

#### Scenario: Target above the limit
- **WHEN** the bed has a 1500 mL fluid limit, and a nurse sets an intake target of 1600 mL
- **THEN** the form shows `Above the fluid limit of 1500 mL`, Save is disabled, and no request is sent
- **AND** a fluid limit set below an active 1600 mL target shows `Below the intake target of 1600 mL`

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens the bed review of a bed with orders
- **THEN** the Care plan section lists the orders and their progress, with no control to add, change or end an order and no "Reviewed today"

#### Scenario: Acuity not offered here
- **WHEN** Anita Thomas (nurse) opens the add-order control on a bed whose only active order is acuity `watch`
- **THEN** it offers nil by mouth, thickened fluids, fluid limit, intake target and catheter, and not acuity

### Requirement: Care badges on bed cards
Each ward dashboard bed card SHALL show one badge per active order other than acuity (which has its own chip: "Acuity on bed cards"), in the order of `care.orders`:
- `NBM`;
- `IDDSI <level>`;
- `Limit <litres> L · <percent>%`;
- `Target <counted mL>/<target mL>`;
- `Catheter day <n>`.

They come from the beds' existing load, so the dashboard sends no extra request.

#### Scenario: Every kind
- **WHEN** a bed's `care` has nil by mouth, thickened fluids at level 2, a 1500 mL limit at 82%, a 1600 mL target with 900 mL counted, and a catheter on day 6
- **THEN** its card shows, in order, `NBM`, `IDDSI 2`, `Limit 1.5 L · 82%`, `Target 900/1600` and `Catheter day 6`

#### Scenario: Litres
- **WHEN** one bed has a 1000 mL limit at 82%, and another a 1250 mL limit at 40%
- **THEN** their badges read `Limit 1 L · 82%` and `Limit 1.25 L · 40%`

#### Scenario: No extra request
- **WHEN** Grace Lee opens the dashboard of ward 5B (id 3), whose beds have orders
- **THEN** exactly two requests are made: `GET /api/admissions?ward=3` and `GET /api/wards/3/team`

#### Scenario: Acuity is not a care badge
- **WHEN** a bed's `care.orders` holds acuity `critical` and nil by mouth
- **THEN** its only care badge is `NBM`, and its acuity shows as the `Critical` chip

## ADDED Requirements

### Requirement: Acuity on bed cards
Each ward dashboard bed card SHALL show its acuity level as a labelled chip and, when `suggested` is set, a separate `Suggested <level> · Review` chip naming its reasons. The dashboard's All, Critical, Watch and Stable filter shows only the beds placed in that group ("Beds needing attention first"), and changing it sends no request. None of it makes a model request.

#### Scenario: Chips
- **WHEN** the ward of "Acuity first" is open
- **THEN** bed 4 shows `Stable` and `Suggested critical · Review` naming `Low output`, bed 6 shows `Critical`, bed 1 shows `Watch`, and beds 2, 3 and 5 show `Stable` with no suggestion chip

#### Scenario: Critical filter
- **WHEN** the ward of "Acuity first" is open and the nurse picks Critical, then All
- **THEN** only beds 4 and 6 are shown, then all six again in the order 4, 6, 1, 3, 2, 5
- **AND** no request was sent when the filter changed

### Requirement: Set or confirm acuity on the bed review
The bed review SHALL show the bed's acuity and its source (`Order` or `Ward default`) to everyone, with its suggestion, and the controls only to a nurse or matron: set a level with one `PUT /api/admissions/:id/care/acuity`, confirm a suggestion with one such PUT, or return to the ward default with one `DELETE` of that order. Nothing is set without a tap. It makes no model request.

#### Scenario: Confirm a suggestion
- **WHEN** Anita Thomas (nurse) opens 3A bed 2, which is `stable` from the ward default with `suggested: critical` for low urine output, and taps Confirm
- **THEN** before the tap the review shows `Stable · Ward default` and `Suggested critical: Low output. Review`, and no PUT was sent on opening
- **AND** the tap sends exactly one `PUT /api/admissions/<3A bed 2>/care/acuity` with `{ level: "critical" }` and no `/api/ai` request
- **AND** after the reload the review shows `Critical · Order`

#### Scenario: Set Watch
- **WHEN** Anita Thomas (nurse) picks Watch and saves on 3A bed 4, which is `stable` from the ward default with no suggestion
- **THEN** exactly one `PUT /api/admissions/<3A bed 4>/care/acuity` with `{ level: "watch" }` is sent, then the reload
- **AND** no `/api/ai` request is sent, so it makes 0 model requests
- **AND** after the reload the review shows `Watch · Order`

#### Scenario: Back to the ward default
- **WHEN** Anita Thomas picks "Ward default" and saves on 3A bed 2, which has an acuity order `critical`
- **THEN** exactly one `DELETE /api/admissions/<3A bed 2>/care/acuity` is sent, and after the reload the review shows `Stable · Ward default`

#### Scenario: Attendant sees it read-only
- **WHEN** Ravi Kumar (attendant) opens 3A bed 2 while it is `stable` from the ward default with `suggested: critical`
- **THEN** he sees `Stable · Ward default` and the suggestion, with no Confirm and no level control

