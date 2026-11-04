# Spec Delta

## MODIFIED Requirements

### Requirement: Amend an approved entry
`POST /api/entries/:id/amend` SHALL change an approved entry's volume, its type within the same direction, its urine colour, or any of these. It needs a reason of 3 to 200 characters and must change something.
- A new `urine_colour` is allowed on urine entries only and clears `urine_rgb`.
- Changing the type away from urine clears both colour fields.

It SHALL record an `amended` event and set `amended_at`. Totals and prompts SHALL use the new values. A pending or rejected entry SHALL get HTTP 409 `not_approved`, an unknown entry HTTP 404 `not_found`, and an invalid body HTTP 400 `invalid_request`.

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
