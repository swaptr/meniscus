# Spec Delta

## MODIFIED Requirements

### Requirement: Tray reading
`POST /api/ai/meal` SHALL make exactly 3 upstream requests in `sam+spark` mode, unless the local budget refuses one (see "Tray segmentation degrades"), and exactly 1 in `spark` mode, each with `store: false`, never retried. With no `mode`, `MEAL_USE_SAM` picks it. Spark gets the image and a strict JSON schema. It returns the mode, reading, segmentation, draft, warnings, trace, `needs_review` and `image_sha256`, the image's SHA-256. Upstream errors map as for `/api/ai/read`. It saves nothing.

#### Scenario: Half-eaten lunch
- **WHEN** a JPEG tray photo is posted with no mode while `MEAL_USE_SAM` is true, SAM `dish` finds one dish at 211,228–271,255, SAM `food` finds food over the same area, and the model reads rice in region 1 (half eaten), dal in region 0 (all eaten) and soup 150 mL, overall half eaten, confidence 0.82, no issues
- **THEN** the response has `mode: "sam+spark"`, a draft with portion 50, items `rice, dal` and `fluid_ml: 150`, `needs_review: false`, the trace steps `sam:dish`, `sam:food`, `spark:meal`, and `image_sha256` equal to the lowercase-hex SHA-256 of the posted bytes
- **AND** the upstream received exactly 3 requests, two SAM and one Spark, each sent with `store: false`, and the Spark request asks for a strict JSON schema
- **AND** nothing is saved: the bed's meals and entries are unchanged

#### Scenario: Rate-limited tray read
- **WHEN** Spark answers 429 `rate_limit_exceeded` with `Retry-After: 12` during a tray read in `sam+spark` mode, and again during one in `spark` mode
- **THEN** both responses are 429 with header `Retry-After: 12`, `retryable: true` and `code: rate_limit_exceeded`
- **AND** the first came after exactly 3 upstream requests (two SAM, one Spark) and the second after exactly 1 (Spark)

#### Scenario: Not a meal
- **WHEN** the model reads no items with issue `not_a_meal` and confidence 0.3
- **THEN** the draft has `items: ""` and `fluid_ml: null`, and `needs_review` is true

### Requirement: Tray read fits a saved meal
The returned read SHALL be trimmed to what a saved meal accepts as evidence: at most 20 dishes (so 20 items) and 10 fluids, names cut to 80 characters, notes to 300, fluid volumes to 0–5000 mL, at most 12 dish regions, masks of at most 32 × 32 cells keeping the box's aspect, at most 6 warnings of at most 200 characters each, and the draft's items cut to 200 characters.

#### Scenario: Long read
- **WHEN** the model reads 25 dishes, each named with 90 characters
- **THEN** the reading holds 20 dishes and 20 items with 80-character names, and the draft's items are 200 characters long
- **AND** posting the meal with that read as evidence, the `media_id` of the same photo and the draft's dishes returns 201

#### Scenario: Large dish mask
- **WHEN** SAM returns a dish whose box is 120 × 90 pixels
- **THEN** its region's dish mask and food mask are each 32 × 24 cells, held in 128 base64 characters

#### Scenario: Long warning
- **WHEN** both SAM requests fail with an upstream error message of 400 characters
- **THEN** the read has exactly one warning, starting `segmentation unavailable: `, and it is 200 characters long

### Requirement: Tray upload validation
`POST /api/ai/meal` SHALL apply the photo upload rules of `POST /api/ai/read`: a missing or non-image `image`, or a `mode` other than `spark` or `sam+spark`, gets HTTP 400 `invalid_request` and makes no model request.

#### Scenario: Text file as a tray
- **WHEN** the `image` field is a `text/plain` file
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request

#### Scenario: Unknown mode
- **WHEN** a JPEG tray is posted with `mode: sam`
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request

## ADDED Requirements

### Requirement: Tray segmentation grounding
In `sam+spark` mode a tray read SHALL make exactly two SAM requests on the tray photo, concept `dish` and concept `food`, both asking for one-bit masks, then exactly one Spark request whose prompt lists each dish region as `Dish <index>: x <left>–<right>, y <top>–<bottom>, <position>, food covers <percent>%`, where `<percent>` is the coverage × 100 rounded to a whole number, halves up. If SAM `dish` finds none, the segmentation has no regions and the read warns `segmentation found no dishes`.

#### Scenario: One plate
- **WHEN** a JPEG tray photo is read in `sam+spark` mode, SAM `dish` returns one dish at 211,228–271,255 and SAM `food` returns nothing
- **THEN** the upstream receives SAM prompts `dish` and `food`, each with metadata `mask_encoding: one_bit`, then one Spark request
- **AND** the Spark prompt contains `Dish 1: x 211–271, y 228–255, centre, food covers 0%`
- **AND** the trace lists `sam:dish`, `sam:food`, `spark:meal`

#### Scenario: Rounded coverage
- **WHEN** the segmentation has region 1 with coverage 0.125 and region 2 with coverage 0.995
- **THEN** the Spark prompt says `food covers 13%` for dish 1 and `food covers 100%` for dish 2

#### Scenario: No dishes found
- **WHEN** SAM `dish` and SAM `food` both return empty output
- **THEN** the result has `segmentation: { regions: [], loose_food: null }` and the warning `segmentation found no dishes`, after exactly 3 upstream requests

### Requirement: Spark-only tray reading
A tray read in `spark` mode, or with no mode while `MEAL_USE_SAM` is false, SHALL make exactly one Spark request and no SAM request, return `segmentation: null`, and give every dish and fluid index 0 with no box or coverage.

