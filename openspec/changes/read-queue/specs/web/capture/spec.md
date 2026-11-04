# Spec Delta

## ADDED Requirements

### Requirement: Queued read at the bed
When a photo read, voice note or text note answers 202, the bed's capture screen SHALL keep the photo, recording or note on screen. It shows `Queued · position <n> · about <HH:MM>` and `You can leave. It is saved for nurse approval once read.`, offers Done and Enter by hand instead, and sends no `/api/ai` request on any timer. The screen sends `Prefer: respond-async` and the bed's `admission_id` with every photo read, voice note and text note.

#### Scenario: Photo queued
- **WHEN** at 10:40 a photo read for 3A bed 4 answers 202 with `position: 3` and `eta` 11:00
- **THEN** the photo stays on screen with `Queued · position 3 · about 11:00` and `You can leave. It is saved for nurse approval once read.`
- **AND** the read request carried `Prefer: respond-async` and 3A bed 4's `admission_id`
- **AND** Done returns to the capture tiles, and no `/api/ai` request is sent afterwards without a tap

#### Scenario: Enter by hand instead
- **WHEN** Enter by hand instead is tapped on that queued photo
- **THEN** exactly one `POST /api/read-jobs/<id>/cancel` is sent, and on its 200 the by-hand form opens for 3A bed 4 with the photo attached
- **AND** saving it sends one entry request with the photo's `media_id`, and no `/api/ai` request

#### Scenario: Already being read
- **WHEN** Enter by hand instead is tapped and the cancel answers 409 `not_waiting`
- **THEN** the screen says `Already being read. Its entry will appear for nurse approval.` and opens no by-hand form

### Requirement: Bed screen follows its reads
The bed's capture screen SHALL list the bed's reads from its chart read, refreshing that chart read every 30 s only while one of them is waiting or being sent. It offers Enter by hand, with the photo or recording attached, on a failed, expired or not saved read, and Read again on a failed or expired one, each only on a tap.

#### Scenario: Read failed while away
- **WHEN** Ravi Kumar opens 3A bed 4's capture screen and its chart read lists a photo read `failed` with `upstream_status: 503`
- **THEN** the screen shows `Read failed (model unavailable). Enter by hand or read again.`, with Enter by hand and Read again
- **AND** tapping Read again sends exactly one `POST /api/ai/read-again` with that read's `job_id`, and nothing is sent without the tap

#### Scenario: Refresh only while waiting
- **WHEN** the bed has one read waiting at 10:40:00, and it ends `done` between 11:00:00 and 11:00:30
- **THEN** the screen sends one chart read every 30 s until a chart read shows nothing waiting, then stops
- **AND** it sends no `/api/ai` request
