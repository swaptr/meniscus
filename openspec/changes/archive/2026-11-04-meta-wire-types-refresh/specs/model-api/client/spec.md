## ADDED Requirements

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
