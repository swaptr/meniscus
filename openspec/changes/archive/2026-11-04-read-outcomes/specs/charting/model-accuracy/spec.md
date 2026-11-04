# Spec Delta

## Purpose

Measuring the models in the ward. Every photo, typed and voice read is logged as closed-list classes and numbers, each saved record is linked to the read it came from, and each draft's outcome is derived from what staff kept. These are summarised per read kind and per class, positives and negatives, with the same scoring as the lab eval of container photos. None of it adds a model request.

## ADDED Requirements

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
A stored read SHALL hold only closed-list values (read kind, mode, model ids, container kind, fluid kind, entry type, urine colour, issue codes), numbers, booleans, ids and times. It never holds a transcript, note text, image, reading basis, appearance, draft item or notes, or model reply. Nothing about a read is logged beyond the existing model-API lines (path, model, status, timing). This adds no model request.

#### Scenario: Voice note
- **WHEN** a voice note is transcribed as `bed 4 had rice and a coconut water, 200 mL`, and the model drafts item `coconut water`, notes `half the glass, with rice`, `water` 200 mL
- **THEN** no column of the stored read contains `rice`, `coconut`, `bed 4` or `half the glass`
- **AND** no line the server logged contains them
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: Photo read
- **WHEN** a photo read returns reading basis `between the 400 and 500 marks` and appearance `pale yellow, clear`
- **THEN** no column of the stored read contains `between the 400 and 500 marks` or `pale yellow, clear`
- **AND** every string in its stored output is a value of `READ_KINDS`, `CONTAINER_KINDS`, `FLUID_KINDS`, the entry types, `URINE_COLOURS` or `READING_ISSUES`

### Requirement: Reads name their bed
`POST /api/ai/read`, `/api/ai/note` and `/api/ai/voice-note` SHALL accept an optional `admission_id`, as a form field or, for `/note`, a JSON field. An unknown admission gets 404 `not_found` with no model request and nothing stored. The id is never sent upstream: the model requests are identical with or without it, photo 3 (1 in `spark` mode), text 1, voice 2.

#### Scenario: Unknown bed
- **WHEN** a JPEG is posted to `/api/ai/read` and a note to `/api/ai/note`, each with `admission_id: 9999`
- **THEN** both responses are 404 with `error: not_found`
- **AND** the upstream received no request, and no read is stored

#### Scenario: Not sent upstream
- **WHEN** `{ text: "coconut water 200" }` is posted to `/api/ai/note` once without `admission_id` and once with the id of bed 1
- **THEN** the two Spark request bodies are identical, and neither contains bed 1's patient name
- **AND** the second stored read names bed 1's admission and the first names none

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
A draft with no link SHALL be `open` while its read is less than `READ_ABANDON_HOURS` (12 h) old, the draft of a negative read included. From then on it is `abandoned`, or `negative_confirmed` for a negative read. Open drafts count in no rate and in no negative count. This makes 0 model requests.

#### Scenario: Never saved
- **WHEN** a photo read at 08:00 drafts 450 mL urine and nothing is saved
- **THEN** at 19:59 the summary shows `open` 1 and `abandoned` 0
- **AND** at 20:00 it shows `open` 0 and `abandoned` 1

#### Scenario: One draft of two saved
- **WHEN** a voice read at 08:00 drafts 200 mL tea and 300 mL urine, and only the tea is saved and approved unchanged
- **THEN** at 20:00 the `voice` row shows `accepted` 1 and `abandoned` 1

### Requirement: Negative reads
A read SHALL be negative when its issues include a code in `NEGATIVE_ISSUES` (`no_container`). A negative read with no draft is `negative_confirmed` at once; its unsaved draft is `open` for 12 h, then `negative_confirmed`; a linked draft is `negative_overridden` while its record stands, and `negative_confirmed` once rejected. Overrides count by the type saved. Any other read with no draft is `nothing_drafted`, counted apart from negatives. This makes 0 model requests.

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
`GET /api/quality/model` SHALL summarise the drafts of reads made in the last `days` (1 to `QUALITY_MAX_DAYS`, default 7) for the ward `ward=<id>`, or else the whole hospital: each read kind and photo mode, the type and urine colour tables, the volume error, the negatives and the reads with nothing drafted. It makes 0 model requests and needs no session.

#### Scenario: Window and errors
- **WHEN** it is requested with `days` 0, 31 and `x`, and with `ward=999`
- **THEN** the first three are 400 with `error: invalid_request`, and the last is 404 with `error: not_found`
- **AND** without `days`, the response has `days: 7` and `since` 7 days before now

#### Scenario: No session
- **WHEN** `GET /api/quality/model?ward=2` is sent with the device token and no session
- **THEN** the response is 200, and the upstream received no request

#### Scenario: Ward and hospital
- **WHEN** one read is linked from a 3A bed and one from a 5B bed
- **THEN** `?ward=2` (3A) counts the first only, and the request without `ward` counts both

#### Scenario: Kinds always listed
- **WHEN** the window holds only text reads
- **THEN** `kinds` still lists, in order, `photo` `sam+spark`, `photo` `spark`, `text` and `voice`, the others with 0 drafts

#### Scenario: No names
- **WHEN** Ravi Kumar and Anita Thomas read and save drafts for 3A beds 1 and 2, and the 3A summary is requested
- **THEN** the body has no `bed`, `patient` or `mrn` field, and contains neither staff name nor either patient's name

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

### Requirement: Older stores keep their records out
A store file made before the read log SHALL open with its records unchanged and gain the read tables. Records saved before it have no read and count in no number of the summary, and opening it again changes nothing. It makes no model request.

#### Scenario: Older store
- **WHEN** a store file with no read tables, holding three approved photo entries, is opened
- **THEN** the entries are listed as before, and `GET /api/quality/model` shows 0 drafts in every kind

#### Scenario: Old and new records
- **WHEN** a photo read is then made on that store, and its entry is saved and approved unchanged
- **THEN** the summary's `photo` row shows `accepted` 1 of 1 decided drafts

#### Scenario: Opened again
- **WHEN** that upgraded file is closed and opened a second time
- **THEN** its `PRAGMA schema_version` is the same before and after the second open

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
