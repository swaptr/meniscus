# Spec Delta

## ADDED Requirements

### Requirement: Queued round readings
When a round reading's read answers 202, the round SHALL mark the reading `Queued · about <HH:MM>`, go on to read the next reading, leave it out of "Save all high-confidence", and never send it again, because the server saves it. The round sends `Prefer: respond-async` and the bed's `admission_id` with each read.

#### Scenario: One of three queued
- **WHEN** three photos are read in a round, and the second read answers 202 with `eta` 11:00
- **THEN** exactly three read requests are sent, in order, each with `Prefer: respond-async`
- **AND** the second reading shows `Queued · about 11:00`
- **AND** "Save all high-confidence" sends no save request for the second reading, and no further `/api/ai` request is sent for it
