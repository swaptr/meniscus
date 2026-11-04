# web/ward-round Specification

## Purpose
Bulk capture on a multi-bed ward: photograph a bed's QR card, then its containers, bed after bed, and confirm all drafts at the end.

## Requirements

### Requirement: Bed card switches the bed
A round photo whose QR code is a Meniscus bed link (`…/a/bed/<token>`) SHALL make that bed current, making no model request; a QR code that is not a bed link SHALL be reported and change nothing.

#### Scenario: Bed card photo
- **WHEN** a photo decodes to `https://ward.example/a/bed/abcDEF123_-xyz0000000`
- **THEN** the token `abcDEF123_-xyz0000000` is looked up and that bed becomes current, with no `/api/ai` request

#### Scenario: Foreign QR
- **WHEN** a photo decodes to `https://example.com/menu`
- **THEN** it is reported as not a bed card and the current bed is unchanged

### Requirement: Readings join the current bed
A round photo without a bed link SHALL be queued as a reading for the current bed; with no current bed it SHALL be rejected with a prompt to scan a bed card first and make no request.

#### Scenario: Two beds
- **WHEN** bed 1's card, a bag photo, bed 2's card and two photos are taken
- **THEN** the queue holds one reading for bed 1 and two for bed 2, in that order

#### Scenario: No bed yet
- **WHEN** the first photo of a round has no bed card
- **THEN** nothing is queued and the user is asked to scan a bed card

### Requirement: One read per photo, in order
Queued readings, photos and recordings alike, SHALL be read one at a time in queue order, each with exactly one read request: a photo's is one `POST /api/ai/read`, making 3 model requests in `sam+spark` and 1 in `spark`, per its response's `mode`; a recording's is one `POST /api/ai/voice-note`, making 2. A refused read makes 0. A failed read is marked failed and read again only on a Retry tap; after a 429, Retry stays disabled until its `Retry-After`.

#### Scenario: Three photos, one fails
- **WHEN** three readings are queued and the second read fails
- **THEN** exactly three read requests are made in capture order
- **AND** the second reading is marked failed, and the third is still read

#### Scenario: Fast mode
- **WHEN** fast mode is on
- **THEN** each photo read request asks for mode `spark`

#### Scenario: Photo then recording
- **WHEN** a photo and then a recording are queued for bed 2
- **THEN** exactly two read requests are made, in order: `POST /api/ai/read`, then `POST /api/ai/voice-note`
- **AND** the voice-note request carries no read mode

#### Scenario: Mode from each response
- **WHEN** at 10:40 three photos are queued and their read responses are 200 with `mode: "sam+spark"`, 200 with `mode: "spark"` and the warning `budget pressure: read without segmentation`, and 429 `request_budget_exceeded` with `Retry-After: 1200`
- **THEN** exactly three read requests are made, in order, and none is sent again
- **AND** the second reading shows its `budget pressure` warning
- **AND** the third is marked failed, with Retry disabled until 11:00 and enabled after it

### Requirement: Save the round
"Save all high-confidence" SHALL save every unsaved photo reading with a draft whose confidence is at least 0.75. Each save uploads its photo once and, when segmented, its labeled copy, then posts the entry, the level for a jug or bottle, or the bag reading for urine, stoma and drain bags, with those ids. A bag reading takes its picked event ("Bag readings in the round"). A reading answered 409 `duplicate_reading` and every other reading, recordings included, stay for individual review.

#### Scenario: Mixed round
- **WHEN** a round has photo readings at confidence 0.9 (urine bag), 0.8 (water jug) and 0.5 (urinal), plus one recording
- **THEN** one bag reading and one level are saved, each after its own media uploads
- **AND** the 0.5 reading and the recording stay unsaved

#### Scenario: Two wards
- **WHEN** a round reads a urine bag at confidence 0.9 on 3A bed 3 and one on HDU bed 1, and "Save all high-confidence" is tapped
- **THEN** the 3A bag-reading request has `event: "emptied"` and the HDU one `event: "check"`, each after its own media uploads
- **AND** saving sends no `/api/ai` request

#### Scenario: Duplicate left for review
- **WHEN** "Save all high-confidence" posts urine-bag readings for 3A beds 3 and 5, and bed 3's post answers 409 `duplicate_reading`
- **THEN** bed 5's reading is saved and bed 3's stays unsaved
- **AND** tapping "Save all high-confidence" again sends no request for bed 3

### Requirement: Ward progress
A round started for a ward SHALL show that ward's beds, each marked visited once its bed card is scanned in the round, making no model request. A card from another ward SHALL still make that bed current and be reported as being on another ward, leaving the grid unchanged.

#### Scenario: Two beds visited
- **WHEN** a round for ward 5B with beds 1–6 scans the cards of bed 4 and then bed 1
- **THEN** beds 1 and 4 are marked visited, beds 2, 3, 5 and 6 are not, and no `/api/ai` request was made

