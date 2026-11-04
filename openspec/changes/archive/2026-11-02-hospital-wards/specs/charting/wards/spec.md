# Spec Delta

## Purpose

The hospital's wards and their census of admitted patients, so every bed a capture can reach belongs to a named ward, as it would in the hospital's own system.

## ADDED Requirements

### Requirement: Demo hospital
When the store has no admissions, the server SHALL seed the fictional hospital "Meniscus Demo Hospital" with wards 2C (capacity 6, 5 admissions), 3A (8, 7), 5B (6, 6) and HDU (4, 3). Each admission SHALL have a fictional patient, a weight, a distinct MRN, a distinct bed QR token of at least 22 characters, and an admission time equal to the moment of seeding. Seeding SHALL make no model request.

#### Scenario: Fresh store
- **WHEN** `GET /api/wards` and `GET /api/admissions` are called on an empty store
- **THEN** both responses are 200. The hospital is `Meniscus Demo Hospital` and the wards come in the order `2C`, `3A`, `5B`, `HDU`, with capacities 6, 8, 6, 4 and occupied 5, 7, 6, 3. There are 21 admissions with 21 distinct `qr_token` and 21 distinct `mrn` values, every `pending` count is 0, and the upstream received no request

#### Scenario: Seeding happens once
- **WHEN** the store is opened a second time on the same file
- **THEN** there are still 21 admissions with the same tokens

### Requirement: Ward summary
`GET /api/wards` SHALL return, per ward, its `id`, `code`, `name`, `specialty`, `capacity`, `occupied` beds, `pending` entries of the last 24 hours (the sum of its admissions' `pending`), `beds_with_alerts` (beds with at least one review prompt) and `last_entry_at`. `last_entry_at` is the newest entry of any status in the last 24 hours, or null. The request SHALL make no model request.

#### Scenario: Pending entry on 5B
- **WHEN** a 200 mL water entry is posted for ward 5B bed 1 on a fresh store
- **THEN** ward 5B shows `pending: 1` and `last_entry_at` equal to the entry's `created_at`, and every other ward shows `pending: 0` and `last_entry_at: null`

#### Scenario: Bed with a prompt
- **WHEN** ward 5B bed 2 has an approved 2000 mL IV entry and nothing else
- **THEN** ward 5B shows `beds_with_alerts: 1` and every other ward shows 0

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

### Requirement: Pre-ward stores
A store file created before wards existed SHALL open with all its admissions in one ward, code `W1` and name "Ward 1", whose capacity equals the number of admissions. Their beds, tokens and entries SHALL be kept.

#### Scenario: Legacy file
- **WHEN** a pre-ward store file with six admissions on beds 1–6 and one 200 mL water entry for bed 1 is opened
- **THEN** `GET /api/wards` lists one ward `W1` with capacity 6 and occupied 6, the six tokens are unchanged, and bed 1's entry list still holds the 200 mL entry
