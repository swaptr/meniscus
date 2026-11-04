# Spec Delta

## Purpose

How the single Meniscus server process runs in production: its health check, serving the web build on the same origin as the API, and ending cleanly when the host stops it. None of it calls a model.

## ADDED Requirements

### Requirement: Health check
`GET /api/health` SHALL answer 200 with the body exactly `{"ok":true}`, with no session or cookie, without reading the store, and with 0 model requests. It is the host's health check path.

#### Scenario: Healthy server
- **WHEN** `GET /api/health` is sent with no cookie
- **THEN** the response is 200 with the body exactly `{"ok":true}`
- **AND** the store received no call and the upstream received no request

#### Scenario: Store unavailable
- **WHEN** the store throws on every call and `GET /api/health` is sent
- **THEN** the response is still 200 `{"ok":true}`

### Requirement: Web build served
When `WEB_DIST` holds `index.html`, every GET or HEAD outside `/api` for a file in it SHALL be answered with that file and its content type, and `/` with `index.html`. Paths that leave the directory (`..`, encoded or not) are never served. It needs no session and makes no model request.

#### Scenario: Index and an asset
- **WHEN** `WEB_DIST` holds `index.html`, `sw.js` and `assets/index-BQlYVns6.js`, and `/`, `/sw.js` and `/assets/index-BQlYVns6.js` are requested with no cookie
- **THEN** each is 200 with that file's bytes, typed `text/html`, `text/javascript` and `text/javascript`

#### Scenario: Outside the build
- **WHEN** `/..%2Fpackage.json` and `/assets/../../package.json` are requested
- **THEN** neither response contains the repository's `package.json`

### Requirement: Web app routes fall back to index.html
A GET or HEAD outside `/api` that matches no file in `WEB_DIST` and whose last path segment has no file extension SHALL be answered 200 with `index.html`, so a deep link opens the web app. A missing path with an extension gets 404. It makes no model request.

#### Scenario: Bed link and ward dashboard
- **WHEN** `/a/bed/abc_DEF-123` and `/n/w/2` are requested with no cookie
- **THEN** both are 200 with the bytes of `index.html`, typed `text/html`

#### Scenario: Missing asset
- **WHEN** `/assets/gone-1234abcd.js` is requested and no such file exists
- **THEN** the response is 404, and its body is not `index.html`

### Requirement: Web cache headers
Files under `/assets/` (Vite's content-hashed output) SHALL carry `Cache-Control: public, max-age=31536000, immutable`, and every other web response, `index.html`, its fallback, `sw.js`, `manifest.webmanifest` and `registerSW.js` included, `Cache-Control: no-cache`, so a deploy reaches every device on its next load.

#### Scenario: Hashed and unhashed
- **WHEN** `/assets/index-BQlYVns6.js`, `/`, `/n/w/2`, `/sw.js` and `/manifest.webmanifest` are requested
- **THEN** the first carries `Cache-Control: public, max-age=31536000, immutable`, and the other four `Cache-Control: no-cache`

### Requirement: API paths are never the web app
A request to `/api` or any path under `/api/` that no API route answers SHALL never be answered with `index.html` or any web file: it gets 401 `sign_in_required` without a session and 404 `{"error":"not_found"}` with one. A non-GET outside `/api` gets 404. It makes no model request.

#### Scenario: Unknown API path
- **WHEN** `GET /api/nope` is sent with no cookie, and again signed in as Ravi Kumar
- **THEN** the first is 401 with `error: sign_in_required`, the second is 404 with the body `{"error":"not_found"}`, and neither is typed `text/html`

#### Scenario: Post to a web path
- **WHEN** `POST /n/w/2` is sent signed in as Anita Thomas
- **THEN** the response is 404 and not `index.html`

### Requirement: Production needs the web build
With `NODE_ENV=production`, the server SHALL refuse to start, naming `WEB_DIST` and the path it looked in, when that directory holds no `index.html`. Outside production a missing build only means paths outside `/api` get 404. It makes no model request.

#### Scenario: Build missing in production
- **WHEN** the server starts with `NODE_ENV=production` and `WEB_DIST=/tmp/meniscus-empty`, an empty directory
- **THEN** start fails with an error naming `WEB_DIST` and `/tmp/meniscus-empty/index.html`, and nothing listens on `PORT`

#### Scenario: Development without a build
- **WHEN** the server runs with `NODE_ENV=development` and an empty `WEB_DIST`, and `/n` is requested
- **THEN** the response is 404, and `GET /api/health` is 200

### Requirement: Graceful shutdown
On SIGTERM or SIGINT the server SHALL stop accepting connections, let requests in flight finish for up to `SHUTDOWN_GRACE_MS` (default 25000), then close any connection left, close the store and exit with code 0. If shutting down fails, it logs only `[app] shutdown failed <error class>` and exits with code 1. A request cut off at the grace limit is never retried, and shutting down makes no model request.

#### Scenario: Request in flight
- **WHEN** Anita Thomas's sign-in `POST /api/session` is in flight, its body still arriving, and SIGTERM arrives
- **THEN** that sign-in completes with 201, a new connection afterwards is refused, the store is closed, and the process exits with code 0

#### Scenario: Grace limit
- **WHEN** `SHUTDOWN_GRACE_MS` is 100, a request is held open for 1 s, and SIGTERM arrives
- **THEN** within 1 s that connection is closed, the store is closed and the process exits with code 0
- **AND** the upstream received no request during shutdown

#### Scenario: Shutdown fails
- **WHEN** SIGTERM arrives and shutting down rejects with a `TypeError` whose message names a file path
- **THEN** the only log line is `[app] shutdown failed TypeError`, and the process exits with code 1
