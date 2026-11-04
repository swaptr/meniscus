# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: API access token
**Reason**: The Node server now serves the web on the same origin, and a browser can't hold or add a device token. A bearer check that only a proxy could satisfy guarded nothing the session doesn't. Every `/api` route except `/api/session` and `/api/health` now needs a signed-in session ("Signed-in reads", "Signed-in changes").
**Migration**: Unset `MENISCUS_API_TOKEN`. The server ignores it if it is set. Clients sign in with `POST /api/session` and send the `meniscus_session` cookie; curl uses a cookie jar (`-c`/`-b`). The Vite proxy no longer adds `Authorization`.

### Requirement: Production requires a token
**Reason**: The device token is removed (see "API access token"). Production is protected by the session on every read and change, and by `Secure` cookies.
**Migration**: Remove `MENISCUS_API_TOKEN` from the host's environment. Production starts without it.
