## Purpose
The nurse's ward dashboard and per-bed approval queue, so pending entries get reviewed quickly and alerts are seen.

## ADDED Requirements

### Requirement: Beds needing attention first
The ward dashboard SHALL list beds with alerts first (most alerts first), then beds with pending entries, then the rest, each group in bed order.

#### Scenario: Mixed ward
- **WHEN** bed 3 has 2 alerts, bed 5 has 1 alert, bed 2 has 4 pending entries and beds 1, 4, 6 have nothing
- **THEN** the order is 3, 5, 2, 1, 4, 6

### Requirement: Batch approve high confidence
"Approve all high-confidence" SHALL approve exactly the pending entries whose confidence is at least 0.75, one review request each, and leave the others pending.

#### Scenario: Queue of four
- **WHEN** the queue holds pending entries at confidence 0.9, 0.75, 0.6 and none (manual)
- **THEN** two review requests are sent, for the 0.9 and 0.75 entries, each with `action: approve`

### Requirement: Explain on request
The bed screen SHALL request an alert explanation only when the nurse taps Explain, and only when the bed has alerts.

#### Scenario: Tap explain
- **WHEN** a bed with alerts is opened and Explain is tapped once
- **THEN** exactly one `POST /api/ai/explain` request is made with that admission id
