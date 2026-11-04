# Spec Delta

## Purpose

A photo read, voice note or text note that the local model budget cannot serve now waits in a durable queue instead of being refused. This capability covers the queue's order, sending each read at most and never retrying it, expiry, what a finished read saves for nurse approval, and how staff see, cancel and re-read queued reads.

## ADDED Requirements

### Requirement: Queued instead of refused
A photo read, voice note or text note that names a bed and sends `Prefer: respond-async` SHALL answer 202 `{ queued }` with `Preference-Applied: respond-async` when the local budget cannot admit it now or an older read of its class or a higher one is still waiting. It stores the photo or recording as that bed's media and a note's text in the store, and sends no upstream request. Admitted at once, it answers as without the header.

#### Scenario: Queued at the routine ceiling
- **WHEN**, with a cap of 120, a 30 % reserve and 84 requests in use, all sent at 10:00:00, Ravi Kumar (id 1) posts a JPEG to `/api/ai/read` for 3A bed 4 (`stable`) at 10:40:00 with `Prefer: respond-async`
- **THEN** the response is 202 with the header `Preference-Applied: respond-async`, and `queued` holds:
  - `status: "queued"`, `kind: "photo"`, `budget_class: "routine"`;
  - `position: 1`, `eta` 11:00:00, `expires_at` 11:25:00;
  - `requests: 0`, and a `media` reference of kind `photo`
- **AND** the upstream received no request, and `GET /api/media/<that id>` returns the posted bytes

#### Scenario: Room now
- **WHEN** 10 of 120 requests are in use, nothing is waiting, and the same JPEG is posted with `Prefer: respond-async`
- **THEN** the response is 200 with the read, as without the header, after exactly 2 SAM requests and 1 Spark request
- **AND** no queued read is stored

#### Scenario: Behind an older read
- **WHEN**, with a concurrency limit of 4 and 3 requests in flight, a `sam+spark` photo read for 3A bed 4 is queued (it needs 2 free slots), and then a text note `{ text: "tea 150" }` for 3A bed 6, which would fit the 1 free slot, is posted with `Prefer: respond-async`
- **THEN** the note answers 202 with `position: 2`
- **AND** the upstream received no request for either

#### Scenario: Not queued
- **WHEN** 84 of 120 requests are in use (routine ceiling 84) and each of these is posted:
  - the JPEG for 3A bed 4 without `Prefer`;
  - the JPEG with `Prefer: respond-async` and no `admission_id`;
  - a tray photo to `/api/ai/meal` for 3A bed 4 with `Prefer: respond-async`;
  - `POST /api/ai/explain` for 3A bed 4, which has a `logging_gap` prompt, with `Prefer: respond-async`
- **THEN** each response is 429 `request_budget_exceeded` with `budget_class: "routine"`
- **AND** no queued read is stored, and the upstream received no request

### Requirement: Queue order
Waiting reads SHALL be sent critical class first, then in capture order. A read queued in the critical class raises its bed's waiting reads to critical, so one bed's reads keep their capture order. `position` counts waiting reads from 1 across the hospital. `eta` is when the hourly window, after the fewest requests of the reads ahead, admits the read's own fewest: photo 1, voice 2, text 1.

#### Scenario: Critical goes first
- **WHEN**, with a cap of 120, a 30 % reserve and a concurrency limit of 4, all 120 requests in use were sent at 10:00:00, and these are posted with `Prefer: respond-async`:
  - a JPEG for 3A bed 4 at 10:50:00;
  - a text note for 3A bed 6 at 10:51:00;
  - a voice note for HDU bed 1 (`critical`) at 10:52:00
- **THEN** they answer 202 with positions 1, 2 and 1, and the chart reads of 3A beds 4 and 6 then show positions 2 and 3
- **AND** at 11:00:00 the first upstream request of each is sent in the order HDU bed 1 (speech-to-text), 3A bed 4 (SAM), 3A bed 6 (Spark)

