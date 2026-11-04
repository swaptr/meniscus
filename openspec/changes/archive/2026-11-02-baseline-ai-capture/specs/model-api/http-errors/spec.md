## Purpose
How the server reports Meta Model API failures to its own HTTP callers, so the web app can tell retryable from permanent errors.

## ADDED Requirements

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
