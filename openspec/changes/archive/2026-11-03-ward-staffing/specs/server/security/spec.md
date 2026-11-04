# Spec Delta

## MODIFIED Requirements

### Requirement: Per-client rate limit
Each client SHALL be allowed at most the configured number of `/api/ai/*` requests per rolling minute, and separately as many password checks (`POST /api/session` and `POST /api/wards/:id/access`); further requests SHALL get HTTP 429 `rate_limited` with a `Retry-After` header and make no model request. Accounts are never locked.

#### Scenario: Limit of 2 per minute
- **WHEN** the limit is 2 and one client posts three notes within a minute
- **THEN** the first two are 200, the third is 429 with `error: rate_limited` and a `Retry-After` of at least 1 second, and the upstream received exactly two requests

#### Scenario: Sign-in attempts
- **WHEN** the limit is 2 and one client sends three sign-ins with `{ username: "ravi", password: "wrong" }` within a minute
- **THEN** the responses are 401, 401 and 429 with `error: rate_limited` and a `Retry-After` of at least 1 second
- **AND** a minute later, `{ username: "ravi", password: "ravi" }` gets 201

## ADDED Requirements

### Requirement: Staff sign-in
`POST /api/session` with `{ username, password }` SHALL, when the password matches that staff member's scrypt hash, return 201 `{ staff }` (with `wards`) and set the cookie `meniscus_session=<token>; HttpOnly; SameSite=Strict; Path=/api`, plus `Secure` in production. A wrong username or password gets the same 401 `invalid_credentials` and no cookie. Passwords, tokens, password hashes and the login body are never logged or returned. It makes no model request.

#### Scenario: Ravi signs in
- **WHEN** `POST /api/session` is sent with `{ username: "ravi", password: "ravi" }` to a fresh demo store in development
- **THEN** the response is 201 with `staff` `{ id: 1, name: "Ravi Kumar", role: "attendant" }` and `wards` coded 3A then 2C
- **AND** it sets `meniscus_session` to 43 base64url characters with `HttpOnly`, `SameSite=Strict` and `Path=/api`, and without `Secure`
- **AND** no response body or log line contains the token or `scrypt$`, no log line contains the request body, and the upstream received no request

#### Scenario: Same answer for a wrong username or password
- **WHEN** `POST /api/session` is sent with `{ username: "ravi", password: "wrong" }` and with `{ username: "nobody", password: "ravi" }`
- **THEN** both responses are 401 with the identical body `{ error: "invalid_credentials" }`, and neither sets a cookie

#### Scenario: Secure in production
- **WHEN** the server runs with `NODE_ENV=production`, an API token and `MENISCUS_DEMO_LOGIN=1`, and Ravi Kumar signs in
- **THEN** the `meniscus_session` cookie also carries `Secure`

### Requirement: Sessions end
A session SHALL end at the end of the shift it began in, or 30 minutes after the last request carrying its cookie, whichever comes first. `GET /api/session` returns 200 `{ staff }` for a live session, or 401 `{ error: "sign_in_required", hospital, demo_accounts }`. `DELETE /api/session` always returns 204, clearing the cookie and ending any session it names. Ended sessions are deleted when looked up and when the store opens. It makes no model request.

#### Scenario: Shift end
- **WHEN** Ravi Kumar signs in at 19:30 and `GET /api/session` is sent at 19:50 and at 20:00
- **THEN** the first is 200 with `staff` Ravi Kumar, and the second is 401 with `error: sign_in_required`

#### Scenario: Thirty minutes without a request
- **WHEN** Ravi Kumar signs in at 10:00, and `GET /api/session` is sent at 10:29 and again at 11:00
- **THEN** the 10:29 request is 200, and the 11:00 request is 401 with `error: sign_in_required`
- **AND** the session's row is gone from the store

#### Scenario: Sign out
- **WHEN** Ravi Kumar, signed in, sends `DELETE /api/session`, then posts an entry with the same cookie
- **THEN** the first response is 204 and clears `meniscus_session` (`Max-Age=0`, `Path=/api`)
- **AND** the entry post is 401 with `error: sign_in_required`, and no entry is stored
- **AND** a second `DELETE /api/session` with the same cookie, and one with no cookie, are each 204

