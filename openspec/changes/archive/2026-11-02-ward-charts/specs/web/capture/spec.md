# Spec Delta

## ADDED Requirements

### Requirement: Recording feedback
While a voice note is recording, the capture screen SHALL show the elapsed time against the 1:00 limit as `m:ss / 1:00` and a live input level, and a single large button SHALL stop and send. No model request SHALL be made until it is stopped.

#### Scenario: Seven seconds in
- **WHEN** a recording has run for 7.4 seconds
- **THEN** the screen shows `0:07 / 1:00` and no `/api/ai` request has been made
