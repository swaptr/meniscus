# Spec Delta

## MODIFIED Requirements

### Requirement: One read per photo, in order
Queued readings, photos and recordings alike, SHALL be read one at a time in queue order, each with exactly one read request. A photo's read request is one `POST /api/ai/read`, which makes 3 model requests (1 in fast mode). A recording's is one `POST /api/ai/voice-note`, which makes 2. A failed read SHALL be marked failed and read again only when the user taps Retry.

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

### Requirement: Save the round
"Save all high-confidence" SHALL save every unsaved photo reading with a draft whose confidence is at least 0.75. Each save uploads its photo as media once, then posts the entry, or the level for jug and bottle readings, with that `media_id`. Every other reading, including every recording, stays for individual review.

#### Scenario: Mixed round
- **WHEN** a round has photo readings at confidence 0.9 (urine bag), 0.8 (water jug) and 0.5 (urinal), plus one recording
- **THEN** one entry and one level are saved, each after its own media upload
- **AND** the 0.5 reading and the recording stay unsaved

## ADDED Requirements

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
