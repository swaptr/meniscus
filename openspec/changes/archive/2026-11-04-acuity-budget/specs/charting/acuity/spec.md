# Spec Delta

## Purpose

A bed's acuity: how closely a patient must be watched (`critical`, `watch` or `stable`), set by a nurse as a care order or defaulted by the ward. It orders the ward dashboard and sets the bed's model budget class. Live prompts may suggest a higher level, which raises the bed's dashboard group and budget class but is never stored or applied.

## ADDED Requirements

### Requirement: Ward default acuity
Every ward SHALL have a `default_acuity` of `critical`, `watch` or `stable`, returned on each `GET /api/wards` item and used by its beds that have no acuity order. On a fresh store the demo HDU defaults to `critical` and every other ward to `stable`. It makes no model request.

#### Scenario: Demo defaults
- **WHEN** `GET /api/wards` is called on a fresh store
- **THEN** HDU has `default_acuity: "critical"`, and 2C, 3A and 5B have `default_acuity: "stable"`
- **AND** the upstream received no request

### Requirement: Acuity order
`PUT /api/admissions/:id/care/acuity` SHALL accept only `{ level }` with `critical`, `watch` or `stable`, and otherwise answer 400 `invalid_request` and change nothing. The order follows the care-order rules for setting, ending, roles and history. It makes no model request.

#### Scenario: Acuity values
- **WHEN** at 10:00 on 3 Nov a nurse sends `acuity` with `{ level: "critical" }` for HDU bed 3, then `{ level: "urgent" }`, `{ level: "Critical" }` and `{}` for 3A bed 4
- **THEN** the first response is 201 with `kind: "acuity"` and `value: { level: "critical" }`
- **AND** each of the others is 400 with `error: invalid_request`, leaving 3A bed 4 with no acuity order

#### Scenario: Attendant cannot set it
- **WHEN** signed in as Ravi Kumar (id 1, attendant), `PUT /api/admissions/<3A bed 4>/care/acuity` is sent with `{ level: "critical" }`
- **THEN** the response is 403 with `error: forbidden`, and the bed has no acuity order

### Requirement: Acuity on chart reads
Each `GET /api/admissions` item and `GET /api/admissions/:id/entries` SHALL include `acuity`, computed without any model request:
- `level`: the active `acuity` care order's level, else the ward's `default_acuity`;
- `source`: `order` or `ward`;
- `order_id`: that order's id, or null;
- `suggested` and `reasons`, as in "Suggested acuity".

#### Scenario: Ward default
- **WHEN** HDU bed 1 and 3A bed 4 have no acuity order and their wards are listed
- **THEN** HDU bed 1 has `acuity.level: "critical"` and 3A bed 4 has `acuity.level: "stable"`, both with `source: "ward"` and `order_id: null`

#### Scenario: Order overrides the ward
- **WHEN** at 10:00 Anita Thomas sends `PUT /api/admissions/<3A bed 4>/care/acuity` with `{ level: "watch" }`, and at 12:00 ends it with `DELETE /api/admissions/<3A bed 4>/care/acuity`
- **THEN** read at 11:00, the bed has `level: "watch"`, `source: "order"` and that order's id
- **AND** read at 12:01, it has `level: "stable"`, `source: "ward"` and `order_id: null`, and its `care_history` holds the ended order

### Requirement: Suggested acuity
`acuity.suggested` SHALL be `critical` when the bed's level is lower and its alerts include `low_urine_output`, `overload`, `fluid_limit_reached` or `nil_by_mouth_intake`; `watch` when the level is `stable` and they include `logging_gap`, `appearance`, `fluid_limit_near` or `intake_target_behind`; else null. `reasons` lists only the bed's alert kinds from the suggested level's list. A suggestion is never stored and never changes `level` or any order.

#### Scenario: Suggested, not applied
- **WHEN** 3A bed 2 (57 kg, ward default `stable`, no acuity order), admitted 8 hours ago, has 100 mL of approved urine in the last 6 hours, below its 171 mL threshold, and no intake in the last 4 hours
- **THEN** its alerts include `low_urine_output` and `logging_gap`
- **AND** its `acuity` reads `level: "stable"`, `source: "ward"`, `suggested: "critical"` and `reasons: ["low_urine_output"]`
- **AND** its `care_history` holds no acuity order, and the upstream received no request

#### Scenario: Nurse confirms
- **WHEN** a nurse then sends `PUT /api/admissions/<3A bed 2>/care/acuity` with `{ level: "critical" }`
- **THEN** the bed reads `level: "critical"`, `source: "order"`, `suggested: null` and `reasons: []`

#### Scenario: Never a step down
- **WHEN** HDU bed 2 (ward default `critical`) has no alerts for 24 hours
- **THEN** its `suggested` is null and its level stays `critical`

#### Scenario: Amber on a stable bed
- **WHEN** 2C bed 1 (`stable`) has only a `logging_gap` alert, and 5B bed 1 (order `watch`) has only `logging_gap`
- **THEN** 2C bed 1 has `suggested: "watch"` with `reasons: ["logging_gap"]`, and 5B bed 1 has `suggested: null` and `reasons: []`