#### Scenario: Raised with its bed
- **WHEN**, with all 120 requests in use sent at 10:00:00, JPEGs are queued for 3A bed 4 at 10:49:00 and for 3A bed 2 (`stable`) at 10:50:00, and at 10:51:00 a nurse sets bed 2's acuity to `critical` and a text note for bed 2 is queued
- **THEN** bed 2's photo and note show `budget_class: "critical"` at positions 1 and 2
- **AND** 3A bed 4's photo shows position 3

#### Scenario: Estimated start
- **WHEN**, with a cap of 120 and a 30 % reserve, 84 requests are in use, 2 sent at 10:00:00 and 82 at 10:30:00, and text notes for 3A bed 4 and 3A bed 6 are queued at 10:40:00
- **THEN** both show `eta` 11:00:00, at positions 1 and 2

### Requirement: Sent at most once, when it fits
A waiting read SHALL be sent exactly once, as soon as its class's hourly ceiling and its in-flight slots admit it and no read is ahead of it. It runs in the mode the budget picks then, with that mode's upstream requests: photo 3 in `sam+spark` mode or 1 in `spark` mode, voice 2, text 1. It is sent whether or not its staff member is still signed in, and once sent it never waits again.

#### Scenario: Window rolls
- **WHEN** the JPEG for 3A bed 4 queued at 10:40:00, with 84 requests in use all sent at 10:00:00, is still waiting at 10:59:59
- **THEN** the upstream has received no request for it
- **AND** at 11:00:00 it is sent with exactly 2 SAM requests and 1 Spark request in `sam+spark` mode, and it then shows `status: "done"` and `requests: 3`

#### Scenario: One request frees
- **WHEN** 84 requests are in use, 1 sent at 10:00:00 and 83 at 10:30:00, and a JPEG for 3A bed 4 is queued at 10:40:00 in `sam+spark` mode
- **THEN** at 11:00:00 it is sent with exactly 1 Spark request and no SAM request
- **AND** its read has `mode: "spark"` and a warning starting `budget pressure`

#### Scenario: Slots free
- **WHEN** 4 requests are in flight with a concurrency limit of 4, a text note for 3A bed 4 is queued at 10:40:00, and one in-flight action ends at 10:40:20
- **THEN** the note is sent at 10:40:20 with exactly 1 Spark request

### Requirement: Upstream failures are not retried
A waiting read whose upstream request fails, through an HTTP error (429 and 503 included), a timeout or no connection, SHALL end `failed` with that error's code. It saves nothing, is never sent again, and has made exactly the requests it sent. Its photo or recording stays. A failed SAM request on a photo still degrades, as it does for any photo read. Only a staff tap on Read again reads it again.

#### Scenario: Spark unavailable
- **WHEN** a queued text note for 3A bed 4 is sent at 11:00:00 and Spark answers HTTP 503
- **THEN** the read shows `status: "failed"`, `error: "model_api_error"`, `upstream_status: 503` and `requests: 1`, and no entry is saved
- **AND** by 13:00:00 the upstream has received no other request for it

#### Scenario: Rate-limited upstream
- **WHEN** a queued photo read for 3A bed 4 is sent in `sam+spark` mode and Spark answers HTTP 429 `rate_limit_exceeded` with `Retry-After: 12`
- **THEN** the read shows `status: "failed"`, `upstream_status: 429` and `requests: 3`
- **AND** the upstream receives no request for it at 11:00:12 or later

#### Scenario: Speech-to-text fails
- **WHEN** a queued voice note for HDU bed 1 is sent and its speech-to-text request answers HTTP 503
- **THEN** the read shows `status: "failed"` and `requests: 1`, and no Spark request is sent
- **AND** `GET /api/media/<its recording's id>` still returns the recording

