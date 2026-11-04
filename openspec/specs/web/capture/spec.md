# web/capture Specification

## Purpose
The attendant's bedside screen: open a bed, capture a photo or note, confirm the draft and save it to the chart with the photo as evidence.

## Requirements

### Requirement: Photos are shrunk before upload
A captured photo SHALL be scaled so its longest side is at most 1280 px, keeping its aspect ratio and never enlarging it, and sent only when it is at most 8 MB. A photo still over 8 MB after one lower-quality re-encode, or one the server refuses as invalid or too large, shows `Photo too large · max 8 MB. Retake closer or in better light.`

#### Scenario: Large phone photo
- **WHEN** a 4032 × 3024 photo is captured
- **THEN** it is uploaded at 1280 × 960

#### Scenario: Small photo
- **WHEN** an 800 × 600 photo is captured
- **THEN** it is uploaded at 800 × 600

#### Scenario: Photo over 8 MB
- **WHEN** a picked photo is still over 8 MB after shrinking and its one re-encode
- **THEN** the screen shows `Photo too large · max 8 MB. Retake closer or in better light.` and no request is sent

#### Scenario: Server refuses the photo's size
- **WHEN** an upload or read of a photo is answered 413 `payload_too_large` or 400 `invalid_request`
- **THEN** the screen shows `Photo too large · max 8 MB. Retake closer or in better light.`, not a generic failure

### Requirement: Draft becomes an entry
A confirmed draft SHALL be saved as an entry with its direction, category, volume, item, notes, the capture source and the reading confidence; a draft without a volume SHALL NOT be saveable until a volume is entered, and +/- adjusts the volume in 10 mL steps between 1 and 5000 mL.

#### Scenario: Photo draft
- **WHEN** a photo draft of 450 mL urine at confidence 0.9 is confirmed
- **THEN** the saved entry is `out` / `urine` / 450 mL with source `photo` and confidence 0.9

#### Scenario: No volume
- **WHEN** a draft has no volume
- **THEN** it cannot be saved

#### Scenario: Adjust
- **WHEN** + is pressed on 4995 mL, or - on 5 mL
- **THEN** the volume becomes 5000 mL, or 1 mL

### Requirement: Photo saved as evidence
Saving a photo capture SHALL upload the photo once as media, then its labeled copy when the read has segmentation ("Labeled copy drawn at the bed"), and then post the record with its `media_id` and any `labeled_media_id`. If the photo upload fails, no copy is uploaded, the record is still saved without media, and the screen says the photo was not kept.

#### Scenario: Save with photo
- **WHEN** a photo draft read in `sam+spark` mode with segmentation is saved
- **THEN** exactly three requests are made: `POST /api/admissions/:id/media` with `kind: photo` for the photo, the same for its labeled copy, then `POST /api/admissions/:id/entries` with its `media_id` and `labeled_media_id`

#### Scenario: Save a Spark-only photo
- **WHEN** a photo draft read in `spark` mode, with `segmentation: null`, is saved
- **THEN** exactly two requests are made: `POST /api/admissions/:id/media` with `kind: photo`, then `POST /api/admissions/:id/entries` with its `media_id` and no `labeled_media_id`

#### Scenario: Photo upload fails
- **WHEN** the photo's media request fails with 500
- **THEN** no labeled copy is uploaded, the entry is posted without `media_id` or `labeled_media_id`, and the save result has the entry and a warning that the photo was not kept

### Requirement: Jug photos record levels
A photo reading of a water jug or water bottle with a volume SHALL be saved as a level reading linked to its photo, as in "Photo saved as evidence", and the screen shows the intake entry created from the drop, if any.

#### Scenario: Water jug reading
- **WHEN** a `sam+spark` reading of container `water_jug` at 600 mL, with segmentation, is saved
- **THEN** exactly three requests are made: two `POST /api/admissions/:id/media` with `kind: photo` (the photo, then its labeled copy), then `POST /api/admissions/:id/levels` with `water_jug`, 600 mL, its `media_id` and `labeled_media_id`
- **AND** no entry is posted directly

#### Scenario: Volume typed over the read
- **WHEN** that 600 mL reading's volume is changed to 550 mL before it is saved
- **THEN** the same three requests are made, the level post carries 550 mL and the copy's `labeled_media_id`
- **AND** the copy is drawn from the read as returned, labelled 600 mL: a snapshot of the read at capture

### Requirement: Read result kept as evidence
Saving a photo draft SHALL send its read result as the evidence of its entry or bag reading, keeping the model's own volume when the attendant adjusted it. The evidence holds the mode, `image_sha256`, reading, segmentation, review reasons, trace and liquid colour. Voice and typed drafts send the transcript or note text, the model's volume for that draft as `draft_ml`, and the trace. Text is trimmed to the server's bounds so the entry is never lost. Manual entries send no evidence.

#### Scenario: Adjusted photo draft
- **WHEN** a urinal read as 450 mL is adjusted to 430 mL and saved
- **THEN** the entry request has `volume_ml: 430` and `evidence.kind: photo` with `reading.volume_ml: 450`, the read's `image_sha256`, segmentation and trace

#### Scenario: Voice draft
- **WHEN** a voice note heard as "bed 4 had coconut water 200 mL" is saved
- **THEN** the entry request has `evidence.kind: voice`, that transcript, `draft_ml: 200`, and the `asr` and `spark:note` trace steps

