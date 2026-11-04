# Spec Delta

## MODIFIED Requirements

### Requirement: Staff roster
`GET /api/staff` SHALL return the hospital's staff roster. Each member has an `id`, a `name`, a `role` (`attendant`, `nurse` or `matron`) and `wards`, and never a username or password hash. `wards` lists `{ id, code }` for each ward, home ward first, then the wards they cover. A matron's `wards` are the wards they oversee. The demo hospital SHALL be seeded with fictional staff. It makes no model request.

#### Scenario: Demo roster
- **WHEN** a new demo store is opened and `GET /api/staff` is requested
- **THEN** the response lists 10 staff: 4 with role `attendant`, 5 with role `nurse` and 1 with role `matron`
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
