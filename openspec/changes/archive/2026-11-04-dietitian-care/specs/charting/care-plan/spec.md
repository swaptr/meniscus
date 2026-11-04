# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