#### Scenario: Segmentation fails, read saved
- **WHEN** a queued `sam+spark` photo read's container SAM request answers HTTP 500, and Spark reads a `cup` of 250 mL `water`
- **THEN** exactly 3 upstream requests are sent
- **AND** the read ends `done` with `outcome: "saved"`, and a pending 250 mL `water` entry is saved

### Requirement: Read again
`POST /api/ai/read-again` with `{ job_id }` of a `failed` or `expired` read SHALL queue one new read of the same photo, recording or text for the same bed, by the signed-in staff member, and answer 202 `{ queued }`, or 429 as "Queue full" says. It uploads nothing, and sends upstream only once the new read is admitted, with its mode's requests. A read already read again answers 409 `already_read_again`, and a read in any other state 409 `not_readable_again`.

#### Scenario: Tap after a failure
- **WHEN** Anita Thomas (id 4, nurse) reads the failed text note again at 11:05:00, with 10 requests in use
- **THEN** the response is 202 with a new `queued` read whose `created_by` is Anita Thomas, and the failed read shows `read_again_job_id` equal to its id
- **AND** the upstream receives exactly 1 Spark request for the new read, and a pending entry is saved for 3A bed 4

#### Scenario: Only once
- **WHEN** the same `job_id` is posted to `/api/ai/read-again` a second time
- **THEN** the response is 409 `already_read_again`, no read is queued, and the upstream receives no request

#### Scenario: Not failed
- **WHEN** `/api/ai/read-again` is posted for a read that is still waiting, and for one that is `done`
- **THEN** both answer 409 `not_readable_again`, and the upstream receives no request

### Requirement: Waiting reads expire
A waiting read not sent within its maximum wait, counted from its capture, SHALL end `expired` with `requests: 0`, save nothing and never be sent. The wait is `READ_QUEUE_MAX_WAIT_CRITICAL_MIN` (default 10) for the critical class and `READ_QUEUE_MAX_WAIT_ROUTINE_MIN` (default 45) otherwise. Its photo or recording stays the bed's media, linkable to a record entered by hand.

#### Scenario: Overtaken by critical reads
- **WHEN**, with a cap of 10 and a 30 % reserve (routine ceiling 7), 7 requests were sent at 10:00:00, a JPEG for 3A bed 4 is queued at 10:20:00 with `eta` 11:00:00, HDU bed 1 sends 3 requests at 10:30:00, and 7 text notes for HDU bed 1 are queued at 10:52:00
- **THEN** at 11:00:00 the 7 notes are sent first, and the JPEG keeps waiting
- **AND** at 11:05:00 it shows `status: "expired"` and `requests: 0`, and the upstream receives no request for it, then or after 11:30:00

#### Scenario: Entered by hand with its photo
- **WHEN**, after it expired, Ravi Kumar posts a 250 mL `water` entry for 3A bed 4 with `source: "photo"`, no evidence, and the expired read's `media.id` as `media_id`
- **THEN** the response is 201, and the entry's `media` is that photo

### Requirement: Queue full
A read whose `eta` is later than its capture time plus its maximum wait SHALL not be queued. It answers 429 `request_budget_exceeded` with `limit: "hourly"`, its `budget_class`, and a `retry_after_ms` (at least 1000) until it could be queued. It stores nothing and sends no upstream request.

#### Scenario: Past the routine wait
- **WHEN**, with a cap of 120 and a 30 % reserve, 84 requests are in use (2 sent at 10:00:00 and 82 at 10:30:00), and at 10:40:00 text notes for 3A beds 4 and 6 and then a JPEG for 3A bed 2 are posted with `Prefer: respond-async`
- **THEN** both notes answer 202 with `eta` 11:00:00
- **AND** the JPEG answers 429 with `limit: "hourly"`, `budget_class: "routine"`, `retry_after_ms: 300000` and `Retry-After: 300`, because its start, 11:30:00, is 50 minutes away
- **AND** no read and no media is stored for the JPEG

