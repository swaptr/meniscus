# model-api/client Specification

## Purpose
The @meniscus/meta client: one HTTP request per call, a hard request budget, typed errors, no upstream retention and validated output.

## Requirements

### Requirement: No upstream retention
Responses API requests SHALL send `store: false` unless the caller overrides it, and SHALL send JSON output requests with a strict `json_schema` text format.

#### Scenario: Structured reading
- **WHEN** `generateObject` is called with output name `reading`
- **THEN** the request body has `store: false` and `text.format` `{type: json_schema, name: reading, strict: true}`, and the request hook reports status 200 for that model

#### Scenario: SAM request
- **WHEN** `sam.segment` is called with prompt `urine bag`
- **THEN** the body has model `sam-3.1`, metadata `{include_confidence: "true", mask_encoding: "lossless"}` and `store: false`

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
The client SHALL admit an action of one or more requests only if all of them fit, holding them until it ends, and otherwise refuse it up front with a retryable `MetaBudgetError` carrying `limit` and `retryAfterMs`, sending nothing. Requests sent in the rolling hour plus those held stay within the action's priority ceiling (the cap for `high`, the cap less `reservePct` percent for `normal`), and in-flight requests within their limit. Unsent requests are returned.

#### Scenario: Hourly cap of 2
- **WHEN** three requests are made with a cap of 2 per hour
- **THEN** the third fails with limit `hourly` and only two requests were sent

#### Scenario: One in flight
- **WHEN** a second request starts while one is in flight with a concurrency cap of 1
- **THEN** it fails with `MetaBudgetError`, and after the first settles a new request succeeds

#### Scenario: Window rolls
- **WHEN** the hourly cap of 1 is used and 3,600,001 ms pass
- **THEN** a new request is allowed

#### Scenario: Whole action or nothing
- **WHEN**, with a cap of 10 and 8 requests sent, a `normal` action of 3 requests is reserved
- **THEN** it fails with limit `hourly` and no request is sent
- **AND** a `normal` action of 2 is then admitted, and its 2 requests are sent without a budget error

#### Scenario: Reserve for high priority
- **WHEN**, with a cap of 10, `reservePct` 30 and 7 requests sent, a `normal` action of 1 and a `high` action of 3 are reserved
- **THEN** the `normal` action fails with limit `hourly`, and the `high` action is admitted

#### Scenario: Retry time
- **WHEN**, with a cap of 2, requests were sent at 10:00:00 and 10:20:00, and a `normal` action of 1 is reserved at 10:40:00
- **THEN** it fails with `retryAfterMs` 1,200,000, the time until the 10:00:00 request leaves the hour, and `retryable` true

#### Scenario: Retry time when the excess is held
- **WHEN**, with a cap of 2 and no request sent in the hour, a `normal` action of 2 is admitted and has sent nothing yet, and a `normal` action of 1 is reserved
- **THEN** the second fails with limit `hourly`, `retryAfterMs` 60,000 and `retryable` true, and no request is sent

#### Scenario: Retry time when the action exceeds its ceiling
- **WHEN**, with a cap of 10, `reservePct` 30 and no request sent in the hour, a `normal` action of 8 is reserved, its ceiling being 7
- **THEN** it fails with limit `hourly`, `retryAfterMs` 3,600,000 and `retryable` true, and no request is sent
- **AND** a `high` action of 8 is then admitted

#### Scenario: Unsent requests returned
- **WHEN**, with a cap of 4, an action of 3 is admitted, sends 1 request and ends
- **THEN** a second action of 3 is admitted at once, after which an action of 1 fails with limit `hourly`

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

### Requirement: Image requests
Image generation and image editing SHALL each send exactly one JSON request through the request budget, to `POST /v1/images/generations` or `POST /v1/images/edits`, never retried. The body has `n: 1` unless given, `response_format: b64_json` always, `reasoning_strength: low` unless given, and `tool_enablement` with image search, web search and shell all `false` unless given. It never has `stream`, `moderation`, `mask`, `input_fidelity` or `partial_images`.

#### Scenario: Generate with defaults
- **WHEN** an image is generated with model `muse-image-1.0` and prompt `a urine drainage bag hanging on a bed frame`
- **AND** the API answers 200 with `{created: 1793750400, data: [{b64_json: "iVBORw0KGgo=", revised_prompt: "a drainage bag on a bed rail"}], output_format: "png"}`
- **THEN** exactly one request was sent, to `https://api.meta.ai/v1/images/generations`, with this JSON body and no other field: `{model: "muse-image-1.0", prompt: "a urine drainage bag hanging on a bed frame", n: 1, response_format: "b64_json", reasoning_strength: "low", tool_enablement: {enable_image_search: false, enable_web_search: false, enable_shell: false}}`
- **AND** the result holds one image whose bytes are `89 50 4E 47 0D 0A 1A 0A`, with revised prompt `a drainage bag on a bed rail`, `created` 1793750400 and output format `png`