#### Scenario: Long model text
- **WHEN** the read's `reading_basis` is 900 characters and one review reason is 400 characters
- **THEN** the evidence sent has a `reading_basis` of at most 300 characters and every review reason at most 200, and the entry is saved

### Requirement: Liquid colour sampled from the photo
The capture screen SHALL derive the liquid colour as the mean colour of the liquid box's central half, as `#rrggbb`. The central half is the box inset by 25% of its width and height on each side. It SHALL record no colour when segmentation found no liquid.

#### Scenario: Uniform liquid
- **WHEN** every pixel in the central half of the liquid box is rgb(217, 180, 74) and the rest of the box is black
- **THEN** the colour is `#d9b44a`

#### Scenario: No liquid found
- **WHEN** the read has no liquid box
- **THEN** no colour is recorded

### Requirement: Read summary on the check screen
After a photo read, the check screen SHALL show the number of model calls and the read's wall time as `<n> model calls · <s> s`. It SHALL overlay the segmentation on the preview as in "Segmentation overlay".

#### Scenario: Three calls
- **WHEN** a read returns a trace of three calls and `ms: 6800`
- **THEN** the screen shows `3 model calls · 6.8 s`

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

### Requirement: Recording feedback
While a voice note is recording, the capture screen SHALL show the elapsed time against the 1:00 limit as `m:ss / 1:00` and a live input level, and a single large button SHALL stop and send. No model request SHALL be made until it is stopped.

#### Scenario: Seven seconds in
- **WHEN** a recording has run for 7.4 seconds
- **THEN** the screen shows `0:07 / 1:00` and no `/api/ai` request has been made

### Requirement: Meal capture
The capture screen SHALL offer "Meal": the meal preselected as in "Meal follows the served tray", else by local time (breakfast 05:00–10:29, lunch 10:30–14:59, snack 15:00–17:59, otherwise dinner), portion chips None, ¼, ½, ¾ and All, items, optional fluid mL and "When did it happen?". "Photo of the tray" makes exactly one `/api/ai/meal` request and fills the form from its draft; a read needing review says "Check the tray" with the reasons. Saving posts the meal and makes no `/api/ai` request.

#### Scenario: Lunch by hand
- **WHEN** at 13:10 the attendant opens Meal on a bed with no served tray waiting, picks ½, types "rice, dal" and sets 150 mL, then saves
- **THEN** after the served-tray lookup, the only request is `POST /api/admissions/<id>/meals` with `{ meal: "lunch", portion: 50, items: "rice, dal", fluid_ml: 150, source: "manual" }`

#### Scenario: Tray photo
- **WHEN** the attendant takes a tray photo whose draft is `{ portion: 75, items: "idli, sambar", fluid_ml: 100 }` with confidence 0.8, then saves
- **THEN** the requests after the served-tray lookup are, in order: one `/api/ai/meal`, one `POST /api/admissions/<id>/media` with `kind: photo`, and one `POST /api/admissions/<id>/meals`
- **AND** the meal post has `portion: 75`, `items: "idli, sambar"`, `fluid_ml: 100`, `source: "photo"`, `confidence: 0.8`, the read's evidence and the tray's `media_id`

#### Scenario: Tray needs a check
- **WHEN** the tray read returns confidence 0.6 with issue `partly_hidden`
- **THEN** the form shows `Check the tray: low confidence (0.60), partly hidden`

#### Scenario: Meal by time of day
- **WHEN** Meal is opened at 07:45, 15:30 and 21:00 on a bed with no served tray waiting
- **THEN** breakfast, snack and dinner are preselected

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

### Requirement: Recording saved as evidence
Saving a draft from a voice note SHALL upload the recording once as voice media, with its duration, the first time any of its drafts is saved. That draft and every later draft from the same note SHALL be posted with the same `media_id`. If the upload fails, it SHALL NOT be tried again for that note: its drafts are saved without media, and the screen SHALL say the recording was not kept. No `/api/ai` request is made.

#### Scenario: Two drafts, one recording
- **WHEN** a voice note drafted 200 mL tea and 300 mL urine, and both drafts are saved
- **THEN** the requests are, in order:
  1. one `POST /api/admissions/:id/media` with `kind: voice`;
  2. one `POST /api/admissions/:id/entries` for each draft, both with that `media_id`

#### Scenario: Recording not kept
- **WHEN** a voice note drafted 200 mL tea and 300 mL urine, the media request fails with 500, and both drafts are then saved
- **THEN** exactly one `POST /api/admissions/:id/media` is made, followed by two entry posts, both without `media_id`
- **AND** each save result warns that the recording was not kept

### Requirement: Tray photo saved with the meal
Saving a meal filled from a tray photo SHALL upload the photo once as photo media, then its labeled copy when the read has segmentation, and post the meal with its `media_id` and any `labeled_media_id`. A meal entered by hand uploads nothing.

#### Scenario: Lunch from a tray
- **WHEN** a meal filled from a `sam+spark` tray read with 2 regions is saved
- **THEN** exactly three requests are made: two `POST /api/admissions/:id/media` with `kind: photo` (the tray, then its labeled copy), then `POST /api/admissions/:id/meals` with its `media_id` and `labeled_media_id`

#### Scenario: Spark-only tray
- **WHEN** a meal filled from a `spark` tray read, with `segmentation: null`, is saved
- **THEN** exactly two requests are made: `POST /api/admissions/:id/media` with `kind: photo`, then `POST /api/admissions/:id/meals` with its `media_id` and no `labeled_media_id`

