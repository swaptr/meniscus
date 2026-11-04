# model-api/http-errors Specification

## Purpose
How the server reports Meta Model API failures to its own HTTP callers, so the web app can tell retryable from permanent errors.

## Requirements

### Requirement: Rate limits pass through
An upstream 429 SHALL be answered with HTTP 429, the upstream `Retry-After` in seconds, `retryable: true` and the upstream error code.

#### Scenario: Spark rate limited
- **WHEN** Spark answers 429 `rate_limit_exceeded` with `Retry-After: 12` during a note
- **THEN** the response is 429 with header `Retry-After: 12`, `retryable: true` and `code: rate_limit_exceeded`

### Requirement: Upstream auth is ours
An upstream 401 or 403 SHALL be answered with HTTP 502, because a bad key is the server's misconfiguration, not the caller's.

#### Scenario: Bad key
- **WHEN** Spark answers 401 `invalid_api_key`
- **THEN** the response is 502

### Requirement: Invalid model output
Model output that fails validation SHALL be answered with HTTP 502 `model_output_invalid` listing the validation issues.

#### Scenario: Unknown container
- **WHEN** Spark returns `{"container":"spaceship"}` for a photo read
- **THEN** the response is 502 with `error: model_output_invalid` and at least one issue

### Requirement: Local budget refusal
A model action refused by the local request budget SHALL get HTTP 429 before any upstream request, with:
- `error: request_budget_exceeded` and `retryable: true`;
- `limit`: `hourly` or `concurrent`;
- `budget_class`: `critical` or `routine`;
- `retry_after_ms`, which is 5000 for `concurrent`;
- a `Retry-After` header: `retry_after_ms` in whole seconds, rounded up, at least 1.

#### Scenario: Routine read refused
- **WHEN** at 10:40:00, with a cap of 120, a 30 % reserve and 84 requests in use (the oldest sent at 10:00:00), a photo read is posted for 3A bed 4 (`stable`)
- **THEN** the response is 429 with `error: "request_budget_exceeded"`, `limit: "hourly"`, `budget_class: "routine"`, `retry_after_ms: 1200000`, `retryable: true` and the header `Retry-After: 1200`
- **AND** the upstream received no request

#### Scenario: Busy rather than spent
- **WHEN** 4 requests are in flight with a concurrency limit of 4 and a voice note is posted for HDU bed 1
- **THEN** the response is 429 with `limit: "concurrent"`, `budget_class: "critical"`, `retry_after_ms: 5000` and the header `Retry-After: 5`
- **AND** the upstream received no request

### Requirement: Retry verdict passes through
A `model_api_error` response SHALL carry `retryable: true` only when the upstream answered 429, 500 or 503, with `upstream_status` set to that status; any other upstream status gives `retryable: false`. A text note still makes exactly 1 Spark request, and the server never retries it.

#### Scenario: Spark unavailable
- **WHEN** Spark answers 503 with type `server_error` during a text note
- **THEN** the response is 503 with `error: "model_api_error"`, `upstream_status: 503` and `retryable: true`
- **AND** the upstream received exactly one request

#### Scenario: Spark internal error
- **WHEN** Spark answers 500 with type `server_error` during a text note
- **THEN** the response is 502 with `error: "model_api_error"`, `upstream_status: 500` and `retryable: true`
- **AND** the upstream received exactly one request

#### Scenario: Bad gateway upstream
- **WHEN** Spark answers 502 with an empty body during a text note
- **THEN** the response is 502 with `error: "model_api_error"`, `upstream_status: 502` and `retryable: false`
- **AND** the upstream received exactly one request
