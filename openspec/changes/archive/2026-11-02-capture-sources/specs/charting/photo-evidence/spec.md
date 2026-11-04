# Spec Delta

## MODIFIED Requirements

### Requirement: Rejected entries drop their photo
Rejecting an entry SHALL unlink its media and delete its evidence. The media itself SHALL be deleted once no live record links it, as in `charting/media` "Media goes with its record".

#### Scenario: Reject
- **WHEN** a pending entry with a photo and evidence is rejected
- **THEN** its photo request returns 404 and the entry shows `has_photo: false` and `evidence: null`

### Requirement: Read evidence stored with the entry
`POST /api/admissions/:id/entries` and `POST /api/admissions/:id/levels` SHALL accept an optional `evidence` object, stored with each entry and level they create. Its `kind` must match the source: `photo`, `voice` or `text`, and none for `manual`. Photo evidence holds the read mode, reading, segmentation, review reasons, trace and liquid colour. Note evidence holds the transcript, `draft_ml` and the trace. Entry lists SHALL return it as `evidence` (null if none). No model request is made.

#### Scenario: Photo evidence round trip
- **WHEN** an entry with source `photo` is posted with photo evidence: mode `sam+spark`, reading 450 mL of 2000 mL, container box 100,80–400,900, liquid box 110,520–390,890, fill 0.463, colour `#d9b44a` and a trace of three calls
- **THEN** the entry list returns that same evidence on the entry and the upstream received no request

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
