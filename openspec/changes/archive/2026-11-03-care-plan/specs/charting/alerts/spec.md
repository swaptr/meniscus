# Spec Delta

## MODIFIED Requirements

### Requirement: Logging gap
An admission admitted at least 3 hours ago with no pending or approved intake entry in the last 3 hours SHALL carry a `logging_gap` alert, unless it has an active nil-by-mouth order (charting/care-plan).

#### Scenario: No intake since morning
- **WHEN** the last intake entry was recorded 4 hours ago
- **THEN** the alerts include `logging_gap`

#### Scenario: Nil by mouth
- **WHEN** the last intake entry was recorded 4 hours ago, and the bed has been nil by mouth since 3 hours ago
- **THEN** the alerts do not include `logging_gap`
- **AND** once nil by mouth is ended, the alerts include `logging_gap` again
