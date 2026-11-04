## Purpose
Rule-based review prompts on an admission's fluid chart, and a model-written explanation on request, so nurses catch low output, overload, missing intake and worrying appearance without the app making a diagnosis.

## ADDED Requirements

### Requirement: Low urine output
An admission with a weight, admitted at least 6 hours ago, whose approved urine output over the last 6 hours is below 0.5 mL per kg per hour SHALL carry a `low_urine_output` alert.

#### Scenario: 60 kg patient, 120 mL in 6 h
- **WHEN** a 60 kg patient admitted 2 days ago has 120 mL of approved urine in the last 6 hours (threshold 180 mL)
- **THEN** the admission's alerts include `low_urine_output`

#### Scenario: Enough output
- **WHEN** the same patient has 200 mL of approved urine in the last 6 hours
- **THEN** there is no `low_urine_output` alert

### Requirement: Intake and output mismatch
When `low_urine_output` is raised, the admission SHALL also carry `mismatch` if at least 1500 mL of approved intake was recorded in the last 24 hours, otherwise `intake_incomplete`; both messages tell the nurse to review rather than conclude.

#### Scenario: Intake logged
- **WHEN** low output is raised and 2100 mL of approved intake was recorded in 24 hours
- **THEN** the alerts include `mismatch` with a message containing `2100 mL` and `review`

#### Scenario: Intake missing
- **WHEN** low output is raised and 300 mL of approved intake was recorded in 24 hours
- **THEN** the alerts include `intake_incomplete` and not `mismatch`

### Requirement: Fluid overload
An admission whose approved 24-hour balance exceeds +1500 mL SHALL carry an `overload` alert.

#### Scenario: Positive balance
- **WHEN** approved intake is 2500 mL and output 800 mL in 24 hours
- **THEN** the alerts include `overload`

### Requirement: Logging gap
An admission admitted at least 3 hours ago with no pending or approved intake entry in the last 3 hours SHALL carry a `logging_gap` alert.

#### Scenario: No intake since morning
- **WHEN** the last intake entry was recorded 4 hours ago
- **THEN** the alerts include `logging_gap`

### Requirement: Appearance notes
A pending or approved output entry from the last 24 hours whose item or notes mention blood, dark, cloudy, red, brown or clots SHALL raise an `appearance` alert.

#### Scenario: Dark urine noted
- **WHEN** a urine entry has notes `dark, slightly cloudy`
- **THEN** the alerts include `appearance`

### Requirement: Alerts on chart reads
`GET /api/admissions` and `GET /api/admissions/:id/entries` SHALL include each admission's current alerts, computed without any model request.

#### Scenario: Ward list
- **WHEN** bed 1 meets the overload rule and the ward is listed
- **THEN** bed 1 has an `overload` alert, the other beds have none of that kind, and the upstream received no request

### Requirement: Explain alerts
`POST /api/ai/explain` with an admission id SHALL make exactly one Spark request whose input contains the alerts and totals but not the patient's name, and return its text; an admission with no alerts SHALL get HTTP 409 `no_alerts` with no request, and an unknown admission HTTP 404 `not_found`.

#### Scenario: Explanation
- **WHEN** bed 1 has an overload alert and the explanation is requested
- **THEN** the response is 200 with the model's text, the upstream received exactly one request, and that request does not contain the patient's name

#### Scenario: Nothing to explain
- **WHEN** bed 2 has no alerts and the explanation is requested
- **THEN** the response is 409 with `error: no_alerts` and the upstream received no request
