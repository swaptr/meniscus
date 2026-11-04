# Spec Delta

## ADDED Requirements

### Requirement: Urine colour read
The Spark reading SHALL also return two fields, both null unless the fluid is urine:
- `urine_colour`: one of `pale`, `yellow`, `dark`, `orange`, `pink`, `red` or `brown`.
- `urine_rgb`: the urine's colour as seen, as `#rrggbb` in lowercase.

A urine draft SHALL carry both. A `urine_rgb` that is not a 6-digit hex colour SHALL become null and the colour is kept. This adds no request: `sam+spark` mode stays at 3 requests and `spark` mode at 1.

#### Scenario: Dark urine in a bag
- **WHEN** a JPEG is read with hint `urine_bag` in `sam+spark` mode and Spark returns fluid `urine`, 450 mL, `urine_colour` `dark` and `urine_rgb` `#C9952F`
- **THEN** the draft has `urine_colour: dark` and `urine_rgb: "#c9952f"`
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Not urine
- **WHEN** Spark returns fluid `water` with `urine_colour` `yellow` and `urine_rgb` `#ecd558`
- **THEN** the reading and the draft have `urine_colour` and `urine_rgb` null

#### Scenario: Not a hex colour
- **WHEN** Spark returns fluid `urine`, `urine_colour` `dark` and `urine_rgb` `amber`
- **THEN** the draft has `urine_colour: dark` and `urine_rgb: null`
