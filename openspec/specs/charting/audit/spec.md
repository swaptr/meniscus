# charting/audit Specification

## Purpose
Who did what to each chart entry, and when. Covers the staff roster, attribution of chart changes, an append-only entry history with corrections, amendments, rejection reasons and late entries, and a per-ward data-quality summary. None of it calls a model.

## Requirements

### Requirement: Staff roster
`GET /api/staff` SHALL return the hospital's staff roster. Each member has an `id`, a `name`, a `role` (`attendant`, `nurse`, `matron` or `dietitian`) and `wards`, and never a username or password hash. `wards` lists `{ id, code }` for each ward, home ward first, then the wards they cover. A matron's `wards` are the wards they oversee, and a dietitian's the wards they cover. The demo hospital SHALL be seeded with fictional staff. It makes no model request.

#### Scenario: Demo roster
- **WHEN** a new demo store is opened and `GET /api/staff` is requested
- **THEN** the response lists 11 staff: 4 with role `attendant`, 5 with role `nurse`, 1 with role `matron` and 1 with role `dietitian`
- **AND** the first is `{ id: 1, name: "Ravi Kumar", role: "attendant" }`, with `wards` coded 3A then 2C
- **AND** no member has a `username` or `password_hash` field

### Requirement: Chart changes are attributed
Recording an entry or level, reviewing and amending SHALL record the signed-in staff member; an `X-Staff-Id` header, when sent, must name them (server/security "Signed-in changes"). Entries SHALL return `created_by` and `reviewed_by` as `{ id, name, role }`, or null for an entry not yet reviewed or stored before staff were recorded. An `X-Staff-Id` that is malformed or not on the roster SHALL get HTTP 400 `invalid_request` and change nothing.

#### Scenario: Recorded and reviewed
- **WHEN** an entry is posted with `X-Staff-Id: 1` and approved with `X-Staff-Id: 4`
- **THEN** the entry shows `created_by` `{ id: 1, name: "Ravi Kumar", role: "attendant" }` and `reviewed_by` `{ id: 4, name: "Anita Thomas", role: "nurse" }`

#### Scenario: Unknown staff
- **WHEN** an entry is posted with `X-Staff-Id: 999`, and another with `X-Staff-Id: abc`
- **THEN** both responses are 400 with `error: invalid_request` and no entry is stored

#### Scenario: No staff sent
- **WHEN** signed in as Ravi Kumar (id 1), an entry is posted without `X-Staff-Id`, and another without `X-Staff-Id` and with no session
- **THEN** the first is stored with `created_by` `{ id: 1, name: "Ravi Kumar", role: "attendant" }`
- **AND** the second gets 401 with `error: sign_in_required`, and is not stored

#### Scenario: Level attributed
- **WHEN** a water jug level of 1000 mL and then 600 mL are posted with `X-Staff-Id: 2`
- **THEN** the 400 mL intake entry it creates has `created_by` `{ id: 2, name: "Sunita Devi", role: "attendant" }`

### Requirement: Amend an approved entry
`POST /api/entries/:id/amend` SHALL change an approved entry's volume, type within the same direction, or urine colour, with a 3–200 character reason, and must change something. A new colour (urine only) clears `urine_rgb`, and leaving urine clears both colour fields. It SHALL record an `amended` event and set `amended_at`; totals and prompts use the new values. A pending or rejected entry SHALL get 409 `not_approved`, an unknown entry 404 `not_found`, an invalid body 400 `invalid_request`.

#### Scenario: Volume amended
- **WHEN** bed 1's only entry, an approved 400 mL drink, is amended to `{ volume_ml: 380, reason: "re-measured with jug" }`
- **THEN** the response is 200 with `volume_ml: 380`, `approved_ml: 400` and `amended_at` set, and bed 1's `in_ml` is 380

#### Scenario: Colour corrected
- **WHEN** an approved urine entry with `urine_colour: yellow` and `urine_rgb: "#ecd558"` is amended to `{ urine_colour: "red", reason: "rechecked the bag" }`
- **THEN** the response is 200 with `urine_colour: red`, `urine_rgb: null` and `amended_at` set
- **AND** the `amended` event records `from_colour: yellow` and `to_colour: red`

#### Scenario: Not approved
- **WHEN** a pending entry is amended, and then `/api/entries/999/amend` is posted
- **THEN** the first response is 409 with `error: not_approved` and the entry is unchanged, and the second is 404 with `error: not_found`

