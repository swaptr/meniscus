# Spec Delta

## ADDED Requirements

### Requirement: Hourly series
Each admission in `GET /api/admissions` SHALL carry `hourly.in_ml`, `hourly.out_ml` and `hourly.in_logged`, each 24 numbers for the rolling hours of the last 24 hours, oldest first. The last covers the most recent 60 minutes; an entry exactly 60 minutes old falls in the one before. `in_ml` and `out_ml` sum approved volume by charted time; `in_logged` counts intake entries that are not rejected. It SHALL make no model request.

#### Scenario: Three entries
- **WHEN** a bed has approved 300 mL water 30 minutes ago, approved 400 mL urine 5.5 hours ago, pending 200 mL tea 10 minutes ago and approved 500 mL water 25 hours ago
- **THEN** `hourly.in_ml[23]` is 300, `hourly.out_ml[18]` is 400, `hourly.in_logged[23]` is 2, every other element is 0, and the upstream received no request

#### Scenario: Bucket edge
- **WHEN** a bed has one approved 250 mL drink charted exactly 60 minutes ago and one rejected 100 mL drink 20 minutes ago
- **THEN** `hourly.in_ml[22]` is 250, `hourly.in_ml[23]` is 0, `hourly.in_logged[22]` is 1 and `hourly.in_logged[23]` is 0
