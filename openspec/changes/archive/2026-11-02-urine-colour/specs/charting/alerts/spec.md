# Spec Delta

## MODIFIED Requirements

### Requirement: Appearance notes
A pending or approved output entry from the last 24 hours SHALL raise an `appearance` alert when either:
- its `urine_colour` is `pink`, `red` or `brown`; or
- its item or notes mention blood, pink, red, brown or clots.

A `dark` colour, or the word dark, SHALL raise it only when the admission also has a `low_urine_output` alert. Cloudy urine alone SHALL NOT raise it. The message names what was seen, e.g. `red noted on 1 output entry. Review.`

#### Scenario: Dark urine noted
- **WHEN** a urine entry has notes `dark, slightly cloudy` and the patient's urine rate is above 0.5 mL/kg/h
- **THEN** the alerts do not include `appearance`

#### Scenario: Red by colour
- **WHEN** an approved urine entry has `urine_colour: red` and no notes
- **THEN** the alerts include `appearance` with the message `red noted on 1 output entry. Review.`

#### Scenario: Clots noted
- **WHEN** a pending urine entry has notes `small clots`
- **THEN** the alerts include `appearance`

#### Scenario: Dark and low
- **WHEN** a 60 kg patient has 120 mL of approved urine in the last 6 hours, with `urine_colour: dark`
- **THEN** the alerts include both `low_urine_output` and `appearance`
