## Purpose
Turning successive jug or bottle level readings into intake entries, so drinking between refills is charted without anyone measuring it.

## ADDED Requirements

### Requirement: Level drop becomes intake
`POST /api/admissions/:id/levels` SHALL store the level and, when the previous level of the same container within 24 hours was higher, create a pending `in` / `water` entry for the difference and return it, making no model request.

#### Scenario: Jug drops from 1000 to 600 mL
- **WHEN** bed 1's water jug is recorded at 1000 mL and later at 600 mL
- **THEN** the second response is 201 with an entry of 400 mL `in` / `water` with status `pending`, and the upstream received no request

### Requirement: Refill resets the baseline
A first reading, or a reading at or above the previous level, SHALL be stored as the new baseline without creating an entry.

#### Scenario: First reading and refill
- **WHEN** bed 1's water jug is recorded at 600 mL for the first time, then at 1000 mL
- **THEN** both responses are 201 with `entry: null`

#### Scenario: Containers are separate
- **WHEN** the jug is at 1000 mL and a bottle is then recorded at 500 mL
- **THEN** no entry is created

### Requirement: Latest levels
`GET /api/admissions/:id/levels` SHALL return the latest level of each container recorded for the admission.

#### Scenario: Two readings
- **WHEN** the jug was recorded at 1000 mL then 600 mL
- **THEN** the response lists the jug once, at 600 mL
