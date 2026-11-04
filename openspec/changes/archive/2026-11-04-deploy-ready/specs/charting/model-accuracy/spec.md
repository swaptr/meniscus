# Spec Delta

## MODIFIED Requirements

### Requirement: Model accuracy summary
`GET /api/quality/model` SHALL summarise the drafts of reads made in the last `days` (1 to `QUALITY_MAX_DAYS`, default 7) for the ward `ward=<id>`, or else the whole hospital: each read kind and mode with its outcome rates, the type, urine colour and dish kind tables, the container rows, meal and dish portion agreement, meal fluid, the volume error, the negatives, the positive drafts not kept, the top corrections and the reads with nothing drafted. It makes 0 model requests and needs a session.

#### Scenario: Window and errors
- **WHEN** it is requested with `days` 0, 31 and `x`, and with `ward=999`
- **THEN** the first three are 400 with `error: invalid_request`, and the last is 404 with `error: not_found`
- **AND** without `days`, the response has `days: 7` and `since` 7 days before now

#### Scenario: No session
- **WHEN** `GET /api/quality/model?ward=2` is sent with no session, and again signed in as Anita Thomas
- **THEN** the first is 401 with `error: sign_in_required` and the second is 200, and the upstream received no request

#### Scenario: Ward and hospital
- **WHEN** one read is linked from a 3A bed and one from a 5B bed
- **THEN** `?ward=2` (3A) counts the first only, and the request without `ward` counts both

#### Scenario: Kinds always listed
- **WHEN** the window holds only text reads
- **THEN** `kinds` still lists, in order, `photo` `sam+spark`, `photo` `spark`, `text`, `voice`, `tray` `sam+spark` and `tray` `spark`, the others with 0 drafts
- **AND** `containers` and `top_corrections` are `[]`, `dish_portion.of` and `meal_portion.of` are 0, and `meal_fluid.volume.of` is 0

#### Scenario: No names
- **WHEN** Ravi Kumar and Anita Thomas read and save drafts for 3A beds 1 and 2, including a tray lunch whose read names the dish `paneer tikka` (`curry_vegetables`), and the 3A summary is requested
- **THEN** the body has no `bed`, `patient` or `mrn` field, and contains neither staff name nor either patient's name
- **AND** the body does not contain `paneer`

#### Scenario: Rates per outcome
- **WHEN** the 3A `photo` `sam+spark` drafts end 20 accepted, 2 edited at capture, 3 corrected by a nurse and 1 rejected
- **THEN** that `kinds` row has accepted `{ n: 20, of: 26, pct: 76 }`, edited_at_capture `{ n: 2, of: 26, pct: 7 }`, corrected_by_nurse `{ n: 3, of: 26, pct: 11 }`, corrected `{ n: 5, of: 26, pct: 19 }` and rejected `{ n: 1, of: 26, pct: 3 }`
