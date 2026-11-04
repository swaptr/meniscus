# Spec Delta

## MODIFIED Requirements

### Requirement: Resolve from the bed review
The bed review SHALL let a nurse:
- amend an approved entry's volume or type, with a reason of at least 3 characters;
- reject a pending entry with a reason chosen from the list;
- add a missed entry with the time it happened, saved and then approved in their name.

An attendant on shift saves a missed entry without approving it. Prompts `intake_incomplete`, `logging_gap` and `intake_target_behind` SHALL offer "Add missed entry". None of these makes a model request.

#### Scenario: Missed drink
- **WHEN** at 14:10 nurse 4 adds a missed 200 mL drink that happened at 08:00
- **THEN** exactly two requests are sent, both with `X-Staff-Id: 4`:
  1. `POST /api/admissions/<id>/entries` with `source: manual` and `charted_at` 08:00 today;
  2. `POST /api/entries/<new id>/review` with `action: approve`

  No `/api/ai` request is sent.

#### Scenario: Attendant adds a missed drink
- **WHEN** Ravi Kumar (id 1, attendant) adds a missed 200 mL drink that happened at 08:00
- **THEN** exactly one request is sent: `POST /api/admissions/<id>/entries` with `X-Staff-Id: 1`, `source: manual` and `charted_at` 08:00 today
- **AND** the entry stays pending

#### Scenario: Reject with a reason
- **WHEN** a nurse rejects a pending entry and picks "Duplicate"
- **THEN** the review request body is `{ action: "reject", reason: "duplicate" }`

#### Scenario: Gap prompts offer a missed entry
- **WHEN** a bed has `logging_gap`, `intake_incomplete`, `intake_target_behind` and `low_urine_output` prompts
- **THEN** "Add missed entry" is offered on the first three and not on `low_urine_output`

#### Scenario: Amend needs a reason
- **WHEN** a nurse sets an approved 400 mL entry to 380 mL
- **THEN** saving stays disabled until the reason has at least 3 characters
- **AND** the request body is then `{ volume_ml: 380, reason: "<the reason>" }`

## ADDED Requirements

### Requirement: Care plan on the bed review
The bed review SHALL show a "Care plan" section:
- each active order, in the order of `care.orders`;
- progress bars for a fluid limit and an intake target;
- the catheter day and its last review, as `Reviewed today` when it falls in the current chart day (since 08:00);
- under "History", the `CARE_HISTORY_SHOWN` (10) newest orders of `care_history`, with "Show all".

With no orders it reads `No care orders`. It sends no request beyond the bed review's own load.

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

#### Scenario: No extra request
- **WHEN** the bed review of a bed with all five kinds of order is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

### Requirement: Change care orders from the bed review
On the bed review, a nurse or matron SHALL be able to:
- add an order of a kind that is not active;
- change or end an active order;
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

### Requirement: Care badges on bed cards
Each ward dashboard bed card SHALL show one badge per active order, in the order of `care.orders`:
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

### Requirement: Care prompt colours
The web app SHALL colour care prompts like the existing ones, so a bed's status follows its worst prompt:
- red (`Review now`): `nil_by_mouth_intake`, `drink_too_thin` and `fluid_limit_reached`;
- amber (`Review`): `fluid_limit_near`, `nil_by_mouth_overdue`, `intake_target_behind` and `drink_consistency_unrecorded`;
- blue (`Check`): `catheter_review`.

Each prompt chip shows its label, never colour alone.

#### Scenario: Worst prompt wins
- **WHEN** one bed's only prompt is `catheter_review`, a second has `catheter_review` and `fluid_limit_near`, a third `catheter_review` and `drink_too_thin`, and a fourth only `drink_consistency_unrecorded`
- **THEN** their status chips read `Check`, `Review`, `Review now` and `Review`, on the ward dashboard and on the bed review alike

#### Scenario: Labels
- **WHEN** a bed raises each care prompt
- **THEN** the chips read:
  - `Intake while NBM` for `nil_by_mouth_intake`;
  - `Drink too thin` for `drink_too_thin`;
  - `Consistency not recorded` for `drink_consistency_unrecorded`;
  - `Fluid limit reached` for `fluid_limit_reached`;
  - `Near fluid limit` for `fluid_limit_near`;
  - `NBM past planned end` for `nil_by_mouth_overdue`;
  - `Behind intake target` for `intake_target_behind`;
  - `Catheter review` for `catheter_review`

### Requirement: Care flags on entries and meals
On the bed review, pending cards, log rows and entry details SHALL badge:
- an entry in the `entry_ids` of `nil_by_mouth_intake` as `During NBM`;
- one in the `entry_ids` of `drink_too_thin` as `Thinner than ordered`, and of `drink_consistency_unrecorded` as `Consistency not recorded`;
- every drink with a level as `IDDSI <level>`.

Meals in `meal_ids` are badged `During NBM`. Approving and rejecting stay as before.

#### Scenario: Drink while fasting
- **WHEN** a pending 150 mL water entry is in the `entry_ids` of `nil_by_mouth_intake`, and Anita Thomas (nurse) opens the bed
- **THEN** its pending card shows `During NBM`, with Approve and Reject

#### Scenario: Thin drink
- **WHEN** `drink_too_thin` lists an approved water entry at `iddsi_level: 0`, `drink_consistency_unrecorded` lists a jug-drop entry with no level, and the log also holds a level-2 drink that neither lists
- **THEN** the first row shows `IDDSI 0` and `Thinner than ordered`, the second `Consistency not recorded`, and the third `IDDSI 2` only

#### Scenario: Lunch while fasting
- **WHEN** a lunch is in the `meal_ids` of `nil_by_mouth_intake`
- **THEN** its row on the bed review's meals shows `During NBM`

### Requirement: Correct a drink's consistency
In entry details, Amend on an approved drink SHALL offer "Consistency" to a nurse or matron: chips `0 Thin` to `4 Extremely thick`, set to the drink's level, or none picked when it has none. A changed level is sent as `iddsi_level` with the reason, in one request. Other types offer no "Consistency". The timeline shows the change as `consistency <from> → IDDSI <to>`, with `none` for no level. It makes no model request.

#### Scenario: Record a jug drink's level
- **WHEN** Anita Thomas (id 4) opens Amend on an approved 400 mL jug-drop drink with no level, picks `2 Mildly thick` and gives the reason `checked the cup`
- **THEN** "Consistency" first shows no chip picked
- **AND** saving sends exactly one request, `POST /api/entries/<id>/amend` with `{ iddsi_level: 2, reason: "checked the cup" }` and `X-Staff-Id: 4`, and no `/api/ai` request

#### Scenario: Timeline
- **WHEN** that drink's `amended` event has `from_iddsi: null` and `to_iddsi: 2`, at 15:00 by Anita Thomas (nurse)
- **THEN** its timeline line reads `15:00 · Amended consistency none → IDDSI 2 by Anita Thomas (nurse): checked the cup`
- **AND** an event from `0` to `2` reads `consistency IDDSI 0 → IDDSI 2`

#### Scenario: Not a drink
- **WHEN** Amend is opened on an approved urine entry, and a level-2 drink is amended to food with the reason `it was soup`
- **THEN** the urine entry's Amend shows no "Consistency"
- **AND** the food request is `{ category: "food", reason: "it was soup" }`, with no `iddsi_level`
