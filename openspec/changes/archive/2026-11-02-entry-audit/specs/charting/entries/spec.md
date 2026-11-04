# Spec Delta

## MODIFIED Requirements

### Requirement: Record an entry
`POST /api/admissions/:id/entries` SHALL store a valid entry as `pending` and return it with HTTP 201, making no model request. An entry whose category does not belong to its direction, whose volume is not an integer from 1 to 5000 mL, whose `charted_at` is out of range (see Late entries) or whose `X-Staff-Id` is invalid (see Chart changes are attributed) SHALL get HTTP 400 `invalid_request`, and an unknown admission HTTP 404 `not_found`.

#### Scenario: Confirmed photo draft
- **WHEN** `{ direction: in, category: water, volume_ml: 200, item: coconut water, source: voice }` is posted for bed 1
- **THEN** the response is 201 with `status: pending`, `volume_ml: 200` and an id, and the upstream received no request

#### Scenario: Invalid entries
- **WHEN** `{ direction: in, category: urine, volume_ml: 200 }` or `{ direction: out, category: urine, volume_ml: 0 }` is posted
- **THEN** both responses are 400 with `error: invalid_request` and nothing is stored

#### Scenario: Unknown admission
- **WHEN** a valid entry is posted to admission `999`
- **THEN** the response is 404 with `error: not_found`

### Requirement: 24-hour totals
`GET /api/admissions/:id/entries` SHALL return the admission's entries, newest charted first, and totals over entries charted in the last 24 hours. `in_ml`, `out_ml` and `balance_ml` count approved entries only, and `pending_ml` sums pending entries of both directions. An entry's charted time is its `created_at`, which for a late entry is earlier than when it was saved.

#### Scenario: Mixed entries
- **WHEN** bed 1 has approved 500 mL water in, approved 300 mL urine out, pending 200 mL tea in, rejected 900 mL water in, and approved 1000 mL water in charted 25 hours ago
- **THEN** totals are `in_ml 500`, `out_ml 300`, `balance_ml 200`, `pending_ml 200`, and the list starts with the newest entry

#### Scenario: Late entry counts by its charted time
- **WHEN** at 14:10 a 300 mL drink charted 23 hours earlier is posted and approved
- **THEN** it counts in `in_ml`, and it is listed after entries charted later even though it was saved last
