# Spec Delta

## MODIFIED Requirements

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
A `sam+spark` read, requested or by default, SHALL make exactly 3 upstream requests when 3 fit under its class's hourly ceiling, unless "Served tray reads fit the budget" applies; else, when 1 fits, exactly 1, with `mode: "spark"` and a `budget pressure` warning; else it is refused with 0. A `spark` read makes exactly 1, never upgraded. Requests in flight never change the mode: a `sam+spark` read needs 2 free in-flight slots (`MODEL_API_MAX_CONCURRENT` ≥ 2), else it gets `limit: "concurrent"`.

#### Scenario: Room for three
- **WHEN**, with a cap of 120 and a 30 % reserve, 81 requests are in use and a JPEG is posted to `/api/ai/read` for 3A bed 4 (`stable`)
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

## ADDED Requirements

### Requirement: Served tray reads fit the budget
A `sam+spark` tray read with a comparable served photo (found, not the tray's bytes, both sizes readable) SHALL be admitted for 5 upstream requests when 5 fit under its class's hourly ceiling. With 3 or 4 left it makes exactly 3, none on the served photo, warns `budget pressure: read without comparison`, and its `comparison` names the served photo. A photo that is not comparable plans 3 and gives only its own `comparison unavailable` warning. With fewer, "Read mode fits the budget" applies.

#### Scenario: Room for five
- **WHEN**, with a cap of 120 and a 30 % reserve, 79 requests are in use and a collected lunch tray with one dish region is read for 3A bed 4 (`stable`), which has a served lunch photo
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
