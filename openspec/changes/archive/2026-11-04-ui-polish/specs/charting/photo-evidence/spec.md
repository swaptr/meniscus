# Spec Delta

## ADDED Requirements

### Requirement: Segmentation masks in stored evidence
Photo evidence posted to `POST /api/admissions/:id/entries` or `POST /api/admissions/:id/levels` SHALL accept `segmentation.container_mask` and `segmentation.fluid_mask`, each a mask of at most 32 × 32 cells whose `bits` are exactly ⌈width × height / 8⌉ bytes, or null, store them with the evidence and return them unchanged in entry lists. Evidence without them is stored and returned as before. It makes no model request.

#### Scenario: Masks round trip
- **WHEN** an entry with source `photo` is posted with photo evidence whose segmentation has a 12 × 32 `container_mask` and a 24 × 32 `fluid_mask`
- **THEN** the response is 201, the entry list returns both masks unchanged, and the upstream received no request

#### Scenario: Evidence without masks
- **WHEN** photo evidence whose segmentation has no mask fields, as stored before this change, is posted
- **THEN** the response is 201 and the entry list returns that evidence unchanged, with no mask fields added

#### Scenario: Malformed mask
- **WHEN** an entry is posted whose photo evidence has a `container_mask` of 33 × 10 cells, or a `fluid_mask` whose `bits` are not exactly ⌈width × height / 8⌉ bytes
- **THEN** each response is 400 with `error: invalid_request` and nothing is stored

### Requirement: Liquid region volume in stored evidence
Photo evidence posted to `POST /api/admissions/:id/entries` or `POST /api/admissions/:id/levels` SHALL accept `segmentation.fluid_volume_ml`, null or the evidence's own `fill_fraction` × reading `capacity_ml` rounded to the nearest 10 mL, store it with the evidence and return it unchanged in entry lists. Any other value is HTTP 400 `invalid_request`. Evidence without the field is stored and returned without it. It makes no model request.

#### Scenario: Volume round trip
- **WHEN** an entry with source `photo` is posted with photo evidence whose reading has capacity 2000 mL and whose segmentation has fill 0.463 and `fluid_volume_ml: 930`
- **THEN** the response is 201, the entry list returns `fluid_volume_ml: 930` unchanged, and the upstream received no request

#### Scenario: Null without a capacity
- **WHEN** photo evidence whose reading has `capacity_ml: null` is posted with `fluid_volume_ml: null`
- **THEN** the response is 201 and the entry list returns `fluid_volume_ml: null`

#### Scenario: Evidence without a volume
- **WHEN** photo evidence whose segmentation has no `fluid_volume_ml` field, as stored before this change, is posted
- **THEN** the response is 201 and the entry list returns that evidence with no `fluid_volume_ml` field added

#### Scenario: Volume that does not match the fill
- **WHEN** photo evidence with capacity 2000 mL and fill 0.463 is posted with `fluid_volume_ml` 920, or with 930 and `capacity_ml: null`
- **THEN** each response is 400 with `error: invalid_request` and nothing is stored
