# server/security Specification

## Purpose
Who may call the Meniscus API, how often, what it accepts and what it reveals, so patient data and model credits stay protected.

## Requirements

### Requirement: Loopback by default
The server SHALL listen on the interface `HOST` names (default `127.0.0.1`) and the port `PORT` names (default `8787`).

#### Scenario: Default host
- **WHEN** config is loaded without `HOST`
- **THEN** the host is `127.0.0.1`

#### Scenario: Default port
- **WHEN** config is loaded without `PORT`
- **THEN** the port is 8787

#### Scenario: Hosted
- **WHEN** config is loaded with `HOST=0.0.0.0` and `PORT=10000`
- **THEN** the host is `0.0.0.0` and the port is 10000

### Requirement: Per-client rate limit
Each client SHALL be allowed at most the configured number of `/api/ai/*` requests per rolling minute, and separately as many password checks (`POST /api/session` and `POST /api/wards/:id/access`); further requests SHALL get HTTP 429 `rate_limited` with a `Retry-After` header and make no model request. Accounts are never locked.

#### Scenario: Limit of 2 per minute
- **WHEN** the limit is 2 and one client posts three notes within a minute
- **THEN** the first two are 200, the third is 429 with `error: rate_limited` and a `Retry-After` of at least 1 second, and the upstream received exactly two requests

#### Scenario: Sign-in attempts
- **WHEN** the limit is 2 and one client sends three sign-ins with `{ username: "ravi", password: "wrong" }` within a minute
- **THEN** the responses are 401, 401 and 429 with `error: rate_limited` and a `Retry-After` of at least 1 second
- **AND** a minute later, `{ username: "ravi", password: "ravi" }` gets 201

### Requirement: Upload content matches its type
An image upload whose bytes do not start with the file signature of its declared type (JPEG, PNG, WebP or GIF) SHALL be rejected with HTTP 400 `invalid_request` and make no model request.

#### Scenario: Text labelled as JPEG
- **WHEN** the `image` field holds the bytes `hello` with type `image/jpeg`
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request

### Requirement: Security headers
Every response, from `/api` and from the web build alike, SHALL carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and `Cross-Origin-Resource-Policy: same-origin`; every `/api/*` response other than `/api/health` also carries `Cache-Control: no-store`.

#### Scenario: Health and AI responses
- **WHEN** `/api/health` and a rejected `/api/ai/note` are requested
- **THEN** both carry the four headers and only the AI response carries `Cache-Control: no-store`

#### Scenario: Patient data is not cached
- **WHEN** `GET /api/admissions` is requested signed in as Anita Thomas
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: Web build
- **WHEN** `/` and `/n/w/2` are requested from a server with a web build
- **THEN** both carry the four headers, and neither carries `Cache-Control: no-store`

### Requirement: Internal errors stay internal
An unexpected server error SHALL be answered with HTTP 500 and the body `{"error":"internal_error"}` only.

#### Scenario: Pipeline bug
- **WHEN** note parsing throws `TypeError: secret detail`
- **THEN** the response is 500, the body is exactly `{"error":"internal_error"}` and does not contain `secret detail`

### Requirement: Staff sign-in
`POST /api/session` with `{ username, password }` SHALL, when the password matches that staff member's scrypt hash, return 201 `{ staff }` (with `wards`) and set the cookie `meniscus_session=<token>; HttpOnly; SameSite=Strict; Path=/api`, plus `Secure` in production or over HTTPS. A wrong username or password gets the same 401 `invalid_credentials` and no cookie. Passwords, tokens, password hashes and the login body are never logged or returned. It makes no model request.

#### Scenario: Ravi signs in
- **WHEN** `POST /api/session` is sent with `{ username: "ravi", password: "ravi" }` to a fresh demo store in development
- **THEN** the response is 201 with `staff` `{ id: 1, name: "Ravi Kumar", role: "attendant" }` and `wards` coded 3A then 2C
- **AND** it sets `meniscus_session` to 43 base64url characters with `HttpOnly`, `SameSite=Strict` and `Path=/api`, and without `Secure`
- **AND** no response body or log line contains the token or `scrypt$`, no log line contains the request body, and the upstream received no request

#### Scenario: Same answer for a wrong username or password
- **WHEN** `POST /api/session` is sent with `{ username: "ravi", password: "wrong" }` and with `{ username: "nobody", password: "ravi" }`
- **THEN** both responses are 401 with the identical body `{ error: "invalid_credentials" }`, and neither sets a cookie

