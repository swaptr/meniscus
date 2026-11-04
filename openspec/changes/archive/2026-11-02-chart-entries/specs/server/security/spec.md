## MODIFIED Requirements

### Requirement: API access token
When an API token is configured, every `/api/*` request other than `/api/health` without `Authorization: Bearer <token>` matching it SHALL be answered with HTTP 401 `unauthorized`, read or change no patient data and make no model request.

#### Scenario: Missing or wrong token
- **WHEN** the token is `t0k3n-…` (32 chars) and a note is posted with no Authorization header, or with `Bearer wrong`
- **THEN** both responses are 401 with `error: unauthorized` and the upstream received no request

#### Scenario: Correct token
- **WHEN** the same note is posted with the configured bearer token
- **THEN** the response is 200

#### Scenario: Health stays public
- **WHEN** `/api/health` is requested without a token
- **THEN** the response is 200

#### Scenario: Patient data needs the token
- **WHEN** `GET /api/admissions` is requested without a token
- **THEN** the response is 401 with `error: unauthorized`

### Requirement: Security headers
Every response SHALL carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and `Cross-Origin-Resource-Policy: same-origin`, and every `/api/*` response other than `/api/health` SHALL carry `Cache-Control: no-store`.

#### Scenario: Health and AI responses
- **WHEN** `/api/health` and a rejected `/api/ai/note` are requested
- **THEN** both carry the four headers and only the AI response carries `Cache-Control: no-store`

#### Scenario: Patient data is not cached
- **WHEN** `GET /api/admissions` is requested
- **THEN** the response carries `Cache-Control: no-store`
