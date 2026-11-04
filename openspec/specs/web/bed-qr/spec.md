# web/bed-qr Specification

## Purpose
Printable bed cards whose QR code opens that bed's capture screen in the phone's browser, without showing the patient's name.

## Requirements

### Requirement: Bed card link
Each bed card's QR code SHALL encode the URL `<origin>/a/bed/<token>` for that bed's QR token, and the card SHALL show the ward code, ward name and bed number but not the patient's name.

#### Scenario: Bed 4 card
- **WHEN** the card for ward 5B (Neurology Ward 5B) bed 4 with token `abc_DEF-123` is rendered on origin `https://ward.example`
- **THEN** its QR encodes `https://ward.example/a/bed/abc_DEF-123`, the card text contains `5B · Bed 4` and `Neurology Ward 5B`, and not the patient's name

### Requirement: Bed link needs sign-in
Opening a bed card's link `/a/bed/<token>` SHALL show the bed only to a signed-in person: signed out, the app shows the sign-in screen and sends no `GET /api/beds/<token>`, and after sign-in the same URL opens that bed. The token identifies the bed and is never a credential: the server answers `GET /api/beds/<token>` without a session with 401 `sign_in_required`. It makes no model request.

#### Scenario: Scanned while signed out
- **WHEN** the link for 3A bed 4 (`/a/bed/<its token>`) is opened on a phone with no session, and Ravi Kumar then signs in
- **THEN** before sign-in the only request is `GET /api/session`, and no patient name is shown
- **AND** after sign-in the requests are `GET /api/beds/<its token>` and `GET /api/admissions/<its id>/entries`, and the bed's capture screen is shown

#### Scenario: Token alone
- **WHEN** `GET /api/beds/<3A bed 4 token>` is sent with no cookie
- **THEN** the response is 401 with `error: sign_in_required`, and the body has no `patient`, `mrn` or `admission`