### Requirement: Care orders at the bed
The attendant's bed screen SHALL show the bed's care badges under the patient banner, as on the ward bed card, read-only. They come from its existing load (`GET /api/beds/<token>` and `GET /api/admissions/<id>/entries`), with no extra request.

#### Scenario: Fasting stroke patient
- **WHEN** Ravi Kumar (attendant) opens `/a/bed/<token>` for a bed that is nil by mouth with thickened fluids at level 2
- **THEN** the banner shows `NBM` and `IDDSI 2`, with no control to change them
- **AND** the only requests are `GET /api/beds/<token>` and `GET /api/admissions/<id>/entries`

### Requirement: Nil by mouth warning before saving
While the bed has an active nil-by-mouth order, these screens SHALL warn before saving a water or food draft, or a meal with some portion eaten or some fluid: the capture check screen, the by-hand form, the Meal form and the bed review's "Add missed entry". The warning reads `Nil by mouth since <time>[, until <time>]. Saving records it and asks the nurse to review.`, and the save button reads `Save anyway`. Saving sends the same requests as without the order.

#### Scenario: Drink for a fasting patient
- **WHEN** 2C bed 1 has been nil by mouth since 06:00 with no planned end, and Ravi Kumar enters a 200 mL drink by hand
- **THEN** the form shows `Nil by mouth since 06:00. Saving records it and asks the nurse to review.`, and the save button reads `Save anyway`
- **AND** tapping it sends exactly one request, `POST /api/admissions/<id>/entries`, and no `/api/ai` request

#### Scenario: Planned end
- **WHEN** the bed is nil by mouth since 06:00 until 14:00, and a voice draft of 150 mL tea is checked
- **THEN** the draft shows `Nil by mouth since 06:00, until 14:00. Saving records it and asks the nurse to review.`

#### Scenario: IV or output
- **WHEN** on the same bed a 500 mL IV draft and a 300 mL urine draft are checked
- **THEN** neither shows the warning, and both save buttons read `Save`

#### Scenario: Meal
- **WHEN** on the same bed the Meal form has portion ½, then portion None with no fluid, then portion None with 150 mL tea
- **THEN** the first shows the warning with `Save anyway`, the second does not, and the third shows it again

#### Scenario: Missed entry by a nurse
- **WHEN** Meera Pillai (id 6) adds a missed 200 mL drink on that bed from the bed review
- **THEN** the dialog shows the warning
- **AND** saving sends `POST /api/admissions/<id>/entries`, then `POST /api/entries/<new id>/review` with `action: approve`, as without the order

### Requirement: Drink consistency on the check screen
With an active thickened-fluids order, the capture check screen, the by-hand form and the bed review's "Add missed entry" SHALL offer "Consistency" for a water draft and send the chosen `iddsi_level`. Chips run from `0 Thin` to `4 Extremely thick`, first set to the ordered level. A lower level shows `Thinner than ordered (IDDSI <level> <name>). The nurse is asked to review.` Without the order, nothing is shown or sent. It makes no model request.

#### Scenario: Defaults to the order
- **WHEN** 5B bed 6 has thickened fluids at level 2, and a 200 mL drink entered by hand is saved unchanged
- **THEN** "Consistency" shows `2 Mildly thick` picked
- **AND** the only request is `POST /api/admissions/<id>/entries` with `iddsi_level: 2`

#### Scenario: Thinner than ordered
- **WHEN** on that drink `0 Thin` is picked, and it is saved
- **THEN** the form shows `Thinner than ordered (IDDSI 2 Mildly thick). The nurse is asked to review.`, and saving stays enabled
- **AND** the entry request carries `iddsi_level: 0`

#### Scenario: Thicker
- **WHEN** `3 Moderately thick` is picked instead
- **THEN** no warning is shown, and the entry request carries `iddsi_level: 3`

#### Scenario: Photo draft
- **WHEN** a photo of a cup of water on that bed is read, then saved unchanged
- **THEN** "Consistency" shows `2 Mildly thick` picked, and the entry request carries `iddsi_level: 2`
- **AND** reading it sent one `/api/ai/read` request, and saving sent none

#### Scenario: Type changed
- **WHEN** the drink's type is changed to food, and then back to drink
- **THEN** with food no "Consistency" is shown and the request carries no `iddsi_level`
- **AND** back on drink, `2 Mildly thick` is picked again

#### Scenario: No order
- **WHEN** a 200 mL drink is entered by hand on a bed with no thickened-fluids order
- **THEN** no "Consistency" is shown, and the entry request carries no `iddsi_level`

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

### Requirement: Bag level by hand
The by-hand form SHALL offer "Bag level" for urine, stoma or drain output only for a bag in `devices.bags`, on at first: the bag's level, the event as on the check screen, "When did it happen?" and an optional photo. Without a photo, saving sends one `POST /api/admissions/:id/bag-readings` with `source: "manual"` and no media. With one, it uploads the photo once, then sends the reading with `source: "photo"`, its `media_id` and no evidence. It makes no `/api/ai` request.

#### Scenario: Emptied now
- **WHEN** at 14:00 Ravi Kumar, on 3A bed 3, whose `devices.bags` is `["urine_bag"]`, picks urine output, finds "Bag level" already on, enters 400 mL with "Emptied after photo" picked, and saves
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
- **WHEN** "Bag level" is turned off and 300 mL of urine is saved
- **THEN** exactly one request is sent, `POST /api/admissions/<id>/entries`, as before

