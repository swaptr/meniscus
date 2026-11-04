# capture/notes Specification

## Purpose
Turn a short typed or spoken note from ward staff into draft intake/output chart entries with a fixed number of model requests.

## Requirements

### Requirement: Entries from a note
A text note SHALL be turned into draft entries with exactly one Spark request offering the `log_entry` tool, one entry per tool call, with "null"-like text fields normalised to null.

#### Scenario: Coconut water
- **WHEN** the note is `coconut water 200` and the model calls `log_entry` with volume 200 and notes `"null"`
- **THEN** exactly one Spark request was made and the entry has volume 200 and notes null

#### Scenario: Null-like strings
- **WHEN** a text field is `null`, ` N/A `, a JSON null, or ` cloudy `
- **THEN** it becomes null, null, null and `cloudy`

### Requirement: Voice note
A voice note SHALL be converted to 16 kHz mono WAV, transcribed with exactly one speech-to-text request, then parsed with exactly one Spark request.

#### Scenario: Recorded note
- **WHEN** a WAV recording is posted and transcribed as `bed 4 had a coconut water, 200 mL`
- **THEN** the upstream receives one ASR request then one Spark request, and the result carries that transcript and two trace entries

### Requirement: Undecodable audio
`POST /api/ai/voice-note` SHALL answer HTTP 422 `invalid_audio` for audio that cannot be decoded, without any model request.

#### Scenario: Not audio
- **WHEN** the `audio` field holds the text `not audio`
- **THEN** the response is 422 and the upstream received no request

### Requirement: Urine colour from a note
When a note states the urine's colour, its urine entry SHALL get the nearest `urine_colour` and `urine_rgb` null. Every other entry SHALL have both null. A text note stays at exactly 1 Spark request, and a voice note at 1 ASR request and 1 Spark request.

#### Scenario: Dark urine noted
- **WHEN** the note is `bed 3 passed 300 mL dark urine` and the model calls `log_entry` with `out`, `urine`, 300 and `urine_colour` `dark`
- **THEN** the entry has `urine_colour: dark` and `urine_rgb: null`
- **AND** exactly one Spark request was made

#### Scenario: Colour on a drink
- **WHEN** the model calls `log_entry` with `in`, `water`, 200 and `urine_colour` `red`
- **THEN** the entry has `urine_colour: null`

### Requirement: Voice note timing
The one speech-to-text request of `POST /api/ai/voice-note` SHALL ask for mode `ENDPOINTING`, which returns timed turns for the uploaded clip. The response SHALL also return `duration_ms` and `turns`, each `{ start_ms, end_ms, text }`. The request count is unchanged: one speech-to-text request, then one Spark request. Voice evidence posted with an entry MAY carry `duration_ms` and up to 200 turns, and entry lists SHALL return them.

#### Scenario: Two turns
- **WHEN** a voice note is posted, and speech-to-text returns `audioDurationMs: 4200` and the turns 0–1800 ms `bed 4 had a coconut water` and 1900–4100 ms `200 mL`
- **THEN** the speech-to-text request asked for `mode: ENDPOINTING`
- **AND** the response has `duration_ms: 4200` and those two turns as `{ start_ms, end_ms, text }`
- **AND** the upstream received exactly one speech-to-text request and one Spark request

### Requirement: Recording length limit
`POST /api/ai/voice-note` with a recording longer than 10 minutes SHALL answer HTTP 422 `{ error: "audio_too_long", message, retryable: false, duration_ms, limit_ms: 600000 }`. It makes 0 upstream requests and holds no budget slot, whatever the budget, and stores no read. A recording of 10 minutes or less keeps exactly 1 speech-to-text request, then 1 Spark request.

#### Scenario: Ten minutes and one second
- **WHEN** a 16 kHz WAV recording of 601,000 ms is posted for 3A bed 4
- **THEN** the response is 422 with `error: "audio_too_long"`, `retryable: false`, `duration_ms: 601000` and `limit_ms: 600000`
- **AND** the upstream received no request, and no read is stored

#### Scenario: Ten minutes exactly
- **WHEN** a 16 kHz WAV recording of 600,000 ms is posted and transcribed as `bed 4 had a coconut water, 200 mL`
- **THEN** the response is 200, and the upstream received exactly one speech-to-text request, then one Spark request

#### Scenario: Too long while the budget is spent
- **WHEN** the hourly cap of 2 has been used and a 16 kHz WAV recording of 601,000 ms is posted
- **THEN** the response is 422 with `error: "audio_too_long"`, not 429, and the upstream received no request

### Requirement: Drink kind from a note
The `log_entry` tool SHALL also take `drink`, one of the drink kinds (`water`, `tea`, `coffee`, `milk`, `juice`, `coconut_water`, `buttermilk`, `ors`, `supplement`, `soup`, `other`) or `none`. A `water` entry gets that kind, or `other` for `none`; a `food` entry gets it only when it is a kind, else null; every other entry gets null. `item` stays the model's name. A text note stays at exactly 1 Spark request, and a voice note at exactly 1 speech-to-text request and 1 Spark request.

#### Scenario: Coconut water typed
- **WHEN** the note is `coconut water 200` and the model calls `log_entry` with `in`, `water`, 200, item `coconut water` and drink `coconut_water`
- **THEN** the entry has `drink: coconut_water` and `item: "coconut water"`
- **AND** the request's `log_entry` parameters list `drink` as required, with an enum of the eleven kinds and `none`
- **AND** exactly one Spark request was made

#### Scenario: Tea and urine spoken
- **WHEN** a voice note is transcribed as `bed 4 had 200 mL chai and passed 300 mL urine`, and the model calls `log_entry` for `in`, `water`, 200, item `chai`, drink `tea`, and for `out`, `urine`, 300, drink `tea`
- **THEN** the first entry has `drink: tea` and `item: "chai"`, and the second has `drink: null`
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: Drink not named
- **WHEN** the note is `had a drink 150` and the model calls `log_entry` with `in`, `water`, 150 and drink `none`, and another note is `ate half the rice` and the model calls it with `in`, `food`, null and drink `none`
- **THEN** the first entry has `drink: other` and the second `drink: null`
- **AND** each note made exactly one Spark request
