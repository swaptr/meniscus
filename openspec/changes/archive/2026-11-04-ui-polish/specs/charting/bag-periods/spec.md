# Spec Delta

## ADDED Requirements

### Requirement: Bag levels on the bed list
Each item of `GET /api/admissions` SHALL carry `bag_levels`: one per bag container with a reading charted in the last 24 hours, in `urine_bag`, `stoma_bag`, `drain_bag` order, holding `container`, `level_ml` (the newest reading's level: a check's volume, an emptying's residual or 0, 0 after a bag change), `capacity_ml`, `read_at` and `due_at` (when "Urine bag reading due" would raise `bag_reading_due`, or null). It makes no model request.

#### Scenario: Urine bag on a catheter
- **WHEN** 3A bed 4 has a catheter order with a 4-hour interval and its newest urine-bag reading is a check of 1680 mL at 18:20
- **THEN** its `bag_levels` is `[{ container: "urine_bag", level_ml: 1680, capacity_ml: 2000, read_at: <18:20>, due_at: <22:20> }]`

#### Scenario: Emptied and changed
- **WHEN** a bed's newest stoma-bag reading is an emptying with no residual and its newest drain-bag reading a bag change
- **THEN** its `bag_levels` holds the stoma bag at `level_ml: 0` of 500 and the drain bag at `level_ml: 0` of 1000, both with `due_at: null`

#### Scenario: No recent reading
- **WHEN** a bed's only urine-bag reading was charted 30 hours ago
- **THEN** its `bag_levels` is `[]`, and the upstream received no request