#### Scenario: Critical waits less
- **WHEN** all 120 requests in use were sent at 10:00:00, and a voice note for HDU bed 1 is posted at 10:45:00 with `Prefer: respond-async`
- **THEN** it answers 429 with `budget_class: "critical"` and `retry_after_ms: 300000`, because its start, 11:00:00, is more than 10 minutes away

### Requirement: Queued photo saves its record
When a queued photo read answers, the server SHALL save what the ward round saves for that read: a jug or bottle level; a bag reading with the bed's default event; or one pending entry, a `water` drink taking its consistency from an active thickened-fluids order. Each record is saved as the staff member who took the photo, charted when the photo was taken (a level, which has no charted time, when it is read), and linked to the photo and its read. Saving makes no more upstream requests.

#### Scenario: Attendant leaves, nurse approves
- **WHEN** Ravi Kumar (id 1, attendant) queues a JPEG for 3A bed 4 at 10:40:00 and signs out at 10:41:00, and at 11:00:00 the read finds a `cup` of 250 mL `water` at confidence 0.9
- **THEN** a pending 250 mL `water` entry is saved for 3A bed 4 with:
  - `source: "photo"`, `created_by` Ravi Kumar, charted at 10:40:00;
  - the photo as its `media`, `queued_read: true`, and photo evidence with `mode: "sam+spark"`
- **AND** the read shows `outcome: "saved"` with that entry's id, and the upstream received exactly 3 requests in all
- **AND** Anita Thomas (id 4, nurse) sees the entry pending on `GET /api/admissions/<3A bed 4>/entries` and approves it with one review request

#### Scenario: Jug level
- **WHEN** 3A bed 4 has a 1000 mL `water_jug` level charted at 09:00, and a JPEG captured at 10:40:00 is read at 11:00:00 as a `water_jug` at 600 mL
- **THEN** a 600 mL `water_jug` level and a pending 400 mL intake entry are saved at 11:00:00, each linked to the photo, and the level linked to the read

#### Scenario: Bag reading with the bed's default event
- **WHEN** queued photo reads find a `urine_bag` at 450 mL for 3A bed 3 (ward default: a reading every 4 h), one at 300 mL for HDU bed 1 (ward default every hour), and one at 350 mL for 3A bed 5, whose catheter order sets `measure_every_h: 1`
- **THEN** 3A bed 3 gets a bag reading with `event: "emptied"`, and HDU bed 1 and 3A bed 5 each one with `event: "check"`
- **AND** each reading has `source: "photo"` and its photo, and each rise is charted as one pending `urine` entry

#### Scenario: Nothing to chart
- **WHEN** a queued photo read finds no container: issue `no_container`, no draft
- **THEN** nothing is saved, and the read shows `status: "done"` and `outcome: "nothing_to_chart"`
- **AND** its photo stays the bed's media

#### Scenario: A save rule refuses it
- **WHEN** a JPEG for 3A bed 3 captured at 10:40:00 is read at 11:00:00 as a `urine_bag` at 380 mL, to be saved as `emptied`, and an emptying of that bag at 390 mL charted at 10:45:00 was saved by hand
- **THEN** nothing is saved, and the read shows `outcome: "not_saved"` and `error: "duplicate_reading"`
- **AND** the upstream received exactly 3 requests for it, and none after

#### Scenario: Attendant's photo inside a fall
- **WHEN** 3A bed 3's bag fell from 500 mL charted at 10:00:00 to 150 mL charted at 10:50:00, and a JPEG Ravi Kumar (id 1, attendant) captured at 10:40:00 is read at 11:00:00 as a `urine_bag` at 550 mL, to be saved as `emptied`
- **THEN** nothing is saved, the read shows `outcome: "not_saved"` and `error: "forbidden"`, and the alerts still include `bag_level_fell`
- **AND** a nurse can then post that emptying by hand with the read's photo as `media_id`

