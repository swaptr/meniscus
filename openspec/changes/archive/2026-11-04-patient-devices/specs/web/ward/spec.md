## ADDED Requirements

### Requirement: Output devices on the care plan
The bed review's care plan SHALL show each active stoma, drain and voiding order as a row, `Ileostomy · stoma bag`, `Chest drain` or `Commode for urine` (`· not measured` for toilet and pads), and let a nurse or matron add, change or end each with its own form, in one request then a reload. The forms offer each value, starting at none picked, Save disabled until one is, except voiding at `Urinal`. Attendants see the rows only. It makes no model request.

#### Scenario: Rows
- **WHEN** a bed's `care.orders` holds a catheter, a `{ type: "ileostomy" }` stoma, a `{ site: "chest" }` drain and a `{ method: "toilet" }` voiding order
- **THEN** after the catheter row the rows read, in order, `Ileostomy · stoma bag`, `Chest drain` and `Toilet for urine · not measured`
- **AND** the History rows read like `Ileostomy · 09:00–now · set by Meera P.`

#### Scenario: Add a commode order
- **WHEN** Anita Thomas (id 4) adds "Urine collection" on 3A bed 4 (admission 9), picks `Commode`, and saves
- **THEN** the requests are, in order, `PUT /api/admissions/9/care/voiding` with `{ method: "commode" }` and `X-Staff-Id: 4`, then `GET /api/admissions/9/entries` and `GET /api/admissions/9/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Form defaults
- **WHEN** the stoma, drain and urine collection forms are opened on a bed with no orders
- **THEN** the stoma form offers `Colostomy` and `Ileostomy` and the drain form `Abdominal`, `Chest`, `Pelvic` and `Wound`, each with none picked and Save disabled
- **AND** the urine collection form offers `Urinal`, `Bedpan`, `Commode`, `Toilet (not measured)` and `Pads (not measured)`, with `Urinal` picked

#### Scenario: End an order
- **WHEN** Meera Pillai ends 2C bed 2's drain and confirms `Drain removed?`
- **THEN** the requests are `DELETE /api/admissions/<id>/care/drain`, then the reload
- **AND** ending a stoma asks `End the stoma order?`, and ending urine collection `Back to the urinal default?`

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens the bed review of 2C bed 3, with its ileostomy
- **THEN** the row `Ileostomy · stoma bag` is shown, with no control to add, change or end it

### Requirement: Device badges on bed cards
Each ward dashboard bed card SHALL show, among its care badges in the order of `care.orders`, `Stoma` for a stoma order, `Drain` for a drain order, and for a voiding order its method: `Urinal`, `Bedpan`, `Commode`, `Toilet` or `Pads`. A bed on the default urinal shows no voiding badge. They come from the beds' existing load, so the dashboard sends no extra request.

#### Scenario: Every device
- **WHEN** a bed's `care.orders` holds a catheter on day 2, an ileostomy, an abdominal drain and a `{ method: "commode" }` voiding order
- **THEN** its card shows, in order, `Catheter day 2`, `Stoma`, `Drain` and `Commode`

#### Scenario: Default urinal
- **WHEN** a bed has no orders, so `devices.urine_from` is `default`
- **THEN** its card shows no care badge

#### Scenario: No extra request
- **WHEN** Meera Pillai opens the dashboard of ward 2C (id 1), whose beds have device orders
- **THEN** exactly two requests are made: `GET /api/admissions?ward=1` and `GET /api/wards/1/team`

#### Scenario: Urine not measured
- **WHEN** a bed's `care.orders` holds a `{ method: "toilet" }` voiding order and no catheter
- **THEN** its card shows the badge `Toilet`, and under the balance the note `Urine not measured`
- **AND** a bed on the default urinal shows no note

### Requirement: Urine rate not drawn when not measured
While urine is not measured (`devices.urine_measured` false), the bed review's urine output rate chart SHALL show `Urine not measured` instead of the plot, with no rate, reference line or caption, ahead of the weight check in "Urine output rate against the threshold". It makes no request.

#### Scenario: Urine not measured
- **WHEN** 3A bed 7 (60 kg, admitted 2 days ago) has a `{ method: "toilet" }` voiding order, no catheter and no urine in 24 h
- **THEN** the chart area reads `Urine not measured`, with no point, no 0.5 line and nothing marked below
- **AND** a bed on the default urinal with the same entries has its latest point at 0.00, marked below the line

### Requirement: Bag without a device on the bed review
The web app SHALL colour `bag_without_device` amber (`Review`), with the chip `Bag not on care plan`. On the bed review, for a nurse or matron, each such prompt offers "Add catheter", "Add stoma" or "Add drain" for its bag, opening that care-plan form; saving it sends one `PUT` and reloads the bed review. Attendants see the prompt without the action. None of it makes a model request.

#### Scenario: Colour
- **WHEN** one bed's only prompt is `bag_without_device`
- **THEN** its status chip reads `Review` on the ward dashboard and the bed review, and its prompt chip `Bag not on care plan`

#### Scenario: Add the catheter
- **WHEN** Anita Thomas (id 4) opens 3A bed 5 (admission 10), whose prompt is `Urine bag reading at 10:30, but no catheter is on the care plan. Review.`, taps "Add catheter", keeps the defaults and saves
- **THEN** the requests are `PUT /api/admissions/10/care/catheter` with `type: "urethral"` and `X-Staff-Id: 4`, then `GET /api/admissions/10/entries` and `GET /api/admissions/10/meals`
- **AND** after the reload the prompt is gone, and no `/api/ai` request was sent

#### Scenario: Drain
- **WHEN** a bed's prompts are `bag_without_device` for its stoma bag and for its drain bag
- **THEN** the first offers "Add stoma" and the second "Add drain"

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens 3A bed 5's bed review
- **THEN** the prompt is shown with no "Add catheter"

## MODIFIED Requirements

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
  - diet with no type picked, `IDDSI 7 Regular` and no target, and Save disabled until a type is picked;
  - stoma, drain and urine collection as in "Output devices on the care plan"
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
- **THEN** it offers nil by mouth, thickened fluids, fluid limit, intake target, catheter, stoma, drain, urine collection and diet, and not acuity

#### Scenario: Dietitian offered diet only
- **WHEN** Sana Mirza (dietitian) opens the add-order control on the same bed
- **THEN** it offers only diet

### Requirement: Fluid balance chart
The bed review SHALL plot cumulative approved intake and output over the last 24 hours as two step lines, one step per approved entry, and show the final balance. Pending and rejected entries SHALL NOT move the lines. While urine is not measured (`devices.urine_measured` false), the output line is labelled `Output (urine not measured)` and the balance is followed by `Urine not measured`, as it leaves urine out.

#### Scenario: Day so far
- **WHEN** the approved entries are water 500 mL 10 h ago, urine 300 mL 6 h ago and water 200 mL 2 h ago, plus a pending 100 mL tea
- **THEN** the intake line steps to 500 and then 700, the output line steps to 300, and the balance reads `+400 mL`

#### Scenario: Urine not measured
- **WHEN** 3A bed 7 has a `{ method: "toilet" }` voiding order and no catheter, and its only approved entries in 24 hours are drinks of 1500 mL and 900 mL
- **THEN** the intake line steps to 1500 and then 2400, the output line, labelled `Output (urine not measured)`, stays at 0, and the balance reads `+2400 mL` followed by `Urine not measured`
- **AND** on a bed on the default urinal with the same entries, neither label is shown

### Requirement: Printable daily chart
`/n/<id>/print` SHALL show one row per clock hour for the 24 clock hours ending with the current one, oldest first, giving the hour, approved intake mL, approved output mL and running balance, followed by a totals row, like the paper I&O form. Printing SHALL hide the app chrome. While urine is not measured (`devices.urine_measured` false), the output column is headed `Out (urine not measured)` and the totals row ends `Urine not measured`.

#### Scenario: Two busy hours
- **WHEN** at 14:30 the approved entries are a 300 mL drink at 09:10 and 400 mL urine at 11:45
- **THEN** the first row is `15:00` and the last `14:00`; the `09:00` row reads in 300, out 0, balance +300; the `11:00` row reads in 0, out 400, balance −100; the totals row reads in 300, out 400, balance −100

#### Scenario: Printed with urine not measured
- **WHEN** at 14:30 3A bed 7, with a `{ method: "toilet" }` voiding order and no catheter, has approved drinks of 300 mL at 09:10 and 200 mL at 12:20 and no output
- **THEN** the output column is headed `Out (urine not measured)`, the totals row reads in 500, out 0, balance +500, and ends `Urine not measured`