#### Scenario: No bag on record
- **WHEN** Ravi Kumar, on 3A bed 5, whose `devices.bags` is `[]`, picks urine, stoma and drain output in turn
- **THEN** none of them shows "Bag level"
- **AND** saving 300 mL of urine sends exactly one request, `POST /api/admissions/<id>/entries`

#### Scenario: Stoma only
- **WHEN** on 2C bed 3, whose `devices.bags` is `["stoma_bag"]`, stoma output is picked, and then urine output
- **THEN** stoma output shows "Stoma bag level" with "Bag level" on, and urine output shows no "Bag level"

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

### Requirement: Dishes on the meal form
After a tray read with dishes, the Meal form SHALL show the tray photo with its dish outlines, as in "Tray overlay", and one row per dish in place of the items field: its region number, an editable name, a kind and portion chips. Saving sends the edited `dishes`, their names joined by ", " as `items`, and the read unchanged as evidence, and makes no `/api/ai` request. If the tray photo upload fails, the meal is posted without evidence.

#### Scenario: Rice was finished
- **WHEN** a tray read drafts dishes `1 rice` (kind Rice, Half) and `2 dal` (kind Dal / lentils, All), and the attendant taps All on rice, renames dal to `sambar`, then saves
- **THEN** the meal post has `dishes: [{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }, { index: 2, name: "sambar", dish_kind: "dal_lentils", portion: 100 }]` and `items: "rice, sambar"`
- **AND** its evidence's reading still has rice at portion 50 and the name `dal`, and its `image_sha256` is the read's
- **AND** saving sent `POST /api/admissions/<id>/media` and `POST /api/admissions/<id>/meals`, and no `/api/ai` request

#### Scenario: Read with no dishes
- **WHEN** a tray read returns no dishes
- **THEN** the form shows the items field, as for a meal by hand, and no dish rows

#### Scenario: Tray photo not kept
- **WHEN** a tray read drafts dishes `1 rice` and `2 dal`, and on saving `POST /api/admissions/<id>/media` answers 500
- **THEN** the meal post has those dishes, no `media_id` and no `evidence`
- **AND** the save result warns that the photo was not kept

### Requirement: Reads and saves carry their read
On the bed capture screen, each photo, typed or voice read request SHALL carry the bed's `admission_id`, and each save of its draft (entry, level or bag reading) its `read_id`, with `read_draft` for a note's drafts. No request is added: photo 3 (1 in `spark` mode), text 1, voice 2. By-hand records carry none, nor does a draft whose read answered `READ_ABANDON_HOURS` less 5 minutes or more ago, by the device's clock, as decided at its first save attempt and kept for its retries.

#### Scenario: Photo draft
- **WHEN** on bed 16 a `sam+spark` photo read of a `urinal` answers with `read_id: 41`, segmentation and a 450 mL urine draft, and the draft is saved
- **THEN** the read request was one `POST /api/ai/read` whose form has `admission_id` 16
- **AND** saving makes exactly three requests: two `POST /api/admissions/16/media` with `kind: photo` (the photo, then its labeled copy), then `POST /api/admissions/16/entries` with `read_id: 41`

#### Scenario: Voice note with two drafts
- **WHEN** a voice note on bed 16 answers with `read_id: 42` and drafts 200 mL tea and 300 mL urine, and both are saved
- **THEN** the requests are one `POST /api/admissions/16/media` with `kind: voice`, then two entry posts, with `read_id: 42` and `read_draft` 0 and 1 respectively

#### Scenario: Dropped draft
- **WHEN** a voice note answers with `read_id: 42` and drafts 200 mL tea and 300 mL urine, the tea draft is removed, and the urine draft is saved
- **THEN** its entry post carries `read_id: 42` and `read_draft: 1`

#### Scenario: Typed note and jug
- **WHEN** a typed note answers with `read_id: 45` and a water jug read with `read_id: 43`, and each is saved
- **THEN** the note's entry post has `read_id: 45` and `read_draft: 0`, and the level post `read_id: 43`
- **AND** the note request carried `admission_id` 16 in its JSON

#### Scenario: By hand
- **WHEN** a drink is entered by hand, and on bed 16 "Bag level" is saved for urine at 400 mL with a photo and "Emptied after photo" on
- **THEN** the entry post carries no `read_id`
- **AND** the bag-reading post is `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "photo", media_id: <it> }`, with no `evidence` and no `read_id`

#### Scenario: Bag photo
- **WHEN** on bed 16 a `spark` photo read answers with `read_id: 47`, `segmentation: null` and a `urine_bag` at 380 mL, and it is saved as an emptying
- **THEN** saving makes exactly two requests, with no labeled copy: `POST /api/admissions/16/media` with `kind: photo`, then `POST /api/admissions/16/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 380, source: "photo", media_id: <it>, read_id: 47 }` and the read's evidence

#### Scenario: Emptied it now
- **WHEN** on bed 16 a photo read answers with `read_id: 48` and a `urine_bag` at 260 mL, it is saved as a check with `read_id: 48`, and "Emptied it now? Add after-emptying photo" is tapped
- **THEN** the emptying post is `{ container: "urine_bag", event: "emptied", volume_ml: 260, source: "manual" }`, with no `read_id`

