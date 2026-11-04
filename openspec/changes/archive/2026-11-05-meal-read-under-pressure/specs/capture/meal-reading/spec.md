## MODIFIED Requirements

### Requirement: Served and collected trays
With `admission_id` and `meal`, a tray read SHALL use the bed's newest photo uploaded with that `served_meal` at or after now − 4 h and linked by no record, never another bed's, and return it as `comparison` (null when none, or for the same bytes). Admitted for 5 by capture/read-budget, with a dish region on the collected photo, it makes exactly 5 requests: SAM `dish` and `food` on the collected photo, then, once both answered, on the served photo, then Spark. Else 3; in `spark` mode 1.

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

#### Scenario: Stable bed under pressure
- **WHEN**, with a cap of 120 and 60 requests in use, 3A bed 4 (`stable`) has a comparable served lunch photo and its collected lunch tray is read in `sam+spark` mode
- **THEN** the read makes exactly 1 request, Spark, with `mode: "spark"` and a warning starting `budget pressure`, and `comparison` names the served photo with `served: null`
