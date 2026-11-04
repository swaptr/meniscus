# Spec Delta

## ADDED Requirements

### Requirement: Urine colour from a note
When a note states the urine's colour, its urine entry SHALL get the nearest `urine_colour` and `urine_rgb` null. Every other entry SHALL have both null. A text note stays at exactly 1 Spark request, and a voice note at 1 ASR request and 1 Spark request.

#### Scenario: Dark urine noted
- **WHEN** the note is `bed 3 passed 300 mL dark urine` and the model calls `log_entry` with `out`, `urine`, 300 and `urine_colour` `dark`
- **THEN** the entry has `urine_colour: dark` and `urine_rgb: null`
- **AND** exactly one Spark request was made

#### Scenario: Colour on a drink
- **WHEN** the model calls `log_entry` with `in`, `water`, 200 and `urine_colour` `red`
- **THEN** the entry has `urine_colour: null`