#### Scenario: Stale read
- **WHEN** two `urinal` photo reads and one `water_jug` photo read answer at 08:00 by the device's clock, and the first urinal draft is saved at 19:54, the second at 19:55 and the jug at 19:55
- **THEN** the first entry post carries its `read_id`
- **AND** the second entry post and the level post carry none, and both are saved

#### Scenario: Retried save
- **WHEN** a `urinal` photo read answers with `read_id: 41` at 08:00 by the device's clock, its first save at 19:54 uploads the photo and then the entry post fails with a network error, and Save is tapped again at 19:56
- **THEN** the retry sends exactly one request, the entry post, and it carries `read_id: 41`

### Requirement: Budget refusal offers manual entry
When a read or note is refused with 429 `request_budget_exceeded`, the capture screen SHALL:
- keep the photo or recording;
- for `limit: "hourly"`, say that model reads are used up until the time given by `Retry-After`;
- for `limit: "concurrent"`, say that model reads are busy and can be read again in a few seconds;
- offer Enter by hand at once;
- enable Read again only from the `Retry-After` time, and only on a tap.

Nothing is read without that tap, and no timer sends a request.

#### Scenario: Routine bed refused
- **WHEN** at 10:40 a photo read for 3A bed 4 gets 429 with `limit: "hourly"`, `budget_class: "routine"` and `Retry-After: 1200`
- **THEN** the photo stays on screen with `Model reads for routine beds are used up until 11:00. Enter by hand, or read again from 11:00.`
- **AND** Enter by hand opens the by-hand form for 3A bed 4 at once
- **AND** Read again is disabled until 11:00 and enabled after it
- **AND** no `/api/ai` request is sent until Read again is tapped

#### Scenario: Busy for a moment
- **WHEN** at 10:40:00 a photo read for HDU bed 1 gets 429 with `limit: "concurrent"`, `budget_class: "critical"` and `Retry-After: 5`
- **THEN** the photo stays on screen with `Model reads are busy. Read again in a few seconds, or enter by hand.`, and no "used up until" time
- **AND** Enter by hand opens the by-hand form for HDU bed 1 at once
- **AND** Read again is disabled until 10:40:05 and enabled after it
- **AND** no `/api/ai` request is sent until Read again is tapped

### Requirement: Meal follows the served tray
Opening Meal on the bed capture screen SHALL send one `GET /api/admissions/<id>/served-tray` and, when it returns a photo, preselect that photo's `served_meal` and read `Served <meal> tray from <HH:MM> waiting`. When it returns `media: null` or fails, the meal is preselected by local time and the lookup is not resent. Picking another meal chip stays possible until a compared read is on the form. It makes no `/api/ai` request.

#### Scenario: Lunch collected late
- **WHEN** at 15:10 the attendant opens Meal on bed 1, whose served lunch photo 41 was uploaded at 14:30
- **THEN** the only request on opening is `GET /api/admissions/1/served-tray`, lunch is preselected instead of snack, and the screen reads `Served lunch tray from 14:30 waiting`
- **AND** a tray photo then read sends `meal: lunch` in its one `POST /api/ai/meal`

#### Scenario: No served tray waiting
- **WHEN** at 15:10 the lookup answers `media: null`, and on another bed it answers 500
- **THEN** snack is preselected on both, no served tray is named, and neither lookup is resent

### Requirement: Served tray photo at the bed
The Meal capture SHALL offer "Served tray": a photo of the tray as it is served, uploaded once as photo media with the selected meal as `served_meal`. It makes no `/api/ai` request and posts no meal, and it says when the photo was kept. A failed upload says so and is not resent. Either way, the meal is captured as before when the tray is collected.

#### Scenario: Lunch served
- **WHEN** at 12:40 the attendant opens Meal on bed 1 (lunch preselected), taps "Served tray" and takes a photo
- **THEN** after the served-tray lookup, the only request is `POST /api/admissions/1/media` with `kind: photo` and `served_meal: lunch`
- **AND** the screen reads `Served lunch kept at 12:40. Photograph the tray again when it is collected.`

#### Scenario: Served photo not kept
- **WHEN** that upload answers 500
- **THEN** the screen reads `Served tray photo not kept. You can still photograph the tray when it is collected.`
- **AND** no other request is made

### Requirement: Collected tray compared at the bed
On the bed capture screen, the tray read SHALL send the bed's `admission_id` and the selected `meal` in its one `/api/ai/meal` request. When the read has a `comparison`, the form names the served photo's time, marks `measured` dish portions, and keeps the meal fixed, saying why, until the photo is retaken, and saving posts `served_media_id` beside the tray's `media_id`. A meal posted without the tray's `media_id` sends no `served_media_id`.

#### Scenario: Lunch compared
- **WHEN** at 13:30 on bed 1 a lunch tray photo is read, answering a `comparison` with `served_media_id: 41`, `served_at` 12:40, a served segmentation, and dishes `1 rice` (Half, `basis: measured`) and `2 dal` (All, `basis: model`), and the attendant saves
- **THEN** the read request was one `POST /api/ai/meal` whose form has the image, `admission_id` 1 and `meal: lunch`
- **AND** the form reads `Compared with the served tray from 12:40`, rice's portion is marked `measured`, and the meal chips are disabled under `Meal fixed to lunch by the served tray. Retake to change it.`
- **AND** saving makes exactly three requests: `POST /api/admissions/1/media` with `kind: photo` (answering media 42), the same for its labeled copy (media 43), then `POST /api/admissions/1/meals` with `media_id: 42`, `labeled_media_id: 43`, `served_media_id: 41` and the read as evidence

