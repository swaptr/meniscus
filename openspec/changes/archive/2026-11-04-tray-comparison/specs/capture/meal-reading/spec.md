# Spec Delta

## MODIFIED Requirements

### Requirement: Tray reading
`POST /api/ai/meal` SHALL make exactly 3 upstream requests in `sam+spark` mode, 5 with a compared served photo, and 1 in `spark` mode, each with `store: false`, never retried. With no `mode`, `MEAL_USE_SAM` picks it; the budget may pick `spark` or refuse it. Spark gets the collected image and a strict JSON schema. It returns the mode, reading, segmentation, comparison, draft, warnings, trace, `needs_review` and `image_sha256`. Upstream errors map as for `/api/ai/read`. It saves nothing.

#### Scenario: Half-eaten lunch
- **WHEN** a JPEG tray photo is posted with no mode while `MEAL_USE_SAM` is true, SAM `dish` finds one dish at 211,228–271,255, SAM `food` finds food over the same area, and the model reads rice in region 1 (half eaten), dal in region 0 (all eaten) and soup 150 mL, overall half eaten, confidence 0.82, no issues
- **THEN** the response has `mode: "sam+spark"`, a draft with portion 50, items `rice, dal` and `fluid_ml: 150`, `needs_review: false`, `comparison: null`, the trace steps `sam:dish`, `sam:food`, `spark:meal`, and `image_sha256` equal to the lowercase-hex SHA-256 of the posted bytes
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
The returned read SHALL be trimmed to what a saved meal accepts as evidence: at most 20 dishes (so 20 items) and 10 fluids, names cut to 80 characters, notes to 300, fluid volumes to 0–5000 mL, at most 12 dish regions on each photo and 12 matches, masks of at most 32 × 32 cells keeping the box's aspect, at most 6 warnings of at most 200 characters each, at most 5 trace steps, and the draft's items cut to 200 characters.

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

#### Scenario: Largest compared read
- **WHEN** a compared read of two 1000 × 800 photos finds the same 15 dish boxes, each of a different size, on each photo, and the model names 25 dishes with 90-character names in those regions
- **THEN** the segmentation and `comparison.served` each hold 12 regions, `comparison.matches` holds exactly 12, each with `distance2: 0`, the reading holds 20 dishes, and the trace has 5 steps
- **AND** posting the meal with that read as evidence, the collected photo's `media_id`, the served photo's `served_media_id` and the draft's dishes returns 201

### Requirement: Tray segmentation degrades
When a SAM request on the collected tray photo fails upstream (any HTTP error, 429 included, or a network error), the read SHALL still make its one Spark request, for exactly 3 upstream requests, and return its reading with `segmentation: null` and a warning starting `segmentation unavailable`, without retrying SAM. A caller's cancellation fails the read instead, with no Spark request. With 1 or 2 requests left it runs in `spark` mode with exactly 1; with none left it gets 429 with 0.

#### Scenario: SAM overloaded
- **WHEN** both SAM requests return HTTP 503 and the model reads rice in region 1, all eaten
- **THEN** the result has `segmentation: null`, a warning `segmentation unavailable: …`, and rice with index 0 and portion 100
- **AND** exactly 3 upstream requests were made: two SAM and one Spark

#### Scenario: SAM rate-limited upstream
- **WHEN** SAM `dish` answers HTTP 429 `rate_limit_exceeded` with `Retry-After: 12`, SAM `food` answers normally, and the model reads rice in region 1, half eaten
- **THEN** the response is 200 with `segmentation: null`, a warning `segmentation unavailable: …`, and rice with index 0 and portion 50
- **AND** exactly 3 upstream requests were made: two SAM, then one Spark

#### Scenario: One request left
- **WHEN**, with a cap of 120 and a 30 % reserve, 83 requests are in use (1 left under the routine ceiling of 84) and a tray is read in `sam+spark` mode
- **THEN** the response is 200 with `mode: "spark"`, `segmentation: null` and a warning starting `budget pressure`
- **AND** the upstream received exactly 1 request, Spark, and no SAM request

#### Scenario: Budget spent
- **WHEN** 84 of 120 requests are in use with a 30 % reserve (none left under the routine ceiling) and a tray is read in `sam+spark` mode
- **THEN** the response is 429 with `error: request_budget_exceeded` and `budget_class: "routine"`
- **AND** the upstream received no request: no SAM `dish`, no SAM `food` and no Spark request

