# charting/model-accuracy Specification

## Purpose
Measuring the models in the ward. Every photo, typed and voice read is logged as closed-list classes and numbers, each saved record is linked to the read it came from, and each draft's outcome is derived from what staff kept. These are summarised per read kind and per class, positives and negatives, with the same scoring as the lab eval of container photos. None of it adds a model request.

## Requirements

### Requirement: Reads are logged
Each `POST /api/ai/read`, `/api/ai/note` and `/api/ai/voice-note` that answers 200 SHALL store one read and return its id as `read_id`. The read holds the kind (`photo`, `text`, `voice`), photo mode, model ids, signed-in staff, `admission_id` if given, time, confidence, issues, `needs_review`, container hint, number of drafts, and the model's classes and numbers. Upstream requests stay: photo 3 (1 in `spark` mode), text 1, voice 2.

#### Scenario: Photo read
- **WHEN** signed in as Ravi Kumar (id 1), a JPEG is posted to `/api/ai/read` in `sam+spark` mode with the `admission_id` of 3A bed 1, and Spark reads container `urine_bag`, fluid `urine`, 450 mL of 2000 mL, marks visible, `urine_colour` `dark`, confidence 0.9 and no issues
- **THEN** the response is 200 with a `read_id`
- **AND** the stored read with that id has:
  - kind `photo`, mode `sam+spark`, models `sam-3.1` and `muse-spark-1.3`, staff 1, that admission;
  - confidence 0.9, issues `[]`, `needs_review: false`, no hint, 1 draft;
  - container `urine_bag`, fluid `urine`, volume 450, capacity 2000, marks visible, colour `dark`;
  - a draft of type `urine`, 450 mL, colour `dark`
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Spark-only read
- **WHEN** a JPEG is posted to `/api/ai/read` in `spark` mode
- **THEN** the stored read has kind `photo`, mode `spark` and models `muse-spark-1.3` only
- **AND** the upstream received exactly one request

#### Scenario: Text note
- **WHEN** `{ text: "coconut water 200" }` is posted to `/api/ai/note` and the model calls `log_entry` once with `in`, `water`, 200
- **THEN** the stored read has kind `text`, mode null, 1 draft of type `water` and 200 mL
- **AND** the upstream received exactly one Spark request

#### Scenario: Voice note with two drafts
- **WHEN** a recording is posted to `/api/ai/voice-note`, transcribed as `bed 4 had 200 mL tea and passed 300 mL urine`, and the model calls `log_entry` for `water` 200 mL and `urine` 300 mL
- **THEN** the stored read has kind `voice`, models `muse-voice-transcribe-1.0` and `muse-spark-1.3`, and 2 drafts: `water` 200 mL (draft 0) and `urine` 300 mL (draft 1)
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: Failed read or explain
- **WHEN** Spark answers 429 during a `spark` mode photo read, and a bed with prompts is explained through `POST /api/ai/explain`
- **THEN** the read gets 429 and the explanation 200
- **AND** no read is stored for either, and the upstream received exactly one request for each

### Requirement: Read log holds no text
A stored read SHALL hold only closed-list values (read kind, mode, model ids, container, fluid, drink and meal fluid kinds, entry type, urine colour, dish kind, portion basis, issue codes), numbers, booleans, ids and times. It never holds a transcript, note text, image, image hash, reading basis, appearance, dish, fluid or drink name, mask, box, draft item or notes, or model reply. The only log lines about a read are the model-API lines (path, model, status, timing). This adds no model request.

#### Scenario: Voice note
- **WHEN** a voice note is transcribed as `bed 4 had rice and a kokum sherbet, 200 mL`, and the model drafts item `kokum sherbet`, notes `half the glass, with rice`, `water` 200 mL, drink `other`
- **THEN** no column of the stored read contains `rice`, `kokum`, `sherbet`, `bed 4` or `half the glass`
- **AND** no line the server logged contains them
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: Photo read
- **WHEN** a photo read returns reading basis `between the 400 and 500 marks`, appearance `pale yellow, clear` and `drink_name` `masala chai`
- **THEN** no column of the stored read contains `between the 400 and 500 marks`, `pale yellow, clear` or `masala`
- **AND** every string in its stored output is a value of `READ_KINDS`, `CONTAINER_KINDS`, `FLUID_KINDS`, `DRINK_KINDS`, the entry types, `URINE_COLOURS` or `READING_ISSUES`

#### Scenario: Tray read
- **WHEN** a tray photo is read in `sam+spark` mode, and the model names `paneer tikka` (dish kind `curry_vegetables`, region 1, half eaten) and `masala chai` (fluid kind `tea`, 150 mL), with notes `left the roti`
- **THEN** no column of the stored read contains `paneer`, `masala`, `roti`, the read's `image_sha256`, a region box or a mask's bits
- **AND** every string in its stored output is a value of `READ_KINDS`, `DISH_KINDS`, `MEAL_FLUID_KINDS`, `PORTION_BASES` or `MEAL_ISSUES`, and no line the server logged contains `paneer` or `masala`
- **AND** the upstream received exactly 3 requests: two SAM and one Spark

### Requirement: Reads name their bed
`POST /api/ai/read`, `/api/ai/note` and `/api/ai/voice-note` SHALL accept an optional `admission_id`, as a form field or, for `/note`, a JSON field. An unknown admission gets 404 `not_found` with no model request and nothing stored. The id is never sent upstream and never changes a request's body; its bed sets only the budget class (capture/read-budget). Requests: photo 3 in `sam+spark` mode and 1 in `spark` mode, text 1, voice 2; 0 when refused.

#### Scenario: Unknown bed
- **WHEN** a JPEG is posted to `/api/ai/read` and a note to `/api/ai/note`, each with `admission_id: 9999`
- **THEN** both responses are 404 with `error: not_found`
- **AND** the upstream received no request, and no read is stored

#### Scenario: Not sent upstream
- **WHEN** `{ text: "coconut water 200" }` is posted to `/api/ai/note` once without `admission_id` and once with the id of bed 1
- **THEN** the two Spark request bodies are identical, and neither contains bed 1's patient name
- **AND** the second stored read names bed 1's admission and the first names none

#### Scenario: Bed picks the class
- **WHEN**, with a cap of 120, a 30 % reserve and 84 requests in use, the same JPEG is posted to `/api/ai/read` in `sam+spark` mode once with HDU bed 1's id and once with 3A bed 4's id
- **THEN** the HDU read is 200 with `mode: "sam+spark"` after exactly 3 upstream requests
- **AND** the 3A read is 429 with `budget_class: "routine"`, the upstream received no request for it, and no read is stored for it
- **AND** the HDU Spark request body contains neither an admission id nor a patient name