#### Scenario: Secure in production
- **WHEN** the server runs with `NODE_ENV=production` and `MENISCUS_DEMO_LOGIN=1`, and Ravi Kumar signs in
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
Before any other check, every non-GET `/api/*` request except to `/api/session` SHALL need a live session cookie, else get 401 `sign_in_required`, changing nothing and making no model request. The staff member is the session's: an `X-Staff-Id` that is malformed or off the roster gets 400 `invalid_request`, and one naming anyone else 401 `sign_in_required`. `/api/session` ignores `X-Staff-Id`. Reads follow server/security "Signed-in reads".

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
- **WHEN** `GET /api/session` and `GET /api/health`, the two reads that need no session, are sent with no session cookie
- **THEN** the first is 401 with `error: sign_in_required`, `hospital` and `demo_accounts`, and the second is 200 `{"ok":true}`; every other read needs a session (server/security "Signed-in reads")

### Requirement: Cross-site form posts
A non-GET `/api/*` request with a form content type (multipart, URL-encoded, plain text or none) that carries `Origin` or `Sec-Fetch-Site` SHALL get 403 and change nothing unless `Sec-Fetch-Site` is `same-origin` or `Origin` is the request's own origin (its protocol per "Forwarded protocol") or `http://localhost:5173` (the development web server). A request with neither header is not refused by this rule. It runs after the session check and makes no model request.

#### Scenario: Photo upload from another site
- **WHEN** signed in, a photo is uploaded as multipart to `POST /api/admissions/<id>/media` with `Origin: https://evil.example`, and again with `Sec-Fetch-Site: cross-site` too
- **THEN** both responses are 403 and no media is stored
- **AND** the same upload with `Origin` equal to the server's own origin, with `Sec-Fetch-Site: same-origin`, or with `Origin: http://localhost:5173` is 201, and the upstream received no request

### Requirement: Demo accounts and sign-in
Each demo staff member SHALL have their lowercase first name as username and password, set when the store opens for any who have none. Demo sign-in is on unless `NODE_ENV=production` without `MENISCUS_DEMO_LOGIN=1`. When on, the 401 of `GET /api/session` lists every demo account as `{ username, name, role, ward }`. When off, it lists none, and a demo password gets 401 `invalid_credentials`. It makes no model request.

#### Scenario: Demo accounts listed
- **WHEN** a fresh store runs in development, and `GET /api/session` is sent with no session
- **THEN** the 401 body has `hospital: "Meniscus Demo Hospital"` and lists 11 `demo_accounts`, including `{ username: "anita", name: "Anita Thomas", role: "nurse", ward: "3A" }`, `{ username: "lakshmi", name: "Lakshmi Iyer", role: "matron", ward: null }` and `{ username: "sana", name: "Sana Mirza", role: "dietitian", ward: null }`
- **AND** `POST /api/session` with `{ username: "lakshmi", password: "lakshmi" }` gets 201, and with `{ username: "sana", password: "sana" }` gets 201 with `staff` id 11

#### Scenario: Production refuses demo passwords
- **WHEN** the server runs with `NODE_ENV=production`, without `MENISCUS_DEMO_LOGIN`
- **THEN** `POST /api/session` with `{ username: "ravi", password: "ravi" }` gets 401 with `error: invalid_credentials`
- **AND** `GET /api/session` with no session returns `demo_accounts: []`
- **AND** with `MENISCUS_DEMO_LOGIN=1` set, the same sign-in gets 201

### Requirement: No contributor models
Loading configuration SHALL fail, naming the variable, when `SPARK_MODEL`, `SAM_MODEL` or `ASR_MODEL` is a contributor-mode model id (one ending in `-contributor`, in any letter case), because contributor mode lets Meta train on patient content and is refused under zero data retention. The server does not start, and it sends 0 upstream requests.

#### Scenario: Contributor Spark
- **WHEN** config is loaded with `SPARK_MODEL=muse-spark-1.3-contributor`
- **THEN** loading throws an error naming `SPARK_MODEL`, and the upstream received no request

#### Scenario: Any letter case, any model variable
- **WHEN** config is loaded with `SPARK_MODEL=MUSE-SPARK-1.2-CONTRIBUTOR`, and separately with `SAM_MODEL=sam-3.1-contributor`
- **THEN** both loads throw, naming `SPARK_MODEL` and `SAM_MODEL`