#### Scenario: Served photo not compared
- **WHEN** the read's `comparison` has `served_media_id: 41`, `served_at` 12:40 and `served: null`
- **THEN** the form reads `Served tray from 12:40 kept with the meal` and no portion is marked `measured`
- **AND** saving posts `served_media_id: 41`

#### Scenario: No served photo
- **WHEN** the read's `comparison` is null
- **THEN** the form names no served tray, and the meal post has no `served_media_id`

#### Scenario: Tray photo not kept
- **WHEN** a compared read is saved and `POST /api/admissions/1/media` answers 500
- **THEN** no labeled copy is uploaded, and the meal post has no `media_id`, no `labeled_media_id`, no `served_media_id` and no `evidence`
- **AND** the save result warns that the photo was not kept

#### Scenario: Retaken for another meal
- **WHEN** after a compared lunch read the attendant taps "Retake", picks Snack and takes a new photo
- **THEN** the new read is one `POST /api/ai/meal` with `meal: snack`, and the form no longer names the served lunch tray

### Requirement: Duplicate bag reading at the bed
When a bag-reading post from the bed screen (a read bag photo, "Bag level" by hand, or "Emptied it now?") answers 409 `duplicate_reading`, the screen SHALL show `Same as the reading at <time>: <event> at <level> mL.` with "Save anyway" and "Discard", and send nothing more until one is tapped. "Save anyway" resends the same body once with `confirm_duplicate_of` that reading's id, without uploading its photo again. "Discard" sends nothing. No `/api/ai` request is made.

#### Scenario: Saved twice
- **WHEN** on 3A bed 3 Ravi Kumar saves a urine bag photo, read as 380 mL with `read_id: 49`, as an emptying at 11:02, and the bag-reading post answers 409 with `duplicate_of` `{ id: 101, event: "emptied", volume_ml: 380, created_at: <11:00> }`
- **THEN** the screen shows `Same as the reading at 11:00: emptied at 380 mL.` with "Save anyway" and "Discard", and no saved message
- **AND** saving sent exactly two requests, the photo upload and that bag-reading post, and no `/api/ai` request

#### Scenario: Save anyway
- **WHEN** "Save anyway" is tapped
- **THEN** exactly one request is sent: `POST /api/admissions/<id>/bag-readings` with the same `media_id`, evidence and `read_id: 49`, and `confirm_duplicate_of: 101`
- **AND** when it answers 201 with a 380 mL entry, the screen reads `Urine bag emptied at 380 mL: 380 mL charted. Waiting for nurse approval.`

#### Scenario: Response lost
- **WHEN** that "Save anyway" post gets no response, and "Save anyway" is tapped again
- **THEN** exactly one more request is sent, the same body with `confirm_duplicate_of: 101`
- **AND** when it answers 409 with `duplicate_of` `{ id: 102, event: "emptied", volume_ml: 380, created_at: <11:03> }`, the screen shows `Same as the reading at 11:03: emptied at 380 mL.` with "Save anyway" and "Discard", and nothing more is sent

#### Scenario: Discard
- **WHEN** "Discard" is tapped instead
- **THEN** no request is sent, and the screen reads `Not saved. The reading at 11:00 stands.`

#### Scenario: By hand
- **WHEN** "Bag level" by hand, with a photo, saves a check at 300 mL whose post answers 409 with `duplicate_of` `{ id: 88, event: "check", volume_ml: 290, created_at: <10:02> }`, and "Save anyway" is tapped
- **THEN** the screen first shows `Same as the reading at 10:02: checked at 290 mL.`
- **AND** the resend is one bag-reading post with `source: "photo"`, the same `media_id` and `confirm_duplicate_of: 88`, with no second photo upload

### Requirement: Nearly full at the bed
A bag's check screen and its "Bag level" form SHALL show `Nearly full: <level> of <capacity> mL. Empty it now?` when the level is at or above 80% of the bag's capacity and the event is a check, and after that check is saved lead with "Emptied it now? Add after-emptying photo". It sends no request of its own and no `/api/ai` request.

#### Scenario: Check at 1650 mL
- **WHEN** on HDU bed 1 a nurse's photo reads the urine bag at 1650 mL, with "Emptied after photo" off
- **THEN** the check screen shows `Nearly full: 1650 of 2000 mL. Empty it now?`
- **AND** after saving, "Emptied it now? Add after-emptying photo" is the first button, and saving sent only the photo upload and the bag-reading post

#### Scenario: Under 80%, or emptied
- **WHEN** the level is 1599 mL with "Emptied after photo" off, or 1650 mL with it on
- **THEN** no `Nearly full` line is shown

#### Scenario: Stoma bag by hand
- **WHEN** "Bag level" for stoma output is set to a check at 420 mL
- **THEN** the form shows `Nearly full: 420 of 500 mL. Empty it now?`

### Requirement: Meal saves carry their read
On the bed capture screen, the tray read SHALL carry the bed's `admission_id`, and a meal saved from it its `read_id`, adding no request to the one `/api/ai/meal` (3 or 1 model requests, 5 with a served photo) and the meal post. A meal by hand carries none, nor one whose read drafted no dish and no fluid or answered `READ_ABANDON_HOURS` less 5 minutes or more ago by the device's clock, as decided at the first save attempt and kept for retries. A retry answered `already linked` shows as saved.

