# Spec Delta

## MODIFIED Requirements

### Requirement: Read result kept as evidence
Saving a photo draft SHALL send its read result as the evidence of its entry or bag reading, keeping the model's own volume when the attendant adjusted it. The evidence holds the mode, reading, segmentation, review reasons, trace and liquid colour. Voice and typed drafts SHALL send the transcript or note text, the model's volume for that draft as `draft_ml`, and the trace. Text is trimmed to the server's bounds, so a long model sentence never loses the entry. Manual entries send no evidence.

#### Scenario: Adjusted photo draft
- **WHEN** a urinal read as 450 mL is adjusted to 430 mL and saved
- **THEN** the entry request has `volume_ml: 430` and `evidence.kind: photo` with `reading.volume_ml: 450` and the read's segmentation and trace

#### Scenario: Voice draft
- **WHEN** a voice note heard as "bed 4 had coconut water 200 mL" is saved
- **THEN** the entry request has `evidence.kind: voice`, that transcript, `draft_ml: 200`, and the `asr` and `spark:note` trace steps

#### Scenario: Long model text
- **WHEN** the read's `reading_basis` is 900 characters and one review reason is 400 characters
- **THEN** the evidence sent has a `reading_basis` of at most 300 characters and every review reason at most 200, and the entry is saved

### Requirement: Urine colour on the check screen
When a photo read or a note gives a urine draft, the capture and round check screens SHALL show the colour's swatch and name. They SHALL also show seven labelled colour chips, and picking a chip replaces the colour and drops `urine_rgb`. The attendant's by-hand form SHALL offer the same chips for urine, with none picked. Saving SHALL send the chosen colour on urine entries and urine-bag readings only. None of this adds a model request.

#### Scenario: Read colour kept
- **WHEN** a photo read gives a urine draft with `urine_colour: dark` and `urine_rgb: "#c9952f"`, and it is saved unchanged
- **THEN** the entry request carries `urine_colour: "dark"` and `urine_rgb: "#c9952f"`

#### Scenario: Staff change the colour
- **WHEN** on that draft the `Red` chip is picked and the draft is saved
- **THEN** the entry request carries `urine_colour: "red"` and no `urine_rgb`

#### Scenario: Type changed
- **WHEN** a urine draft with colour `dark` has its type changed to water and is saved
- **THEN** the entry request carries neither colour field

#### Scenario: By hand
- **WHEN** a urine output is entered by hand with the `Yellow` chip
- **THEN** the entry request carries `urine_colour: "yellow"` and no `urine_rgb`, and exactly one request is made

## ADDED Requirements

### Requirement: Bag photos record readings
A bag photo read with a volume SHALL be saved by exactly one photo upload, then one `POST /api/admissions/:id/bag-readings` with the level, event, evidence, notes and urine colour. The check screen shows the last reading, what saving charts and the event as one choice of "Check", "Emptied after photo" and "Bag changed", with "Emptied after photo" picked when the bed's reading interval is 4 hours or more, else "Check", and its effect on the next reading. The saved message says what was charted.

#### Scenario: Emptied on a general ward
- **WHEN** Ravi Kumar opens 3A bed 3, whose urine bag was last checked at 260 mL at 10:00, and at 11:00 a photo is read as a urine bag at 380 mL
- **THEN** the check screen shows `Last reading 260 mL at 10:00` and `+120 mL since 10:00`, with "Emptied after photo" picked and `The next reading starts from 0 mL.`, and no request was sent beyond the bed screen's load and the one `/api/ai/read`
- **AND** saving sends exactly two requests: `POST /api/admissions/<id>/media` with `kind: photo`, then `POST /api/admissions/<id>/bag-readings` with `container: "urine_bag"`, `event: "emptied"`, `volume_ml: 380`, `source: "photo"`, its `media_id` and the read's evidence
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
- **WHEN** a urinal is read at 300 mL and saved
- **THEN** the requests are `POST /api/admissions/<id>/media`, then `POST /api/admissions/<id>/entries` with `out` / `urine` / 300 mL, and no bag-reading request is sent

### Requirement: Bag level by hand
The by-hand form SHALL offer "Bag level" for urine, stoma and drain output: the bag's level, the event as on the check screen, "When did it happen?" and an optional photo. Without a photo, saving sends one `POST /api/admissions/:id/bag-readings` with `source: "manual"` and no media. With one, it uploads the photo once, then sends the reading with `source: "photo"`, its `media_id` and no evidence. It makes no `/api/ai` request.

#### Scenario: Emptied now
- **WHEN** at 14:00 Ravi Kumar, on 3A bed 3, turns on "Bag level" for urine, enters 400 mL with "Emptied after photo" picked, and saves
- **THEN** exactly one request is sent: `POST /api/admissions/<id>/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "manual" }` and no `charted_at`
- **AND** no `/api/ai` request is sent

#### Scenario: Earlier time
- **WHEN** the same level is saved with "When did it happen?" at 12:30
- **THEN** the request has `charted_at` 12:30 today, local time

#### Scenario: Photo, level typed
- **WHEN** Ravi Kumar adds a photo of the bag to that form, enters 400 mL with "Emptied after photo" picked, and saves
- **THEN** exactly two requests are sent: `POST /api/admissions/<id>/media` with `kind: photo`, then `POST /api/admissions/<id>/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "photo", media_id: <it> }` and no `evidence`
- **AND** no `/api/ai` request is sent

#### Scenario: Not a bag
- **WHEN** "Bag level" is left off and 300 mL of urine is saved
- **THEN** exactly one request is sent, `POST /api/admissions/<id>/entries`, as before

### Requirement: After-emptying photo
After an emptying or a bag change is saved, the capture screen SHALL lead with "Add after-emptying photo" and, for an emptying, offer "Left in bag" at 0 mL. After a check it offers "Emptied it now? Add after-emptying photo", which first posts an `emptied` reading at the check's level. A photo is uploaded once and sent with any residual in one `POST /api/bag-readings/:id/after-emptying`; "Done" with neither sends nothing. None of it makes an `/api/ai` request.

#### Scenario: Proof photo
- **WHEN** an emptying is saved as reading 31, and the attendant taps "Add after-emptying photo", the first button on the saved screen, takes the photo and taps "Done"
- **THEN** the requests are `POST /api/admissions/<id>/media` with `kind: photo`, then `POST /api/bag-readings/31/after-emptying` with that `media_id`
- **AND** no `/api/ai` request is sent

#### Scenario: Residual only
- **WHEN** "Left in bag" is set to 30 mL and "Done" is tapped
- **THEN** exactly one request is sent: `POST /api/bag-readings/31/after-emptying` with `{ residual_ml: 30 }`

#### Scenario: Nothing added
- **WHEN** "Done" is tapped with no photo and 0 mL left in the bag
- **THEN** no request is sent

#### Scenario: After a check
- **WHEN** on HDU bed 1 a check at 260 mL is saved, and the nurse taps "Emptied it now? Add after-emptying photo", takes the photo and taps "Done"
- **THEN** exactly three requests are sent, in order: `POST /api/admissions/<id>/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 260, source: "manual" }`, then `POST /api/admissions/<id>/media` with `kind: photo`, then `POST /api/bag-readings/<the emptying's id>/after-emptying` with that `media_id`
- **AND** no `/api/ai` request is sent

#### Scenario: Check left as it is
- **WHEN** a check is saved and "Done" is tapped
- **THEN** no request is sent after the check's own
