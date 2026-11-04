# Spec Delta

## ADDED Requirements

### Requirement: Late entry by hand
Enter by hand SHALL ask when the intake or output happened: "Now" by default, or an earlier time of day within the last 24 hours. A time later than the current time of day means yesterday. An earlier time SHALL be sent as `charted_at`, and a time before the patient's admission SHALL be refused on the device with "Before admission"; "Now" sends none.

#### Scenario: This morning
- **WHEN** at 14:10 the attendant picks 08:00
- **THEN** the entry request has `charted_at` equal to 08:00 today, local time

#### Scenario: Last night
- **WHEN** at 07:30 the attendant picks 22:00
- **THEN** `charted_at` is 22:00 yesterday, local time

#### Scenario: Now
- **WHEN** the attendant leaves "Now"
- **THEN** the entry request has no `charted_at`

#### Scenario: Before admission
- **WHEN** at 14:10 the attendant picks 09:00 for a patient admitted at 10:00
- **THEN** saving is refused with `Before admission` and no request is sent
