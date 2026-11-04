# capture/read-budget Specification

## Purpose
How each model action spends the hourly request budget: its class (critical or routine) from the bed's acuity, the share of the cap kept for critical beds, and admission of a whole action before it sends anything, in the read mode it can afford. Request counts per action stay fixed for the mode used.

## Requirements

### Requirement: Budget class of a model action
A model action (`POST /api/ai/read`, `/meal`, `/note`, `/voice-note` or `/explain`, or `GET /api/ai/status`) SHALL run in the `critical` budget class when its bed's acuity `level` or `suggested` is `critical`, and in the `routine` class otherwise, including when it names no bed, as a status check and a tray read without `admission_id` do. The class decides only whether the action is admitted and in which mode; it never changes what a request sends upstream.

#### Scenario: Classes at the routine ceiling
- **WHEN**, with a cap of 120, a 30 % reserve and 84 requests in use, these are sent in order, each read in `sam+spark` mode:
  - a photo read for HDU bed 1 (ward default `critical`);
  - a photo read for 3A bed 2 (`stable`, suggested `critical`);
  - a photo read for 3A bed 4 (`stable`);
  - a photo read with no `admission_id`;
  - a tray photo to `/api/ai/meal`;
  - `GET /api/ai/status`
- **THEN** the first two are each 200 with `mode: "sam+spark"`, after exactly 2 SAM requests and 1 Spark request each
- **AND** the last four are each 429 with `budget_class: "routine"`, and the upstream received no request for any of them

#### Scenario: Tray read for a critical bed
- **WHEN**, with a cap of 120, a 30 % reserve and 84 requests in use, a tray photo is posted to `/api/ai/meal` in `sam+spark` mode with HDU bed 1's `admission_id` (no served photo), and then the same photo with 3A bed 4's
- **THEN** the first is 200 with `mode: "sam+spark"` after exactly 3 upstream requests
- **AND** the second is 429 with `budget_class: "routine"`, and the upstream received no request for it

### Requirement: Critical reserve
A routine action SHALL be admitted only when the requests sent in the rolling hour, plus those held by admitted actions, plus its own stay within the hourly cap less `CRITICAL_RESERVE_PCT` (an integer 0–90, default 30) percent of it, rounded down (84 of 120 by default). A critical action may use the whole cap. Admitting or refusing an action sends no upstream request.

#### Scenario: Reserve boundary
- **WHEN**, with a cap of 120, a 30 % reserve and 82 requests in use, three text notes are posted for 3A bed 4 (`stable`), then one for HDU bed 1 (`critical`)
- **THEN** the first two are 200 with exactly 1 upstream request each
- **AND** the third is 429 with `budget_class: "routine"`, and the upstream received no request for it
- **AND** the HDU note is 200 with exactly 1 upstream request, bringing the hour to 85

#### Scenario: Cap reached for critical
- **WHEN** 119 of 120 requests are in use and a voice note, which needs 2, is posted for HDU bed 1
- **THEN** the response is 429 with `budget_class: "critical"`
- **AND** the upstream received no speech-to-text request and no Spark request

#### Scenario: Ceiling from config
- **WHEN** the server's config is read with `MODEL_API_MAX_REQUESTS_PER_HOUR` 120 and `CRITICAL_RESERVE_PCT` unset, then 0, then 90, then 95
- **THEN** the routine ceiling is 84 when unset (the default 30), 120 at 0 and 12 at 90
- **AND** 95 is rejected at startup with an error naming `CRITICAL_RESERVE_PCT`, and no upstream request is sent

### Requirement: Whole action admitted up front
Each model action SHALL be admitted or refused before its first upstream request, for all requests its mode can make: a photo or tray read 3 in `sam+spark` mode (5 with a comparable served photo: found, other bytes, sizes readable) and 1 in `spark` mode, a voice note 2, a text note 1, Explain 1, a status check 1. An admitted action is never refused part way by the local budget, and its unsent requests are returned when it ends. A refused action sends 0 and is never queued, delayed or sent later.

#### Scenario: Voice note at the edge
- **WHEN** 83 of 120 requests are in use and a voice note is posted for 3A bed 4 (`stable`, needing 2 under a routine ceiling of 84)
- **THEN** the response is 429
- **AND** the upstream received no speech-to-text request and no Spark request

