# Spec Delta

## ADDED Requirements

### Requirement: Set a ward's default acuity
`PUT /api/wards/:id/default-acuity` with `{ level }` from a signed-in matron SHALL set the ward's `default_acuity`, record who set it and when as `default_acuity_set_by` and `default_acuity_set_at`, and return the ward. Any other role gets 403 `forbidden` before the ward or body is checked, an unknown ward 404 `not_found` and another level 400 `invalid_request`, each changing nothing. It makes no model request.

#### Scenario: Matron changes a ward
- **WHEN** at 10:00 on 3 Nov, signed in as Lakshmi Iyer (id 10, matron), `PUT /api/wards/<5B>/default-acuity` is sent with `{ level: "watch" }`
- **THEN** the response is 200 with `default_acuity: "watch"`, `default_acuity_set_by` `{ id: 10, name: "Lakshmi Iyer", role: "matron" }` and `default_acuity_set_at` 10:00
- **AND** `GET /api/wards` shows the same three values for 5B, and every 5B bed without an acuity order reads `acuity.level: "watch"` with `source: "ward"` and `interval_h: 2`
- **AND** the upstream received no request

#### Scenario: Not a matron
- **WHEN** signed in as Anita Thomas (id 4, nurse), `PUT /api/wards/<5B>/default-acuity` is sent with `{ level: "critical" }`; as the matron with `{ level: "urgent" }`; and as the matron to ward 999 with `{ level: "watch" }`
- **THEN** the responses are 403 `forbidden`, 400 `invalid_request` and 404 `not_found`
- **AND** 5B still defaults to `stable`, with `default_acuity_set_by: null` and `default_acuity_set_at: null`

### Requirement: Reading interval by acuity
Every chart read that includes `acuity` SHALL give `acuity.interval_h`, the level's interval, which the bed uses unless its catheter order sets one (charting/bag-periods "Reading interval"): 1 for `critical`, 2 for `watch` and 4 for `stable`. A suggested level never changes it. It makes no model request.

#### Scenario: Three levels
- **WHEN** HDU bed 1 (ward `critical`), 5B bed 1 (order `watch`) and 3A bed 4 (ward `stable`) are read
- **THEN** their `interval_h` are 1, 2 and 4

#### Scenario: Suggestion leaves it
- **WHEN** 3A bed 2 (ward `stable`) has `suggested: "critical"` for low urine output
- **THEN** its `interval_h` is 4

#### Scenario: Catheter sets its own
- **WHEN** 3A bed 3 has an acuity order `critical` and a catheter order with `measure_every_h: 4`, and its entries are read
- **THEN** it has `acuity.interval_h: 1`, and `bags.interval_h: 4` with `bags.interval_from: catheter`
