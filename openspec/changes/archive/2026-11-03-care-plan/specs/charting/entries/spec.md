# Spec Delta

## ADDED Requirements

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