#### Scenario: Standard models
- **WHEN** config is loaded with no model variables, and separately with `SPARK_MODEL=muse-spark-1.2`
- **THEN** both loads succeed, with Spark `muse-spark-1.3` and `muse-spark-1.2`

### Requirement: Signed-in reads
Every GET or HEAD under `/api` except `/api/session` and `/api/health` SHALL need a live session cookie, else get 401 `sign_in_required` with no patient data in the body and 0 model requests. A bed's QR token, a media id or an admission id is never a credential on its own. A read with a live session keeps that session alive.

#### Scenario: Reads without a session
- **WHEN** `GET /api/wards`, `GET /api/admissions`, `GET /api/beds/<3A bed 4 token>`, `GET /api/admissions/<3A bed 4>/entries`, `GET /api/media/1`, `GET /api/quality/model` and `GET /api/ai/status` are each sent with no cookie
- **THEN** each response is 401 with the body `{"error":"sign_in_required"}`, and the upstream received no request

#### Scenario: Ended session
- **WHEN** Ravi Kumar signed in at 19:30, and at 20:05 `GET /api/beds/<3A bed 4 token>` is sent with that cookie
- **THEN** the response is 401 with `error: sign_in_required`, and the body has no `patient` or `mrn`

#### Scenario: Signed in
- **WHEN** Ravi Kumar is signed in and sends `GET /api/wards` and `GET /api/beds/<3A bed 4 token>`
- **THEN** both responses are 200, and the second holds 3A bed 4's admission

### Requirement: Trusted proxy hops
The client address the rate limits count SHALL be the socket's address when `TRUST_PROXY_HOPS` is 0 (the default), and otherwise the `TRUST_PROXY_HOPS`-th entry from the right of `X-Forwarded-For`, or the socket's address when the header has fewer entries. Entries left of that one are client-controlled and never used. `TRUST_PROXY_HOPS` is an integer 0 to 3; anything else fails config, naming it.

#### Scenario: One hop
- **WHEN** `TRUST_PROXY_HOPS` is 1, the limit is 2, and three wrong sign-ins arrive with `X-Forwarded-For: 1.1.1.1, 203.0.113.7`, `9.9.9.9, 203.0.113.7` and `203.0.113.7`
- **THEN** the responses are 401, 401 and 429 with `error: rate_limited`
- **AND** a wrong sign-in with `X-Forwarded-For: 203.0.113.8` is 401

#### Scenario: No hops trusted
- **WHEN** `TRUST_PROXY_HOPS` is 0, the limit is 2, and three wrong sign-ins from one socket carry `X-Forwarded-For` values `1.1.1.1`, `2.2.2.2` and `3.3.3.3`
- **THEN** the responses are 401, 401 and 429

#### Scenario: Bad setting
- **WHEN** config is loaded with `TRUST_PROXY_HOPS=-1`, and separately with `TRUST_PROXY_HOPS=two`
- **THEN** both loads throw an error naming `TRUST_PROXY_HOPS`

### Requirement: Forwarded protocol
A request's protocol SHALL be its socket's (`http`, or `https` over TLS), except that with `TRUST_PROXY_HOPS` 1 or more, an `X-Forwarded-Proto` whose last value is `http` or `https` sets it. That protocol forms the request's own origin for the cross-site check, and a sign-in over `https` sets `Secure` on the session cookie in any `NODE_ENV`. It makes no model request.

#### Scenario: Behind TLS termination
- **WHEN** `TRUST_PROXY_HOPS` is 1, and signed in, a photo is uploaded as multipart to `POST /api/admissions/<id>/media` with `Host: meniscus.onrender.com`, `X-Forwarded-Proto: https`, `Origin: https://meniscus.onrender.com` and no `Sec-Fetch-Site`
- **THEN** the response is 201
- **AND** with `TRUST_PROXY_HOPS` 0, the same upload is 403 and no media is stored

#### Scenario: Secure cookie over HTTPS
- **WHEN** `NODE_ENV` is `development`, `TRUST_PROXY_HOPS` is 1, and Ravi Kumar signs in with `X-Forwarded-Proto: https`
- **THEN** the `meniscus_session` cookie carries `Secure`
- **AND** the same sign-in with `TRUST_PROXY_HOPS` 0 sets a cookie without `Secure`
