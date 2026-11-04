# Spec Delta

## MODIFIED Requirements

### Requirement: Whole action admitted up front
Each model action SHALL be admitted or refused before its first upstream request, for all requests its mode can make: a photo or tray read 3 in `sam+spark` mode (5 with a comparable served photo: found, other bytes, sizes readable) and 1 in `spark` mode, a voice note 2, a text note 1, Explain 1, a status check 1. An admitted action is never refused part way by the local budget, and its unsent requests are returned when it ends. A refused action is never sent; a queued one is admitted whole.

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

#### Scenario: Queued, then admitted whole
- **WHEN** 83 of 120 requests are in use, the oldest 2 sent at 10:00:00, and a voice note for 3A bed 4 is posted at 10:40:00 with `Prefer: respond-async`
- **THEN** the response is 202, and the upstream receives no request before 11:00:00
- **AND** at 11:00:00 it is admitted for 2 requests and sends exactly one speech-to-text request and one Spark request

### Requirement: Read mode fits the budget
A `sam+spark` read SHALL make exactly 3 upstream requests when 3 fit under its class's hourly ceiling, unless "Served tray reads fit the budget" or "Reads under budget pressure" applies; else, when 1 fits, exactly 1, with `mode: "spark"` and a `budget pressure` warning; else 0: refused or queued. A `spark` read makes exactly 1, never upgraded. Requests in flight never change the mode: a `sam+spark` read needs 2 free slots (`MODEL_API_MAX_CONCURRENT` ≥ 2), else `limit: "concurrent"` or queued.

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

#### Scenario: Busy, queued
- **WHEN** the same `sam+spark` photo read for HDU bed 1 is posted with `Prefer: respond-async` while 3 of 4 in-flight slots are taken, and one in-flight action ends 20 s later
- **THEN** the response is 202, and nothing is sent for it while only 1 slot is free
- **AND** once 2 slots are free it is sent with exactly 2 SAM requests and 1 Spark request, with `mode: "sam+spark"`
