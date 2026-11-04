# Spec Delta

## ADDED Requirements

### Requirement: Masks kept with the segmentation
A photo read's segmentation SHALL carry `container_mask` and `fluid_mask`: the chosen container's and liquid's SAM masks over their boxes, packed as one-bit grids of at most 32 × 32 cells keeping the box's aspect, each cell sampled at its centre, as tray masks are, or null when that element was not found. The read still makes exactly 3 upstream requests in `sam+spark` mode (2 SAM, 1 Spark) and 1 in `spark` mode, which has no segmentation.

#### Scenario: Half-filled container mask
- **WHEN** in `sam+spark` mode the chosen container's mask fills the left half of its box 0,0–200,400
- **THEN** `container_mask` is 16 × 32 cells with the left 8 cells of every row set, held in 88 base64 characters, and exactly 3 upstream requests were made

#### Scenario: No liquid
- **WHEN** SAM finds a container and no liquid
- **THEN** `fluid_mask` is null and `container_mask` is set

#### Scenario: Spark mode
- **WHEN** a JPEG is read in `spark` mode
- **THEN** exactly one upstream request is made and the result has `segmentation: null`

### Requirement: Liquid region quantity
A photo read's segmentation SHALL carry `fluid_volume_ml`, the liquid region's approximate volume: its `fill_fraction` × the reading's `capacity_ml`, rounded to the nearest 10 mL (halves up), or null when the reading has no capacity or SAM found no fill. It is computed from results the read already has, so the read still makes exactly 3 upstream requests in `sam+spark` mode and 1 in `spark` mode, which has no segmentation.

#### Scenario: Urine bag 46% full
- **WHEN** in `sam+spark` mode SAM gives fill fraction 0.463 and Spark reads a capacity of 2000 mL
- **THEN** the segmentation has `fluid_volume_ml: 930` (926 rounded to the nearest 10) and exactly 3 upstream requests were made

#### Scenario: No capacity
- **WHEN** in `sam+spark` mode SAM gives fill fraction 0.4 and the reading has `capacity_ml: null`
- **THEN** the segmentation has `fluid_volume_ml: null` and `fill_fraction: 0.4`

#### Scenario: No liquid found
- **WHEN** in `sam+spark` mode SAM finds a container and no liquid, so `fill_fraction` is null, and the capacity is 1000 mL
- **THEN** the segmentation has `fluid_volume_ml: null`

#### Scenario: Spark mode has no region quantity
- **WHEN** a JPEG is read in `spark` mode
- **THEN** exactly one upstream request is made and the result has `segmentation: null`, so there is no `fluid_volume_ml`
