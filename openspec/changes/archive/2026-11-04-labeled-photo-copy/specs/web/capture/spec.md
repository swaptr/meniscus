# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Tray photo saved with the meal
Saving a meal filled from a tray photo SHALL upload the photo once as photo media, then its labeled copy when the read has segmentation, and post the meal with its `media_id` and any `labeled_media_id`. A meal entered by hand uploads nothing.

#### Scenario: Lunch from a tray
- **WHEN** a meal filled from a `sam+spark` tray read with 2 regions is saved
- **THEN** exactly three requests are made: two `POST /api/admissions/:id/media` with `kind: photo` (the tray, then its labeled copy), then `POST /api/admissions/:id/meals` with its `media_id` and `labeled_media_id`

#### Scenario: Spark-only tray
- **WHEN** a meal filled from a `spark` tray read, with `segmentation: null`, is saved
- **THEN** exactly two requests are made: `POST /api/admissions/:id/media` with `kind: photo`, then `POST /api/admissions/:id/meals` with its `media_id` and no `labeled_media_id`

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
