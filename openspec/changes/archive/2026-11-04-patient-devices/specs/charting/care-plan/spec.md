## ADDED Requirements

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

## MODIFIED Requirements

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
