# Spec Delta

## ADDED Requirements

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
