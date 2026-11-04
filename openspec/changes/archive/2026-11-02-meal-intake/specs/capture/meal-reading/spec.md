# Spec Delta

## Purpose

Reading a meal tray photo into a draft food chart record: what was on the tray, how much of each item was eaten, the overall portion, and the fluids served with their volumes. One Muse Spark request per photo, never retried; the attendant confirms the draft before anything is saved.

## ADDED Requirements

### Requirement: Tray reading
`POST /api/ai/meal` with an `image` SHALL make exactly 1 upstream request: Muse Spark with the image and a strict JSON schema, `store: false`. It SHALL return the reading (items with portion eaten, overall portion, fluids with mL, confidence, issues, notes), a draft (portion, item names joined by ", ", fluids summed in mL or null), the trace and `needs_review`. Upstream errors SHALL map as for `POST /api/ai/read`. It never saves anything.

#### Scenario: Half-eaten lunch
- **WHEN** a tray photo is posted and the model reads rice (half eaten), dal (all eaten) and soup 150 mL, overall half eaten, confidence 0.82, no issues
- **THEN** the response has draft `{ portion: 50, items: "rice, dal", fluid_ml: 150 }`, `needs_review: false`, one trace step `spark:meal`, and the upstream received exactly 1 request, sent with `store: false`, and nothing is saved: the bed's meals and entries are unchanged

#### Scenario: Rate-limited tray read
- **WHEN** Spark answers 429 `rate_limit_exceeded` with `Retry-After: 12` during a tray read
- **THEN** the response is 429 with header `Retry-After: 12`, `retryable: true` and `code: rate_limit_exceeded`, after exactly 1 upstream request

#### Scenario: Not a meal
- **WHEN** the model reads no items with issue `not_a_meal` and confidence 0.3
- **THEN** the draft has `items: ""` and `fluid_ml: null`, and `needs_review` is true

### Requirement: Tray review gate
`needs_review` SHALL be true when the read's confidence is below 0.75 or it reports any issue, and false otherwise.

#### Scenario: Issue at high confidence
- **WHEN** the model reads confidence 0.9 with issue `partly_hidden`
- **THEN** `needs_review` is true

#### Scenario: At the threshold
- **WHEN** the model reads confidence 0.75 with no issues
- **THEN** `needs_review` is false

### Requirement: Tray read fits a saved meal
The returned reading SHALL be trimmed to what a saved meal accepts as evidence: at most 20 items and 10 fluids, names cut to 80 characters, notes to 300, fluid volumes to 0–5000 mL; the draft's items SHALL be cut to 200 characters.

#### Scenario: Long read
- **WHEN** the model reads 25 items, each named with 90 characters
- **THEN** the reading holds 20 items with 80-character names, the draft's items are 200 characters long, and posting the meal with that reading as evidence returns 201

### Requirement: Tray upload validation
`POST /api/ai/meal` SHALL apply the photo upload rules of `POST /api/ai/read`: a missing or non-image `image` gets HTTP 400 `invalid_request` and makes no model request.

#### Scenario: Text file as a tray
- **WHEN** the `image` field is a `text/plain` file
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request
