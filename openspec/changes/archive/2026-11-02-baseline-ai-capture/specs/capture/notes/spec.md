## Purpose
Turn a short typed or spoken note from ward staff into draft intake/output chart entries with a fixed number of model requests.

## ADDED Requirements

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
