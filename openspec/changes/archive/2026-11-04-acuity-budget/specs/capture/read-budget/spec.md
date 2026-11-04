# Spec Delta

## Purpose

How each model action spends the hourly request budget: its class (critical or routine) from the bed's acuity, the share of the cap kept for critical beds, and admission of a whole action before it sends anything, in the read mode it can afford. Request counts per action stay fixed for the mode used.

## ADDED Requirements

### Requirement: Budget class of a model action
A model action (`POST /api/ai/read`, `/meal`, `/note`, `/voice-note` or `/explain`, or `GET /api/ai/status`) SHALL run in the `critical` budget class when its bed's acuity `level` or `suggested` is `critical`, and in the `routine` class otherwise, including when it names no bed, as every tray read and status check does. The class decides only whether the action is admitted and in which mode; it never changes what a request sends upstream.

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
Each model action SHALL be admitted or refused before its first upstream request, for every request its mode can make: a photo or tray read 3 in `sam+spark` mode and 1 in `spark` mode, a voice note 2, a text note 1, Explain 1, a status check 1. An admitted action is never refused part way by the local budget, and requests it does not send are returned when it ends. A refused action sends 0 and is never queued, delayed or sent later.

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

### Requirement: Read mode fits the budget
A photo or tray read in `sam+spark` mode, requested or by default, SHALL make exactly 3 upstream requests when 3 fit under its class's hourly ceiling; else, when 1 fits, exactly 1, with `mode: "spark"` and a warning starting `budget pressure`; else it is refused with 0. A `spark` read makes exactly 1 and is never upgraded. Requests in flight never change the mode: a `sam+spark` read needs 2 free in-flight slots (`MODEL_API_MAX_CONCURRENT` ≥ 2), else it is refused with `limit: "concurrent"`.

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
