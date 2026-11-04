# Spec Delta

## MODIFIED Requirements

### Requirement: Reads are logged
Each `POST /api/ai/read`, `/api/ai/note` and `/api/ai/voice-note` that answers 200, or is queued and answers, SHALL store one read, returning its id as `read_id` on a 200. The read holds the kind (`photo`, `text`, `voice`), photo mode, model ids, signed-in staff (who queued it, if queued), `admission_id` if given, time, confidence, issues, `needs_review`, container hint, number of drafts, and the model's classes and numbers. Upstream requests stay: photo 3 (1 in `spark` mode), text 1, voice 2.

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

#### Scenario: Queued read logged
- **WHEN** Ravi Kumar (id 1) queues a JPEG for 3A bed 4 at 10:40:00, and at 11:00:00 it is read as a `cup` of 250 mL `water`
- **THEN** one read is stored, with kind `photo`, staff 1, 3A bed 4's admission and time 11:00:00
- **AND** the entry the queue saved is linked to its draft 0
- **AND** a queued read that fails, expires or is cancelled stores no read

## ADDED Requirements

### Requirement: Queued reads in the accuracy numbers
A draft of a read the queue sent (capture/read-queue) SHALL count in the accuracy numbers only through the entry the queue saved for it, whose outcome follows the nurse's review. Its level, bag reading and unsaved drafts, and the read itself when it has no draft or is negative, count in no outcome, rate, volume error, table row, negative or `nothing_drafted` count. This applies before "Outcome of a saved level", "Unsaved drafts" and "Negative reads". It makes 0 model requests.

#### Scenario: Saved entry follows the nurse
- **WHEN** a queued photo read for 3A bed 4 drafts a 250 mL `water` `cup`, the queue saves its entry, and Anita Thomas (id 4, nurse) approves it unchanged
- **THEN** `GET /api/quality/model?ward=<3A>` shows the `photo` `sam+spark` row with `accepted` 1 and `edited_at_capture` 0

#### Scenario: Queued level left out
- **WHEN** the only read of 3A bed 4 is a queued photo read that drafts a 600 mL `water_jug`, and the queue saves the level
- **THEN** `GET /api/quality/model?ward=<3A>` counts that draft in no outcome, no volume error and no type table row

#### Scenario: Nothing saved, nothing counted
- **WHEN** the only reads of 3A bed 4 are a queued photo read at 08:00 with the issue `no_container` and no draft, and a queued text note at 08:05 whose one draft has no volume, so neither saves anything
- **THEN** at 20:30 the summary for 3A shows `open` 0, `abandoned` 0 and `nothing_drafted` 0
- **AND** the negatives show confirmed and overridden over 0 reads
