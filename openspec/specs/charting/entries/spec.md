# charting/entries Specification

## Purpose
How chart entries are recorded against an admission, reviewed by a nurse and totalled, so every bedside capture ends up on the chart with a running balance.

## Requirements

### Requirement: Persistent store
Admissions and entries SHALL be stored in the Postgres database at `DATABASE_URL` and survive a server restart. The server, `demo`, `media:sweep` and `db:migrate` refuse to start when `DATABASE_URL` is unset, with a message naming it and `pnpm dev:stack`, and they never fall back to a local file.

#### Scenario: Restart keeps entries
- **WHEN** an entry of 200 mL water is recorded, and the server is stopped and started again with the same `DATABASE_URL`
- **THEN** the admission's entry list contains that 200 mL entry

#### Scenario: No database configured
- **WHEN** the server starts with `DATABASE_URL` unset
- **THEN** it exits with status 1 and a message naming `DATABASE_URL` and `pnpm dev:stack`, before it listens
- **AND** the upstream received no request

### Requirement: Bed QR lookup
`GET /api/beds/:token` SHALL return the admission whose bed QR token matches, and HTTP 404 `not_found` for any other token.

#### Scenario: Known token
- **WHEN** the token of bed `4` is looked up
- **THEN** the response is 200 with bed `4`

#### Scenario: Unknown token
- **WHEN** the token `nope` is looked up
- **THEN** the response is 404 with `error: not_found`

### Requirement: Record an entry
`POST /api/admissions/:id/entries` SHALL store a valid entry as `pending` and return it with HTTP 201, making no model request. An entry whose category does not belong to its direction, whose volume is not an integer from 1 to 5000 mL, whose `charted_at` is out of range (see Late entries) or whose `X-Staff-Id` is invalid (see Chart changes are attributed) SHALL get HTTP 400 `invalid_request`, and an unknown admission HTTP 404 `not_found`.

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
`GET /api/admissions/:id/entries` SHALL return the admission's entries, newest charted first, and totals over entries charted in the last 24 hours. `in_ml`, `out_ml` and `balance_ml` count approved entries only, and `pending_ml` sums pending entries of both directions. An entry's charted time is its `created_at`, which for a late entry is earlier than when it was saved.

#### Scenario: Mixed entries
- **WHEN** bed 1 has approved 500 mL water in, approved 300 mL urine out, pending 200 mL tea in, rejected 900 mL water in, and approved 1000 mL water in charted 25 hours ago
- **THEN** totals are `in_ml 500`, `out_ml 300`, `balance_ml 200`, `pending_ml 200`, and the list starts with the newest entry

#### Scenario: Late entry counts by its charted time
- **WHEN** at 14:10 a 300 mL drink charted 23 hours earlier is posted and approved
- **THEN** it counts in `in_ml`, and it is listed after entries charted later even though it was saved last

### Requirement: Nurse review
`POST /api/entries/:id/review` with `approve` SHALL mark a pending entry approved, optionally replacing its volume, and with `reject` mark it rejected; reviewing an entry that is not pending SHALL get HTTP 409 `not_pending` and change nothing.

#### Scenario: Approve with correction
- **WHEN** a pending 450 mL urine entry is approved with `volume_ml: 400`
- **THEN** the response is 200 with `status: approved` and `volume_ml: 400`

#### Scenario: Review twice
- **WHEN** the same entry is then rejected
- **THEN** the response is 409 with `error: not_pending` and the entry stays approved at 400 mL

### Requirement: Recorded volume kept
Every entry SHALL carry `recorded_ml`, the volume it was saved with, which a nurse's correction on approval SHALL NOT change.

#### Scenario: Corrected on approval
- **WHEN** a pending 450 mL urine entry is approved with `volume_ml: 400`
- **THEN** the entry shows `volume_ml: 400` and `recorded_ml: 450`

### Requirement: Hourly series
Each admission in `GET /api/admissions` SHALL carry `hourly.in_ml`, `hourly.out_ml` and `hourly.in_logged`, each 24 numbers for the rolling hours of the last 24 hours, oldest first. The last covers the most recent 60 minutes; an entry exactly 60 minutes old falls in the one before. `in_ml` and `out_ml` sum approved volume by charted time; `in_logged` counts intake entries that are not rejected. It SHALL make no model request.

#### Scenario: Three entries
- **WHEN** a bed has approved 300 mL water 30 minutes ago, approved 400 mL urine 5.5 hours ago, pending 200 mL tea 10 minutes ago and approved 500 mL water 25 hours ago
- **THEN** `hourly.in_ml[23]` is 300, `hourly.out_ml[18]` is 400, `hourly.in_logged[23]` is 2, every other element is 0, and the upstream received no request

#### Scenario: Bucket edge
- **WHEN** a bed has one approved 250 mL drink charted exactly 60 minutes ago and one rejected 100 mL drink 20 minutes ago
- **THEN** `hourly.in_ml[22]` is 250, `hourly.in_ml[23]` is 0, `hourly.in_logged[22]` is 1 and `hourly.in_logged[23]` is 0

