## ADDED Requirements

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
