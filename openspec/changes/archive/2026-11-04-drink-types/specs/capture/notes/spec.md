# Spec Delta

## ADDED Requirements

### Requirement: Drink kind from a note
The `log_entry` tool SHALL also take `drink`, one of the drink kinds (`water`, `tea`, `coffee`, `milk`, `juice`, `coconut_water`, `buttermilk`, `ors`, `supplement`, `soup`, `other`) or `none`. A `water` entry gets that kind, or `other` for `none`; a `food` entry gets it only when it is a kind, else null; every other entry gets null. `item` stays the model's name. A text note stays at exactly 1 Spark request, and a voice note at exactly 1 speech-to-text request and 1 Spark request.

#### Scenario: Coconut water typed
- **WHEN** the note is `coconut water 200` and the model calls `log_entry` with `in`, `water`, 200, item `coconut water` and drink `coconut_water`
- **THEN** the entry has `drink: coconut_water` and `item: "coconut water"`
- **AND** the request's `log_entry` parameters list `drink` as required, with an enum of the eleven kinds and `none`
- **AND** exactly one Spark request was made

#### Scenario: Tea and urine spoken
- **WHEN** a voice note is transcribed as `bed 4 had 200 mL chai and passed 300 mL urine`, and the model calls `log_entry` for `in`, `water`, 200, item `chai`, drink `tea`, and for `out`, `urine`, 300, drink `tea`
- **THEN** the first entry has `drink: tea` and `item: "chai"`, and the second has `drink: null`
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: Drink not named
- **WHEN** the note is `had a drink 150` and the model calls `log_entry` with `in`, `water`, 150 and drink `none`, and another note is `ate half the rice` and the model calls it with `in`, `food`, null and drink `none`
- **THEN** the first entry has `drink: other` and the second `drink: null`
- **AND** each note made exactly one Spark request
