# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
