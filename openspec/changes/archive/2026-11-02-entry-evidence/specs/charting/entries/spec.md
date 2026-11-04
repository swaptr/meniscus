# Spec Delta

## ADDED Requirements

### Requirement: Recorded volume kept
Every entry SHALL carry `recorded_ml`, the volume it was saved with, which a nurse's correction on approval SHALL NOT change.

#### Scenario: Corrected on approval
- **WHEN** a pending 450 mL urine entry is approved with `volume_ml: 400`
- **THEN** the entry shows `volume_ml: 400` and `recorded_ml: 450`