#### Scenario: Spark mode
- **WHEN** a tray is read with `mode: spark` and the model names rice in region 2
- **THEN** the upstream received exactly 1 request, a Spark request, and the trace lists only `spark:meal`
- **AND** `segmentation` is null, and rice has index 0, box null and coverage null

#### Scenario: SAM switched off
- **WHEN** `MEAL_USE_SAM` is false, and a tray is read with no mode and then with `mode: sam+spark`
- **THEN** the first read makes exactly 1 upstream request and the second exactly 3

### Requirement: Tray segmentation degrades
When a SAM request on the tray photo fails upstream (any HTTP error, 429 included, or a network error), the read SHALL still make its one Spark request, for exactly 3 upstream requests, and return its reading with `segmentation: null` and a warning starting `segmentation unavailable`, without retrying SAM. A caller's cancellation or a refusal by the local request budget fails the read instead, and then no Spark request is made.

#### Scenario: SAM overloaded
- **WHEN** both SAM requests return HTTP 503 and the model reads rice in region 1, all eaten
- **THEN** the result has `segmentation: null`, a warning `segmentation unavailable: …`, and rice with index 0 and portion 100
- **AND** exactly 3 upstream requests were made: two SAM and one Spark

#### Scenario: SAM rate-limited upstream
- **WHEN** SAM `dish` answers HTTP 429 `rate_limit_exceeded` with `Retry-After: 12`, SAM `food` answers normally, and the model reads rice in region 1, half eaten
- **THEN** the response is 200 with `segmentation: null`, a warning `segmentation unavailable: …`, and rice with index 0 and portion 50
- **AND** exactly 3 upstream requests were made: two SAM, then one Spark

#### Scenario: Budget spent
- **WHEN** the client's hourly request budget has 1 request left and a tray is read in `sam+spark` mode
- **THEN** the response is 429 with `error: request_budget_exceeded`
- **AND** the upstream received exactly 1 request, SAM `dish`, and no Spark request

### Requirement: Dish coverage
Each dish region of a tray segmentation SHALL carry its coverage: the share of the dish's own pixels that any food mask covers, to 3 decimals. A pixel inside nested dishes belongs to the smallest. Food outside every dish counts only in `loose_food`, the share of food pixels outside every dish. Regions are numbered from 1 by box centre, left to right, then top to bottom, then larger first; at most the 12 largest are kept, and dishes under 400 px² are dropped.

#### Scenario: Half-full plate
- **WHEN** a dish mask fills 0,0–100,100 and a food mask fills 0,0–50,100
- **THEN** region 1 has coverage 0.5 and `loose_food` is 0

#### Scenario: Empty bowl
- **WHEN** a dish mask fills 0,0–100,100 and there is no food mask
- **THEN** region 1 has coverage 0 and `loose_food` is null

#### Scenario: Two foods in one bowl
- **WHEN** a dish mask fills 0,0–100,100 and two food masks fill 0,0–60,100 and 40,0–100,50
- **THEN** region 1 has coverage 0.8, counting the overlap once

#### Scenario: Food beside the plate
- **WHEN** a dish mask fills 0,0–100,100 and food masks fill 0,0–50,100 and 150,0–200,50
- **THEN** region 1 has coverage 0.5 and `loose_food` is 0.333

#### Scenario: Bowl on a plate
- **WHEN** a plate mask fills 0,0–200,200, a bowl mask fills 50,50–150,150, and a food mask fills 50,50–150,150
- **THEN** region 1, the plate, has coverage 0, and region 2, the bowl, has coverage 1

#### Scenario: One above the other
- **WHEN** SAM returns a dish filling 0,200–100,300 and then a dish filling 0,0–100,100
- **THEN** region 1 is the dish at 0,0–100,100 and region 2 the dish at 0,200–100,300

#### Scenario: Crowded tray
- **WHEN** SAM returns 15 dishes, 12 of them 100 × 100 px in a row and 3 of them 30 × 30 px
- **THEN** the segmentation has 12 regions, numbered 1 to 12 by centre from left to right, and none of the 30 × 30 dishes

#### Scenario: Crumb
- **WHEN** SAM returns one dish whose mask is 15 × 15 px
- **THEN** the segmentation has no regions

### Requirement: Dishes and fluids in the reading
The reading SHALL list each food Spark names as a dish with its region `index`, that region's box and coverage, name, `dish_kind`, portion eaten and `basis`; each fluid with its `index` and `fluid_kind`; and `items` as the dishes' names and portions. A cited region that does not exist becomes index 0 with no box or coverage, and a region cited only by fluids is a drink, not a dish.

#### Scenario: Plate and a cup of tea
- **WHEN** the segmentation has region 1, a plate at 100,80–400,480 with coverage 0.25, and region 2, a cup at 500,100–600,200 with coverage 0, and the model reads rice of kind `rice` in region 1, three quarters eaten, and tea of kind `tea` in region 2, 150 mL
- **THEN** `dishes` holds only rice: index 1, kind `rice`, portion 75, basis `model`, box 100,80–400,480 and coverage 0.25
- **AND** `fluids` is `[{ index: 2, name: "tea", fluid_kind: "tea", volume_ml: 150 }]` and `items` is `[{ name: "rice", portion: 75 }]`
- **AND** the draft has items `rice`, `fluid_ml: 150` and dishes `[{ index: 1, name: "rice", dish_kind: "rice", portion: 75 }]`

#### Scenario: Region that does not exist
- **WHEN** the segmentation has 2 regions and the model names roti in region 7
- **THEN** roti has index 0, box null and coverage null
