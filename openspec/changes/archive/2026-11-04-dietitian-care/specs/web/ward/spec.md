# Spec Delta

## MODIFIED Requirements

### Requirement: Nutrition on the bed review
The bed review SHALL show a "Nutrition" section from the bed's `nutrition`:
- `Dietitian: <name> · assigned <time> by <name>`, else `Dietitian: ward dietitians`, or `No dietitian covers <ward name>`;
- the latest referral: reason, who made it and when, its acknowledgement or its close (outcome, next review), and any note;
- the meals of the last 24 h as "Meals on the bed review" lists them, with their dishes.

It sends no request beyond the bed review's own load, and no model request.

#### Scenario: Acknowledged referral
- **WHEN** at 15:00 on 3 Nov the bed's `nutrition` has `dietitian_available: true` and a `poor_intake` referral made at 14:05 by Anita Thomas and acknowledged at 14:30 by Sana Mirza
- **THEN** the section reads `Dietitian: ward dietitians` and `Referred 14:05 by Anita T. · Poor intake · Acknowledged 14:30 · Sana M.`

#### Scenario: Closed with an outcome
- **WHEN** at 10:00 on 3 Nov the latest referral, `weight_loss` with the note `Lost weight at home`, was made at 09:00 on 1 Nov by Meera Pillai and closed at 17:00 on 1 Nov by Sana Mirza with `supplements_started` and `next_review: "2026-11-05"`
- **THEN** the section reads `Referred 1 Nov 09:00 by Meera P. · Weight loss` and `Closed 1 Nov 17:00 by Sana M. · Supplements started · next review 5 Nov`
- **AND** the note reads `Lost weight at home`

#### Scenario: No dietitian
- **WHEN** a bed on Medical Ward 3A has `nutrition: { dietitian_available: false, dietitian: null, referral: null }`
- **THEN** the section reads `No dietitian covers Medical Ward 3A`

#### Scenario: Assigned dietitian
- **WHEN** at 15:00 on 3 Nov the bed's `nutrition.dietitian` is Sana Mirza, assigned at 14:40 by Anita Thomas
- **THEN** the section reads `Dietitian: Sana M. · assigned 14:40 by Anita T.`
- **AND** with that assignment made at 09:00 on 2 Nov, it reads `Dietitian: Sana M. · assigned 2 Nov 09:00 by Anita T.`

#### Scenario: Meals in the section
- **WHEN** Sana Mirza opens a bed with a lunch at 13:10 today from a tray photo, half eaten, items "rice, dal", and the dishes rice (All) and dal (Half)
- **THEN** the Nutrition section lists the lunch as `13:10`, `Lunch`, `Half` with 2 of 4 parts filled and `rice, dal`, and under it the dishes `rice · All` and `dal · Half`
- **AND** no tray photo is loaded until "Show tray" is tapped

#### Scenario: No extra request
- **WHEN** the bed review of a bed with an acknowledged referral, an assigned dietitian and 3 meals with dishes is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

### Requirement: Change care orders from the bed review
On the bed review, a nurse or matron SHALL be able to:
- add an order of a kind other than acuity that is not active;
- change or end an active order other than acuity (acuity is changed on its own row);
- record the catheter's "Reviewed today".

Diets follow "Diet order from the bed review", and a dietitian may do these for diets only. Each sends one request, then reloads the bed review. Attendants see the section without these actions. The forms load on first use. It makes no model request.

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
  - thickened fluids with no level picked, and Save disabled until one is;
  - diet with no type picked, `IDDSI 7 Regular` and no target, and Save disabled until a type is picked
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
- **THEN** it offers nil by mouth, thickened fluids, fluid limit, intake target, catheter and diet, and not acuity

#### Scenario: Dietitian offered diet only
- **WHEN** Sana Mirza (dietitian) opens the add-order control on the same bed
- **THEN** it offers only diet