#### Scenario: Tray lunch
- **WHEN** on bed 16 a tray photo is read in `sam+spark` mode, answering `read_id: 61`, a segmentation and a draft of portion 50, `rice, dal` and 150 mL, and the lunch is saved
- **THEN** the read request was one `POST /api/ai/meal` whose form has `admission_id` 16
- **AND** saving makes exactly three requests: two `POST /api/admissions/16/media` with `kind: photo` (the tray, then its labeled copy), then `POST /api/admissions/16/meals` with `source: "photo"`, the tray's `media_id` and `read_id: 61`

#### Scenario: Meal by hand
- **WHEN** on bed 16 a lunch is entered by hand at ½ with `rice, dal` and saved
- **THEN** the only request is `POST /api/admissions/16/meals` with `source: "manual"` and no `read_id`

#### Scenario: Empty tray read
- **WHEN** on bed 16 a tray photo is read, answering `read_id: 63`, the issue `not_a_meal`, `segmentation: null`, no dishes and `fluid_ml: null`, and the attendant sets lunch at ½ with `rice, dal` and saves
- **THEN** saving makes exactly two requests: `POST /api/admissions/16/media` with `kind: photo`, then `POST /api/admissions/16/meals` with `source: "photo"`, the tray's `media_id` and no `read_id`
- **AND** the meal post answers 201, and the screen shows `Saved lunch, half eaten.`

#### Scenario: Stale tray read
- **WHEN** a tray read answers with `read_id: 61` at 08:00 by the device's clock, and its lunch is saved at 19:55
- **THEN** the meal post carries no `read_id`, and the lunch is saved

#### Scenario: Retried meal save
- **WHEN** a tray read answers with `read_id: 61` at 08:00 by the device's clock, its first save at 19:54 uploads the photo and its labeled copy and then the meal post fails with a network error, and Save is tapped again at 19:56
- **THEN** the retry sends exactly one request, the meal post, and it carries `read_id: 61`

#### Scenario: Already linked
- **WHEN** a tray read answers with `read_id: 61` and a draft of lunch at portion 50 with 150 mL, its first save uploads the photo and its labeled copy, the meal post reaches the server but its response is lost, and Save is tapped again
- **THEN** the retry sends exactly one request, the meal post with `read_id: 61`, and it answers 400 with `{ path: "read_id", message: "already linked" }`
- **AND** the screen shows `Saved lunch, half eaten. 150 mL waiting for nurse approval.`, with no error and no further request

### Requirement: Recording too long
When a voice note is answered HTTP 422 `audio_too_long`, the screen that sent it SHALL say `Recording over 10 minutes. Record a shorter note.` and draft nothing. It makes no further `/api/ai` request for that recording, so the note costs 0 model requests.

#### Scenario: Long recording refused
- **WHEN** a voice note for 3A bed 4 is sent and `POST /api/ai/voice-note` answers 422 with `{ error: "audio_too_long", message: "audio is 601000 ms; limit is 600000 ms", retryable: false, duration_ms: 601000, limit_ms: 600000 }`
- **THEN** the screen shows `Recording over 10 minutes. Record a shorter note.`, not the server's message
- **AND** no draft is shown, and exactly one `/api/ai` request was made

### Requirement: Capture choices follow the bed's devices
The bed screen SHALL list photo container hints as "Auto-detect", the bed's own output containers (urine bag, urinal, bedpan or commode pan as `devices.urine` says, then its stoma and drain bags), the intake containers, then the urinal, bedpan, commode pan and emesis basin not yet listed, never a bag outside `devices.bags`. By hand, urine is saved with the urine method's container as `item`. It all comes from the bed screen's own load, with no extra request.

#### Scenario: Commode bed
- **WHEN** Ravi Kumar opens 3A bed 4, whose `devices` is `{ urine: "commode", urine_from: "voiding", urine_measured: true, bags: [] }`
- **THEN** the hints read, in order, `Auto-detect`, `Commode pan`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Urinal`, `Bedpan`, `Emesis basin`
- **AND** the only requests are `GET /api/beds/<token>` and `GET /api/admissions/<id>/entries`

#### Scenario: Catheter and drain
- **WHEN** a nurse opens 2C bed 2, whose `devices` has `urine: "catheter"` and `bags: ["urine_bag", "drain_bag"]`
- **THEN** the hints read, in order, `Auto-detect`, `Urine bag`, `Drain bag`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Urinal`, `Bedpan`, `Commode pan`, `Emesis basin`, with no `Stoma bag`

#### Scenario: Default urinal
- **WHEN** a bed has `devices` `{ urine: "urinal", urine_from: "default", urine_measured: true, bags: [] }`
- **THEN** the hints read `Auto-detect`, `Urinal`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Bedpan`, `Commode pan`, `Emesis basin`

#### Scenario: Urine by hand
- **WHEN** on 3A bed 4 (commode) 220 mL of urine is saved by hand, and on a default urinal bed 180 mL
- **THEN** the requests are `POST /api/admissions/<id>/entries` with `{ direction: "out", category: "urine", volume_ml: 220, item: "commode pan", source: "manual" }`, and with `volume_ml: 180` and `item: "urinal"`

#### Scenario: Toilet
- **WHEN** Ravi Kumar opens 3A bed 7, whose `devices` is `{ urine: "toilet", urine_from: "voiding", urine_measured: false, bags: [] }`, and saves 300 mL of urine by hand
- **THEN** the hints read `Auto-detect`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Urinal`, `Bedpan`, `Commode pan`, `Emesis basin`
- **AND** the urine form shows `Urine is not measured on this bed (toilet).`, and the request has `item: null`

