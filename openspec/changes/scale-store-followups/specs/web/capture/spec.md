# Spec Delta

## ADDED Requirements

### Requirement: Bed picker by ward
The attendant's bed list SHALL load the wards with one `GET /api/wards`, then a ward's beds with one `GET /api/admissions?ward=<id>` once that ward is picked. It never requests `GET /api/admissions` without a ward. It makes no model request.

#### Scenario: Pick a bed without a QR card
- **WHEN** an attendant opens `/a` and picks ward 3A
- **THEN** exactly two requests are sent, `GET /api/wards` then `GET /api/admissions?ward=<3A>`, and 3A's beds are listed in bed order
- **AND** no `GET /api/admissions` request without `ward` and no `/api/ai` request is sent

## MODIFIED Requirements

### Requirement: Bag photos record readings
A bag photo read with a volume SHALL be saved by one photo upload, one more for its labeled copy when segmented, then one `POST /api/admissions/:id/bag-readings` with the level, event, evidence, notes and urine colour. The check screen shows the last reading, what saving charts, the event ("Check", "Emptied after photo" or "Bag changed"; "Emptied after photo" when the bed's reading interval is ≥ 4 h, else "Check") and its effect on the next reading. The saved message says what was charted.

#### Scenario: Emptied on a general ward
- **WHEN** Ravi Kumar opens 3A bed 3, whose urine bag was last checked at 260 mL at 10:00, and at 11:00 a photo is read as a urine bag at 380 mL
- **THEN** the check screen shows `Last reading 260 mL at 10:00` and `+120 mL since 10:00`, with "Emptied after photo" picked and `The next reading starts from 0 mL.`, and no request was sent beyond the bed screen's load and the one `/api/ai/read`
- **AND** saving that `sam+spark` read, with segmentation, sends exactly three requests: `POST /api/admissions/<id>/media` with `kind: photo` for the photo, the same for its labeled copy, then `POST /api/admissions/<id>/bag-readings` with `container: "urine_bag"`, `event: "emptied"`, `volume_ml: 380`, `source: "photo"`, its `media_id`, `labeled_media_id` and the read's evidence
- **AND** the screen reads `Urine bag emptied at 380 mL: 120 mL charted. Waiting for nurse approval.`

#### Scenario: Hourly check on HDU
- **WHEN** a nurse reads HDU bed 1's urine bag at 260 mL, last checked at 150 mL at 09:00
- **THEN** "Check" is picked, with `The next reading starts from 260 mL.`, and saving sends `event: "check"`
- **AND** the screen then reads `Urine bag checked at 260 mL: 110 mL charted. Waiting for nurse approval.`

#### Scenario: Bag changed
- **WHEN** "Bag changed" is picked on that draft
- **THEN** "Bag changed" is picked and "Emptied after photo" is not, `The next reading starts from 0 mL.` is shown, and saving sends `event: "bag_changed"`

#### Scenario: Level fell
- **WHEN** the bag was last checked at 500 mL at 09:00, and at 12:00 it is read at 150 mL with "Check" picked
- **THEN** the screen shows `Below the 09:00 reading (500 mL) with no emptying recorded. Saving charts 150 mL and asks the nurse to review.`, and Save stays enabled
- **AND** after saving it reads `Urine bag checked at 150 mL: 150 mL charted and flagged for review, as the level fell. Waiting for nurse approval.`

#### Scenario: Nothing to chart
- **WHEN** the bag was last checked at 300 mL at 10:02, and at 10:13 it is read at 300 mL with "Check" picked
- **THEN** the screen shows `No rise since 10:02: saving charts nothing`
- **AND** after saving it reads `Urine bag checked at 300 mL: nothing new to chart.`, with no `Waiting for nurse approval`

#### Scenario: First reading
- **WHEN** the bag has no earlier reading and is read at 600 mL
- **THEN** the screen shows `First reading of this bag: saving charts 600 mL`

#### Scenario: Adjusted bag reading
- **WHEN** a urine bag read as 450 mL is adjusted to 430 mL and saved
- **THEN** the bag-reading request has `volume_ml: 430` and `evidence.kind: photo` with `reading.volume_ml: 450` and the read's segmentation and trace

#### Scenario: Urinal
- **WHEN** a urinal is read at 300 mL in `spark` mode and saved
- **THEN** the requests are `POST /api/admissions/<id>/media`, then `POST /api/admissions/<id>/entries` with `out` / `urine` / 300 mL, and no bag-reading request is sent

#### Scenario: Watch bed
- **WHEN** a nurse reads 5B bed 1's urine bag (order `watch`, `bags.interval_h: 2` with `interval_from: acuity`) at 300 mL, last checked at 180 mL at 08:00
- **THEN** "Check" is picked, with `The next reading starts from 300 mL.`, and saving sends `event: "check"`
- **AND** no request was sent beyond the bed screen's load and the one `/api/ai/read`