### Requirement: Care badges on bed cards
Each ward dashboard bed card SHALL show one badge per active order other than acuity (which has its own chip: "Acuity on bed cards") and diet (whose badges are in "Diet badges on bed cards"), in the order of `care.orders`:
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

#### Scenario: Diet has its own badges
- **WHEN** a bed's `care.orders` holds thickened fluids at level 2 and the diet `{ type: "low_salt", texture: 5 }`
- **THEN** its care badges read `IDDSI 2`, then `Low salt diet` and `Food IDDSI 5`, the diet's two from "Diet badges on bed cards", and no other badge

## ADDED Requirements

### Requirement: Dishes in the Nutrition section
Each meal in the Nutrition section SHALL list its `dishes` in order, as `<name> · <portion word>` beside the dish kind's label. A dish that a meal amendment changed, added or removed is marked with who did it and when, and a changed one with what it was. A meal whose tray photo is kept offers "Show tray": one `GET /api/media/<id>`, then the photo with the tray overlay. Nothing else is fetched, and it makes no model request.

#### Scenario: Lunch dishes
- **WHEN** a lunch has the dishes `{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }` and `{ index: 2, name: "dal", dish_kind: "dal_lentils", portion: 50 }`, and a breakfast by hand has none
- **THEN** the lunch lists `rice · All` labelled `Rice`, then `dal · Half` labelled `Dal / lentils`
- **AND** the breakfast lists no dishes, only its items as before

#### Scenario: Amended dishes
- **WHEN** a lunch was saved at 13:10 with the dishes `{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }`, `{ index: 2, name: "dal", dish_kind: "dal_lentils", portion: 100 }`, `{ index: 3, name: "papad", dish_kind: "snack", portion: 50 }` and `{ index: 4, name: "roti", dish_kind: "bread", portion: 75 }`
- **AND** at 14:10 Anita Thomas amended them to `{ index: 1, name: "jeera rice", dish_kind: "rice", portion: 100 }`, `{ index: 2, name: "dal", dish_kind: "dal_lentils", portion: 50 }`, `{ index: 4, name: "roti", dish_kind: "bread", portion: 75 }` and `{ index: 0, name: "curd", dish_kind: "dairy", portion: 100 }`
- **THEN** the dal reads `dal · Half` with `Amended 14:10 by Anita T. · was All`
- **AND** the rice reads `jeera rice · All` with `Amended 14:10 by Anita T. · was rice`
- **AND** the curd reads `curd · All` with `Added 14:10 by Anita T.`, and the papad is struck through with `Removed 14:10 by Anita T.`
- **AND** the roti reads `roti · Three quarters` with no mark

#### Scenario: Two dishes in one region
- **WHEN** a lunch was saved at 13:10 with the dishes `{ index: 1, name: "rice", dish_kind: "rice", portion: 50 }` and `{ index: 1, name: "dal", dish_kind: "dal_lentils", portion: 50 }`
- **AND** at 14:10 Anita Thomas amended them to `{ index: 1, name: "rice", dish_kind: "rice", portion: 50 }` and `{ index: 1, name: "sambar", dish_kind: "dal_lentils", portion: 50 }`
- **THEN** the rice reads `rice · Half` with no mark
- **AND** the sambar reads `sambar · Half` with `Amended 14:10 by Anita T. · was dal`, and no dish is marked added or removed

#### Scenario: Show tray
- **WHEN** the tray photo of the lunch in "Lunch dishes" is media 31, with segmentation regions 1 and 2, and "Show tray" is tapped, then hidden and shown again
- **THEN** exactly one request is sent, `GET /api/media/31`, and no `/api/ai` request
- **AND** the photo is drawn with the tray overlay, region 1 labelled `1 rice · All` and region 2 `2 dal · Half`

#### Scenario: No photo kept
- **WHEN** a lunch was voided, so its tray photo is deleted, and a breakfast was entered by hand
- **THEN** neither offers "Show tray"