### Requirement: Bag photo on a bed without that bag
A photo read as a bag not in the bed's `devices.bags` SHALL be drafted and saved as any bag reading, its check screen showing `No catheter on the care plan for this bed. Saving charts it and asks the nurse to review.` (`No stoma` or `No drain` for those bags). After saving, a nurse or matron is offered "Add catheter" ("Add stoma", "Add drain"), opening that care-plan form, whose save sends one `PUT` and reloads the bed. The mismatch makes no extra `/api/ai` request.

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens 3A bed 5, whose `devices.bags` is `[]`, and a photo is read as a urine bag at 300 mL
- **THEN** the check screen shows `No catheter on the care plan for this bed. Saving charts it and asks the nurse to review.`
- **AND** no request was sent beyond the bed screen's load and the one `/api/ai/read`
- **AND** saving sends exactly two requests: `POST /api/admissions/<id>/media` with `kind: photo`, then `POST /api/admissions/<id>/bag-readings` with `container: "urine_bag"`
- **AND** the saved screen offers no "Add catheter"

#### Scenario: Nurse adds the catheter
- **WHEN** Anita Thomas (id 4, nurse) saves the same reading, taps "Add catheter", keeps "Urethral" and "Inserted" today, and saves
- **THEN** the requests after the reading are `PUT /api/admissions/<id>/care/catheter` with `type: "urethral"` and `X-Staff-Id: 4`, then `GET /api/admissions/<id>/entries`
- **AND** no `/api/ai` request is sent

#### Scenario: Bag on record
- **WHEN** a photo is read as a urine bag on 3A bed 3, whose `devices.bags` is `["urine_bag"]`
- **THEN** the check screen shows no `No catheter` warning, and the saved screen offers no "Add catheter"

#### Scenario: Drain on a stoma bed
- **WHEN** on 2C bed 3, whose `devices.bags` is `["stoma_bag"]`, a photo is read as a drain bag at 200 mL
- **THEN** the check screen shows `No drain on the care plan for this bed. Saving charts it and asks the nurse to review.`

### Requirement: Drink on the check screen
A draft with a `drink` SHALL show on the check screen with the kind's icon and `<Kind> · <mL>` (`Drink` for `other`), its item below when that differs from the label ignoring case, and a `Drink` picker of the eleven kinds set to its kind. Picking another kind sets `drink` and the item to the new label. The by-hand form for `water` offers the same picker, unset. Saving sends `drink` and `item`, and no `/api/ai` request.

#### Scenario: Masala chai photo
- **WHEN** a photo read returns a draft `{ in, water, 150 mL, item: "masala chai", drink: tea }`, and the attendant saves it
- **THEN** the check screen shows the tea icon, `Tea · 150 mL` and `masala chai`, with `Tea` picked
- **AND** saving makes exactly two requests, `POST /api/admissions/<id>/media`, then `POST /api/admissions/<id>/entries` with `drink: "tea"` and `item: "masala chai"`

#### Scenario: Kind changed
- **WHEN** that draft's picker is changed to `Coffee` before saving
- **THEN** the screen shows `Coffee · 150 mL`, and the entry post has `drink: "coffee"` and `item: "Coffee"`

#### Scenario: Coconut water by hand
- **WHEN** the attendant picks Drink by hand, 200 mL, and `Coconut water` in the picker, and saves
- **THEN** the only request is `POST /api/admissions/<id>/entries` with `{ direction: "in", category: "water", volume_ml: 200, drink: "coconut_water", item: "Coconut water", source: "manual" }`

#### Scenario: Output draft
- **WHEN** a photo read returns a urine draft from a urinal
- **THEN** the check screen shows no `Drink` picker, and the entry post has no `drink`

### Requirement: Labeled copy drawn at the bed
Saving a photo whose read has segmentation SHALL draw on the device a labeled copy, the uploaded photo's own pixels at its size with the segmentation or tray overlay drawn in (contours, surface line, labels with quantities), as JPEG, and upload it once as photo media after the photo. It makes 0 model requests. A failed draw or upload is not retried; the app saves the record without `labeled_media_id` and shows `Labeled copy not kept`. Spark-only reads and photos without a read get no copy.

#### Scenario: Urine bag copy
- **WHEN** a 1000 × 1000 photo read in `sam+spark` mode with container `urine_bag`, fill fraction 0.463 and `fluid_volume_ml: 930` is saved
- **THEN** the second `POST /api/admissions/:id/media` carries a 1000 × 1000 JPEG with the labels `Urine bag` and `Liquid · 46% full ≈ 930 mL` drawn in, and no `/api/ai` request is sent

#### Scenario: Tray copy
- **WHEN** a tray read with region 1 named rice, Half, and region 2 cited by the fluid tea, 150 mL, is saved
- **THEN** the labeled copy has `1 rice · Half` and `2 tea · 150 mL` drawn in

#### Scenario: Copy upload fails
- **WHEN** the labeled copy's media request answers 500
- **THEN** the entry is posted with its `media_id` and no `labeled_media_id`, the save result reads `Labeled copy not kept`, and the media request is not resent

#### Scenario: No read, no copy
- **WHEN** a typed bag level is saved with a photo, or an after-emptying photo, or a served tray photo
- **THEN** exactly one media upload is made for it, and no labeled copy
