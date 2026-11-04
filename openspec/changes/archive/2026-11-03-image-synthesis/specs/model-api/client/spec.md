# Spec Delta

## ADDED Requirements

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
