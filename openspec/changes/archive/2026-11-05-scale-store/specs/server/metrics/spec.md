# Spec Delta

## Purpose

Operational counts that show how the server and the model budget hold up under load (requests, latency, budget use by class, refusals, store and media size), for the matron and for operations, without any patient data.

## ADDED Requirements

### Requirement: Operational metrics
`GET /api/metrics` SHALL return 200 with counts since the server started, without any model request:
- `requests` by method, route pattern and status;
- `latency_ms` (p50, p95) by method and route over each route's last 1,000 requests;
- `model_budget`: the cap, the requests used and held, and `remaining` per class, or `null` with no model client;
- `model_actions` admitted, refused and downgraded (admitted for fewer requests than its mode plans) per class;
- `store` and `media` sizes.

#### Scenario: Counts after use
- **WHEN**, with a cap of 120, a 30 % reserve (routine ceiling 84) and 60 requests in use, two entries are saved for 3A bed 4 and one photo read for HDU bed 1 makes 3 requests, and then Lakshmi Iyer (id 10, matron) sends `GET /api/metrics`
- **THEN** the response is 200
- **AND** `requests` holds `{ method: "POST", route: "/api/admissions/:id/entries", status: 201, count: 2 }`
- **AND** `model_budget` reads `used: 63`, `held: 0` and `remaining: { critical: 57, routine: 21 }`
- **AND** `model_actions.critical.admitted` is 1
- **AND** the upstream received no request for the metrics call

#### Scenario: Refusals counted
- **WHEN**, with a cap of 120, a 30 % reserve and 83 requests in use, two photo reads in `sam+spark` mode are posted for 3A bed 4 (`stable`)
- **THEN** the first runs in `spark` mode with 1 request and the second gets 429
- **AND** `model_actions.routine.downgraded` is 1 and `model_actions.routine.refused` is 1

#### Scenario: Downgrades of both kinds
- **WHEN**, with a cap of 120 and a 30 % reserve, a `sam+spark` photo read for 3A bed 4 (`stable`) is posted with 60 requests in use, and a collected lunch tray for 5B bed 1 (order `watch`), which has a comparable served lunch photo, is read with 80 in use
- **THEN** the first makes exactly 1 upstream request and the second exactly 3
- **AND** `model_actions.routine.admitted` is 2 and `model_actions.routine.downgraded` is 2

### Requirement: Metrics are for the matron
`GET /api/metrics` SHALL answer only a signed-in matron: without a session it gets 401 `sign_in_required`, and any other role gets 403 `forbidden`, with no counts in the body.

#### Scenario: Not the matron
- **WHEN** `GET /api/metrics` is sent with no session, and signed in as Anita Thomas (id 4, nurse)
- **THEN** the responses are 401 `sign_in_required` and 403 `forbidden`, and neither body holds `requests`

### Requirement: Metrics hold no patient data
`GET /api/metrics` SHALL report routes only by their pattern, a request that matches no route under `unmatched`, and contain no patient name, MRN, bed QR token, admission or entry id, note, item text, transcript, image or recording.

#### Scenario: Nothing identifying
- **WHEN**:
  - an entry with the note `felt dizzy after tea` is saved for Grace Okafor (2C bed 2);
  - `GET /api/beds/<her qr_token>` is called;
  - `GET /api/admissions/<her admission id>/nothing-here` is called and answers 404;
  - a voice note is read;
  - and the matron reads `GET /api/metrics`
- **THEN** the body contains none of:
  - `Grace Okafor`, `AT-100212` or her `qr_token`;
  - `felt dizzy`;
  - the transcript;
  - her admission id as a path segment
- **AND** the bed lookup is counted under the route `/api/beds/:token`, and the 404 under the route `unmatched`