#### Scenario: Too many in flight
- **WHEN** 4 requests are in flight with a concurrency limit of 4, and a text note is posted for 3A bed 4
- **THEN** the response is 429 with `limit: "concurrent"`, and the upstream received no request for it

#### Scenario: Failed segmentation keeps its read
- **WHEN** a `sam+spark` photo read for HDU bed 1 is admitted, and its container SAM request answers HTTP 500
- **THEN** its liquid SAM request and its Spark request are still sent, exactly 3 upstream requests in all
- **AND** the response is 200 with `segmentation: null` and a warning starting `segmentation unavailable`

#### Scenario: Unsent requests returned
- **WHEN**, with 10 of 120 requests in use, a voice note for HDU bed 1 is admitted for 2 requests and its speech-to-text request answers HTTP 503
- **THEN** the response is 503, and no Spark request is sent
- **AND** once it has returned, exactly 11 requests are in use: the hour grew by exactly 1

#### Scenario: Served tray admitted for five, sends three
- **WHEN**, with 10 of 120 requests in use, a `sam+spark` tray read for HDU bed 1, which has a served lunch photo, is admitted for 5 requests, and SAM `dish` finds no dish on the collected photo
- **THEN** exactly 3 upstream requests are sent: SAM `dish` and `food` on the collected photo, then Spark
- **AND** once it has returned, exactly 13 requests are in use: the hour grew by exactly 3

### Requirement: Read mode fits the budget
A `sam+spark` read SHALL make exactly 3 upstream requests when 3 fit under its class's hourly ceiling, unless "Served tray reads fit the budget" or "Reads under budget pressure" applies; else, when 1 fits, exactly 1, with `mode: "spark"` and a `budget pressure` warning; else refused with 0. A `spark` read makes exactly 1, never upgraded. Requests in flight never change the mode: a `sam+spark` read needs 2 free in-flight slots (`MODEL_API_MAX_CONCURRENT` ≥ 2), else it gets `limit: "concurrent"`.

#### Scenario: Room for three
- **WHEN**, with a cap of 120 and a 30 % reserve, 81 requests are in use and a JPEG is posted to `/api/ai/read` for 5B bed 1 (order `watch`)
- **THEN** the response has `mode: "sam+spark"`, and the upstream received exactly 2 SAM requests and 1 Spark request

#### Scenario: Room for one request only
- **WHEN** 82 requests are in use and a read is posted for 5B bed 1 (order `watch`, ceiling 84), and separately 118 are in use and a read is posted for HDU bed 1 (`critical`, ceiling 120)
- **THEN** each read makes exactly 1 Spark request and no SAM request
- **AND** each response has `mode: "spark"` and a warning starting `budget pressure`

#### Scenario: Spark requested
- **WHEN** no requests are in use and a read for HDU bed 1 is posted with `mode: spark`
- **THEN** it makes exactly 1 Spark request, its `mode` is `spark`, and it has no `budget pressure` warning

#### Scenario: Busy, not downgraded
- **WHEN**, with a cap of 120, a 30 % reserve, a concurrency limit of 4 and 10 requests in use, 3 of them in flight, a `sam+spark` photo read is posted for HDU bed 1
- **THEN** the response is 429 with `limit: "concurrent"`, `budget_class: "critical"` and `retry_after_ms: 5000`, not a `spark` read
- **AND** the upstream received no request for it

#### Scenario: In-flight minimum from config
- **WHEN** the server's config is read with `MODEL_API_MAX_CONCURRENT` 1, then 2, then unset
- **THEN** 1 is rejected at startup with an error naming `MODEL_API_MAX_CONCURRENT`, and no upstream request is sent
- **AND** 2 is accepted, and unset gives the default 4

### Requirement: Served tray reads fit the budget
A `sam+spark` tray read with a comparable served photo (found, other bytes, sizes readable) SHALL be admitted for 5 upstream requests when 5 fit under its class's ceiling, unless "Reads under budget pressure" applies. With 3 or 4 left it makes exactly 3, none on the served photo, warns `budget pressure: read without comparison`, and `comparison` names the served photo. A photo that is not comparable plans 3, warning only `comparison unavailable`. With fewer, "Read mode fits the budget" applies.

#### Scenario: Room for five
- **WHEN**, with a cap of 120 and a 30 % reserve, 79 requests are in use and a collected lunch tray with one dish region is read for 5B bed 1 (order `watch`), which has a served lunch photo
- **THEN** the upstream received exactly 5 requests, and the response has `mode: "sam+spark"` and no `budget pressure` warning

