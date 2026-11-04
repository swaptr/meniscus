# Spec Delta

## ADDED Requirements

### Requirement: Meals on the bed review
The bed review SHALL list the last 24 hours' meals, newest first. Each row shows the time, meal, portion eaten as a word (None, A quarter, Half, Three quarters, All) and a four-part bar, the items, the meal's fluid with its entry status, and who recorded it and how. Photo meals SHALL open "What the AI read" with each item's portion, the fluids and the model step. Voided meals SHALL stay listed, struck through, with "Voided: <reason>" and who voided them.

#### Scenario: Lunch from a tray photo
- **WHEN** a lunch at 13:10 was recorded by Ravi Kumar from a tray photo, half eaten, items "rice, dal", 150 mL pending
- **THEN** its row reads `13:10`, `Lunch`, `Half` with 2 of 4 parts filled, `rice, dal`, `+150 mL · pending`, `Tray photo by Ravi K.`

#### Scenario: Breakfast by hand
- **WHEN** a breakfast at 08:05 was entered by hand by Sunita Devi, all eaten, with no fluid
- **THEN** its row reads `08:05`, `Breakfast`, `All` with 4 of 4 parts filled, no fluid, `By hand by Sunita D.`

#### Scenario: What the AI read
- **WHEN** that lunch's read had rice half eaten, dal all eaten, soup 150 mL and a 2140 ms `spark:meal` step
- **THEN** "What the AI read" lists `rice · Half`, `dal · All`, `soup · 150 mL` and `Muse Spark · tray · 2.1 s`

#### Scenario: Voided meal
- **WHEN** a breakfast was voided by Anita Thomas with reason "wrong bed"
- **THEN** its row is struck through and shows `Voided: wrong bed · Anita T.`

### Requirement: Void a meal from the bed review
"Void…" on a meal SHALL ask for a reason of at least 3 characters and send one `POST /api/meals/<id>/void` in the name of the staff member on shift; it is disabled until the reason is long enough.

#### Scenario: Void with a reason
- **WHEN** a nurse on shift (staff 4) voids meal 12 with reason "duplicate photo"
- **THEN** the only request is `POST /api/meals/12/void` with `{ reason: "duplicate photo" }` and `X-Staff-Id: 4`, and a reason of "ab" sends nothing
