# Spec Delta

## MODIFIED Requirements

### Requirement: Staff roster
`GET /api/staff` SHALL return the hospital's staff roster. Each member has an `id`, a `name`, a `role` (`attendant`, `nurse`, `matron` or `dietitian`) and `wards`, and never a username or password hash. `wards` lists `{ id, code }` for each ward, home ward first, then the wards they cover. A matron's `wards` are the wards they oversee, and a dietitian's the wards they cover. The demo hospital SHALL be seeded with fictional staff. It makes no model request.

#### Scenario: Demo roster
- **WHEN** a new demo store is opened and `GET /api/staff` is requested
- **THEN** the response lists 11 staff: 4 with role `attendant`, 5 with role `nurse`, 1 with role `matron` and 1 with role `dietitian`
- **AND** the first is `{ id: 1, name: "Ravi Kumar", role: "attendant" }`, with `wards` coded 3A then 2C
- **AND** no member has a `username` or `password_hash` field