#### Scenario: Collected SAM fails with a served photo
- **WHEN** bed 1 has the served lunch photo 41, a collected lunch tray is read for bed 1 in `sam+spark` mode, SAM `dish` on the collected photo answers HTTP 503 and SAM `food` answers normally
- **THEN** exactly 3 upstream requests were made: SAM `dish` and `food` with the collected image, then Spark, and no SAM request with the served image
- **AND** the response is 200 with `segmentation: null`, a warning starting `segmentation unavailable: `, and `comparison` with `served_media_id: 41`, `served: null` and `matches: []`

## ADDED Requirements

### Requirement: Tray reads name their bed
`POST /api/ai/meal` SHALL accept an optional `admission_id` and, only with it, an optional `meal` (`breakfast`, `lunch`, `dinner` or `snack`). An unknown admission gets 404 `not_found`, and `meal` without `admission_id` or with another value gets 400 `invalid_request`, each before any model request. Neither value is sent upstream. The bed sets the read's budget class (capture/read-budget).

#### Scenario: Unknown bed
- **WHEN** a JPEG tray photo is posted with `admission_id: 9999` and `meal: lunch`
- **THEN** the response is 404 with `error: not_found`, and the upstream received no request

#### Scenario: Meal without a bed
- **WHEN** a JPEG tray photo is posted with `meal: lunch` and no `admission_id`, and another with bed 1's `admission_id` and `meal: brunch`
- **THEN** both responses are 400 with `error: invalid_request`, and the upstream received no request

#### Scenario: Not sent upstream
- **WHEN** the same PNG tray photo is read in `sam+spark` mode once with no `admission_id` and once with bed 3's `admission_id` and `meal: lunch`, while bed 3 has no served photo
- **THEN** each read makes exactly 3 upstream requests, and each of the 3 request bodies of the second read equals the one in the same place in the first
- **AND** no request body has an `admission_id` or `meal` field, and none contains bed 3's patient name

### Requirement: Served and collected trays
With `admission_id` and `meal`, a tray read SHALL use the bed's newest photo uploaded with that `served_meal` at or after now − 4 h and linked by no record, never another bed's, and return it as `comparison` (null when none, or for the same bytes). In `sam+spark` mode, when it is comparable and the collected photo has a dish region, it makes exactly 5 requests: SAM `dish` and `food` on the collected photo, then, once both answered, on the served photo, then Spark. Otherwise 3; in `spark` mode 1.

#### Scenario: Lunch served and collected
- **WHEN** Ravi Kumar uploads a 1000 × 800 PNG for bed 1 at 12:40 with `served_meal: lunch` (media 41), and at 13:30 a 1000 × 800 PNG collected tray is read with bed 1's `admission_id`, `meal: lunch` and no mode while `MEAL_USE_SAM` is true, where SAM finds one dish at 100,80–400,480 on each photo, with coverage 0.4 on the collected photo and 0.8 on the served photo, and the model reads rice in region 1, a quarter eaten
- **THEN** the upstream received exactly 5 requests, each with `store: false`, in this order: SAM `dish` and SAM `food` with the collected image, SAM `dish` and SAM `food` with the served image, then one Spark request with the collected image only
- **AND** no SAM request with the served image was sent before both SAM requests with the collected image had answered, so at most 2 were in flight at once
- **AND** the trace steps are `sam:dish`, `sam:food`, `sam:served-dish`, `sam:served-food`, `spark:meal`
- **AND** `comparison` has `served_media_id: 41`, `served_sha256` equal to the upload's `sha256`, `served_at` 12:40 and `matches: [{ index: 1, served_index: 1, distance2: 0 }]`
- **AND** rice has portion 50, `basis: measured` and `model_portion: 25`, the reading's `items` and the draft's dishes hold rice at 50, and the draft's items are `rice`
- **AND** the Spark prompt contains `Dish 1: x 100–400, y 80–480, centre, food covers 40%, served 80%`

#### Scenario: No served photo
- **WHEN** a collected tray is read in `sam+spark` mode with bed 1's `admission_id` and `meal: lunch`, and bed 1 has no served photo
- **THEN** `comparison` is null and the upstream received exactly 3 requests

#### Scenario: Wrong time, meal or bed
- **WHEN** at 13:30 bed 1 has a served lunch photo uploaded at 09:29 and a served breakfast photo uploaded at 13:00, bed 2 has a served lunch photo uploaded at 13:00, and a collected tray is read with bed 1's `admission_id` and `meal: lunch`
- **THEN** `comparison` is null and the upstream received exactly 3 requests
- **AND** with bed 1's lunch photo uploaded at 09:30 instead, `comparison.served_media_id` is that photo's id

