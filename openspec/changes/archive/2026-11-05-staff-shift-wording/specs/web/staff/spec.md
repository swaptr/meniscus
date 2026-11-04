## MODIFIED Requirements

### Requirement: Staff on shift
The app SHALL take who is on shift from the server session, sending one `GET /api/session` on opening. Signed out, `/` shows the landing page, `/login` the sign-in screen, and any other route redirects to `/login?next=<URL>`. After sign-in it opens that URL, else `/a` (attendants), `/d` (dietitians) or `/n` (others). The header shows name, role and "Switch user". Non-GET requests other than to `/api/session` carry `X-Staff-Id`; reads carry none. No model request.

#### Scenario: Nurse on shift
- **WHEN** Anita Thomas (id 4, nurse) is signed in and an entry is approved
- **THEN** the header reads `Anita Thomas · Nurse` with "Switch user", and the review request carries `X-Staff-Id: 4`

#### Scenario: Nobody chosen
- **WHEN** the bed link `/a/bed/<token>` is opened and `GET /api/session` answers 401
- **THEN** nobody is signed in, `GET /api/session` is the only request sent, and the app redirects to `/login?next=/a/bed/<token>`
- **AND** once Ravi Kumar signs in, the page to open is still `/a/bed/<token>`, not his landing page `/a`

#### Scenario: Stale choice
- **WHEN** the device's session has ended and the app is opened at `/n`
- **THEN** `GET /api/session` answers 401 `sign_in_required`, and the app is signed out, not locked, so it redirects to `/login?next=/n` and shows the sign-in screen instead of the ward list

#### Scenario: Reads carry no staff id
- **WHEN** Anita Thomas is signed in and the ward list is loaded
- **THEN** the `GET /api/wards` request has no `X-Staff-Id`

#### Scenario: Landing by role
- **WHEN** the app is opened at `/login` and Ravi Kumar (attendant), Anita Thomas (nurse), Lakshmi Iyer (matron) or Sana Mirza (dietitian) signs in
- **THEN** Ravi Kumar lands on `/a`, Anita Thomas and Lakshmi Iyer on `/n`, and Sana Mirza on `/d`
- **AND** Sana Mirza's header reads `Sana Mirza · Dietitian`