### Requirement: Assign a dietitian from the bed review
In the Nutrition section, a nurse or matron whose `wards` include the bed's ward, and any dietitian, SHALL be offered "Assign dietitian…" ("Change…" once one is assigned) and, when one is assigned, "Hand back…". The dialog loads `GET /api/staff` once and lists the dietitians, those covering the ward first. Each action sends one request, then reloads the bed review. Others see the line without these actions. It makes no model request.

#### Scenario: Anita assigns Sana
- **WHEN** Anita Thomas (id 4, `wards` 3A, 5B) taps "Assign dietitian…" on 3A bed 6 (admission 11), picks Sana Mirza and taps "Assign"
- **THEN** the requests are, in order:
  1. `GET /api/staff`;
  2. `PUT /api/admissions/11/dietitian` with `{ staff_id: 11 }` and `X-Staff-Id: 4`;
  3. `GET /api/admissions/11/entries` and `GET /api/admissions/11/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Dietitians covering the ward first
- **WHEN** the roster has Sana Mirza (`wards` 2C, 3A, 5B, HDU) and Joel Mathew (`wards` 3A), and the dialog is opened for HDU bed 3
- **THEN** it lists `Sana Mirza · covers Renal HDU`, then `Joel Mathew`, and nobody who is not a dietitian
- **AND** "Assign" is disabled until one is picked

#### Scenario: Hand back
- **WHEN** 3A bed 6 is assigned to Sana Mirza, and Anita Thomas taps "Hand back…" and confirms `Hand back to the ward dietitians?`
- **THEN** the requests are `DELETE /api/admissions/11/dietitian`, then the reload
- **AND** when it answers 409 `no_dietitian`, the section shows `No dietitian covers Medical Ward 3A to take the referral.` and nothing more is sent

#### Scenario: Who is offered
- **WHEN** 3A bed 6 is opened by Ravi Kumar (attendant), Grace Lee (nurse, `wards` 5B, 3A), Lakshmi Iyer (matron) and Sana Mirza (dietitian), and HDU bed 3 by Grace Lee after giving a reason
- **THEN** Grace Lee, Lakshmi Iyer and Sana Mirza are offered "Assign dietitian…" on 3A bed 6, and Ravi Kumar is not
- **AND** Grace Lee is not offered it on HDU bed 3, and everyone sees the dietitian line

### Requirement: Diet order on the care plan
The care plan SHALL show an active diet order as `Diet · <type> · IDDSI <level> <name>`, followed by ` · <kcal> kcal` and ` · <protein> g protein` when set, and each diet History row as `Diet <type in lower case>, IDDSI <level>`, with the same targets, then its span and who set and ended it, as other History rows do. It sends no request beyond the bed review's own load.

#### Scenario: Renal diet
- **WHEN** the bed's `care.orders` holds the diet `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }`
- **THEN** its row reads `Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein`

#### Scenario: Soft diet
- **WHEN** the bed's diet is `{ type: "regular", texture: 6, kcal: null, protein_g: null }`
- **THEN** its row reads `Diet · Regular · IDDSI 6 Soft & bite-sized`

#### Scenario: History
- **WHEN** `care_history` holds a renal diet with 1800 kcal and 60 g protein at texture 6 from 11:00 today, active, set by Divya Kapoor, and the same at texture 7 from 10:00 to 11:00, set by Sana Mirza and ended by Divya Kapoor
- **THEN** the History rows read, in order:
  - `Diet renal, IDDSI 6, 1800 kcal, 60 g protein · 11:00–now · set by Divya K.`
  - `Diet renal, IDDSI 7, 1800 kcal, 60 g protein · 10:00–11:00 · set by Sana M. · ended by Divya K.`

### Requirement: Diet order from the bed review
A nurse, matron or dietitian SHALL be able to add, change or end the diet order from the care plan, picking a type and a texture (IDDSI 7 Regular by default). Only a dietitian may set or remove the energy (800–4000 kcal) and protein (20–200 g) targets; others see them read-only and send them back unchanged, and are offered "End…" only when no target is set. Each sends one request, then reloads. A dietitian gets no other care-plan control. It makes no model request.

#### Scenario: Sana sets a renal diet
- **WHEN** Sana Mirza (id 11) adds a diet on HDU bed 3 (admission 21), picks "Renal", keeps "IDDSI 7 Regular", sets 1800 kcal and 60 g protein, and saves
- **THEN** the requests are, in order:
  1. `PUT /api/admissions/21/care/diet` with `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }` and `X-Staff-Id: 11`;
  2. `GET /api/admissions/21/entries` and `GET /api/admissions/21/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Divya changes the texture
