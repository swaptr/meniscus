# Spec Delta

## MODIFIED Requirements

### Requirement: Hourly budget checked first
The synthesis script SHALL refuse a plan whose request count exceeds the requests left this hour, exiting 2 having sent 0 requests. Requests left are, with `--yes`, what the client's budget still admits at normal priority: its hourly limit less its critical reserve, minus the requests that client sent or holds in the last hour; in a dry run, the configured hourly limit less the critical reserve. A dry run never builds the Meta client, so it needs no API key.

#### Scenario: Too big for the hour
- **WHEN** the client's budget is 3 per hour with no critical reserve and 1 request already sent, and a plan of 3 items is run with `--yes`
- **THEN** it exits 2 with `plan needs 3 requests; 2 left this hour`
- **AND** the upstream received 1 request in all, the earlier one, and 0 for the plan

#### Scenario: Reserve kept back
- **WHEN** the client's budget is 10 per hour with a 30 % critical reserve and 1 request already sent, and a plan of 7 items is run with `--yes`
- **THEN** it exits 2 with `plan needs 7 requests; 6 left this hour`
- **AND** the upstream received 1 request in all, and 0 for the plan

#### Scenario: Dry run without a key
- **WHEN** no API key is set, the configured hourly limit is 120 with a 30 % critical reserve, and a plan of 2 items is run without `--yes`
- **THEN** it prints `2 requests` and `84 left`, and exits 0
- **AND** the Meta client is never built, and the upstream received 0 requests
