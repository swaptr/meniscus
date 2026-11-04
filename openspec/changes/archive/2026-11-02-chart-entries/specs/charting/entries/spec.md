## Purpose
How chart entries are recorded against an admission, reviewed by a nurse and totalled, so every bedside capture ends up on the chart with a running balance.

## ADDED Requirements

### Requirement: Persistent store
Admissions and entries SHALL be stored in a SQLite file under `DATA_DIR` and survive a server restart.

#### Scenario: Restart keeps entries
- **WHEN** an entry of 200 mL water is recorded, the app is closed and a new app is opened on the same file
- **THEN** the admission's entry list contains that 200 mL entry

### Requirement: Demo ward
When the store has no admissions, the server SHALL seed six fictional admissions on beds 1–6, each with a distinct bed QR token of at least 22 characters, and `GET /api/admissions` SHALL list them by bed with their 24-hour totals and pending count, making no model request.

#### Scenario: Fresh store
- **WHEN** `GET /api/admissions` is called on an empty store
- **THEN** the response is 200 with six admissions, beds `1` to `6` in order, six distinct `qr_token` values and every `pending` count 0

#### Scenario: Seeding happens once
- **WHEN** the store is opened a second time on the same file
- **THEN** there are still six admissions with the same tokens

### Requirement: Bed QR lookup
`GET /api/beds/:token` SHALL return the admission whose bed QR token matches, and HTTP 404 `not_found` for any other token.

#### Scenario: Known token
- **WHEN** the token of bed `4` is looked up
- **THEN** the response is 200 with bed `4`

#### Scenario: Unknown token
- **WHEN** the token `nope` is looked up
- **THEN** the response is 404 with `error: not_found`

### Requirement: Record an entry
`POST /api/admissions/:id/entries` SHALL store a valid entry as `pending` and return it with HTTP 201, making no model request; an entry whose category does not belong to its direction, or whose volume is not an integer from 1 to 5000 mL, SHALL get HTTP 400 `invalid_request`, and an unknown admission HTTP 404 `not_found`.

#### Scenario: Confirmed photo draft
- **WHEN** `{ direction: in, category: water, volume_ml: 200, item: coconut water, source: voice }` is posted for bed 1
- **THEN** the response is 201 with `status: pending`, `volume_ml: 200` and an id, and the upstream received no request

#### Scenario: Invalid entries
- **WHEN** `{ direction: in, category: urine, volume_ml: 200 }` or `{ direction: out, category: urine, volume_ml: 0 }` is posted
- **THEN** both responses are 400 with `error: invalid_request` and nothing is stored

#### Scenario: Unknown admission
- **WHEN** a valid entry is posted to admission `999`
- **THEN** the response is 404 with `error: not_found`

### Requirement: 24-hour totals
`GET /api/admissions/:id/entries` SHALL return the admission's entries newest first and totals over the last 24 hours, where `in_ml`, `out_ml` and `balance_ml` count approved entries only and `pending_ml` sums pending entries of both directions.

#### Scenario: Mixed entries
- **WHEN** bed 1 has approved 500 mL water in, approved 300 mL urine out, pending 200 mL tea in, rejected 900 mL water in, and approved 1000 mL water in recorded 25 hours ago
- **THEN** totals are `in_ml 500`, `out_ml 300`, `balance_ml 200`, `pending_ml 200`, and the list starts with the newest entry

### Requirement: Nurse review
`POST /api/entries/:id/review` with `approve` SHALL mark a pending entry approved, optionally replacing its volume, and with `reject` mark it rejected; reviewing an entry that is not pending SHALL get HTTP 409 `not_pending` and change nothing.

#### Scenario: Approve with correction
- **WHEN** a pending 450 mL urine entry is approved with `volume_ml: 400`
- **THEN** the response is 200 with `status: approved` and `volume_ml: 400`

#### Scenario: Review twice
- **WHEN** the same entry is then rejected
- **THEN** the response is 409 with `error: not_pending` and the entry stays approved at 400 mL