#### Scenario: Newest unlinked
- **WHEN** bed 1 has served lunch photos uploaded at 12:30 and 12:40, and the 12:40 one is already the served photo of a saved lunch
- **THEN** a collected lunch tray read for bed 1 returns the 12:30 photo's id as `comparison.served_media_id`

#### Scenario: Nothing found on the collected tray
- **WHEN** bed 1 has the served lunch photo 41, and SAM `dish` finds no dish on the collected photo
- **THEN** the upstream received exactly 3 requests: SAM `dish` and `food` with the collected image, then Spark
- **AND** `comparison` has `served_media_id: 41`, `served: null` and `matches: []`, and the read warns `segmentation found no dishes`

#### Scenario: Spark mode with a served photo
- **WHEN** bed 1 has the served lunch photo 41, and a collected lunch tray is read with `mode: spark`
- **THEN** the upstream received exactly 1 request, Spark
- **AND** `comparison` has `served_media_id: 41`, `served: null` and `matches: []`

### Requirement: Served photo with the same bytes
When the collected photo's SHA-256 equals the found served photo's `sha256`, the tray read SHALL compare nothing and return `comparison: null` with the warning `comparison unavailable: same photo as served`, in every mode, so the served photo is not linked. It makes exactly 3 upstream requests in `sam+spark` mode and 1 in `spark` mode, never 5, and sends no SAM request with the served image.

#### Scenario: Same photo twice
- **WHEN** bed 1's served lunch photo 41 holds the PNG bytes B, and B is read as bed 1's collected lunch tray in `sam+spark` mode with 5 requests free under its ceiling
- **THEN** the upstream received exactly 3 requests: SAM `dish` and `food` with B, then Spark
- **AND** the response has `comparison: null`, no dish with `basis: measured`, and the warning `comparison unavailable: same photo as served`
- **AND** uploading B as media 42 and posting the lunch with `media_id: 42`, that read as evidence and no `served_media_id` returns 201

#### Scenario: Same photo in Spark mode
- **WHEN** the same bytes B are read for bed 1's lunch with `mode: spark`
- **THEN** the upstream received exactly 1 request, Spark, and the response has `comparison: null` and the warning `comparison unavailable: same photo as served`

### Requirement: Served photo comparison degrades
When a SAM request on the served photo fails upstream (any HTTP error, 429 included, or a network error) or finds no dish, the read SHALL still send its Spark request, for exactly 5 upstream requests, never retried, with no matches, every dish `basis: model`, and the warning `comparison unavailable: <message>` or `comparison found no served dishes`. A caller's cancellation fails the read instead, with no Spark request.

#### Scenario: Served SAM overloaded
- **WHEN** a collected lunch tray with one dish region is read for bed 1, which has the served lunch photo 41, both SAM requests on the served photo answer HTTP 503, and the model reads rice in region 1, a quarter eaten
- **THEN** the response is 200 with `comparison.served: null`, `comparison.matches: []`, a warning starting `comparison unavailable: `, and rice with portion 25 and `basis: model`
- **AND** exactly 5 upstream requests were made: four SAM and one Spark

#### Scenario: Served tray with no dishes
- **WHEN** both SAM requests on the served photo return empty output
- **THEN** `comparison.served` is `{ regions: [], loose_food: null }`, `matches` is `[]`, and the read warns `comparison found no served dishes`, after exactly 5 upstream requests

#### Scenario: Cancelled during the served segmentation
- **WHEN** the caller cancels the read while both SAM requests on the served photo are in flight
- **THEN** the read fails, no Spark request is sent, and 4 upstream requests were started (2 answered)

### Requirement: Photo sizes needed to compare
With a served photo of other bytes, a tray read SHALL read both photos' pixel sizes from their file headers (JPEG, PNG, WebP or GIF) before any model request. When either cannot be read, a `sam+spark` read is planned and admitted as one with no served photo: exactly 3 upstream requests, no SAM request on the served photo, `comparison.served: null` and the warning `comparison unavailable: photo size unknown`, never a `budget pressure` one. A `spark` read gives no size warning.

#### Scenario: Photo size unknown
- **WHEN** the served lunch photo 41 is a JPEG with no frame header (the bytes `FF D8 FF D9`), and a 1000 × 800 PNG collected tray with one dish region is read for bed 1's lunch
- **THEN** the upstream received exactly 3 requests: SAM `dish` and `food` with the collected image, then Spark
- **AND** `comparison` has `served_media_id: 41` and `served: null`, and the read warns `comparison unavailable: photo size unknown`

#### Scenario: Size unknown and nothing on the collected tray
- **WHEN** the served lunch photo 41 is that JPEG, and SAM `dish` finds no dish on the 1000 × 800 PNG collected tray
- **THEN** the upstream received exactly 3 requests: SAM `dish` and `food` with the collected image, then Spark
- **AND** the read has exactly two warnings, `comparison unavailable: photo size unknown` and `segmentation found no dishes`