### Requirement: Urine colour on the entry
`POST /api/admissions/:id/entries` SHALL accept two optional fields, on `urine` entries only:
- `urine_colour`: one of `pale`, `yellow`, `dark`, `orange`, `pink`, `red` or `brown`;
- `urine_rgb`: `#rrggbb`, accepted only together with `urine_colour`.

Entry lists SHALL return both fields, or null when there are none. Photo evidence SHALL accept the same two fields on its `reading`. Any other use SHALL get HTTP 400 `invalid_request`. None of this makes a model request.

#### Scenario: Urine with its colour
- **WHEN** a 300 mL urine entry is posted with `urine_colour: dark` and `urine_rgb: "#c9952f"`
- **THEN** the entry list returns it with `urine_colour: dark` and `urine_rgb: "#c9952f"`
- **AND** the upstream received no request

#### Scenario: Photo evidence with the colour
- **WHEN** a urine photo entry is posted whose evidence `reading` carries `urine_colour: dark` and `urine_rgb: "#c9952f"`
- **THEN** the response is 201, and the entry list returns that evidence unchanged

#### Scenario: Misplaced colour
- **WHEN** an entry is posted that is any of the following:
  - a water entry with `urine_colour: yellow`;
  - a urine entry with `urine_rgb: "#c9952f"` and no colour;
  - a urine entry with `urine_rgb: "#fff"`;
  - a urine entry with `urine_colour: green`
- **THEN** each response is 400 with `error: invalid_request` and nothing is stored

### Requirement: Latest urine colour
`GET /api/admissions` and `GET /api/admissions/:id/entries` SHALL return `urine_seen` for each admission. It is the newest urine entry charted in the last 24 hours that has a colour and is pending or approved, given as `{ colour, rgb, charted_at, status }`, or null when there is none.

#### Scenario: Newest colour wins
- **WHEN** bed 1 has approved urine charted at 08:00 with colour `yellow`, pending urine at 12:00 with colour `dark` and rgb `#c9952f`, and rejected urine at 13:00 with colour `red`
- **THEN** bed 1's `urine_seen` is `{ colour: dark, rgb: "#c9952f", status: pending }` with the 12:00 time

#### Scenario: No colour today
- **WHEN** bed 1's only coloured urine entry was charted 25 hours ago
- **THEN** bed 1's `urine_seen` is null

### Requirement: Drink consistency on the entry
`POST /api/admissions/:id/entries` SHALL accept an optional `iddsi_level`, an integer from 0 (thin) to 4 (extremely thick), on `water` entries only. Entry lists return it, or null when none was given. Any other use gets 400 `invalid_request`. Amending a drink to another type clears it. It makes no model request.

#### Scenario: Mildly thick drink
- **WHEN** `{ direction: in, category: water, volume_ml: 150, source: manual, iddsi_level: 2 }` is posted for 5B bed 6
- **THEN** the response is 201 with `iddsi_level: 2`, the entry list returns it with `iddsi_level: 2`, and the upstream received no request

#### Scenario: No consistency given
- **WHEN** a 200 mL water entry is posted without `iddsi_level`
- **THEN** the entry list returns it with `iddsi_level: null`

#### Scenario: Misplaced consistency
- **WHEN** an entry is posted that is any of the following:
  - a 150 mL food entry with `iddsi_level: 2`;
  - a 300 mL urine entry with `iddsi_level: 0`;
  - a water entry with `iddsi_level: 5`;
  - a water entry with `iddsi_level: 1.5`
- **THEN** each response is 400 with `error: invalid_request`, and nothing is stored

#### Scenario: Amended to food
- **WHEN** an approved 150 mL water entry with `iddsi_level: 2` is amended to `{ category: "food", reason: "it was soup" }`
- **THEN** the response is 200 with `category: food` and `iddsi_level: null`
- **AND** its `amended` event records `from_iddsi: 2` and `to_iddsi: null`

### Requirement: Drink kind on the entry
`POST /api/admissions/:id/entries` SHALL accept an optional `drink`, one of the drink kinds (`water`, `tea`, `coffee`, `milk`, `juice`, `coconut_water`, `buttermilk`, `ors`, `supplement`, `soup`, `other`), on `water` and `food` entries only. Entry lists return it, or null when none was given, and it survives a restart. Any other use gets 400 `invalid_request`. It makes no model request.

#### Scenario: Tea posted
- **WHEN** `{ direction: in, category: water, volume_ml: 200, item: "masala chai", drink: "tea", source: photo }` is posted for bed 1
- **THEN** the response is 201 with `drink: tea` and `item: masala chai`, the entry list returns it with `drink: tea`, and the upstream received no request

#### Scenario: No kind given
- **WHEN** a 200 mL water entry is posted without `drink`
- **THEN** the entry list returns it with `drink: null`

#### Scenario: Jug drop
- **WHEN** water jug levels of 1000 mL and then 600 mL are posted for bed 1
- **THEN** the second response's drop entry is `water` 400 mL with `drink: water`, the entry list returns it with `drink: water`, and the upstream received no request

#### Scenario: Misplaced kind
- **WHEN** an entry is posted that is any of the following:
  - a 300 mL urine entry with `drink: tea`;
  - a water entry with `drink: lassi`;
  - a water entry with `drink: urine`;
  - a water entry with `drink: none`
- **THEN** each response is 400 with `error: invalid_request`, and nothing is stored