### Requirement: Signed-in changes
After the device token check and before any other check, every non-GET `/api/*` request except to `/api/session` SHALL need a live session cookie, else get 401 `sign_in_required`, changing nothing and making no model request. The staff member is the session's: an `X-Staff-Id` that is malformed or off the roster gets 400 `invalid_request`, and one naming anyone else 401 `sign_in_required`. `/api/session` ignores `X-Staff-Id`. This rule refuses no GET.

#### Scenario: No session
- **WHEN** an entry, a note to `POST /api/ai/note`, a photo upload and `PUT /api/wards/<3A>/in-charge` are each sent without a session cookie
- **THEN** each response is 401 with `error: sign_in_required`, nothing is stored, and the upstream received no request

#### Scenario: Ended session
- **WHEN** Ravi Kumar signed in at 19:30, and at 20:05 an entry is posted with that cookie
- **THEN** the response is 401 with `error: sign_in_required`, and no entry is stored

#### Scenario: Someone else's id
- **WHEN** signed in as Ravi Kumar (id 1), an entry is posted with `X-Staff-Id: 4`, another with `X-Staff-Id: 999`, and another with `X-Staff-Id: 1`
- **THEN** the responses are 401 with `error: sign_in_required`, 400 with `error: invalid_request`, and 201 with `created_by` Ravi Kumar
- **AND** only the last entry is stored

#### Scenario: Sign in again over an ended session
- **WHEN** Ravi Kumar's session ended at 20:00, and at 20:05 `POST /api/session` is sent with that cookie, `X-Staff-Id: 1` and `{ username: "ravi", password: "ravi" }`
- **THEN** the response is 201 with `staff` Ravi Kumar and a new `meniscus_session` cookie

#### Scenario: Reads stay open
- **WHEN** `GET /api/wards` and `GET /api/staff` are sent with the device token and no session
- **THEN** both responses are 200

### Requirement: Demo sign-in in production
Each demo staff member SHALL have their lowercase first name as username and password, set when the store opens for any who have none. Demo sign-in is on unless `NODE_ENV=production` without `MENISCUS_DEMO_LOGIN=1`. When on, the 401 of `GET /api/session` lists every demo account as `{ username, name, role, ward }`. When off, it lists none, and a demo password gets 401 `invalid_credentials`. It makes no model request.

#### Scenario: Demo accounts listed
- **WHEN** a fresh store runs in development, and `GET /api/session` is sent with no session
- **THEN** the 401 body has `hospital: "Meniscus Demo Hospital"` and lists 10 `demo_accounts`, including `{ username: "anita", name: "Anita Thomas", role: "nurse", ward: "3A" }` and `{ username: "lakshmi", name: "Lakshmi Iyer", role: "matron", ward: null }`
- **AND** `POST /api/session` with `{ username: "lakshmi", password: "lakshmi" }` gets 201

#### Scenario: Production refuses demo passwords
- **WHEN** the server runs with `NODE_ENV=production` and an API token, without `MENISCUS_DEMO_LOGIN`
- **THEN** `POST /api/session` with `{ username: "ravi", password: "ravi" }` gets 401 with `error: invalid_credentials`
- **AND** `GET /api/session` with no session returns `demo_accounts: []`
- **AND** with `MENISCUS_DEMO_LOGIN=1` set, the same sign-in gets 201

#### Scenario: Older store gains sign-in
- **WHEN** a store file whose `staff` table has no username or password columns, holding staff 1–6, is opened
- **THEN** `POST /api/session` with `{ username: "ravi", password: "ravi" }` gets 201 with `staff` id 1

### Requirement: Cross-site form posts
A non-GET `/api/*` request with a form content type (multipart, URL-encoded, plain text or none) that carries `Origin` or `Sec-Fetch-Site` SHALL get 403 and change nothing unless `Sec-Fetch-Site` is `same-origin` or `Origin` is the request's own origin or `http://localhost:5173` (the development web server). A request with neither header is not refused by this rule. It runs after the session check and makes no model request.

#### Scenario: Photo upload from another site
- **WHEN** signed in, a photo is uploaded as multipart to `POST /api/admissions/<id>/media` with `Origin: https://evil.example`, and again with `Sec-Fetch-Site: cross-site` too
- **THEN** both responses are 403 and no media is stored
- **AND** the same upload with `Origin` equal to the server's own origin, with `Sec-Fetch-Site: same-origin`, or with `Origin: http://localhost:5173` is 201, and the upstream received no request
