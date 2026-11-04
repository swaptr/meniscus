# Spec Delta

## MODIFIED Requirements

### Requirement: Tray reading
`POST /api/ai/meal` SHALL make exactly 3 upstream requests in `sam+spark` mode, 5 with a compared served photo, and 1 in `spark` mode, each with `store: false`, never retried. With no `mode`, `MEAL_USE_SAM` picks it; the budget may pick `spark` or refuse it. Spark gets the collected image and a strict JSON schema. It returns the mode, reading, segmentation, comparison, draft, warnings, trace, `needs_review` and `image_sha256`. Upstream errors map as for `/api/ai/read`. It saves only its read.

#### Scenario: Half-eaten lunch
- **WHEN** a JPEG tray photo is posted with no mode while `MEAL_USE_SAM` is true, SAM `dish` finds one dish at 211,228–271,255, SAM `food` finds food over the same area, and the model reads rice in region 1 (half eaten), dal in region 0 (all eaten) and soup 150 mL, overall half eaten, confidence 0.82, no issues
- **THEN** the response has `mode: "sam+spark"`, a draft with portion 50, items `rice, dal` and `fluid_ml: 150`, `needs_review: false`, `comparison: null`, the trace steps `sam:dish`, `sam:food`, `spark:meal`, and `image_sha256` equal to the lowercase-hex SHA-256 of the posted bytes
- **AND** the upstream received exactly 3 requests, two SAM and one Spark, each sent with `store: false`, and the Spark request asks for a strict JSON schema
- **AND** no meal or entry is saved: the bed's meals and entries are unchanged

#### Scenario: Rate-limited tray read
- **WHEN** Spark answers 429 `rate_limit_exceeded` with `Retry-After: 12` during a tray read in `sam+spark` mode, and again during one in `spark` mode
- **THEN** both responses are 429 with header `Retry-After: 12`, `retryable: true` and `code: rate_limit_exceeded`
- **AND** the first came after exactly 3 upstream requests (two SAM, one Spark) and the second after exactly 1 (Spark)

#### Scenario: Not a meal
- **WHEN** the model reads no items with issue `not_a_meal` and confidence 0.3
- **THEN** the draft has `items: ""` and `fluid_ml: null`, and `needs_review` is true
