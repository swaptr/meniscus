# Spec Delta

## ADDED Requirements

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
