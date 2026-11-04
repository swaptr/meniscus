# charting/wards Specification

## Purpose
The hospital's wards and their census of admitted patients, so every bed a capture can reach belongs to a named ward, as it would in the hospital's own system.

## Requirements

### Requirement: Demo hospital
When the store has no admissions, the server SHALL seed the fictional hospital "Meniscus Demo Hospital" with wards 2C (capacity 6, 5 admissions), 3A (8, 7), 5B (6, 6) and HDU (4, 3). Each admission SHALL have a fictional patient, a weight, a distinct MRN, a distinct bed QR token of at least 22 characters, and an admission time equal to the moment of seeding. Seeding SHALL make no model request.

#### Scenario: Fresh store
- **WHEN** `GET /api/wards` and `GET /api/admissions` are called on an empty store
- **THEN** both responses are 200. The hospital is `Meniscus Demo Hospital` and the wards come in the order `2C`, `3A`, `5B`, `HDU`, with capacities 6, 8, 6, 4 and occupied 5, 7, 6, 3. There are 21 admissions with 21 distinct `qr_token` and 21 distinct `mrn` values, every `pending` count is 0, and the upstream received no request

#### Scenario: Seeding happens once
- **WHEN** the server is stopped and started again on the same database
- **THEN** there are still 21 admissions with the same tokens

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

### Requirement: Admissions by ward
`GET /api/admissions?ward=<id>` SHALL return only that ward's admissions in bed-number order. Without `ward` it SHALL return every admission, ordered by ward code and then by bed number. An unknown or malformed ward id SHALL get HTTP 404 `not_found`.

#### Scenario: One ward
- **WHEN** `GET /api/admissions?ward=<id of 5B>` is called on a fresh store
- **THEN** the response is 200 with six admissions, beds `1` to `6` in order, every one with `ward_code: 5B`

#### Scenario: Whole hospital
- **WHEN** `GET /api/admissions` is called on a fresh store
- **THEN** the response is 200 with 21 admissions, the first with `ward_code: 2C` and the last with `ward_code: HDU`

#### Scenario: Unknown ward
- **WHEN** `GET /api/admissions?ward=999` or `GET /api/admissions?ward=abc` is called
- **THEN** both responses are 404 with `error: not_found`

### Requirement: Admissions carry their ward
Every admission returned by `GET /api/admissions`, `GET /api/beds/:token` and `GET /api/admissions/:id/entries` SHALL include `ward_id`, `ward_code`, `ward_name` and `mrn`.

#### Scenario: Bed lookup
- **WHEN** the token of ward 5B bed 4 is looked up
- **THEN** the response is 200 with `bed: "4"`, `ward_code: 5B`, `ward_name: Neurology Ward 5B` and a non-empty `mrn`
