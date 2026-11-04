# Spec Delta

## ADDED Requirements

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
