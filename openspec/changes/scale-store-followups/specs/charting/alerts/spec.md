# Spec Delta

## MODIFIED Requirements

### Requirement: Alerts on chart reads
`GET /api/admissions` and `GET /api/admissions/:id/entries` SHALL include each admission's current alerts, computed without any model request. Only `GET /api/admissions` and `GET /api/wards` may reuse a bed's alerts, care, acuity and nutrition, computed together at most 30 s earlier, unless the bed or its ward was written since; every other read, Explain and the budget class compute them when called. A prompt due with no write shows there within 30 s, on a polling dashboard within 60 s.

#### Scenario: Ward list
- **WHEN** bed 1 meets the overload rule and the ward is listed
- **THEN** bed 1 has an `overload` alert, the other beds have none of that kind, and the upstream received no request

#### Scenario: Reuse equals computing afresh
- **WHEN** a store seeded with 100 fictional beds and 3 days of entries, meals, care orders, urine-bag readings and dietitian assignments is listed ward by ward with `GET /api/admissions?ward=<id>` at 10:00:00, and every bed's alerts, care, acuity and nutrition are then computed afresh at 10:00:00
- **THEN** both are equal for every bed
- **AND** a second listing at 10:00:20 returns the same values

#### Scenario: A write drops the reuse
- **WHEN** 3A bed 4's ward is listed at 10:00:00 with no `overload` alert, at 10:00:05 an 1,800 mL IV entry that takes its 24 h balance over +1,500 mL is approved, at 10:00:07 a nurse sets a 1,000 mL fluid limit on 3A bed 5, and at 10:00:09 the matron sets 3A's default acuity to `watch`
- **THEN** the listing at 10:00:06 shows `overload` on 3A bed 4, and `GET /api/wards` counts the bed in `beds_with_alerts`
- **AND** the listing at 10:00:08 shows 3A bed 5's fluid limit in `care.orders`, its `care.fluid_limit` progress and every prompt it raises, all from the same computation
- **AND** the listing at 10:00:10 shows every 3A bed without an acuity order at `acuity.level: "watch"` and `acuity.interval_h: 2`

#### Scenario: Time-only change within the bound
- **WHEN** 3A bed 5's newest intake was charted at 09:00, nothing is written to the bed afterwards, and its ward is listed every 10 seconds from 11:59:50 to 12:01:00
- **THEN** every listing from 12:00:31 on has `logging_gap` on that bed
- **AND** `GET /api/admissions/<3A bed 5>/entries` at 12:00:01 already has it

#### Scenario: Bag window ends with no write
- **WHEN** a 60 kg patient on 3A bed 3 (reading interval 4 h), admitted 2 days ago, has a urine bag changed at 0 mL at 00:00 and emptied at 320 mL at 08:00, that entry approved, nothing is written to the bed afterwards, and its ward is listed every 10 seconds from 15:59:50 to 16:01:00
- **THEN** every listing from 16:00:31 on has `low_urine_output` on that bed
- **AND** `GET /api/admissions/<3A bed 3>/entries` at 16:00:01 already has it