#### Scenario: Size unknown in Spark mode
- **WHEN** the served lunch photo 41 is that JPEG, and the collected lunch tray is read for bed 1 with `mode: spark`
- **THEN** the upstream received exactly 1 request, Spark
- **AND** `comparison` has `served_media_id: 41` and `served: null`, and the read has no `comparison unavailable` warning

### Requirement: Served dishes matched by place
A collected dish region SHALL match a served one only when, with box centres in thousandths of each photo's own width and height, rounded half up (box 100,80–400,480 on a 1000 × 800 photo is at 250,350), their squared distance is at most 40 000, the smaller box's share of its photo is at least half the larger's, and each is the other's strictly nearest region meeting both rules. A region matches at most once; unmatched regions are not measured.

#### Scenario: Same tray, larger photo
- **WHEN** the served photo is 1000 × 800 with region 1 at 100,80–400,480 and region 2 at 500,100–700,300, and the collected photo is 2000 × 1600 with region 1 at 240,200–840,1000 and region 2 at 1000,240–1400,640
- **THEN** `matches` is `[{ index: 1, served_index: 1, distance2: 1025 }, { index: 2, served_index: 2, distance2: 625 }]`, from the centres 270,375 and 250,350, and 600,275 and 600,250

#### Scenario: At the limit
- **WHEN** both photos are 1000 × 800, the served region is at 100,80–400,480, and the collected region is at 300,80–600,480 (centre 450,350)
- **THEN** they match with `distance2: 40000`
- **AND** with the collected region at 302,80–600,480 instead (centre 451,350, 40 401), there is no match

#### Scenario: Two bowls equally near
- **WHEN** both photos are 1000 × 800, the served bowls are at 350,350–450,450 and 550,350–650,450, and the collected bowl is at 450,350–550,450
- **THEN** `matches` is `[]`: both served bowls are 10 000 from it

#### Scenario: Different size
- **WHEN** both photos are 1000 × 800, the served region is at 100,80–400,480 (share 0.15), and the collected region is at 175,180–325,380 (share 0.0375)
- **THEN** `matches` is `[]`

#### Scenario: Two collected dishes near one served dish
- **WHEN** both photos are 1000 × 800, the served region is at 100,80–400,480, and the collected regions are 1 at 60,80–360,480 (centre 210,350) and 2 at 120,80–420,480 (centre 270,350)
- **THEN** `matches` is `[{ index: 2, served_index: 1, distance2: 400 }]`, and region 1 is not measured

### Requirement: Portion measured from the served tray
A dish SHALL get `basis: measured`, a `measure` with its matched served index and coverage, and portion 25 × q, q = ⌊(8·(S − N) + S) / (2·S)⌋ kept to 0–4, with S and N the served and collected coverages in thousandths, only when it is the one dish citing its region, that region matched, S ≥ 150 and 4·N ≤ 5·S. Any other dish keeps Spark's portion, `basis: model` and `measure: null`. Every dish keeps Spark's portion as `model_portion`.

#### Scenario: Half eaten
- **WHEN** collected region 1 has coverage 0.4 and matches served region 1 with coverage 0.8, and the model reads rice in region 1, a quarter eaten
- **THEN** rice has portion 50, `basis: measured`, `model_portion: 25` and `measure: { served_index: 1, served_coverage: 0.8 }`
- **AND** `items` holds rice at 50, and the draft's dishes hold rice at 50

#### Scenario: Halves round up
- **WHEN** a matched dish has served coverage 0.16 and collected coverage 0.14, and another has 0.8 and 0.1
- **THEN** the first has portion 25 (q = ⌊320 / 320⌋ = 1) and the second portion 100 (q = ⌊6400 / 1600⌋ = 4)

#### Scenario: Served tray nearly empty
- **WHEN** a matched dish has served coverage 0.08 and collected coverage 0.07, and the model reads it half eaten
- **THEN** it has portion 50, `basis: model` and `measure: null`

#### Scenario: More on the tray than served
- **WHEN** a matched dish has served coverage 0.4 and collected coverage 0.51, and another has 0.4 and 0.5
- **THEN** the first keeps the model's portion with `basis: model`
- **AND** the second has portion 0 and `basis: measured`

#### Scenario: Two dishes on one plate
- **WHEN** collected region 1 matches a served region, and the model reads rice and dal both in region 1
- **THEN** rice and dal each keep the model's portion with `basis: model` and `measure: null`
