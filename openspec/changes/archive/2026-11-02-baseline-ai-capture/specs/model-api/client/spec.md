## Purpose
The @meniscus/meta client: one HTTP request per call, a hard request budget, typed errors, no upstream retention and validated output.

## ADDED Requirements

### Requirement: No upstream retention
Responses API requests SHALL send `store: false` unless the caller overrides it, and SHALL send JSON output requests with a strict `json_schema` text format.

#### Scenario: Structured reading
- **WHEN** `generateObject` is called with output name `reading`
- **THEN** the request body has `store: false` and `text.format` `{type: json_schema, name: reading, strict: true}`, and the request hook reports status 200 for that model

#### Scenario: SAM request
- **WHEN** `sam.segment` is called with prompt `urine bag`
- **THEN** the body has model `sam-3.1`, metadata `{include_confidence: "true", mask_encoding: "lossless"}` and `store: false`

### Requirement: Typed upstream errors
An HTTP error SHALL become a `MetaApiError` carrying status, type, code and Retry-After, marked retryable only for 429, 500, 502 and 503; the client SHALL NOT retry.

#### Scenario: Invalid key
- **WHEN** the API answers 401 with code `invalid_api_key`
- **THEN** the error has status 401, that code, type `authentication_error`, and is not retryable

#### Scenario: Rate limited
- **WHEN** the API answers 429 with `Retry-After: 7`
- **THEN** the error is retryable with `retryAfterMs` 7000 and only one request was sent

#### Scenario: Empty 404
- **WHEN** the API answers 404 with an empty body
- **THEN** the error message contains `404: Not Found`

### Requirement: Transport failures
A network failure SHALL become a retryable `MetaConnectionError`, a timeout a `MetaTimeoutError`, and a caller cancellation SHALL rethrow the caller's own reason without sending a request when already aborted.

#### Scenario: Network down
- **WHEN** fetch throws `TypeError: fetch failed`
- **THEN** a retryable `MetaConnectionError` is thrown

#### Scenario: Hung upstream
- **WHEN** the upstream never answers and the timeout is 20 ms
- **THEN** a `MetaTimeoutError` is thrown

#### Scenario: Pre-aborted signal
- **WHEN** the signal is already aborted with reason `user left`
- **THEN** the call rejects with `user left` and nothing is sent

### Requirement: Request budget
The client SHALL refuse a request with a non-retryable `MetaBudgetError`, sending nothing, when the rolling-hour count or the in-flight count is at its limit.

#### Scenario: Hourly cap of 2
- **WHEN** three requests are made with a cap of 2 per hour
- **THEN** the third fails with limit `hourly` and only two requests were sent

#### Scenario: One in flight
- **WHEN** a second request starts while one is in flight with a concurrency cap of 1
- **THEN** it fails with `MetaBudgetError`, and after the first settles a new request succeeds

#### Scenario: Window rolls
- **WHEN** the hourly cap of 1 is used and 3,600,001 ms pass
- **THEN** a new request is allowed

### Requirement: Validated output
Model output SHALL be validated against the caller's Standard Schema, and incomplete or refused responses SHALL raise `MetaResponseError`.

#### Scenario: Wrong type
- **WHEN** the schema expects numeric `ml` and the model returns `{"ml":"lots"}`
- **THEN** a `MetaOutputError` with issue `ml: expected number` is thrown

#### Scenario: Incomplete and refused
- **WHEN** the response status is `incomplete` with reason `max_output_tokens`, or the message is a refusal
- **THEN** `MetaResponseError` is thrown with code `max_output_tokens`, or status `refused`

#### Scenario: Two tool calls
- **WHEN** the output holds a reasoning item and two `log` function calls with ml 200 and 350
- **THEN** both calls are returned in order and the request sent `tool_choice: auto`

#### Scenario: No tool call
- **WHEN** the model answers `nothing to log` without calling the tool
- **THEN** no calls are returned and the text is `nothing to log`

### Requirement: Audio checked locally
Speech-to-text SHALL only send RIFF/WAVE mono 16-bit PCM at 16 or 24 kHz, rejecting anything else with `InvalidAudioError` before any request.

#### Scenario: Format check
- **WHEN** WAVs at 16 kHz and 24 kHz, a stereo WAV, a 44.1 kHz WAV and an Ogg header are checked
- **THEN** the first two pass and the rest throw `InvalidAudioError`

#### Scenario: Invalid audio never sent
- **WHEN** an 8-bit WAV is transcribed
- **THEN** `InvalidAudioError` is thrown and no request is sent

#### Scenario: Valid upload
- **WHEN** a 16 kHz WAV is transcribed with language bias `en, hi` and the API returns transcript ` hello `
- **THEN** the multipart `request` part is `{model: muse-voice-transcribe-1.0, audioEncoding: WAV, mode: PUSH_TO_TALK, languageBias: [en, hi]}` and the transcript is `hello`