#### Scenario: Invalid amendments
- **WHEN** an approved drink is amended:
  - with no reason;
  - with reason `ok`;
  - with category `urine`;
  - with its own volume and no type;
  - with `urine_colour: dark`
- **THEN** each response is 400 with `error: invalid_request` and nothing changes

### Requirement: Rejection reason
Rejecting an entry SHALL accept a `reason`: `wrong_bed`, `duplicate`, `unreadable`, `wrong_volume`, `not_given` or `other`. It may add a `note` of up to 200 characters. Both are stored on the `rejected` event, and the entry SHALL return the reason as `reject_reason`, or null if none was given.

#### Scenario: Duplicate
- **WHEN** a pending entry is rejected with `{ action: "reject", reason: "duplicate", note: "same bag photographed twice" }`
- **THEN** the entry shows `status: rejected` and `reject_reason: "duplicate"`, and its last event is `rejected` with that reason and note

#### Scenario: Unknown reason
- **WHEN** a pending entry is rejected with `reason: "tired"`
- **THEN** the response is 400 with `error: invalid_request` and the entry stays pending

### Requirement: Late entries
`POST /api/admissions/:id/entries` SHALL accept `charted_at`, the time the intake or output happened. It must be no later than one minute from now and no earlier than the admission time or 24 hours ago, whichever is later. The entry's `created_at` SHALL be the charted time and `recorded_at` the time it was saved. An entry saved more than 60 minutes after its charted time SHALL return `late: true`.

#### Scenario: Late drink
- **WHEN** at 14:10 a manual 200 mL drink is posted with `charted_at` 08:00 the same day
- **THEN** the entry has `created_at` 08:00, `recorded_at` 14:10 and `late: true`

#### Scenario: On time
- **WHEN** at 14:10 an entry is posted with `charted_at` 13:30, and another without `charted_at`
- **THEN** both have `late: false`, and the second has `created_at` equal to `recorded_at`

#### Scenario: Out of range
- **WHEN** at 14:10 an entry is posted with `charted_at` 14:30 the same day, or 25 hours earlier
- **THEN** both responses are 400 with `error: invalid_request` and nothing is stored

#### Scenario: Before admission
- **WHEN** a patient admitted at 10:00 gets an entry at 14:10 with `charted_at` 09:00
- **THEN** the response is 400 with `error: invalid_request`

### Requirement: Ward data quality
`GET /api/wards/:id/quality` SHALL summarise the ward's entries charted in the last 7 days. It returns counts (entries, corrected at approval, amended, late, rejected by reason, by hand), per recorder the entries recorded, corrected, amended, late and rejected, per reviewer the entries reviewed, and up to 100 corrected, amended, late or rejected entries, newest charted first, with bed and patient and without evidence. An unknown ward SHALL get 404 `not_found`. It makes no model request.

#### Scenario: One of each
- **WHEN** at 2 Nov 12:00, staff 1 recorded four entries in ward 5B:
  - one charted 1 Nov 09:00, approved unchanged by staff 4;
  - one charted 1 Nov 14:00, recorded as 450 mL and approved as 400 mL by staff 4;
  - one charted 2 Nov 08:00, rejected as `duplicate` by staff 4;
  - one by hand, charted 2 Nov 05:00 and saved at 11:00, approved by staff 5
- **THEN** the summary is:
  - totals: `entries 4, corrected 1, amended 0, late 1, rejected 1, manual 1`, and rejected by reason `duplicate 1`;
  - staff 1: recorded 4, corrected 1, late 1, rejected 1;
  - reviewed: staff 4 reviewed 3, staff 5 reviewed 1;
  - the flagged list holds, in order, the rejected (2 Nov 08:00), late (2 Nov 05:00) and corrected (1 Nov 14:00) entries

#### Scenario: Unknown ward
- **WHEN** `GET /api/wards/999/quality` is requested
- **THEN** the response is 404 with `error: not_found`

### Requirement: Amend a drink's consistency
`POST /api/entries/:id/amend` SHALL also accept `iddsi_level`, an integer from 0 to 4, when the entry is a drink (`water`) after the amendment. It follows "Amend an approved entry": a nurse or matron, an approved entry, a 3–200 character reason, and some change. The `amended` event records `from_iddsi` and `to_iddsi`, by the signed-in person. Any other use gets 400 `invalid_request`. It makes no model request.

#### Scenario: Consistency recorded
- **WHEN** signed in as Anita Thomas (id 4), an approved 400 mL drink with `iddsi_level: null` is amended to `{ iddsi_level: 2, reason: "checked the cup" }`
- **THEN** the response is 200 with `iddsi_level: 2`, `volume_ml: 400` and `amended_at` set
- **AND** the `amended` event records `from_iddsi: null`, `to_iddsi: 2`, reason `checked the cup` and `by` Anita Thomas
- **AND** the upstream received no request

