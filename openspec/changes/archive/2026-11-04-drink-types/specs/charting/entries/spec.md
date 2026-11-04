# Spec Delta

## ADDED Requirements

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
