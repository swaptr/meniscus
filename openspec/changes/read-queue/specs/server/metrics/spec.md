# Spec Delta

## ADDED Requirements

### Requirement: Read queue metrics
`GET /api/metrics` SHALL return `read_queue`, with no patient data and no model request. It holds:
- the reads waiting now, by class;
- `wait_p95_ms` by class: the nearest-rank 95th percentile of the time from capture to sending, over reads sent in the last hour, or null when none was sent;
- the reads sent, expired, failed and cancelled in the last hour.

#### Scenario: Queue after a busy hour
- **WHEN**, at 11:30:00, one critical and two routine reads are waiting, and in the last hour three routine reads were sent after waiting 20, 40 and 60 s (the last then failing with HTTP 503), and one routine read expired
- **THEN** Lakshmi Iyer (id 10, matron) gets `GET /api/metrics` with `read_queue` holding:
  - `waiting: { critical: 1, routine: 2 }`;
  - `wait_p95_ms: { critical: null, routine: 60000 }`;
  - `last_hour: { sent: 3, expired: 1, failed: 1, cancelled: 0 }`
- **AND** `read_queue` holds no bed, patient, staff name, read id or note text, and the upstream received no request for the call