#### Scenario: Card from another ward
- **WHEN** the card of ward 3A bed 2 is scanned during a round for ward 5B
- **THEN** 3A bed 2 becomes current, the photo is reported as `other_ward`, and no 5B bed changes its visited mark

### Requirement: Voice in the round
With a bed current, the round SHALL offer Record. Stopping queues the recording as a reading for that bed. With no current bed, it SHALL ask the user to scan a bed card first and record nothing. Reading it makes one `POST /api/ai/voice-note` (2 model requests). Its reading shows a player, the transcript and each drafted entry. Saving it makes one media upload and then one entry post per draft.

#### Scenario: Dictated at bed 2
- **WHEN** bed 2 is current and a recording that drafts 200 mL tea and 300 mL urine is read and saved
- **THEN** the queue held one reading for bed 2, read with exactly one `POST /api/ai/voice-note`
- **AND** saving made one `POST /api/admissions/<bed 2>/media` with `kind: voice`, then two entry posts with its `media_id`

#### Scenario: Record before any card
- **WHEN** no bed is current
- **THEN** Record asks the user to scan a bed card first, and nothing is queued

### Requirement: Import in bulk
"Import" SHALL accept many images and audio files at once and process them in the order given:
- An image with a QR code is handled as in "Bed card switches the bed" and is not read: a bed link switches the bed, any other QR is reported.
- An image with no QR code, or an audio file, joins the bed current at that point.
- A file before any bed card is skipped with the scan prompt.
- Other file types are reported as unsupported and skipped.

Importing makes no model request.

#### Scenario: Two beds from the gallery
- **WHEN** these files are imported, in order: bed 2's card, a bag photo, `rec1.m4a`, bed 4's card, a jug photo, `notes.txt`
- **THEN** bed 2 has a photo reading and a recording reading, and bed 4 has a photo reading
- **AND** `notes.txt` is reported as unsupported, and no `/api/ai` request has been made

#### Scenario: Foreign QR in an import
- **WHEN** bed 2's card, then a photo whose QR code is `https://example.com/menu`, then a bag photo are imported
- **THEN** the menu photo is reported as not a bed card and is not queued
- **AND** bed 2 stays current and has one photo reading

### Requirement: Requests before reading
Imported readings SHALL wait until the user taps `Read <n> · <k> model requests`. Here `k` counts 3 per photo (1 in fast mode) and 2 per recording. Readings captured live are read at once, as before.

#### Scenario: Imported queue
- **WHEN** 3 photos and 2 recordings are imported
- **THEN** the button reads `Read 5 · 13 model requests`, and `Read 5 · 7 model requests` in fast mode
- **AND** no `/api/ai` request is made until it is tapped

### Requirement: Round reads and saves carry their read
In a ward round, each reading's read request SHALL carry its bed's `admission_id`, and each save its reading's `read_id` (with `read_draft` for a recording's drafts), in the request that saves it. No request is added: a photo read stays 3 model requests (1 in `spark` mode) and a recording 2, and `Read <n> · <k> model requests` counts the same. A reading whose read answered `READ_ABANDON_HOURS` less 5 minutes or more ago, by the device's clock, is saved without it.

#### Scenario: Two beds
- **WHEN** bed 2's card, a urinal photo, bed 4's card and a jug photo are taken
- **THEN** the two read requests are `POST /api/ai/read` with `admission_id` of bed 2, then of bed 4

#### Scenario: Save all high-confidence
- **WHEN** the urinal photo was read with `read_id: 51` at confidence 0.9 and the jug photo with `read_id: 52` at 0.8, and "Save all high-confidence" is tapped
- **THEN** the entry post for bed 2 has `read_id: 51` and the level post for bed 4 `read_id: 52`, each after its own media uploads, and no other request is sent
- **AND** with both read in `sam+spark` mode with segmentation, exactly six requests are sent: for each bed, the photo upload, its labeled copy upload, then the post with `labeled_media_id`

#### Scenario: Bag reading
- **WHEN** a urine bag photo for bed 2 was read with `read_id: 54` at confidence 0.9, and "Save all high-confidence" is tapped
- **THEN** after its media uploads, the one `POST /api/admissions/<bed 2>/bag-readings` has `container: "urine_bag"`, `source: "photo"`, its `media_id` and `read_id: 54`
- **AND** read in `spark` mode, with `segmentation: null`, exactly two requests are sent: the photo upload, then that post with no `labeled_media_id`

#### Scenario: Stale reading
- **WHEN** a urinal photo for bed 2 was read at 08:00 by the device's clock, and its reading is saved at 19:55
- **THEN** its entry post carries no `read_id`, and the entry is saved

#### Scenario: Recording with two drafts
- **WHEN** a recording for bed 2 is read with `read_id: 53`, drafting 200 mL tea and 300 mL urine, and both are saved
- **THEN** after one media upload, the two entry posts carry `read_id: 53` with `read_draft` 0 and 1

#### Scenario: Dropped draft
- **WHEN** a recording read with `read_id: 53` drafts 200 mL tea and 300 mL urine, the tea draft is removed, and the reading is saved
- **THEN** after one media upload, exactly one entry post is sent, with `read_id: 53` and `read_draft: 1`