### Requirement: Link a saved record to its read
`POST /api/admissions/:id/entries` and `/levels` SHALL accept `read_id`, entries also `read_draft` (the draft's index, default 0), and store the link with the record in one transaction. A photo read links one entry or level; a note read links one entry per draft. Linking adds no HTTP request, and the save makes 0 model requests.

#### Scenario: Photo entry
- **WHEN** a photo read of a `urinal` by Ravi Kumar for bed 1 returns `read_id` 41, and he posts a 450 mL urine entry with `source: photo` and `read_id: 41` for bed 1
- **THEN** the response is 201, and draft 0 of read 41 is linked to that entry
- **AND** the upstream received no request for the post

#### Scenario: Two drafts of a voice note
- **WHEN** a voice read of bed 1 with 2 drafts returns `read_id` 42, and 200 mL tea is posted with `read_id: 42, read_draft: 0` and 300 mL urine with `read_id: 42, read_draft: 1`
- **THEN** both responses are 201, and drafts 0 and 1 of read 42 are linked to those two entries

#### Scenario: Jug level
- **WHEN** a photo read of a `water_jug` at 600 mL on bed 1 returns `read_id` 43, and a level of 600 mL is posted with `read_id: 43` after a 1000 mL level
- **THEN** the response is 201 with a 400 mL intake entry
- **AND** read 43 is linked to the level, not to the entry

### Requirement: Link checks
A link that fails a check SHALL get 400 `invalid_request` with an issue at `read_id` or `read_draft`, storing nothing and making 0 model requests. The read must exist, be by the signed-in staff member, name the record's admission, be under `READ_ABANDON_HOURS` old, and match the source (`photo`, `text`, `voice` entries; `photo` levels). Its draft must exist and be unlinked, else `already linked` at `read_id`. `read_draft` needs `read_id`.

#### Scenario: Linked twice
- **WHEN** an entry is posted with `read_id: 41`, and then the same entry again with `read_id: 41`
- **THEN** the responses are 201 and 400 with `error: invalid_request` and the issue `{ path: "read_id", message: "already linked" }`
- **AND** the bed holds one entry

#### Scenario: No such draft
- **WHEN** read 42 has 2 drafts, and an entry is posted with `read_id: 42, read_draft: 2`
- **THEN** the response is 400 with `error: invalid_request` and an issue at `read_draft`, and no entry is stored

#### Scenario: Another staff member or bed
- **WHEN** read 41 was made by Ravi Kumar (id 1) for bed 1, and an entry linking it is posted signed in as Sunita Devi (id 2) for bed 1, and another signed in as Ravi Kumar for bed 2
- **THEN** both responses are 400 with `error: invalid_request`, and no entry is stored

#### Scenario: Bedless read
- **WHEN** Ravi Kumar posts a JPEG to `/api/ai/read` without `admission_id` and gets `read_id` 46, and then posts a urine entry for bed 1 with `read_id: 46`
- **THEN** the entry response is 400 with `error: invalid_request` and an issue at `read_id`, and no entry is stored

#### Scenario: Draft index without a read
- **WHEN** an entry is posted for bed 1 with `read_draft: 0` and no `read_id`
- **THEN** the response is 400 with `error: invalid_request` and an issue at `read_draft`, and no entry is stored

#### Scenario: Too old
- **WHEN** two photo reads are made at 08:00, and an entry linking the first is posted at 19:59 and one linking the second at 20:00
- **THEN** the first response is 201 and the second is 400 with `error: invalid_request`

#### Scenario: Wrong kind or unknown read
- **WHEN** each of these is posted:
  - a photo read on a `voice` entry;
  - a text read on a `manual` entry;
  - a text read on a level;
  - `read_id: 9999`
- **THEN** each response is 400 with `error: invalid_request`, nothing is stored, and the upstream received no request

### Requirement: Link a bag reading to its read
`POST /api/admissions/:id/bag-readings` SHALL accept `read_id` and link the reading (the level, not its entry, even with no entry) in its transaction. The "Link checks" apply: the read is by the signed-in staff member, names that admission, is under `READ_ABANDON_HOURS` old, is a `photo` read for a `photo` reading, and is unlinked; a failed check gets 400 at `read_id` and stores nothing. No `read_id`, no link. It makes 0 model requests.

#### Scenario: Emptying linked
- **WHEN** signed in as Ravi Kumar (id 1), a photo read for 3A bed 3 reads a `urine_bag` at 380 mL and returns `read_id` 47, and `{ container: "urine_bag", event: "emptied", volume_ml: 380, source: "photo", media_id: <its photo>, evidence: <the read's>, read_id: 47 }` is posted to `/api/admissions/<3A bed 3>/bag-readings`
- **THEN** the response is 201, and read 47 is linked to that reading, not to the entry it charted
- **AND** the upstream received no request for the post

#### Scenario: Nothing charted
- **WHEN** 3A bed 3's urine bag was checked at 300 mL at 10:02, and at 10:13 a check at 300 mL from photo read 48 is posted with `source: "photo"`, its `media_id` and `read_id: 48`
- **THEN** the response is 201 with `rise_ml: 0` and `entry: null`, and read 48 is linked to that reading

#### Scenario: Photo, level typed
- **WHEN** Ravi Kumar posts `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "photo", media_id: <a photo of 3A bed 3> }` for 3A bed 3, with no `evidence` and no `read_id`, and no read was made
- **THEN** the response is 201, no read is linked to the reading, and `GET /api/quality/model?ward=<3A>` counts 0 in every outcome

#### Scenario: Refused links
- **WHEN** each of these urine bag readings is posted for 3A bed 3, read 47 being unlinked:
  - with `read_id: 47`, signed in as Sunita Devi (id 2);
  - with the `read_id` of Ravi Kumar's photo read for 3A bed 1;
  - with the `read_id` of Ravi Kumar's text read for 3A bed 3;
  - with `source: "manual"`, no media and `read_id: 47`;
  - with `read_id: 47`, 12 hours after read 47
- **THEN** each response is 400 with `error: invalid_request` and an issue at `read_id`, no reading is stored, and the upstream received no request

#### Scenario: Posted again
- **WHEN** the 380 mL emptying linked to read 47 is posted a second time with `read_id: 47`
- **THEN** the response is 400 with the issue `{ path: "read_id", message: "already linked" }`
- **AND** the bag holds one reading and one 380 mL entry

### Requirement: Outcome of a saved draft
Each draft linked to an entry SHALL get one outcome, derived on request from the entry and its history, the first that applies: `pending` while unreviewed; `rejected` when the entry is rejected; `corrected_by_nurse` when approved at another volume or amended in type, volume or urine colour; `edited_at_capture` when saved with another type, volume or colour than drafted; else `accepted`. An amend of only a drink's consistency changes nothing. It makes 0 model requests.

#### Scenario: Accepted
- **WHEN** a 3A photo read of a `urinal` drafts 450 mL urine, saved and approved unchanged
- **THEN** `GET /api/quality/model?ward=2` shows the `photo` `sam+spark` row with `accepted` 1 and every other outcome 0, and its volume error counts 1 draft, 1 of 1 within tolerance

#### Scenario: Edited at capture
- **WHEN** a photo read drafts 300 mL urine, and the attendant saves it as 350 mL, and a nurse approves it unchanged
- **THEN** that row shows `edited_at_capture` 1, and its volume error counts 1 draft, 0 of 1 within tolerance

#### Scenario: Nurse amend
- **WHEN** a photo read of a `cup` drafts 250 mL `water`, saved and approved unchanged, and then amended to type `food` with reason `it was soup`
- **THEN** that row shows `corrected_by_nurse` 1
- **AND** the type table's `water` row has 0 of 1 kept and lists the correction `food` 1

#### Scenario: Corrected at approval, rejected and pending
- **WHEN** one photo draft of 450 mL is approved as 400 mL, one is rejected as `duplicate`, and one is saved and not yet reviewed
- **THEN** the row shows `corrected_by_nurse` 1, `rejected` 1 and `pending` 1
- **AND** the volume error counts the corrected draft only: 1 draft, 0 of 1 within tolerance

#### Scenario: Consistency only
- **WHEN** a text note's 200 mL drink is saved and approved unchanged, and then amended with only `iddsi_level: 2`
- **THEN** the `text` row shows `accepted` 1

### Requirement: Outcome of a saved level
A draft linked to a jug level or a bag reading SHALL be settled at save: `edited_at_capture` when the saved level (`volume_ml`) differs from the drafted volume, else `accepted`. Nothing later changes it: not a nurse's action on the entry it charted, nor a bag reading's missing entry, rise or later fall. Its final type is `water` for a jug and `BAG_CATEGORY` of the bag (`urine`, `stoma` or `drain`), its final volume the saved level, with no urine colour score. It makes 0 model requests.

#### Scenario: Bag reading
- **WHEN** a photo read for 3A bed 3 drafts 400 mL `urine` from a `urine_bag`, the reading is saved at 380 mL linked to it, and a nurse approves the entry it charted at 300 mL
- **THEN** the `photo` `sam+spark` row shows `edited_at_capture` 1 and `corrected_by_nurse` 0, and its volume error counts 1 draft, 1 of 1 within tolerance
- **AND** the type table's `urine` row has 1 of 1 kept

#### Scenario: No entry, then a fall
- **WHEN** a photo read for 3A bed 3 drafts 300 mL `urine` from a `urine_bag`, and its check is saved at 300 mL linked to it just after a 300 mL check, so it charts no entry, and the bag is later checked by hand (`source: "manual"`) at 150 mL, a fall
- **THEN** the `photo` `sam+spark` row shows `accepted` 1, and its volume error counts 1 draft, 1 of 1 within tolerance

#### Scenario: Drain bag
- **WHEN** a photo read of a `drain_bag` drafts 200 mL `urine`, and the reading is saved at 200 mL linked to it
- **THEN** the row shows `accepted` 1
- **AND** the type table's `urine` row has 0 of 1 kept with the correction `drain` 1, and there is no `water` row

#### Scenario: Jug level
- **WHEN** a photo read of a `water_jug` drafts 600 mL, and a level of 600 mL is saved linked to it, and then one of 550 mL from a read that drafted 500 mL
- **THEN** the row shows `accepted` 1 and `edited_at_capture` 1
- **AND** the type table's `water` row has 2 of 2 kept, and the urine colour table is empty

### Requirement: Unsaved drafts
A draft with no link that is not `retaken` ("Retaken tray reads") SHALL be `open` while its read is less than `READ_ABANDON_HOURS` (12 h) old, the draft of a negative read included. From then on it is `abandoned`, or `negative_confirmed` for a negative read. Open drafts count in no rate and in no negative count. This makes 0 model requests.

#### Scenario: Never saved
- **WHEN** a photo read at 08:00 drafts 450 mL urine and nothing is saved
- **THEN** at 19:59 the summary shows `open` 1 and `abandoned` 0
- **AND** at 20:00 it shows `open` 0 and `abandoned` 1

#### Scenario: One draft of two saved
- **WHEN** a voice read at 08:00 drafts 200 mL tea and 300 mL urine, and only the tea is saved and approved unchanged
- **THEN** at 20:00 the `voice` row shows `accepted` 1 and `abandoned` 1

### Requirement: Negative reads
A read SHALL be negative when an issue code is in `NEGATIVE_ISSUES` (`no_container`, `not_a_meal`). A negative read with no draft is `negative_confirmed` at once; its unsaved draft is `open` for 12 h, then `negative_confirmed`; a linked draft is `negative_overridden` while its record stands, and `negative_confirmed` once rejected or voided. Overrides count by type saved, `meal` for a meal. Any other read with no draft is `nothing_drafted`, counted apart from negatives. It makes 0 model requests.

#### Scenario: No container, confirmed
- **WHEN** a photo read returns container `none`, fluid `none`, no volume and the issue `no_container`, so it has no draft
- **THEN** the summary shows it at once as `negative_confirmed` 1

#### Scenario: No container, overridden
- **WHEN** a photo read returns container `none`, fluid `water`, no volume and the issue `no_container`, and the attendant saves its draft as 200 mL water linked to it
- **THEN** the summary shows `negative_overridden` 1, `negative_confirmed` 0, and overrides saved as `water` 1

#### Scenario: Unsaved negative draft
- **WHEN** at 08:00 a photo read returns container `none`, fluid `water`, no volume and the issue `no_container`, and its draft is not saved
- **THEN** at 19:59 the summary shows `open` 1, `negative_confirmed` 0 and `negative_overridden` 0
- **AND** at 20:00 it shows `open` 0 and `negative_confirmed` 1

#### Scenario: Nothing drafted
- **WHEN** a photo read returns container `other`, fluid `other`, 150 mL and no issues, so it has no draft, and a text note gets a reply and no `log_entry` call
- **THEN** the `photo` row and the `text` row each show `nothing_drafted` 1 and `negative_confirmed` 0
- **AND** the negatives show `nothing_drafted` 2, and confirmed and overridden over 0 reads

#### Scenario: Not a meal, confirmed
- **WHEN** a tray read in `spark` mode returns no dishes, no fluid and the issue `not_a_meal`, so it has no draft
- **THEN** the `tray` `spark` row shows `negative_confirmed` 1 at once, and the negatives show confirmed 1 of 1 read
- **AND** the upstream received exactly 1 request for the read

#### Scenario: Not a meal, charted anyway
- **WHEN** a tray read returns rice (half eaten) with the issue `not_a_meal`, and the attendant saves the lunch linked to it, and later a nurse voids a second such lunch with reason `not a meal`
- **THEN** the first counts as `negative_overridden` with overrides saved as `meal` 1
- **AND** the second counts as `negative_confirmed`

#### Scenario: Tray with nothing drafted
- **WHEN** a tray read returns no dishes, no fluid and only the issue `tray_empty_unclear`
- **THEN** the `tray` row shows `nothing_drafted` 1 and `negative_confirmed` 0

### Requirement: Field scoring
Each settled draft (`accepted`, `edited_at_capture`, `corrected_by_nurse`) SHALL be scored against the final record: type kept or not; volume error in mL, within `VOLUME_TOLERANCE_ML` (25 mL) inclusive; urine colour (`none` when not read) kept or not. A draft with no volume counts in `no_volume`, not in the volume error. Scoring makes 0 model requests.

#### Scenario: Volume error math
- **WHEN** five settled photo drafts read 400, 410, 425, 426 and 500 mL, and each record's final volume is 400 mL
- **THEN** the volume error is over 5 drafts with a mean of 32 mL (161 / 5, rounded to the nearest mL)
- **AND** 3 of 5 are within tolerance (60%): the 25 mL error counts, the 26 mL one does not

#### Scenario: Against the final value
- **WHEN** five photo drafts of 400 mL are each saved and approved unchanged, then amended to 300 mL
- **THEN** the mean volume error is 100 mL, with 0 of 5 within tolerance

#### Scenario: No volume read
- **WHEN** a photo draft has no volume, the attendant saves it as 200 mL, and a nurse approves it
- **THEN** it counts in `no_volume` 1 and not in the volume error's drafts

#### Scenario: Urine colour
- **WHEN** one urine draft read `dark` is approved as `dark`, and another read `yellow` is approved and amended to `red`
- **THEN** the urine colour table's `dark` row has 1 of 1 kept, and its `yellow` row has 0 of 1 kept with the correction `red` 1

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

### Requirement: Small numbers withheld
Every rate in the model accuracy summary SHALL carry its count `n` and its denominator `of`, and a whole percentage `pct`, rounded down, only when `of` is at least `MIN_N` (5); below it, `pct` is null. A mean volume error over fewer than `MIN_N` drafts is null as well. This makes 0 model requests.

#### Scenario: Four and five
- **WHEN** a kind has 4 accepted of 4 decided drafts, and another 5 of 5
- **THEN** the first rate is `{ n: 4, of: 4, pct: null }` and the second `{ n: 5, of: 5, pct: 100 }`

#### Scenario: Rounded down
- **WHEN** the `photo` `spark` row has 199 accepted of 200 decided drafts
- **THEN** its accepted rate is `{ n: 199, of: 200, pct: 99 }`

#### Scenario: Two kinds
- **WHEN** the `text` row's volume error is over 7 settled drafts, 3 of them within tolerance, and the `voice` row's is over 4 settled drafts
- **THEN** the `text` row's `within` is `{ n: 3, of: 7, pct: 42 }` and its `mae_ml` is a number
- **AND** the `voice` row's `mae_ml` is null and its `within.pct` is null

### Requirement: Lab eval scored like the ward
The accuracy eval SHALL score container photos with the summary's rules: volume within `VOLUME_TOLERANCE_ML` inclusive, and `pct` rounded down and null below `MIN_N`. A run that passes the container hint reports no container table. Its plan is unchanged, 3 requests a photo (1 in `spark` mode), and without approval it sends none.

#### Scenario: Same tolerance
- **WHEN** lab rows with truth 450 mL read 475 and 476 mL
- **THEN** the first is within tolerance and the second is not, as in the ward

#### Scenario: Hinted container
- **WHEN** a labelled run is made without `--no-hint`
- **THEN** its report has no container table and reads `Container hinted: not scored`
- **AND** with `--no-hint` it has a container table with a row per expected container

#### Scenario: Plan
- **WHEN** a folder of 30 labelled photos is planned in `sam+spark` mode without approval
- **THEN** the plan is 90 model requests, and none is sent

### Requirement: Lab eval labels from the dataset
Given `--container-labels <manifest.jsonl>`, the eval SHALL label each photo from the record whose `id` its file name ends with, using `expected_container`, `expected_fluid`, `liquid_colour`, `expected_ml`, `ml_tolerance` and `expected_outcome`, and report class rows and each expected outcome against what the model did. A skipped record costs no request, each labelled photo 3 (1 in `spark` mode), and nothing is sent without approval.

#### Scenario: Labels
- **WHEN** the manifest holds `ubag-001` (`expected_container: urine_bag`, `expected_fluid: urine`, `liquid_colour: yellow`, `expected_ml: 1700`, `ml_tolerance: 100`, `expected_outcome: positive`) and `hard-007` (`expected_ml: null`, `expected_outcome: negative`)
- **THEN** `urine_bag-1700-ubag-001.jpg` takes the first record's labels, and `hard-007.jpg` is included as a negative sample with no volume truth
- **AND** the two planned without approval are 6 model requests in `sam+spark` mode and 2 in `spark` mode, and none is sent

#### Scenario: Positives and negatives
- **WHEN** a labelled run has 5 `positive` samples (3 drafted without review, 1 flagged for review, 1 with no draft) and 3 `negative` samples (1 with the issue `no_container` and no draft, 1 flagged, 1 drafted without review)
- **THEN** the outcome table's `positive` row reads `5 | 3 | 1 | 1 | 80% · 4/5` (drafted, flagged, refused, right call)
- **AND** its `negative` row reads `3 | 1 | 1 | 1 | — · 2/3`

### Requirement: Synthetic photos in the lab eval
The eval SHALL read the sidecar `<name>.json` beside each photo as well as the manifest. A photo is synthetic when its sidecar or record says `synthetic: true` or its name starts `synth-`, and is scored only if each of them has `label_status: verified` and a non-empty `verified_by`; others are skipped at no request. Its labels come from its record, else its sidecar's `labels`, never its file name. Real and synthetic photos are reported in separate sections.

#### Scenario: Sidecars
- **WHEN** a folder is planned in `sam+spark` mode without `--container-labels` or approval, holding `synth-bag-a.webp`, `synth-bag-b.webp`, `synth-bag-c.webp` and `synth-bag-d.webp`, where:
  - `synth-bag-a.json` has `synthetic: true`, `label_status: verified`, `verified_by: "dev-1"` and labels `{ expected_container: urine_bag, expected_fluid: urine, liquid_colour: dark, expected_ml: 1000 }`;
  - `synth-bag-b.json` has `label_status: draft` and `verified_by: null`;
  - `synth-bag-c.json` has `label_status: verified` and `verified_by: null`;
  - `synth-bag-d` has no sidecar
- **THEN** the plan counts 1 photo and 3 model requests, and none is sent
- **AND** it reads `3 synthetic photos without verified labels, skipped`, and `synth-bag-a` is labelled 1000 mL of dark urine in a `urine_bag`

#### Scenario: File name is not truth
- **WHEN** `urine_bag-450-x.webp` has a sidecar with `synthetic: true`, `label_status: verified`, `verified_by: "dev-1"` and `expected_ml: 1000`, and `water_jug-600-y.webp` a sidecar with `synthetic: true` and `label_status: draft`
- **THEN** the first is a synthetic sample with a truth of 1000 mL, not 450 mL
- **AND** the second is skipped, and no real sample is made from either name

#### Scenario: Synthetic photos apart
- **WHEN** the manifest holds `ubag-001`, `synth-001` (`synthetic: true`, `label_status: verified`, `verified_by: "dev-1"`), `synth-002` (`synthetic: true`, `label_status: draft`) and `synth-003` (`synthetic: true`, `label_status: verified`, no `verified_by`), and the folder has a photo of each and no sidecars
- **THEN** the plan counts 2 photos and the report reads `2 synthetic photos without verified labels, skipped`
- **AND** the report has a `Real photos` section over `ubag-001` and a `Synthetic photos (verified labels)` section over `synth-001`

### Requirement: Tray eval labels from the dataset
Given `--tray-labels <manifest.jsonl>`, the eval SHALL read as a tray each photo whose file name ends with the `id` of a `record_type: original` record that has `expected_items`, labelled from its `expected_items`, `meal_portion_eaten`, `expected_fluids` and `expected_outcome`. Augmented records and other photos are skipped at no request. Each tray costs 3 requests (1 in `spark` mode), and none is sent without approval. With `--container-labels` or `--no-hint` it exits 2 and sends nothing.

#### Scenario: Tray labels
- **WHEN** a folder holding `other-0-tray-002.jpg`, `other-0-hard-041.jpg`, `urine_bag-1700-ubag-001.jpg` and `tray-002__blur_gauss_strong.jpg` is planned with `--tray-labels` and a manifest holding:
  - `tray-002` (`record_type: original`): `expected_items` peas (`curry_vegetables`, 0), mashed potato (`curry_vegetables`, 0) and meat with gravy (`meat_fish_egg`, 0), `meal_portion_eaten: 0`, `expected_fluids: []`, `expected_outcome: positive`;
  - `hard-041` (`record_type: original`): `expected_items: []`, `expected_outcome: negative`, `expected_issues: ["not_a_meal"]`;
  - `ubag-001` (`record_type: original`), with no `expected_items`;
  - `tray-002__blur_gauss_strong` (`record_type: augmented`), with the same `expected_items`, `expected_outcome: positive` and `expected_outcome_after: degraded`
- **THEN** the plan counts 2 trays, 6 model requests in `sam+spark` mode and 2 in `spark` mode, and none is sent
- **AND** it reads `2 photos without tray labels, skipped`
- **AND** `tray-002` is labelled with 3 dishes eaten 0 %, a meal portion of 0 and no fluid truth, and `hard-041` is a negative sample with no dish

#### Scenario: Flags that do not apply to trays
- **WHEN** the eval is run with `--tray-labels manifest.jsonl --container-labels manifest.jsonl`, and with `--tray-labels manifest.jsonl --no-hint`
- **THEN** each exits with status 2, plans nothing and sends no request

### Requirement: Tray eval report
The tray eval report SHALL pair read and true dishes by `dish_kind`, then in order, never by name. Per mode it gives a dish kind table by true kind, dish portions in quarters by `basis`, meal portion in quarters, fluid kinds and mL within `VOLUME_TOLERANCE_ML`, and expected outcomes against drafted, flagged or refused. Fluid `none` is no fluid, a portion outside `PORTIONS` or null mL is unscored, unknown kinds are `other`, and rates follow "Small numbers withheld". It makes no model request.

#### Scenario: Dishes paired by kind
- **WHEN** a tray labelled rice (`rice`, 0) and dal (`dal_lentils`, 0) is read as `dal_lentils` 0 named `sambar` and `rice` 25
- **THEN** its pairs are `rice`/`rice`, 1 quarter apart, and `dal_lentils`/`dal_lentils`, 0 quarters apart

#### Scenario: Portions by basis
- **WHEN** a compared read returns rice 50 with `basis: measured` and `curry_vegetables` 25 with `basis: model`, and its labels are rice 50 and `curry_vegetables` 0
- **THEN** the `measured` row reads exact `— · 1/1` and the `model` row reads exact `— · 0/1`, within one quarter `— · 1/1`

#### Scenario: Unscored values
- **WHEN** a tray record has a dish with `portion_eaten_pct: null` and a fluid of kind `none` with `volume_ml_estimate: 200`
- **THEN** that dish counts in the dish kind table and in no portion pair, and the tray has no fluid truth
- **AND** for a tray record whose only fluid is `soup` with `volume_ml_estimate: null`, read as soup 150 mL, the soup counts in the fluid kind table and in no mL pair

#### Scenario: Tray outcomes
- **WHEN** a tray run reads `hard-041` with the issue `not_a_meal` and no draft, and a `positive` tray with no dish and no fluid
- **THEN** both count as refused: the `negative` row reads `1 | 0 | 0 | 1 | — · 1/1` and the `positive` row `1 | 0 | 0 | 1 | — · 0/1`

#### Scenario: Left-over dishes paired in order
- **WHEN** a lab tray labelled `rice` 0 and `curry_vegetables` 0 is read as `rice` 0 and `bread` 25
- **THEN** its dish pairs are `rice`/`rice`, 0 quarters apart, and `bread`/`curry_vegetables`, 1 quarter apart
- **AND** the dish kind table, by true kind, has `rice` 1 of 1 kept and `curry_vegetables` 0 of 1 kept, read as `bread` 1

#### Scenario: Same tolerance and floors
- **WHEN** lab trays with a fluid truth of 150 mL are read as 175 and 176 mL, and 3 of 7 `model`-basis dish pairs are exact
- **THEN** the first fluid is within tolerance and the second is not, as in the ward
- **AND** the `model` row's exact rate reads `42% · 3/7`

#### Scenario: Out-of-vocabulary values
- **WHEN** a tray record is labelled `rice` 0, a dish with `dish_kind: pizza` and `portion_eaten_pct: 0`, `bread` with `portion_eaten_pct: 30`, and a fluid of kind `kombucha` with `volume_ml_estimate: 150`, and is read as `rice` 0, `other` 25 and `bread` 50, with `other` 150 mL
- **THEN** the `pizza` dish counts as `other` and pairs with the read `other`: the dish kind table's `other` row has 1 of 1 kept, and that pair is 1 quarter apart
- **AND** the fluid counts as `other`, kept, and within tolerance
- **AND** the `bread` dish counts in the dish kind table and in no portion pair

### Requirement: Synthetic trays in the tray eval
A synthetic photo SHALL be read as a tray when read-outcomes' sidecar rule scores it and its sidecar's `labels.truth` has `expected_items`: dishes and fluids from `labels.truth.expected_items` and `expected_fluids`, the meal portion from `labels.meal_portion_eaten` and the outcome from `labels.expected_outcome`, each unscored when absent. Real and synthetic trays are reported in separate sections under the same rules. Each costs 3 requests (1 in `spark` mode), none without approval.

#### Scenario: Synthetic labels
- **WHEN** `synth-gen-tray-02.png` has a verified sidecar (`label_status: verified`, `verified_by: "dev-1"`) with labels `{ meal_portion_eaten: 75, truth: { expected_items: [{ dish_kind: "rice", portion_eaten_pct: 75 }], expected_fluids: [] } }` and no `expected_outcome`, and is planned with `--tray-labels`
- **THEN** it is planned as one tray at 3 requests in `sam+spark` mode, labelled with one rice dish at 75, a meal portion of 75 and no fluid truth
- **AND** it counts in no outcome row

#### Scenario: Real and synthetic apart
- **WHEN** a run reads `other-0-tray-002.jpg` and `synth-gen-tray-02.png`, each with one dish read as its true kind
- **THEN** the report has a real section and a synthetic section, and each dish kind table counts exactly 1 tray

### Requirement: Served and collected pairs in the tray eval
In `sam+spark` mode, a scored synthetic tray whose sidecar has `pair_role: after` SHALL be read with its before as the served photo, at exactly 5 requests (3 when either size is unreadable). The before is the folder photo whose sidecar has the same `pair_id` and `pair_role: before`, else the file of the record its first `source_ids` names, beside the manifest. It is labelled as a synthetic tray, and pairs are reported apart. In `spark` mode, or with no before, it is read alone at 1 or 3.

#### Scenario: Pair planned
- **WHEN** a folder holding `tray-001.jpg` and `synth-gen-tray-01.png`, whose sidecar has `synthetic: true`, `label_status: verified`, `verified_by: "dev-1"`, `source_ids: ["tray-001"]` and labels `{ pair_id: "pair-tray-001", pair_role: "after", truth: { expected_items: [{ dish_kind: "bread", portion_eaten_pct: 100 }] } }`, is planned with `--tray-labels` and a manifest whose `tray-001` has `file: images/food_tray/tray-001.jpg`
- **THEN** the plan is 8 model requests in `sam+spark` mode (3 for `tray-001`, 5 for the pair) and 2 in `spark` mode, and none is sent
- **AND** the pair's served photo is `images/food_tray/tray-001.jpg` beside the manifest

#### Scenario: Pair read
- **WHEN** that pair is read with approval against a fake upstream
- **THEN** the upstream received exactly 5 requests, in order: SAM `dish` and SAM `food` with the after photo, SAM `dish` and SAM `food` with the before photo, then one Spark request with the after photo only
- **AND** the report has a `Pairs (served and collected)` section with 1 pair, scored with the after photo's labels

#### Scenario: Before not found
- **WHEN** the same sidecar names `source_ids: ["tray-999"]`, which no record has, and no folder photo shares its `pair_id`
- **THEN** it is planned as a tray alone at 3 requests in `sam+spark` mode, and the plan reads `1 pair without its before, read alone`

### Requirement: Tray reads are logged
Each `POST /api/ai/meal` answering 200 SHALL store one `tray` read and return its id as `read_id`. It holds mode, model ids, staff, `admission_id` if given, time, confidence, issues, `needs_review`, whether a served photo was found, 1 draft if the draft has a dish or fluid mL (else 0), each dish's region, `dish_kind`, portion and basis, each fluid's region, `fluid_kind` and mL, and the draft's portion, fluid mL and dishes. Requests stay 3 (5 with a served photo) in `sam+spark`, 1 in `spark`.

#### Scenario: Tray read
- **WHEN** signed in as Ravi Kumar (id 1), a tray photo is posted to `/api/ai/meal` in `sam+spark` mode with the `admission_id` of 3A bed 1, and the model reads rice (`rice`, region 1, half eaten), dal (`dal_lentils`, region 0, all eaten) and soup (`soup`, region 2, 150 mL), overall half eaten, confidence 0.82 and no issues
- **THEN** the response is 200 with a `read_id`, and the stored read with that id has:
  - kind `tray`, mode `sam+spark`, models `sam-3.1` and `muse-spark-1.3`, staff 1, that admission, served photo false;
  - confidence 0.82, issues `[]`, `needs_review: false`, 1 draft;
  - dishes `{ index: 1, dish_kind: rice, portion: 50, basis: model }` and `{ index: 0, dish_kind: dal_lentils, portion: 100, basis: model }`, and the fluid `{ index: 2, fluid_kind: soup, volume_ml: 150 }`;
  - a draft of portion 50, fluid 150 mL and dishes `rice` 50 and `dal_lentils` 100
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Spark-only tray read
- **WHEN** a tray photo is posted to `/api/ai/meal` in `spark` mode
- **THEN** the stored read has kind `tray`, mode `spark` and models `muse-spark-1.3` only
- **AND** the upstream received exactly one request

#### Scenario: Served photo compared
- **WHEN** a photo of 3A bed 1's tray was uploaded at 12:40 with `served_meal: lunch`, and at 13:30 the collected tray, with one dish region, is read in `sam+spark` mode with that bed's `admission_id` and `meal: lunch`, and its one dish is measured
- **THEN** the stored read has served photo true, and its dish has basis `measured`
- **AND** the upstream received exactly 5 requests: four SAM and one Spark

#### Scenario: No draft
- **WHEN** a tray read in `spark` mode returns no dishes, no fluid, the issue `not_a_meal` and confidence 0.3
- **THEN** the response is 200 with a `read_id`, and the stored read with that id has issues `not_a_meal`, 0 drafts and no draft values
- **AND** the upstream received exactly 1 request

#### Scenario: Failed tray read
- **WHEN** Spark answers 429 during a tray read in `spark` mode
- **THEN** the response is 429 with no `read_id`, no read is stored, and the upstream received exactly 1 request

#### Scenario: Refused by the budget
- **WHEN**, with a cap of 120, a 30 % reserve and 84 requests in use, a tray photo is posted to `/api/ai/meal` with the `admission_id` of 3A bed 4 (`stable`)
- **THEN** the response is 429 with `error: request_budget_exceeded` and no `read_id`, no read is stored, and the upstream received no request

### Requirement: Link a meal to its read
`POST /api/admissions/:id/meals` SHALL accept `read_id` on a `photo` meal and store the link (the meal, not its fluid entry) in the meal's transaction. The "Link checks" apply: the read exists, is by the signed-in staff member, names that admission, is under `READ_ABANDON_HOURS` old, is a `tray` read with a draft, and is unlinked, else `already linked`. A failed check, or `read_id` on a manual meal, gets 400 at `read_id` and stores nothing. It makes 0 model requests.

#### Scenario: Lunch linked
- **WHEN** signed in as Ravi Kumar, a tray read for 3A bed 1 returns `read_id` 61, its photo is uploaded, and a photo lunch with 150 mL, that `media_id`, its evidence and `read_id: 61` is posted for 3A bed 1
- **THEN** the response is 201, and read 61 is linked to that meal, not to its pending 150 mL entry
- **AND** the upstream received no request for the upload or the post

#### Scenario: Refused meal links
- **WHEN** each of these is posted for 3A bed 1, read 61 being unlinked:
  - a photo lunch with `read_id: 61`, signed in as Sunita Devi (id 2);
  - a photo lunch with the `read_id` of Ravi Kumar's tray read for 3A bed 2;
  - a photo lunch with the `read_id` of Ravi Kumar's photo read of a `cup` for 3A bed 1;
  - a photo lunch with the `read_id` of Ravi Kumar's `not_a_meal` tray read with no draft;
  - a `manual` lunch with `read_id: 61`;
  - a urine entry with `source: photo` and `read_id: 61`;
  - a photo lunch with `read_id: 61`, 12 hours after read 61
- **THEN** each response is 400 with `error: invalid_request` and an issue at `read_id`, no meal or entry is stored, and the upstream received no request

#### Scenario: Bedless tray read
- **WHEN** Ravi Kumar reads a tray without `admission_id` and gets `read_id` 62, and then posts a photo lunch for 3A bed 1 with `read_id: 62`
- **THEN** the response is 400 with `error: invalid_request` and an issue at `read_id`, and no meal is stored

#### Scenario: Empty tray read
- **WHEN** Ravi Kumar's tray read for 3A bed 1 returns `read_id` 63 with the issue `not_a_meal`, no dishes and no fluid, and he posts a photo lunch for 3A bed 1 with that photo's `media_id` and no `read_id`
- **THEN** the response is 201, read 63 has no link, and the summary still counts it as `negative_confirmed`
- **AND** the upstream received no request for the post

#### Scenario: Meal posted again
- **WHEN** the lunch linked to read 61 is posted a second time with `read_id: 61`
- **THEN** the response is 400 with the issue `{ path: "read_id", message: "already linked" }`
- **AND** the bed holds one lunch and one 150 mL entry

### Requirement: Outcome of a saved meal
A draft linked to a meal SHALL get one outcome, derived on request, the first that applies: `rejected` when the meal is voided; `pending` while its fluid entry is unreviewed; `corrected_by_nurse` when a nurse amended its dish kinds or portions, or its fluid entry was rejected, approved at another volume or amended in volume; `edited_at_capture` when saved with another portion, fluid mL or set of dish kinds and portions than drafted; else `accepted`. It makes 0 model requests.

#### Scenario: Accepted lunch
- **WHEN** a 3A tray read drafts portion 50, `rice` 50, `dal_lentils` 100 and 150 mL, the lunch is saved unchanged linked to it, and its 150 mL entry is approved unchanged
- **THEN** `GET /api/quality/model?ward=2` shows the `tray` `sam+spark` row with `accepted` 1 and every other outcome 0

#### Scenario: No fluid
- **WHEN** a tray read drafts portion 75 and `roti` as `bread` 75 with no fluid, and the dinner is saved unchanged linked to it
- **THEN** the `tray` row shows `accepted` 1 at once, with no entry to wait for

#### Scenario: Edited at capture
- **WHEN** a tray read drafts `rice` 50 and `dal_lentils` 100, and the attendant saves the lunch with rice at 75, and its fluid entry is approved unchanged
- **THEN** the `tray` row shows `edited_at_capture` 1

#### Scenario: Amended by a nurse
- **WHEN** a lunch is saved unchanged from its read with portion 50 and its fluid approved, and a nurse then amends the meal's portion to 25 with reason `tray returned fuller` through `POST /api/meals/:id/amend`
- **THEN** the `tray` row shows `corrected_by_nurse` 1

#### Scenario: Renamed only
- **WHEN** a lunch is saved unchanged from its read with portion 50, `rice` 50 and `dal_lentils` 100 and its fluid approved, and a nurse then amends only its items to `jeera rice, dal` and its `rice` dish's name to `jeera rice`, kinds and portions unchanged, through `POST /api/meals/:id/amend`
- **THEN** the `tray` row shows `accepted` 1 and `corrected_by_nurse` 0

#### Scenario: Fluid entry rejected
- **WHEN** a lunch is saved unchanged from its read with 150 mL, and a nurse rejects its 150 mL entry as `duplicate` while the meal stands
- **THEN** the `tray` row shows `corrected_by_nurse` 1 and `rejected` 0, and the meal fluid counts 1 `removed`

#### Scenario: Voided and pending
- **WHEN** one linked lunch is voided with reason `wrong bed`, and another linked lunch's 150 mL entry is not yet reviewed
- **THEN** the `tray` row shows `rejected` 1 and `pending` 1

### Requirement: Retaken tray reads
An unlinked `tray` read with a draft SHALL be `retaken` once the same staff member makes a later `tray` read for the same `admission_id` at most `READ_RETAKE_MINUTES` (10) after it, whatever its meal. `retaken` applies before `open`, `abandoned` and `negative_confirmed`, and counts in no decided count, no rate, neither kept nor not kept, and no negative count. A read with no `admission_id` is never `retaken`. It is derived on request and makes 0 model requests.

#### Scenario: Lunch read twice
- **WHEN** Ravi Kumar reads 3A bed 1's lunch tray in `sam+spark` mode, with no served photo, at 12:00 (read 70) and again at 12:04 (read 71), each drafting rice half eaten, and then saves the lunch linked to read 71
- **THEN** read 70 is `retaken` at 12:05, and still `retaken` at 00:05 the next day
- **AND** at 00:05 the next day the `tray` `sam+spark` row shows `abandoned` 0 and `retaken` 1
- **AND** the upstream received exactly 3 requests for each read, and none for the save or the summary

#### Scenario: Not a retake
- **WHEN** Ravi Kumar's lunch tray read 70 for 3A bed 1 at 12:00, drafting rice half eaten, is never saved, and on a fresh store each time it is followed by one of:
  - Sunita Devi's tray read for 3A bed 1 at 12:04;
  - Ravi Kumar's tray read for 3A bed 1 at 12:11;
  - Ravi Kumar's tray read for 3A bed 2 at 12:04
- **THEN** in each case read 70 is `open` at 12:15, and `abandoned` at 00:05 the next day

#### Scenario: No bed
- **WHEN** Ravi Kumar reads a tray without `admission_id` at 12:00 and again at 12:03, each drafting rice half eaten, and saves neither
- **THEN** at 12:05 both reads are `open`, and the `tray` rows show `retaken` 0

#### Scenario: Negative draft retaken
- **WHEN** at 12:00 Ravi Kumar's tray read for 3A bed 2 returns rice (half eaten) with the issue `not_a_meal`, and at 12:03 he reads the tray again, with no issues, and saves the lunch linked to that second read
- **THEN** at 00:05 the next day the first read is `retaken`, not `negative_confirmed`, and the negatives show confirmed and overridden over 0 reads

### Requirement: Dish scoring
Each settled meal's drafted dishes SHALL be paired with its final dishes: each drafted dish with the first unpaired final dish of the same `dish_kind`, then the rest in order. The `dish_kind` table counts, per drafted kind, the pairs kept and the kinds staff changed to, `none` for a dish removed; a dish staff added counts under model `none`. Dish names are never compared. It makes 0 model requests.

#### Scenario: Kind changed
- **WHEN** a settled meal drafted `rice` 50 and `dal_lentils` 100, and was saved with `bread` 50 and `dal_lentils` 100
- **THEN** the `dish_kind` table's `dal_lentils` row has 1 of 1 kept, and its `rice` row 0 of 1 kept with the correction `bread` 1

#### Scenario: Removed and added
- **WHEN** one settled meal drafted `rice`, `dal_lentils` and `fruit` and was saved with `rice` and `dal_lentils`, and another drafted `rice` and was saved with `rice` and `dairy`
- **THEN** the `fruit` row has 0 of 1 kept with the correction `none` 1
- **AND** the `none` row has n 1 with the correction `dairy` 1, and the `rice` row 2 of 2 kept

#### Scenario: Same kind twice
- **WHEN** a settled meal drafted `rice` 100 then `rice` 25, and was saved with `rice` 25 only
- **THEN** the `rice` row has 1 of 2 kept with the correction `none` 1
- **AND** the dish portion pair is drafted 100 against saved 25

### Requirement: Portion agreement
Portions SHALL be compared in quarters (25 points), for each settled meal's drafted and final portion and for each dish pair, a pair with an unknown portion left out. For meals and for dishes the summary gives the pairs, those `exact`, those within one quarter, and the count at 0, 1, 2, 3 and 4 quarters apart. It makes 0 model requests.

#### Scenario: Quarters
- **WHEN** settled dish pairs (drafted, final) are 50/50, 50/75, 100/50, 0/100 and 25/25
- **THEN** `dish_portion` is over 5 pairs, `exact` `{ n: 2, of: 5, pct: 40 }`, `within_quarter` `{ n: 3, of: 5, pct: 60 }` and `quarters_off` `[2, 1, 1, 0, 1]`

#### Scenario: Meal portion after an amend
- **WHEN** one settled lunch was drafted at portion 50, saved at 50, and amended by a nurse to 25
- **THEN** `meal_portion` is over 1 pair with `exact` `{ n: 0, of: 1, pct: null }`, `within_quarter` `{ n: 1, of: 1, pct: null }` and `quarters_off` `[0, 1, 0, 0, 0]`

### Requirement: Fluid with a meal
Each settled meal's drafted fluid mL SHALL be scored against its fluid entry's final volume, or none when it has no entry or that entry is rejected, within `VOLUME_TOLERANCE_ML` inclusive. This is `meal_fluid` and the tray rows' volume error, never the summary's top-level volume. A fluid staff added counts in `no_volume`, a drafted fluid with no final one in `removed`. It makes 0 model requests.

#### Scenario: Soup kept and re-volumed
- **WHEN** one settled lunch drafted 150 mL and its entry was approved at 150 mL, and another drafted 150 mL and its entry was approved at 120 mL
- **THEN** `meal_fluid.volume` is over 2 meals with 1 of 2 within tolerance, and the second counts as `corrected_by_nurse`
- **AND** the summary's top-level `volume` counts neither

#### Scenario: Added and removed
- **WHEN** one settled tray read drafted no fluid and the attendant saved its dinner with 200 mL, and another drafted 150 mL and its saved entry was rejected
- **THEN** `meal_fluid` has `volume.of` 0, `volume.no_volume` 1 and `removed` 1

### Requirement: Outcomes per container
The summary SHALL list one row per container the photo reads named, both modes together: the reads, the decided drafts, the accepted, corrected and rejected rates over them, and their volume error, most reads first, then in container order. A row says what staff did with drafts of a container the model read; it is not container truth. It makes 0 model requests.

#### Scenario: Two containers
- **WHEN** in 3A, 6 photo reads of a `urinal` were decided (5 accepted, 1 corrected by a nurse) and 2 of a `water_jug` (2 accepted)
- **THEN** `containers` lists `urinal` first, with 6 reads, accepted `{ n: 5, of: 6, pct: 83 }` and corrected `{ n: 1, of: 6, pct: 16 }`
- **AND** then `water_jug`, with 2 reads and accepted `{ n: 2, of: 2, pct: null }`

#### Scenario: No container read
- **WHEN** one photo read returned container `none` with the issue `no_container` and no draft
- **THEN** `containers` has a `none` row with 1 read and 0 decided drafts

### Requirement: Top corrections
The summary SHALL list the `TOP_CORRECTIONS` (5) most frequent changes across the type, urine colour and dish kind tables, each with its table, the model's class, what staff kept and the count: most first, then in that table order, then by the model's class and the kept class. It makes 0 model requests.

#### Scenario: Six changes
- **WHEN** the corrections are type `water` → `food` 3, urine colour `dark` → `red` 2, dish kind `rice` → `bread` 2, type `urine` → `stoma` 1, urine colour `yellow` → `dark` 1 and dish kind `fruit` → `none` 1
- **THEN** `top_corrections` lists, in order, `water` → `food` 3, `dark` → `red` 2, `rice` → `bread` 2, `urine` → `stoma` 1 and `yellow` → `dark` 1, and not `fruit` → `none`

### Requirement: Positive drafts not kept
The summary SHALL count the drafts of reads that are not negative, across every kind, as kept (`accepted`, `edited_at_capture`, `corrected_by_nurse`) or not kept (`rejected`, `abandoned`), each as a rate over both, with the rejected, abandoned and retaken counts. `pending`, `open` and `retaken` drafts count in neither. It makes 0 model requests.

#### Scenario: Kept and not kept
- **WHEN** non-negative drafts end 40 accepted, 4 edited at capture, 2 corrected by a nurse, 3 rejected, 1 abandoned, 2 retaken and 2 pending
- **THEN** `positives` is kept `{ n: 46, of: 50, pct: 92 }`, not kept `{ n: 4, of: 50, pct: 8 }`, rejected 3, abandoned 1 and retaken 2

#### Scenario: Negatives left out
- **WHEN** the window holds one `no_container` read confirmed and one overridden, and nothing else
- **THEN** `positives` is kept `{ n: 0, of: 0, pct: null }` and not kept `{ n: 0, of: 0, pct: null }`

### Requirement: Drink kind in the read log
Each draft a stored photo, text or voice read holds SHALL also hold its `drink`: the draft's drink kind, or null when it has none. A tray read's fluids keep their `fluid_kind`, as now. Reads stored before this change, whose drafts have no `drink`, read as null. Requests are unchanged: photo 3 (1 in `spark` mode), text 1, voice 2, tray 3 (5 when compared, 1 in `spark` mode).

#### Scenario: Photo of coffee
- **WHEN** a JPEG is read in `sam+spark` mode and Spark returns container `cup`, fluid `coffee`, `drink_name` `filter coffee`, 150 mL
- **THEN** the stored read's output has fluid `coffee` and a draft of type `water`, 150 mL and `drink: coffee`
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Voice note with two drafts
- **WHEN** a voice note's model calls `log_entry` for `water` 200 mL with drink `tea`, and `urine` 300 mL
- **THEN** the stored read has 2 drafts: `water` 200 mL with `drink: tea`, and `urine` 300 mL with `drink: null`
- **AND** the upstream received exactly one speech-to-text request and one Spark request

### Requirement: Drink kind table
The summary SHALL hold a `drink_kind` table over settled photo, text and voice drafts with a drink kind and an entry: one row per drafted kind, with its drafts, the kept rate against the entry's final `drink`, and the kinds it was changed to, most first, as the type table does. A final entry with no drink counts as `none`. A change of kind alone leaves the draft's outcome unchanged; this table measures it. Rows follow `DRINK_KINDS` order; an empty window is `[]`. It makes 0 model requests.

#### Scenario: Tea that was coffee
- **WHEN** in 3A, four photo drafts read `tea`: three are approved as `tea`, and one is approved and then amended to `coffee`
- **THEN** `drink_kind` has a `tea` row with `n: 4`, kept `{ n: 3, of: 4, pct: null }` and corrections `[{ to: "coffee", n: 1 }]`
- **AND** all four drafts count as `accepted` in the photo `sam+spark` row
- **AND** the upstream received no request

#### Scenario: Changed away from a drink
- **WHEN** a text draft of `water` 200 mL with `drink: juice` is saved, and a nurse amends the entry to `iv`
- **THEN** the `juice` row has kept `{ n: 0, of: 1, pct: null }` and corrections `[{ to: "none", n: 1 }]`

#### Scenario: A saved jug level is not counted
- **WHEN** a photo of a water jug drafts `water` 500 mL with `drink: water`, and it is saved as a jug level, and one photo draft read `tea` is approved as `tea`
- **THEN** `drink_kind` has only the `tea` row, with `n: 1` and kept `{ n: 1, of: 1, pct: null }`

### Requirement: Drink kinds in the lab evals
The photo eval's fluid table and the tray eval's fluid kind table SHALL have a row for each drink kind their labels or reads name, `coffee`, `coconut_water`, `buttermilk`, `ors` and `supplement` included. A label outside the kinds stays unscored in the photo eval and `other` in the tray eval. Plans are unchanged: 3 requests a photo or tray (1 in `spark` mode), and none is sent without approval.

#### Scenario: Coffee labelled
- **WHEN** a labelled photo run has 2 photos with `expected_fluid: coffee`, one read `coffee` and one read `tea`, and a tray with `expected_fluids` `[{ fluid_kind: "coconut_water", volume_ml_estimate: 200 }]` read as `coconut_water` 200 mL
- **THEN** the photo report's fluid table has a `coffee` row with 1 of 2 kept and the change `tea 1`, and the tray report's fluid kinds have a `coconut_water` row with 1 of 1 kept

#### Scenario: Plan
- **WHEN** a folder of 10 labelled photos, 4 of them labelled `ors`, is planned in `sam+spark` mode without approval
- **THEN** the plan is 30 model requests, and none is sent
