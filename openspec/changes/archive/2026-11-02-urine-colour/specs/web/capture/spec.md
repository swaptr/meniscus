# Spec Delta

## ADDED Requirements

### Requirement: Urine colour on the check screen
When a photo read or a note gives a urine draft, the capture and round check screens SHALL show the colour's swatch and name. They SHALL also show seven labelled colour chips, and picking a chip replaces the colour and drops `urine_rgb`. The attendant's by-hand form SHALL offer the same chips for urine, with none picked. Saving SHALL send the chosen colour on urine entries only. None of this adds a model request.

#### Scenario: Read colour kept
- **WHEN** a photo read gives a urine draft with `urine_colour: dark` and `urine_rgb: "#c9952f"`, and it is saved unchanged
- **THEN** the entry request carries `urine_colour: "dark"` and `urine_rgb: "#c9952f"`

#### Scenario: Staff change the colour
- **WHEN** on that draft the `Red` chip is picked and the draft is saved
- **THEN** the entry request carries `urine_colour: "red"` and no `urine_rgb`

#### Scenario: Type changed
- **WHEN** a urine draft with colour `dark` has its type changed to water and is saved
- **THEN** the entry request carries neither colour field

#### Scenario: By hand
- **WHEN** a urine output is entered by hand with the `Yellow` chip
- **THEN** the entry request carries `urine_colour: "yellow"` and no `urine_rgb`, and exactly one request is made
