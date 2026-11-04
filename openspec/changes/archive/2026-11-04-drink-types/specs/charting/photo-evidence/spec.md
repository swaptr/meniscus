# Spec Delta

## MODIFIED Requirements

### Requirement: Read evidence stored with the entry
`POST /api/admissions/:id/entries` and `POST /api/admissions/:id/levels` SHALL accept an optional `evidence` object, stored on each entry and level created, whose `kind` matches the source: `photo`, `voice` or `text`, none for `manual`. Photo evidence holds the read mode, reading (optional `drink_name` ≤ 40 chars), segmentation, review reasons, trace and liquid colour. Note evidence holds the transcript, `draft_ml` and trace. Entry lists return it as `evidence` or null. No model request is made.

#### Scenario: Photo evidence round trip
- **WHEN** an entry with source `photo` is posted with photo evidence: mode `sam+spark`, reading 450 mL of 2000 mL, container box 100,80–400,900, liquid box 110,520–390,890, fill 0.463, colour `#d9b44a` and a trace of three calls
- **THEN** the entry list returns that same evidence on the entry and the upstream received no request

#### Scenario: Masala chai photo
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has fluid `tea` and `drink_name` `masala chai`
- **THEN** the response is 201 and the entry list returns that evidence with `drink_name: "masala chai"`, and the upstream received no request

#### Scenario: Evidence without a drink name
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has no `drink_name` field, as stored before drink kinds
- **THEN** the response is 201 and the entry list returns that evidence unchanged

#### Scenario: Drink name too long
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has a 41-character `drink_name`
- **THEN** the response is 400 with `error: invalid_request` and nothing is stored

#### Scenario: Level drop keeps evidence
- **WHEN** a water jug level of 1000 mL with photo evidence and then 600 mL with photo evidence are posted
- **THEN** the created 400 mL intake entry carries the second level's evidence
- **AND** the first level keeps its own evidence, which is returned as the entry's `levels.before.evidence`

#### Scenario: Malformed evidence
- **WHEN** an entry is posted whose evidence is any of the following:
  - of kind `photo` without `reading`;
  - has colour `red`;
  - has a transcript longer than 2000 characters;
  - is of kind `voice` on a `photo` entry;
  - is any evidence on a `manual` entry
- **THEN** each response is 400 with `error: invalid_request` and nothing is stored
