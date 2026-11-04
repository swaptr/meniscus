## Purpose
Who may call the Meniscus API, how often, what it accepts and what it reveals, so patient data and model credits stay protected.

## ADDED Requirements

### Requirement: API access token
When an API token is configured, every `/api/ai/*` request without `Authorization: Bearer <token>` matching it SHALL be answered with HTTP 401 `unauthorized` and make no model request, while `/api/health` stays public.

#### Scenario: Missing or wrong token
- **WHEN** the token is `t0k3n-…` (32 chars) and a note is posted with no Authorization header, or with `Bearer wrong`
- **THEN** both responses are 401 with `error: unauthorized` and the upstream received no request

#### Scenario: Correct token
- **WHEN** the same note is posted with the configured bearer token
- **THEN** the response is 200

#### Scenario: Health stays public
- **WHEN** `/api/health` is requested without a token
- **THEN** the response is 200

### Requirement: Production requires a token
Loading configuration with `NODE_ENV=production` SHALL fail when `MENISCUS_API_TOKEN` is missing or shorter than 32 characters.

#### Scenario: Production without a token
- **WHEN** config is loaded with `NODE_ENV=production` and no `MENISCUS_API_TOKEN`, or with a 10-character token
- **THEN** loading throws an error naming `MENISCUS_API_TOKEN`

#### Scenario: Development without a token
- **WHEN** config is loaded with `NODE_ENV=development` and no token
- **THEN** loading succeeds with no token configured

### Requirement: Loopback by default
The server SHALL listen on `127.0.0.1` unless `HOST` is set.

#### Scenario: Default host
- **WHEN** config is loaded without `HOST`
- **THEN** the host is `127.0.0.1`

### Requirement: Per-client rate limit
Each client SHALL be allowed at most the configured number of `/api/ai/*` requests per rolling minute; further requests SHALL get HTTP 429 `rate_limited` with a `Retry-After` header and make no model request.

#### Scenario: Limit of 2 per minute
- **WHEN** the limit is 2 and one client posts three notes within a minute
- **THEN** the first two are 200, the third is 429 with `error: rate_limited` and a `Retry-After` of at least 1 second, and the upstream received exactly two requests

### Requirement: Upload content matches its type
An image upload whose bytes do not start with the file signature of its declared type (JPEG, PNG, WebP or GIF) SHALL be rejected with HTTP 400 `invalid_request` and make no model request.

#### Scenario: Text labelled as JPEG
- **WHEN** the `image` field holds the bytes `hello` with type `image/jpeg`
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request

### Requirement: Security headers
Every response SHALL carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and `Cross-Origin-Resource-Policy: same-origin`, and every `/api/ai/*` response SHALL carry `Cache-Control: no-store`.

#### Scenario: Health and AI responses
- **WHEN** `/api/health` and a rejected `/api/ai/note` are requested
- **THEN** both carry the four headers and only the AI response carries `Cache-Control: no-store`

### Requirement: Internal errors stay internal
An unexpected server error SHALL be answered with HTTP 500 and the body `{"error":"internal_error"}` only.

#### Scenario: Pipeline bug
- **WHEN** note parsing throws `TypeError: secret detail`
- **THEN** the response is 500, the body is exactly `{"error":"internal_error"}` and does not contain `secret detail`
