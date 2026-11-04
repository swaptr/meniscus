## MODIFIED Requirements

### Requirement: Typed upstream errors
An HTTP error SHALL become a `MetaApiError` carrying status, type, code and Retry-After, marked retryable only for 429, 500 and 503, the statuses the API documents as transient. Each call sends exactly 1 request and the client never retries it.

#### Scenario: Invalid key
- **WHEN** the API answers 401 with code `invalid_api_key`
- **THEN** the error has status 401, that code, type `authentication_error`, and is not retryable

#### Scenario: Rate limited
- **WHEN** the API answers 429 with `Retry-After: 7`
- **THEN** the error is retryable with `retryAfterMs` 7000 and only one request was sent

#### Scenario: Empty 404
- **WHEN** the API answers 404 with an empty body
- **THEN** the error message contains `404: Not Found`

#### Scenario: Transient statuses
- **WHEN** the API answers 500 with type `server_error`, and separately 503 with `Retry-After: 60`
- **THEN** both errors are retryable, the 503 has `retryAfterMs` 60000, and exactly one request was sent for each

#### Scenario: Bad gateway is not transient
- **WHEN** the API answers 502 with an empty body, and separately 504
- **THEN** both errors are `MetaApiError`s with `retryable` false, and exactly one request was sent for each

### Requirement: Audio checked locally
Speech-to-text SHALL only send RIFF/WAVE mono 16-bit PCM at 16 or 24 kHz lasting at most 10 minutes (600,000 ms), measured from the bytes of its `data` chunk that the file holds. Any other audio, including a WAV with no `data` chunk, is rejected with `InvalidAudioError` before any request, so it costs 0 requests, and audio that is too long with its subclass `AudioTooLongError`, which carries the clip's duration in whole ms and the limit. Valid audio sends exactly 1 request.

#### Scenario: Format check
- **WHEN** WAVs at 16 kHz and 24 kHz, a stereo WAV, a 44.1 kHz WAV and an Ogg header are checked
- **THEN** the first two pass and the rest throw `InvalidAudioError`

#### Scenario: Invalid audio never sent
- **WHEN** an 8-bit WAV is transcribed
- **THEN** `InvalidAudioError` is thrown and no request is sent

#### Scenario: Valid upload
- **WHEN** a 16 kHz WAV is transcribed with language bias `en, hi` and the API returns transcript ` hello `
- **THEN** the multipart `request` part is `{model: muse-voice-transcribe-1.0, audioEncoding: WAV, mode: PUSH_TO_TALK, languageBias: [en, hi]}` and the transcript is `hello`

#### Scenario: Ten minutes exactly
- **WHEN** a 16 kHz WAV whose `data` chunk holds 19,200,000 bytes, and a 24 kHz WAV whose `data` chunk holds 28,800,000 bytes, are each transcribed and the API answers 200
- **THEN** both are sent, and exactly two requests were sent

#### Scenario: Over ten minutes never sent
- **WHEN** a 16 kHz WAV whose `data` chunk holds 19,200,032 bytes is transcribed
- **THEN** an `AudioTooLongError`, which is also an `InvalidAudioError`, is thrown with `durationMs` 600001 and `limitMs` 600000
- **AND** no request is sent

#### Scenario: Over ten minutes and over 32 MB
- **WHEN** a 24 kHz WAV whose `data` chunk holds 34,000,000 bytes (about 11 min 48 s) is transcribed
- **THEN** an `AudioTooLongError` with `durationMs` 708333 is thrown, not the size error, and no request is sent

#### Scenario: Header claims more than the file holds
- **WHEN** a 16 kHz WAV declares a `data` chunk of 40,000,000 bytes but holds only 32,000 bytes of it, and the API answers 200
- **THEN** it is measured as 1,000 ms and sent, and exactly one request was sent

#### Scenario: Chunk between fmt and data
- **WHEN** a 16 kHz WAV laid out as the server's converter writes it, `RIFF`/`WAVE`, a 16-byte `fmt ` chunk, a 26-byte `LIST` chunk, then a `data` chunk whose 8-byte header starts at byte 70 and which holds 19,200,032 bytes, is transcribed
- **THEN** the `data` chunk is found by walking the chunks, an `AudioTooLongError` with `durationMs` 600001 is thrown, and no request is sent

#### Scenario: No data chunk
- **WHEN** a 16 kHz mono 16-bit WAV with a valid `fmt ` chunk and no `data` chunk is transcribed
- **THEN** an `InvalidAudioError` that is not an `AudioTooLongError` is thrown, and no request is sent

## ADDED Requirements

### Requirement: No extended prompt cache
Every Responses API request, for Spark and for SAM, SHALL be sent without a `prompt_cache_retention` field, even when the caller passes one, so the upstream keeps its default in-memory cache and never the optional 24 h retention. Each call still sends exactly 1 request.

#### Scenario: Reading and segmenting
- **WHEN** `generateObject` is called with output name `reading`, and `sam.segment` with prompt `urine bag`, and the API answers 200 to each
- **THEN** neither request body has a `prompt_cache_retention` key, and exactly two requests were sent

#### Scenario: Caller asks for 24 hours
- **WHEN** `responses.create` is called with `prompt_cache_retention: "24h"`, and the API answers 200
- **THEN** the request body has no `prompt_cache_retention` key, still has `store: false`, and exactly one request was sent
