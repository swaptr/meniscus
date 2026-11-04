# Spec Delta

## MODIFIED Requirements

### Requirement: Bag periods on the chart read
`GET /api/admissions/:id/entries` SHALL return `bags`: the reading interval and, per bag, its periods with a reading charted in the last 24 hours, newest first. A period gives the emptying or bag change that opened and closed it, or null, its readings oldest first with each one's baseline, rise and entry, its total and its rate in mL/h, null when its start is unknown or it lasts under 15 minutes. The ward list carries no `bags`. It makes no model request.

#### Scenario: One period closed
- **WHEN** a bag was emptied at 600 mL at 08:00 with no reading before it, checked at 150 mL at 10:00 and at 260 mL at 11:00, and emptied at 380 mL at 12:00
- **THEN** its newest period has `start_at` 08:00, `end_at` 12:00, `closed_by: emptied`, `total_ml: 380`, `rate_ml_h: 95`, and readings at 10:00, 11:00 and 12:00 with `rise_ml` 150, 110 and 120
- **AND** the next period has `start_at: null`, `end_at` 08:00, one reading, `total_ml: 600` and `rate_ml_h: null`
- **AND** the upstream received no request

#### Scenario: Emptied early
- **WHEN** a bag emptied at 08:00 is emptied again at 220 mL at 10:30
- **THEN** that period has `total_ml: 220` and `rate_ml_h: 88`, from its own 2.5 hours

#### Scenario: Open period
- **WHEN** after the 12:00 emptying the bag is checked at 150 mL at 13:00
- **THEN** the newest period has `start_at` 12:00, `end_at: null`, `closed_by: null` and `total_ml: 150`

#### Scenario: No length
- **WHEN** a bag emptied at 08:00 is changed at 0 mL, charted at the same 08:00
- **THEN** that period has `start_at` and `end_at` 08:00, `total_ml: 0` and `rate_ml_h: null`

#### Scenario: No bag
- **WHEN** a bed has only urinal entries
- **THEN** its `bags.periods` is empty

#### Scenario: Not on the ward list
- **WHEN** 3A bed 3 has bag readings, and `GET /api/admissions?ward=<3A>` is read
- **THEN** no item in the response has a `bags` field

#### Scenario: Too short to rate
- **WHEN** a bag emptied at 08:00 is emptied at 450 mL at 08:10, then at 100 mL at 08:25
- **THEN** the 08:00 → 08:10 period has `total_ml: 450` and `rate_ml_h: null`
- **AND** the 08:10 → 08:25 period has `total_ml: 100` and `rate_ml_h: 400`