### Requirement: Queued note saves its drafts
When a queued voice or text note answers, the server SHALL save one pending entry for each draft with a volume of at least 1 mL. Each entry is saved as the staff member who made the note, charted when the note was made, and linked to its read draft and, for voice, to its recording. Saving makes no more upstream requests. Drafts without a volume are not saved, and a note with nothing saved ends `nothing_to_chart`.

#### Scenario: Two drafts
- **WHEN** a recording for 3A bed 4, queued at 10:40:00, is transcribed at 11:00:00 as `bed 4 had 200 mL tea and passed 300 mL urine`, and the model drafts `water` 200 mL and `urine` 300 mL
- **THEN** two pending entries are saved, charted at 10:40:00, with `source: "voice"`, the recording as `media`, and read drafts 0 and 1
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: No volume
- **WHEN** a queued text note `{ text: "had some coconut water" }` is read, and the model drafts `water` with `volume_ml: null`
- **THEN** nothing is saved, and the read shows `outcome: "nothing_to_chart"` after exactly 1 Spark request

### Requirement: Cancel a waiting read
`POST /api/read-jobs/:id/cancel` SHALL cancel a read that is still waiting, for the staff member who queued it or for a nurse or matron. It answers 200 with `status: "cancelled"`, and no upstream request is ever sent for the read. A read already sent or finished answers 409 `not_waiting`, and another attendant gets 403 `forbidden`. The photo or recording stays.

#### Scenario: Entered by hand instead
- **WHEN** at 10:42:00 Ravi Kumar cancels the photo read for 3A bed 4 that he queued at 10:40:00
- **THEN** the response is 200 with `status: "cancelled"`, and at 11:00:00 the upstream receives no request for it
- **AND** a `photo` entry with no evidence and its photo as `media_id` is then saved with 201

#### Scenario: Not his, or too late
- **WHEN** Sunita Devi (id 2, attendant) cancels Ravi Kumar's waiting read, and Ravi Kumar cancels a read already sent
- **THEN** the responses are 403 `forbidden` and 409 `not_waiting`, and neither read changes

### Requirement: Reads on the bed's chart
`GET /api/admissions/:id/entries` SHALL return `reads`, newest first, with no model request. It lists the bed's waiting and running reads, and those that ended `failed`, `expired`, `nothing_to_chart` or `not_saved` in the last `READ_ABANDON_HOURS` and were not read again. Each read carries its status, outcome, error, `requests` and media, and, while waiting, `position` and `eta`. A text note's text appears only here.

#### Scenario: A morning's reads
- **WHEN** 3A bed 4 has a read waiting at position 2, one that failed at 09:10:00, one saved at 09:30:00 and one cancelled at 09:40:00
- **THEN** `reads` lists the waiting read and then the failed one, and neither the saved nor the cancelled read
- **AND** the upstream received no request for the chart read

### Requirement: Waiting reads on the bed list
`GET /api/admissions` items SHALL carry `reads_waiting`, the number of the bed's reads still waiting or being sent, with no model request.

#### Scenario: Two waiting
- **WHEN** 3A bed 4 has two reads waiting and one failed, and 3A bed 6 has none
- **THEN** `GET /api/admissions?ward=<3A>` gives bed 4 `reads_waiting: 2` and bed 6 `reads_waiting: 0`

### Requirement: Entries from a queued read are marked
Every entry SHALL carry `queued_read`. It is `true` when a queued read saved the entry, directly or as the charted drop or rise of a level or bag reading it saved, and `false` otherwise.

#### Scenario: Marked
- **WHEN** 3A bed 4 has one pending entry saved by a queued read, and one saved from a read at the bed
- **THEN** the first has `queued_read: true` and the second `queued_read: false`

### Requirement: Queued reads survive a restart
Waiting reads, with their photos, recordings and note text, SHALL survive a server restart and be sent after it once admitted. A read that was being sent when its server stopped ends `failed` with `error: "interrupted"` once its hold lapses, at its requests' timeouts plus 30 s from when it was sent, and is never sent again.

