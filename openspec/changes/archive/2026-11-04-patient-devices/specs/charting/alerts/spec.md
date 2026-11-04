## MODIFIED Requirements

### Requirement: Low urine output
An admission with a weight SHALL carry `low_urine_output` when its approved urine output over `(to − 6 h, to]`, in whole mL, is below 0.5 mL/kg/h and it was admitted at least 6 h before `to`. `to` is now, or the newest urine-bag reading's time while under twice the reading interval old, with no pending or approved urine entry not charted from a bag reading after it. A bag entry counts spread evenly from the bag reading before it at save to its own, or whole at its reading when there is none.

#### Scenario: 60 kg patient, 120 mL in 6 h
- **WHEN** a 60 kg patient admitted 2 days ago has 120 mL of approved urine in the last 6 hours (threshold 180 mL)
- **THEN** the admission's alerts include `low_urine_output`

#### Scenario: Enough output
- **WHEN** the same patient has 200 mL of approved urine in the last 6 hours
- **THEN** there is no `low_urine_output` alert

#### Scenario: Window edges
- **WHEN** a 60 kg patient admitted 2 days ago, with no bag reading, has approved urinal entries of 100 mL at 04:00 and 100 mL at 09:00
- **THEN** at 09:59 there is no `low_urine_output`, as both count
- **AND** at 10:00 the alerts include it with the message `Urine output 100 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`, as the 04:00 entry is no longer inside `(04:00, 10:00]`

#### Scenario: Window ends at the newest bag reading
- **WHEN** a 60 kg patient on 3A bed 3 (reading interval 4 h), admitted 2 days ago, has a urine bag changed at 0 mL at 00:00 and emptied at 320 mL at 08:00, that entry approved, and no reading since
- **THEN** at 14:00 and at 15:59 there is no `low_urine_output`, as the 6 hours to 08:00 hold 240 mL of the emptying
- **AND** at 16:00, twice the interval after 08:00, the alerts include it with the message `Urine output 0 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`
- **AND** the upstream received no request

#### Scenario: Spread from the reading before
- **WHEN** that bag is emptied at 200 mL at 08:00 instead, approved, and the alerts are read at 09:00
- **THEN** they include `low_urine_output` with the message `Urine output 150 mL in the 6 h to the 08:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`, counting 6 of the emptying's 8 hours

#### Scenario: Rounded to whole mL
- **WHEN** that bag is emptied at 239 mL at 08:00 on one bed and at 240 mL on another, both approved, and the alerts are read at 09:00
- **THEN** the first has `low_urine_output` with `Urine output 179 mL in the 6 h to the 08:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`
- **AND** the second, counting 180 mL, has none

#### Scenario: HDU hourly
- **WHEN** a 66 kg patient on HDU bed 1 (reading interval 1 h), admitted 2 days ago, has a urine bag changed at 0 mL at 03:00 and checked every hour from 04:00 to 09:00, each check rising 40 mL and approved
- **THEN** at 10:59 there is no `low_urine_output`, as the 6 hours to 09:00 hold 240 mL against a 198 mL threshold
- **AND** at 11:00 the alerts include it with the message `Urine output 160 mL in 6 h, below 198 mL (0.5 mL/kg/h at 66 kg). Review.`

#### Scenario: Admitted 6 hours before the window's end
- **WHEN** a 60 kg patient on 3A bed 3 admitted at 03:00 has a urine bag changed at 0 mL at 03:00 and emptied at 100 mL at 07:00, approved, and no reading since
- **THEN** at 10:00 and at 14:59 there is no `low_urine_output`, as 07:00 is only 4 hours after admission
- **AND** at 15:00 the alerts include it with the message `Urine output 0 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`

#### Scenario: Urinal after the bag
- **WHEN** a 60 kg patient admitted 2 days ago has a urine bag changed at 0 mL at 00:00 and emptied at 320 mL at 08:00, approved, its catheter is then removed, and an approved 50 mL urinal entry is charted at 11:00
- **THEN** at 12:00 the alerts include `low_urine_output` with the message `Urine output 130 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`: 80 mL of the emptying and the 50 mL urinal entry