#### Scenario: Room for four
- **WHEN** 80 requests are in use (4 left under the routine ceiling of 84) and the same tray is read
- **THEN** the upstream received exactly 3 requests: SAM `dish` and `food` on the collected photo, then Spark
- **AND** the response has `mode: "sam+spark"`, `comparison.served: null`, every dish `basis: model`, and the warning `budget pressure: read without comparison`

#### Scenario: Room for four, photo size unknown
- **WHEN** 80 requests are in use (4 left) and the same tray is read, but its served lunch photo is a JPEG with no frame header (the bytes `FF D8 FF D9`)
- **THEN** the upstream received exactly 3 requests: SAM `dish` and `food` on the collected photo, then Spark
- **AND** the read's only warning is `comparison unavailable: photo size unknown`, with no `budget pressure` warning

#### Scenario: Room for two
- **WHEN** 82 requests are in use (2 left) and the same tray is read
- **THEN** the upstream received exactly 1 request, Spark
- **AND** the response has `mode: "spark"`, a warning starting `budget pressure`, and `comparison` naming the served photo with `served: null`

#### Scenario: None left
- **WHEN** 84 requests are in use and the same tray is read
- **THEN** the response is 429 with `error: request_budget_exceeded` and `budget_class: "routine"`, and the upstream received no request

### Requirement: Reads under budget pressure
Once `BUDGET_PRESSURE_PCT` percent of the cap (default 50) or more is in use, a `sam+spark` photo or tray read SHALL make exactly 1 upstream request, in `spark` mode with a warning starting `budget pressure`, when it names no bed or its bed's higher of set and suggested acuity is `stable`, even with a comparable served photo. A tray read's bed is its `admission_id`. Watch and critical beds keep 3, or 5 with a comparable served photo, while they fit.

#### Scenario: Stable bed under pressure
- **WHEN**, with a cap of 120, 60 requests are in use and a JPEG is posted to `/api/ai/read` for 3A bed 4 (`stable`)
- **THEN** the upstream received exactly 1 request, a Spark read, and no SAM request
- **AND** the response has `mode: "spark"` and a warning starting `budget pressure`

#### Scenario: Below the pressure point
- **WHEN** 59 requests are in use and the same read is posted
- **THEN** the upstream received exactly 2 SAM requests and 1 Spark request, and `mode` is `sam+spark`

#### Scenario: Watch and critical keep segmentation
- **WHEN** 70 requests are in use and reads are posted for 5B bed 1 (order `watch`), HDU bed 1 (`critical`) and 3A bed 2 (`stable`, suggested `critical`)
- **THEN** each read makes exactly 3 upstream requests with `mode: "sam+spark"`

#### Scenario: Trays under pressure
- **WHEN**, with a cap of 120 and 60 requests in use, collected tray photos are posted to `/api/ai/meal` in `sam+spark` mode with no `admission_id`, with 3A bed 4's (`stable`) and with HDU bed 1's (`critical`), none of them with a served photo, and then, with 59 in use, one more with no `admission_id`
- **THEN** the first two each make exactly 1 Spark request and no SAM request, with `mode: "spark"` and a `budget pressure` warning
- **AND** HDU bed 1's and the last each make exactly 2 SAM requests and 1 Spark request, with `mode: "sam+spark"`

#### Scenario: Served tray under pressure
- **WHEN**, with a cap of 120 and 60 requests in use, a collected lunch tray is read in `sam+spark` mode for 3A bed 4 (`stable`) and for HDU bed 1 (`critical`), each of which has a comparable served lunch photo
- **THEN** 3A bed 4's read makes exactly 1 request, Spark, with `mode: "spark"`, a warning starting `budget pressure` and `comparison` naming its served photo with `served: null`
- **AND** HDU bed 1's read makes exactly 5 requests, with `mode: "sam+spark"` and no `budget pressure` warning

#### Scenario: Pressure, not concurrency
- **WHEN**, with a cap of 120, a concurrency limit of 4 and 60 requests in use, 3 of them in flight, a `sam+spark` photo read is posted for 3A bed 4 (`stable`)
- **THEN** it makes exactly 1 Spark request, with `mode: "spark"` and a `budget pressure` warning, and no `limit: "concurrent"`