#### Scenario: Restart while waiting
- **WHEN** a JPEG for 3A bed 4 is queued at 10:40:00, with 84 requests in use all sent at 10:00:00, and the server is stopped at 10:50:00 and started again on the same database at 10:55:00
- **THEN** the read is still waiting, at position 1 with `eta` 11:00:00
- **AND** at 11:00:00 it is sent with exactly 3 upstream requests and saves its entry

#### Scenario: Stopped mid-read
- **WHEN**, with `MODEL_API_TIMEOUT_MS` 90000, a queued text note is sent at 11:00:00, the server stops at 11:00:05 while its Spark request is in flight, and is started again on the same database at 11:00:30
- **THEN** at 11:01:59 the read still shows `status: "running"`
- **AND** at 11:02:00 it shows `status: "failed"`, `error: "interrupted"` and `requests: 1`
- **AND** the upstream receives no further request for it

### Requirement: Budget counted in the store
The hourly budget SHALL count the requests sent in the rolling hour, and the slots held by admitted actions, from the database. A restart therefore keeps the hour's count, and every server on one database shares one hour, one critical reserve and one in-flight limit.

#### Scenario: Restart keeps the hour
- **WHEN** 84 requests were sent between 10:00:00 and 10:30:00, the server restarts at 10:40:00, and a text note for 3A bed 4 is posted without `Prefer`
- **THEN** the response is 429 with `budget_class: "routine"`, and the upstream received no request for it

#### Scenario: Two workers, one hour
- **WHEN** two servers share one database with a cap of 4, the first sends a 3-request photo read, and the second gets a voice note for HDU bed 1 without `Prefer`, which needs 2
- **THEN** the second answers 429 with `limit: "hourly"`
- **AND** the upstream received exactly 3 requests in all

### Requirement: Each read sent by one worker
A waiting read SHALL be claimed by exactly one server, in the same database transaction that checks the budget and holds its requests, so two servers on one database that are woken together send it once.

#### Scenario: Woken together
- **WHEN** two servers on one database are both woken at 11:00:00 for one waiting `sam+spark` photo read
- **THEN** the upstream receives exactly 2 SAM requests and 1 Spark request
- **AND** the read is claimed once

### Requirement: Queue woken, never polled
The server SHALL look at the queue only when a read is queued or cancelled or an admitted action ends, on it or on a server sharing its database, and at the one instant it computes after each look: the earliest of when the hourly window next admits the first waiting read, when a waiting read expires, and when an admitted action's hold lapses. With nothing waiting or being sent it sets no timer, and no look sends a request for a read already sent.

#### Scenario: Idle
- **WHEN** nothing is queued from 10:00:00 to 11:00:00
- **THEN** the server sets no queue timer and makes no queue look in that hour

#### Scenario: One timer
- **WHEN** the only waiting read was queued at 10:40:00 with `eta` 11:00:00 and `expires_at` 11:25:00
- **THEN** exactly one queue timer is set, for 11:00:00
- **AND** nothing is sent for the read before that timer fires

#### Scenario: Woken by another server
- **WHEN** two servers share one database with a concurrency limit of 4, server A holds all 4 in-flight slots, a text note for 3A bed 4 is queued on server B at 10:40:00, and A's action ends at 10:40:20
- **THEN** at 10:40:20 the note is sent with exactly 1 Spark request, and neither server had a queue timer set for it

### Requirement: Queued reads stay in the store
A queued read's photo, recording and note text SHALL be kept only in the store. No log line, error body, metric or queued-read response holds them. The only exceptions are the media reference, and a note's text on the bed's chart read.

#### Scenario: Nothing in the logs
- **WHEN** the text note `{ text: "felt dizzy after tea 200" }` and a recording are queued for 3A bed 4 and read, and the recording's read fails with HTTP 503
- **THEN** no captured log line, and no response body except 3A bed 4's chart read, contains `felt dizzy`, the transcript or the recording's bytes
- **AND** `GET /api/metrics` contains none of them
