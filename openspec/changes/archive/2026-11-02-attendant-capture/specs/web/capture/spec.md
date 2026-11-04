## Purpose
The attendant's bedside screen: open a bed, capture a photo or note, confirm the draft and save it to the chart with the photo as evidence.

## ADDED Requirements

### Requirement: Photos are shrunk before upload
A captured photo SHALL be scaled so its longest side is at most 1280 px, keeping its aspect ratio and never enlarging it.

#### Scenario: Large phone photo
- **WHEN** a 4032 × 3024 photo is captured
- **THEN** it is uploaded at 1280 × 960

#### Scenario: Small photo
- **WHEN** an 800 × 600 photo is captured
- **THEN** it is uploaded at 800 × 600

### Requirement: Draft becomes an entry
A confirmed draft SHALL be saved as an entry with its direction, category, volume, item, notes, the capture source and the reading confidence; a draft without a volume SHALL NOT be saveable until a volume is entered, and +/- adjusts the volume in 10 mL steps between 1 and 5000 mL.

#### Scenario: Photo draft
- **WHEN** a photo draft of 450 mL urine at confidence 0.9 is confirmed
- **THEN** the saved entry is `out` / `urine` / 450 mL with source `photo` and confidence 0.9

#### Scenario: No volume
- **WHEN** a draft has no volume
- **THEN** it cannot be saved

#### Scenario: Adjust
- **WHEN** + is pressed on 4995 mL, or - on 5 mL
- **THEN** the volume becomes 5000 mL, or 1 mL

### Requirement: Photo saved as evidence
Saving a photo capture SHALL record the entry first and then attach the photo to it; if attaching the photo fails, the entry SHALL remain saved and the screen SHALL say the photo was not kept.

#### Scenario: Save with photo
- **WHEN** a photo draft is saved
- **THEN** exactly two requests are made, `POST /api/admissions/:id/entries` then `POST /api/entries/:id/photo`

#### Scenario: Photo upload fails
- **WHEN** the photo request fails with 500
- **THEN** the save result has the entry and a warning that the photo was not kept

### Requirement: Jug photos record levels
A photo reading of a water jug or water bottle with a volume SHALL be saved as a level reading, and the screen SHALL show the intake entry created from the drop, if any.

#### Scenario: Water jug reading
- **WHEN** a reading of container `water_jug` at 600 mL is saved
- **THEN** `POST /api/admissions/:id/levels` is called with `water_jug` and 600 mL and no entry is posted directly
