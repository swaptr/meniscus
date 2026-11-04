# Spec Delta

## ADDED Requirements

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