- **WHEN** HDU bed 3 has Sana Mirza's renal diet with 1800 kcal and 60 g protein, and Divya Kapoor (id 8) taps "Change…", picks "IDDSI 6 Soft & bite-sized" and saves
- **THEN** the form shows `1800 kcal · 60 g protein · set by a dietitian`, with no control to change them
- **AND** the request is `PUT /api/admissions/21/care/diet` with `{ type: "renal", texture: 6, kcal: 1800, protein_g: 60 }`, then the reload

#### Scenario: Form defaults
- **WHEN** the diet form is opened on a bed with no diet order
- **THEN** no type is picked and Save is disabled until one is, the texture is "IDDSI 7 Regular", and there is no target
- **AND** for a dietitian, "Add energy target" starts at 1800 kcal, stepping by 50 between 800 and 4000, and "Add protein target" at 60 g, stepping by 5 between 20 and 200, and either can be removed again
- **AND** with no target set, the body has only `type` and `texture`

#### Scenario: Ending
- **WHEN** Divya Kapoor opens HDU bed 3 with the targeted renal diet, Grace Lee opens 5B bed 6 with `{ type: "regular", texture: 6 }`, and Sana Mirza opens HDU bed 3
- **THEN** Divya Kapoor is offered no "End…", and the row reads `Only a dietitian can end a diet with targets.`
- **AND** Grace Lee's "End…" asks `End diet?` and sends `DELETE /api/admissions/<5B bed 6>/care/diet`, then the reload
- **AND** Sana Mirza is offered "End…"

#### Scenario: Dietitian's care plan
- **WHEN** Sana Mirza opens HDU bed 1, which has a catheter and no diet order
- **THEN** the care plan offers her only "Add diet": no other kind to add, no "Change…" or "End…" on the catheter, and no "Reviewed today"

#### Scenario: Targets changed meanwhile
- **WHEN** Divya Kapoor's save answers 403 `forbidden`, because a dietitian changed the targets after her form opened
- **THEN** the form shows `Only a dietitian can change energy and protein targets.`, and the bed review reloads

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens HDU bed 3
- **THEN** the diet row is listed, with no control to add, change or end it

### Requirement: Diet badges on bed cards
Each ward dashboard bed card SHALL show an active diet order as care badges, in the order of `care.orders`: `<type> diet`, left out for a regular diet with a texture below 7, then `Food IDDSI <level>` when the texture is below 7. They come from the beds' existing load, so the dashboard sends no extra request, and they make no model request.

#### Scenario: Renal and soft
- **WHEN** HDU bed 3 has `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }` and a 1000 mL limit at 82%, 5B bed 6 has thickened fluids at level 2 and `{ type: "regular", texture: 6 }`, 2C bed 2 has `{ type: "regular", texture: 7 }`, and 3A bed 4 has `{ type: "low_salt", texture: 5 }`
- **THEN** HDU bed 3's badges read `Limit 1 L · 82%` then `Renal diet`
- **AND** 5B bed 6's read `IDDSI 2` then `Food IDDSI 6`
- **AND** 2C bed 2's read `Regular diet`, and 3A bed 4's `Low salt diet` then `Food IDDSI 5`

#### Scenario: No extra request
- **WHEN** Grace Lee opens the dashboard of ward 5B (id 3), whose beds have diet orders
- **THEN** exactly two requests are made: `GET /api/admissions?ward=3` and `GET /api/wards/3/team`
