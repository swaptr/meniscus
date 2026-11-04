# Spec Delta

## MODIFIED Requirements

### Requirement: Demo hospital
When the store has no admissions, the server SHALL seed the fictional hospital "Meniscus Demo Hospital" with wards 2C (capacity 6, 5 admissions), 3A (8, 7), 5B (6, 6) and HDU (4, 3). Each admission SHALL have a fictional patient, a weight, a distinct MRN, a distinct bed QR token of at least 22 characters, and an admission time equal to the moment of seeding. Seeding SHALL make no model request.

#### Scenario: Fresh store
- **WHEN** `GET /api/wards` and `GET /api/admissions` are called on an empty store
- **THEN** both responses are 200. The hospital is `Meniscus Demo Hospital` and the wards come in the order `2C`, `3A`, `5B`, `HDU`, with capacities 6, 8, 6, 4 and occupied 5, 7, 6, 3. There are 21 admissions with 21 distinct `qr_token` and 21 distinct `mrn` values, every `pending` count is 0, and the upstream received no request

#### Scenario: Seeding happens once
- **WHEN** the server is stopped and started again on the same database
- **THEN** there are still 21 admissions with the same tokens
