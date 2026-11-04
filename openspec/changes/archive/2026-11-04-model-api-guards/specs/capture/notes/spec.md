## ADDED Requirements

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