#### Scenario: Edit one image
- **WHEN** an image is edited with prompt `show the bag about one quarter full`, the one input `{image_url: "data:image/jpeg;base64,/9j/4AAQ"}` and output format `webp`
- **AND** the API answers 200 with one `b64_json` image
- **THEN** exactly one request was sent, to `https://api.meta.ai/v1/images/edits`, with `Content-Type: application/json`
- **AND** its body has `images: [{image_url: "data:image/jpeg;base64,/9j/4AAQ"}]`, `output_format: "webp"`, `n: 1` and `response_format: "b64_json"`

#### Scenario: Server error not retried
- **WHEN** the API answers 503 with type `server_error` to a generation
- **THEN** a retryable `MetaApiError` with status 503 is thrown, and exactly one request was sent

#### Scenario: No image in the reply
- **WHEN** the API answers 200 to a generation with `data: [{url: "https://cdn.example/img.webp"}]` and no `b64_json`
- **THEN** a `MetaOutputError` is thrown, and exactly one request was sent (the URL is never fetched)

### Requirement: Image calls checked locally
Image generation and editing SHALL reject an invalid call with `InvalidImageRequestError` before any request, so it costs 0 requests. Invalid means any of:
- a blank prompt;
- `n` not an integer from 1 to 10;
- `temperature` outside 0–2;
- a call timeout, in ms, not a positive integer;
- `size` not `<width>x<height>` in positive integers, or with one side over 16 times the other;
- for an edit, not 1–10 inputs, or an input without exactly one of `image_url` and `file_id`.

#### Scenario: Bad calls never sent
- **WHEN** these twelve calls are made, one after another:
  - generate with prompt `"   "`;
  - generate with `n` 0;
  - generate with `n` 11;
  - generate with `n` 1.5;
  - generate with `temperature` 2.5;
  - generate with size `1700x100`;
  - generate with size `square`;
  - generate with a call timeout of 0 ms;
  - generate with a call timeout of 1.5 ms;
  - edit with no inputs;
  - edit with 11 inputs;
  - edit with one input holding both `image_url` and `file_id`
- **THEN** each one throws `InvalidImageRequestError`
- **AND** the upstream received 0 requests

#### Scenario: Limits allowed
- **WHEN** a generate with `n` 10, `temperature` 2 and size `1600x100`, and an edit with 10 `data:image/png;base64,` inputs, are made, and the API answers 200 to each
- **THEN** exactly two requests were sent

### Requirement: Content policy refusals
A request that the API refuses with error code `content_policy_violation` SHALL fail with `MetaContentPolicyError`: a `MetaApiError` that keeps the status and `param`, with `retryable` false whatever the status. Exactly 1 request is sent, with no retry.

#### Scenario: Blocked prompt
- **WHEN** the API answers a generation with 400 and `{error: {type: "invalid_request_error", code: "content_policy_violation", param: "prompt", message: "blocked"}}`
- **THEN** the error thrown is a `MetaContentPolicyError` and a `MetaApiError`, with status 400, param `prompt`, and `retryable` false
- **AND** exactly one request was sent

#### Scenario: Any endpoint
- **WHEN** `POST /v1/responses` answers 400 with code `content_policy_violation` and param `input`
- **THEN** the error thrown is a `MetaContentPolicyError` with status 400, and exactly one request was sent

#### Scenario: Retryable status
- **WHEN** the API answers a generation with 503 and code `content_policy_violation`
- **THEN** the error thrown is a `MetaContentPolicyError` with status 503 and `retryable` false
- **AND** exactly one request was sent

### Requirement: Image calls take their own timeout
An image generation or edit SHALL accept its own timeout, which replaces the client's timeout for that one request only. Every other call keeps the client's timeout. Each call sends exactly 1 request.

#### Scenario: Longer for one call
- **WHEN** the client timeout is 20 ms, an image is generated with a 500 ms call timeout, and the upstream answers 200 after 100 ms
- **THEN** the image is returned, and exactly one request was sent

#### Scenario: Others keep the client timeout
- **WHEN** a client with a 20 ms timeout lists models against an upstream that never answers
- **THEN** a `MetaTimeoutError` with `timeoutMs` 20 is thrown
- **AND** exactly one request was sent

### Requirement: No extended prompt cache
Every Responses API request, for Spark and for SAM, SHALL be sent without a `prompt_cache_retention` field, even when the caller passes one, so the upstream keeps its default in-memory cache and never the optional 24 h retention. Each call still sends exactly 1 request.

