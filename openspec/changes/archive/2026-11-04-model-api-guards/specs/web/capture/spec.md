## ADDED Requirements

### Requirement: Recording too long
When a voice note is answered HTTP 422 `audio_too_long`, the screen that sent it SHALL say `Recording over 10 minutes. Record a shorter note.` and draft nothing. It makes no further `/api/ai` request for that recording, so the note costs 0 model requests.

#### Scenario: Long recording refused
- **WHEN** a voice note for 3A bed 4 is sent and `POST /api/ai/voice-note` answers 422 with `{ error: "audio_too_long", message: "audio is 601000 ms; limit is 600000 ms", retryable: false, duration_ms: 601000, limit_ms: 600000 }`
- **THEN** the screen shows `Recording over 10 minutes. Record a shorter note.`, not the server's message
- **AND** no draft is shown, and exactly one `/api/ai` request was made
