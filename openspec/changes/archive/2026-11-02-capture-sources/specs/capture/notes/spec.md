# Spec Delta

## ADDED Requirements

### Requirement: Voice note timing
The one speech-to-text request of `POST /api/ai/voice-note` SHALL ask for mode `ENDPOINTING`, which returns timed turns for the uploaded clip. The response SHALL also return `duration_ms` and `turns`, each `{ start_ms, end_ms, text }`. The request count is unchanged: one speech-to-text request, then one Spark request. Voice evidence posted with an entry MAY carry `duration_ms` and up to 200 turns, and entry lists SHALL return them.

#### Scenario: Two turns
- **WHEN** a voice note is posted, and speech-to-text returns `audioDurationMs: 4200` and the turns 0–1800 ms `bed 4 had a coconut water` and 1900–4100 ms `200 mL`
- **THEN** the speech-to-text request asked for `mode: ENDPOINTING`
- **AND** the response has `duration_ms: 4200` and those two turns as `{ start_ms, end_ms, text }`
- **AND** the upstream received exactly one speech-to-text request and one Spark request
