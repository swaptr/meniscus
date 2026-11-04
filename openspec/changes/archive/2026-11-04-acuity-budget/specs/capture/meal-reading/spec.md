# Spec Delta

## MODIFIED Requirements

### Requirement: Tray reading
`POST /api/ai/meal` SHALL make exactly 3 upstream requests in `sam+spark` mode and exactly 1 in `spark` mode, each with `store: false`, never retried. With no `mode`, `MEAL_USE_SAM` picks it; the budget may pick `spark` or refuse it (capture/read-budget). Spark gets the image and a strict JSON schema. It returns the mode, reading, segmentation, draft, warnings, trace, `needs_review` and `image_sha256`, the image's SHA-256. Upstream errors map as for `/api/ai/read`. It saves nothing.

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

### Requirement: Tray segmentation degrades
When a SAM request on the tray photo fails upstream (any HTTP error, 429 included, or a network error), the read SHALL still make its one Spark request, for exactly 3 upstream requests, and return its reading with `segmentation: null` and a warning starting `segmentation unavailable`, without retrying SAM. A caller's cancellation fails the read instead, with no Spark request. With 1 or 2 requests left it runs in `spark` mode with exactly 1; with none left it gets 429 with 0.

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
