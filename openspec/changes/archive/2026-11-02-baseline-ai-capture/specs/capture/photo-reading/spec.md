## Purpose
Turn one photo of a hospital container into a volume reading, a suggested chart entry and a review flag, using a fixed number of model requests.

## ADDED Requirements

### Requirement: Grounded reading
In `sam+spark` mode a photo read SHALL make exactly two SAM requests (one for the container, one for the liquid) and then exactly one Spark request whose prompt includes the segmentation geometry.

#### Scenario: Urine bag photo
- **WHEN** a JPEG is read with hint `urine_bag` in `sam+spark` mode
- **THEN** the upstream receives SAM prompts `urine bag` and `liquid` and one Spark request, the Spark prompt contains `Segmentation: container spans`, and the result trace lists `sam:container`, `sam:liquid`, `spark:read`

### Requirement: Spark-only reading
In `spark` mode a photo read SHALL make exactly one Spark request and no SAM requests.

#### Scenario: Spark mode
- **WHEN** a JPEG is read in `spark` mode
- **THEN** exactly one upstream request is made and it is a Spark request

### Requirement: Segmentation failure degrades
When a SAM request fails, the read SHALL still return the Spark reading with `segmentation` null and a warning starting `segmentation unavailable`, without retrying SAM.

#### Scenario: SAM overloaded
- **WHEN** both SAM requests return HTTP 503 and Spark reads 1000 mL
- **THEN** the result has `segmentation: null`, warning `segmentation unavailable: …`, volume 1000, and exactly two SAM requests were made

### Requirement: Empty segmentation warns
When SAM finds no container or no liquid, the result SHALL carry the warnings `segmentation found no container` and `segmentation found no liquid` respectively.

#### Scenario: Nothing segmented
- **WHEN** both SAM requests return empty output
- **THEN** the first two warnings are `segmentation found no container` and `segmentation found no liquid`

### Requirement: Draft entry from reading
A reading SHALL map to a draft entry whose category comes from the liquid (falling back to the container type), with `out` direction for urine, stoma, drain and vomit, `in` otherwise, and no draft when neither identifies a category.

#### Scenario: Urine bag
- **WHEN** the reading is container `urine_bag`, fluid `urine`, 450 mL, appearance `pale yellow, clear`
- **THEN** the draft is `{direction: out, category: urine, volume_ml: 450, item: "urine bag", notes: "pale yellow, clear"}`

#### Scenario: Tea in a cup
- **WHEN** the reading is container `cup`, fluid `tea`
- **THEN** the draft direction is `in`

#### Scenario: Unknown liquid in a stoma bag
- **WHEN** the reading is container `stoma_bag`, fluid `other`
- **THEN** the draft category is `stoma`

#### Scenario: Nothing chartable
- **WHEN** the reading is container `none`, fluid `none`
- **THEN** there is no draft

### Requirement: Review gate
A reading SHALL be flagged `needs_review` when its volume is null, its confidence is below 0.75, no graduation marks are visible, or the segmentation fill fraction differs from volume/capacity by more than 0.3.

#### Scenario: Confident and consistent
- **WHEN** volume 1000 of capacity 2000, confidence 0.9, marks visible, segmentation fill 0.55
- **THEN** there are no review reasons

#### Scenario: Each trigger alone
- **WHEN** confidence is 0.5, or marks are not visible, or volume is null, or volume 1800 of 2000 with segmentation fill 0.2
- **THEN** each case yields exactly one review reason

### Requirement: Fill fraction from segmentation
The segmentation SHALL pick the liquid whose centre lies inside the chosen container and report fill fraction as liquid height over container height, or null when either is missing.

#### Scenario: Half-full jug with liquid elsewhere in the frame
- **WHEN** the container spans y 0–200, a 0.8-confidence liquid spans y 100–200 inside it, and a 0.99-confidence liquid lies outside it
- **THEN** the inside liquid is chosen and the fill fraction is 0.5

#### Scenario: Nothing found
- **WHEN** SAM finds no container and no liquid
- **THEN** container, fluid and fill fraction are all null

### Requirement: Upload validation
`POST /api/ai/read` SHALL reject a non-image upload with HTTP 400 `invalid_request` and make no model request.

#### Scenario: Text file uploaded
- **WHEN** the `image` field is a `text/plain` file
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request
