# Spec Delta

## MODIFIED Requirements

### Requirement: Request budget
The client SHALL admit an action of one or more requests only if all of them fit, holding them until it ends, and otherwise refuse it up front with a retryable `MetaBudgetError` carrying `limit` and `retryAfterMs`, sending nothing. Requests sent in the rolling hour plus those held stay within the action's priority ceiling (the cap for `high`, the cap less `reservePct` percent for `normal`), and in-flight requests within their limit. Unsent requests are returned.

#### Scenario: Hourly cap of 2
- **WHEN** three requests are made with a cap of 2 per hour
- **THEN** the third fails with limit `hourly` and only two requests were sent

#### Scenario: One in flight
- **WHEN** a second request starts while one is in flight with a concurrency cap of 1
- **THEN** it fails with `MetaBudgetError`, and after the first settles a new request succeeds

#### Scenario: Window rolls
- **WHEN** the hourly cap of 1 is used and 3,600,001 ms pass
- **THEN** a new request is allowed

#### Scenario: Whole action or nothing
- **WHEN**, with a cap of 10 and 8 requests sent, a `normal` action of 3 requests is reserved
- **THEN** it fails with limit `hourly` and no request is sent
- **AND** a `normal` action of 2 is then admitted, and its 2 requests are sent without a budget error

#### Scenario: Reserve for high priority
- **WHEN**, with a cap of 10, `reservePct` 30 and 7 requests sent, a `normal` action of 1 and a `high` action of 3 are reserved
- **THEN** the `normal` action fails with limit `hourly`, and the `high` action is admitted

#### Scenario: Retry time
- **WHEN**, with a cap of 2, requests were sent at 10:00:00 and 10:20:00, and a `normal` action of 1 is reserved at 10:40:00
- **THEN** it fails with `retryAfterMs` 1,200,000, the time until the 10:00:00 request leaves the hour, and `retryable` true

#### Scenario: Retry time when the excess is held
- **WHEN**, with a cap of 2 and no request sent in the hour, a `normal` action of 2 is admitted and has sent nothing yet, and a `normal` action of 1 is reserved
- **THEN** the second fails with limit `hourly`, `retryAfterMs` 60,000 and `retryable` true, and no request is sent

#### Scenario: Retry time when the action exceeds its ceiling
- **WHEN**, with a cap of 10, `reservePct` 30 and no request sent in the hour, a `normal` action of 8 is reserved, its ceiling being 7
- **THEN** it fails with limit `hourly`, `retryAfterMs` 3,600,000 and `retryable` true, and no request is sent
- **AND** a `high` action of 8 is then admitted

#### Scenario: Unsent requests returned
- **WHEN**, with a cap of 4, an action of 3 is admitted, sends 1 request and ends
- **THEN** a second action of 3 is admitted at once, after which an action of 1 fails with limit `hourly`