#### Scenario: Consistency corrected
- **WHEN** an approved drink at `iddsi_level: 0` is amended to `{ iddsi_level: 2, reason: "thickener was added" }`
- **THEN** the response is 200 with `iddsi_level: 2`, and the event records `from_iddsi: 0` and `to_iddsi: 2`

#### Scenario: Misplaced consistency
- **WHEN** each of these is amended:
  - an approved urine entry with `{ iddsi_level: 2, reason: "checked the cup" }`;
  - an approved drink with `{ category: "food", iddsi_level: 2, reason: "it was soup" }`;
  - an approved drink with `{ iddsi_level: 5, reason: "checked the cup" }`;
  - an approved drink at `iddsi_level: 2` with `{ iddsi_level: 2, reason: "checked the cup" }`
- **THEN** each response is 400 with `error: invalid_request`, and nothing changes

#### Scenario: Amend rules apply
- **WHEN** `{ iddsi_level: 2, reason: "checked the cup" }` is sent for an approved drink signed in as Ravi Kumar (id 1, attendant), and for a pending drink signed in as Anita Thomas
- **THEN** the responses are 403 with `error: forbidden` and 409 with `error: not_approved`, and neither drink changes

### Requirement: Entry event history
Every entry SHALL keep an append-only history of `recorded`, `approved`, `corrected` (approved at another volume), `rejected` and `amended` events, each with its time and staff member or null. Corrections hold the volume before and after; amendments the volume, type and reason; rejections the reason. `GET /api/entries/:id/events` returns them oldest first, or 404 `not_found`.

#### Scenario: Corrected then amended
- **WHEN** a 450 mL urine entry is recorded by staff 1, approved as 400 mL by staff 4, and then amended to 380 mL by staff 4 with reason `re-measured with jug`
- **THEN** its events are, in order:
  - `recorded` with `to_ml` 450 by staff 1;
  - `corrected` 450 → 400 by staff 4;
  - `amended` 400 → 380 with reason `re-measured with jug` by staff 4

#### Scenario: Unknown entry
- **WHEN** `GET /api/entries/999/events` is requested
- **THEN** the response is 404 with `error: not_found`

### Requirement: Amend a drink's kind
`POST /api/entries/:id/amend` SHALL also accept `drink`, one of the drink kinds, when the entry is `water` or `food` after the amendment. It follows "Amend an approved entry": a nurse or matron, an approved entry, a 3–200 character reason, and some change. A new kind sets `item` to its label, and the `amended` event records `from_drink`, `to_drink`, `from_item` and `to_item`. Amending to any other type clears `drink`. Any other use gets 400 `invalid_request`. It makes no model request.

#### Scenario: Tea was coffee
- **WHEN** signed in as Anita Thomas (id 4), an approved 150 mL drink with `drink: tea` and item `masala chai` is amended to `{ drink: "coffee", reason: "it was coffee" }`
- **THEN** the response is 200 with `drink: coffee`, `item: Coffee`, `volume_ml: 150` and `amended_at` set, and the entry list returns `item: Coffee`
- **AND** the `amended` event records `from_drink: tea`, `to_drink: coffee`, `from_item: masala chai`, `to_item: Coffee`, reason `it was coffee` and `by` Anita Thomas
- **AND** the upstream received no request

#### Scenario: Drink amended to IV
- **WHEN** an approved 100 mL drink with `drink: milk` is amended to `{ category: "iv", reason: "it was the IV flush" }`
- **THEN** the response is 200 with `category: iv` and `drink: null`, and the event records `from_drink: milk` and `to_drink: null`

#### Scenario: Misplaced kind
- **WHEN** each of these is amended:
  - an approved urine entry with `{ drink: "tea", reason: "checked the cup" }`;
  - an approved drink with `{ drink: "lassi", reason: "checked the cup" }`;
  - an approved drink at `drink: tea` with `{ drink: "tea", reason: "checked the cup" }`
- **THEN** each response is 400 with `error: invalid_request`, and nothing changes

#### Scenario: Amend rules apply
- **WHEN** `{ drink: "juice", reason: "checked the cup" }` is sent for an approved drink signed in as Ravi Kumar (id 1, attendant), and for a pending drink signed in as Anita Thomas
- **THEN** the responses are 403 with `error: forbidden` and 409 with `error: not_approved`, and neither drink changes