#### Scenario: Reading and segmenting
- **WHEN** `generateObject` is called with output name `reading`, and `sam.segment` with prompt `urine bag`, and the API answers 200 to each
- **THEN** neither request body has a `prompt_cache_retention` key, and exactly two requests were sent

#### Scenario: Caller asks for 24 hours
- **WHEN** `responses.create` is called with `prompt_cache_retention: "24h"`, and the API answers 200
- **THEN** the request body has no `prompt_cache_retention` key, still has `store: false`, and exactly one request was sent

### Requirement: Upstream headroom on the request hook
The request hook SHALL report the upstream's `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-limit-tokens` and `x-ratelimit-remaining-tokens` headers as non-negative integers, for any response that carries them, success or error. A header that is absent or not a whole number is left out, and with none there is no headroom at all. Reading them sends nothing: each call stays exactly 1 request.

#### Scenario: Spark reading with headroom
- **WHEN** `generateObject` is answered 200 with `x-ratelimit-limit-requests: 150`, `x-ratelimit-remaining-requests: 149`, `x-ratelimit-limit-tokens: 3000000` and `x-ratelimit-remaining-tokens: 2990000`
- **THEN** the hook reports headroom `{ limitRequests: 150, remainingRequests: 149, limitTokens: 3000000, remainingTokens: 2990000 }`, and exactly one request was sent

#### Scenario: Rate limited with none left
- **WHEN** the API answers 429 with `Retry-After: 7` and `x-ratelimit-remaining-requests: 0`
- **THEN** the hook reports status 429 and headroom `{ remainingRequests: 0 }`, and exactly one request was sent

#### Scenario: Transcription has no headers
- **WHEN** a 16 kHz WAV is transcribed and the 200 reply has no `x-ratelimit-*` header
- **THEN** the hook reports no headroom, and exactly one request was sent

#### Scenario: Unreadable value
- **WHEN** a reply has `x-ratelimit-remaining-tokens: lots` and `x-ratelimit-limit-tokens: -5`
- **THEN** the hook reports no headroom

### Requirement: Server log lines
The server SHALL log each upstream request as one line holding only method, path, model, status, duration in ms, the local budget's counts, the upstream headroom when reported and, on failure, the error class and upstream error code. Its `[ai]` and unhandled-error lines hold only status, our error code, error class, upstream code and stack frames. No line on any console method holds a prompt, note, transcript, image, model output, upstream error message or the API key.

#### Scenario: Note with headroom
- **WHEN** the client's hourly cap is 120, and a text note `bed 4 had coconut water 200` is parsed as its first request, and Spark answers 200 with requests 149 of 150 and tokens 2990000 of 3000000 remaining
- **THEN** exactly one `[model-api]` line is logged, `[model-api] POST /responses muse-spark-1.3 200 <ms>ms (#1, 1/120 per h) upstream 149/150 req 2990000/3000000 tok`, where `<ms>` is a whole number
- **AND** exactly one upstream request was sent, and no logged line contains `coconut`

#### Scenario: Line format from given inputs
- **WHEN** the request line is formatted for `POST /responses`, model `muse-spark-1.3`, status 429, 812 ms, budget counts total 3, 2 in the last hour of 120, headroom `{ remainingRequests: 0 }` and a `MetaApiError` with code `rate_limit_exceeded`
- **THEN** the line is `[model-api] POST /responses muse-spark-1.3 429 812ms (#3, 2/120 per h) upstream 0/? req ✗ MetaApiError rate_limit_exceeded`

#### Scenario: Failure without the upstream message
- **WHEN** the client's hourly cap is 120, and Spark answers its first request 400 with `{error: {type: "invalid_request_error", code: "invalid_value", message: "bad input: bed 4 had coconut water"}}` and no `x-ratelimit-*` header
- **THEN** the request line ends `400 <ms>ms (#1, 1/120 per h) ✗ MetaApiError invalid_value`
- **AND** no logged line contains `coconut`, and exactly one upstream request was sent

#### Scenario: Unhandled error with a multi-line message
- **WHEN** an unhandled `TypeError` whose message is `x` then a newline then `bed 4 had coconut water` reaches the app error handler
- **THEN** the server answers 500 `internal_error`, its line starts `[app] unhandled TypeError` and holds only stack frame lines (each starting with `at `)
- **AND** no logged line contains `coconut`

#### Scenario: App error line without the upstream message
- **WHEN** `POST /api/ai/note` is sent with note `bed 4 had coconut water 200`, and Spark answers 400 with code `invalid_value` and message `bad input: bed 4 had coconut water`
- **THEN** the server answers 502 `model_api_error`, and its `[ai]` line is exactly `[ai] 502 model_api_error MetaApiError invalid_value`
- **AND** nothing written to `console.log`, `console.info`, `console.warn`, `console.error` or `console.debug` contains `coconut`, and exactly one upstream request was sent
