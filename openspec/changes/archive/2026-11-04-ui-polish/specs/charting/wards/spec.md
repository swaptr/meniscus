# Spec Delta

## MODIFIED Requirements

### Requirement: Ward summary
`GET /api/wards` SHALL return per ward its `id`, `code`, `name`, `specialty`, `capacity`, `occupied` beds, `pending` (its admissions' 24-hour `pending`, summed), `beds_with_alerts` (beds with a review prompt), `worst_tone` (`danger`, `warn`, `info` or null: its beds' worst open prompt as web/ward colours it), `last_entry_at` (newest entry of any status in 24 hours, or null) and `hourly` (`in_ml`, `out_ml`: 24 rolling hours, oldest first, summed over admissions). It makes no model request.

#### Scenario: Pending entry on 5B
- **WHEN** a 200 mL water entry is posted for ward 5B bed 1 on a fresh store
- **THEN** ward 5B shows `pending: 1` and `last_entry_at` equal to the entry's `created_at`, and every other ward shows `pending: 0` and `last_entry_at: null`

#### Scenario: Bed with a prompt
- **WHEN** ward 5B bed 2 has an approved 2000 mL IV entry and nothing else
- **THEN** ward 5B shows `beds_with_alerts: 1` and every other ward shows 0

#### Scenario: Worst prompt tone
- **WHEN** ward 5B bed 2 has an approved 2000 mL IV entry (`overload`, amber) and nothing else
- **THEN** ward 5B shows `worst_tone: "warn"` and every other ward `worst_tone: null`
- **AND** once 5B bed 3, on a nil by mouth order, has an approved 100 mL water (`nil_by_mouth_intake`, red), ward 5B shows `worst_tone: "danger"`

#### Scenario: Hourly sums
- **WHEN** 5B bed 1 has an approved 200 mL water and 5B bed 2 an approved 300 mL urine, both charted in the newest hour
- **THEN** ward 5B's `hourly.in_ml[23]` is 200 and `hourly.out_ml[23]` is 300, every other ward's 24 values are 0, and the upstream received no request