#### Scenario: Imported queue
- **WHEN** 3 photos and 2 recordings are imported
- **THEN** the button still reads `Read 5 · 13 model requests`

### Requirement: Round saves resume after a failure
In a ward round, each draft of a reading SHALL be marked saved as soon as its post succeeds, so saving again after a failure posts only the drafts not yet saved. A retried post answered 400 with the issue `already linked` at `read_id` counts that draft as saved. Whether the posts carry the `read_id` is decided at the reading's first save attempt and kept for every retry. A retry makes no model request and adds no request beyond the posts of unsaved drafts.

#### Scenario: Second draft fails
- **WHEN** a recording for bed 2 read with `read_id: 53` drafts 200 mL tea and 300 mL urine, saving posts the tea (201) and the urine post fails with a network error, and Save is tapped again
- **THEN** the retry sends exactly one request, the entry post with `read_id: 53` and `read_draft: 1`, and no media upload
- **AND** when it answers 201 the reading is saved with both entries

#### Scenario: Already linked
- **WHEN** the urine post of that recording reached the server but its response was lost, and Save is tapped again
- **THEN** the retried post with `read_id: 53` and `read_draft: 1` answers 400 with `{ path: "read_id", message: "already linked" }`
- **AND** the reading shows as saved, with no error and no further request

#### Scenario: Retry past the margin
- **WHEN** a recording for bed 2 read with `read_id: 53` at 08:00 by the device's clock drafts 200 mL tea and 300 mL urine, saving at 19:54 posts the tea (201) and the urine post fails with a network error, and Save is tapped again at 19:56
- **THEN** the retry's one entry post carries `read_id: 53` and `read_draft: 1`

### Requirement: Bag readings in the round
Each bag photo reading in a ward round SHALL show its event as one choice of `Check`, `Emptied` and `Bag changed`, starting at `Emptied` when its bed's reading interval, catheter's included, is 4 h or more, else `Check`, and save with the event picked. A save answered 409 `duplicate_reading` shows `Same as the reading at <time>: <event> at <level> mL.` and "Save anyway", which resends it once with `confirm_duplicate_of` that reading's id and no new upload. Saving makes no `/api/ai` request.

#### Scenario: Per-reading event
- **WHEN** a 3A round reads urine bags at confidence 0.9 for beds 3 and 5, both start at `Emptied`, `Check` is picked on bed 5's reading, and "Save all high-confidence" is tapped
- **THEN** bed 3's bag-reading post has `event: "emptied"` and bed 5's `event: "check"`, each after its own media upload

#### Scenario: Bag changed
- **WHEN** `Bag changed` is picked on bed 3's reading
- **THEN** it is the only event selected on that reading, and its bag-reading post has `event: "bag_changed"`

#### Scenario: Catheter interval
- **WHEN** in the round's ward list 3A bed 5's catheter order has `measure_every_h: 1`
- **THEN** its bag reading starts at `Check`, and "Save all high-confidence" posts it with `event: "check"`

#### Scenario: Duplicate
- **WHEN** bed 3's bag-reading post, after its media upload, answers 409 with `duplicate_of` `{ id: 101, event: "emptied", volume_ml: 380, created_at: <11:00> }`
- **THEN** bed 3's reading shows `Same as the reading at 11:00: emptied at 380 mL.` with "Save anyway", is not saved, and nothing is resent
- **AND** tapping "Save anyway" sends exactly one request, the bag-reading post with the same `media_id` and `read_id` and `confirm_duplicate_of: 101`

#### Scenario: Saved message
- **WHEN** bed 3's emptying at 380 mL is saved and its response holds a 120 mL entry
- **THEN** bed 3's reading reads `Urine bag emptied at 380 mL: 120 mL charted. Waiting for nurse approval.`

### Requirement: Bag readings on beds without the bag
A ward-round bag photo reading whose bag is not in its bed's `devices.bags`, from the round's ward list, SHALL show `No catheter on the care plan: saving asks the nurse to review.` (`No stoma`, `No drain` for those bags) and save as any bag reading, "Save all high-confidence" included. It makes no request beyond the round's own: its ward list, one `/api/ai/read` per photo and the saves.

#### Scenario: Default urinal bed
- **WHEN** a 3A round reads urine bags at confidence 0.9 for bed 3 (`devices.bags` `["urine_bag"]`) and bed 5 (`devices.bags` `[]`)
- **THEN** bed 5's reading shows `No catheter on the care plan: saving asks the nurse to review.`, and bed 3's shows no such line
- **AND** "Save all high-confidence" uploads and posts both bag readings, each after its own media upload, and sends no `/api/ai` request

#### Scenario: Stoma bed
- **WHEN** the round reads a stoma bag on 2C bed 3 (`devices.bags` `["stoma_bag"]`), and a drain bag on the same bed
- **THEN** the stoma reading shows no warning, and the drain reading shows `No drain on the care plan: saving asks the nurse to review.`