#### Scenario: First reading counted whole
- **WHEN** a 60 kg patient on 3A bed 3, admitted 2 days ago, has a first urine-bag reading, a check at 300 mL at 03:00, approved, and no reading since
- **THEN** at 08:59 there is no `low_urine_output`, as the 300 mL counts whole at 03:00, inside the 6 h to 03:00
- **AND** after a check at 330 mL at 09:00, approved, the alerts at 10:00 include it with the message `Urine output 30 mL in the 6 h to the 09:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`, as the first reading counts at 03:00 only, outside `(03:00, 09:00]`

#### Scenario: Charted 25 hours before
- **WHEN** a 60 kg patient on 3A bed 3, admitted 3 days ago, has a catheter order with `measure_every_h: 12`, and its urine bag was changed at 0 mL at 01:00 on 2 Nov, emptied at 240 mL at 13:00 on 2 Nov and checked at 100 mL at 18:00 on 2 Nov, both entries approved, with no reading since
- **THEN** at 14:00 on 3 Nov, 20 hours after the newest reading, the alerts include `low_urine_output` with the message `Urine output 120 mL in the 6 h to the 2 Nov 18:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`
- **AND** the 120 mL is 20 mL of the 13:00 emptying, charted 25 hours before, and the 18:00 check's 100 mL
- **AND** the upstream received no request

#### Scenario: Commode and bedpan entries count
- **WHEN** a 60 kg patient admitted 2 days ago, with a `{ method: "commode" }` voiding order, has approved urine entries with `item` `commode pan` of 120 mL at 06:00 and `bedpan` of 80 mL at 09:00, and the alerts are read at 10:00
- **THEN** there is no `low_urine_output`, as the 6 h hold 200 mL against a 180 mL threshold

### Requirement: Fluid overload
An admission whose approved 24-hour balance exceeds +1500 mL SHALL carry an `overload` alert, unless its urine is not measured ("Urine not measured").

#### Scenario: Positive balance
- **WHEN** approved intake is 2500 mL and output 800 mL in 24 hours
- **THEN** the alerts include `overload`

#### Scenario: Toilet bed drinking well
- **WHEN** 3A bed 7 has a `{ method: "toilet" }` voiding order and no catheter, 2400 mL of approved intake and no output in 24 hours
- **THEN** the alerts do not include `overload`
- **AND** with a `{ method: "commode" }` order instead, they include it

## ADDED Requirements

### Requirement: Urine not measured
While an admission's `devices.urine_measured` is false (charting/care-plan "Output devices on chart reads": a `toilet` or `pads` voiding order and no active catheter), it SHALL NOT carry `low_urine_output` or `overload`, whatever "Low urine output" and "Fluid overload" would give, so it carries neither `mismatch` nor `intake_incomplete`. Its other prompts are worked out as usual. Once urine is measured, both are worked out at once from the approved entries. It makes no model request.

#### Scenario: Toilet, not measured
- **WHEN** a 60 kg patient on 3A bed 7, admitted 2 days ago, has a `{ method: "toilet" }` voiding order, no catheter and no urine charted in the last 6 hours, and has 1600 mL of approved intake in the last 24 hours
- **THEN** the alerts include none of `low_urine_output`, `mismatch` and `intake_incomplete`
- **AND** the same holds with a `{ method: "pads" }` order instead
- **AND** the upstream received no request

#### Scenario: Measured again
- **WHEN** that bed's voiding order is changed to `{ method: "commode" }` at 10:00, and the alerts are read at 10:01
- **THEN** they include `low_urine_output` with the message `Urine output 0 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`

#### Scenario: Catheter on a toilet bed
- **WHEN** a catheter order is set on that bed while its `toilet` order stays active
- **THEN** its `devices.urine_measured` is true, and `low_urine_output` is worked out from its urine as for any catheterised bed
