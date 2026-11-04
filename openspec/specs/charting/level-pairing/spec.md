# charting/level-pairing Specification

## Purpose
Turning successive jug or bottle level readings into intake entries, so drinking between refills is charted without anyone measuring it.

## Requirements

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

### Requirement: Before and after
Every level SHALL keep its `media` and photo evidence. An intake entry created by a level drop, or an output entry charted from a bag reading, SHALL return `levels: { before, after }`, each `{ id, volume_ml, created_at, media, evidence, event, residual_ml }`, and the after level's media as its own `media`. A bag entry's `before` is the bag's previous reading at save, or null. `event` and `residual_ml` are null for jugs. Other entries SHALL return `levels: null`. It makes no model request.

#### Scenario: Jug before and after
- **WHEN** bed 1's water jug is recorded at 08:00 at 1000 mL with photo A and evidence, then at 12:00 at 600 mL with photo B and evidence
- **THEN** the 400 mL entry returns:
  - `levels.before`: 1000 mL at 08:00, with photo A and the first level's evidence
  - `levels.after`: 600 mL at 12:00, with photo B
  - `media`: photo B

#### Scenario: Bag before and after
- **WHEN** bed 1's urine bag is checked at 10:00 at 150 mL with photo A, then at 11:00 at 260 mL with photo B
- **THEN** the 110 mL urine entry returns:
  - `levels.before`: 150 mL at 10:00, `event: check`, with photo A
  - `levels.after`: 260 mL at 11:00, `event: check`, with photo B
  - `media`: photo B
- **AND** the upstream received no request

#### Scenario: First bag reading
- **WHEN** a urine bag with no earlier reading is emptied at 600 mL at 08:00 with photo C
- **THEN** its 600 mL entry returns `levels.before: null` and `levels.after` 600 mL with `event: emptied` and photo C
