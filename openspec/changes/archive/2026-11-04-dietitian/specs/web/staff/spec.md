# Spec Delta

## MODIFIED Requirements

### Requirement: Staff on shift
The app SHALL take who is on shift from the server session. On opening it sends one `GET /api/session`; until someone signs in, every route (`/a/*`, `/n/*` and `/d` alike) shows the sign-in screen in its place, then the URL that was asked for (from `/`, `/a` for attendants, `/d` for dietitians and `/n` for others). The header shows their name, role and "Switch user". Every non-GET request other than to `/api/session` carries their id as `X-Staff-Id`; reads carry none. It makes no model request.

#### Scenario: Nurse on shift
- **WHEN** Anita Thomas (id 4, nurse) is signed in and an entry is approved
- **THEN** the header reads `Anita Thomas · Nurse` with "Switch user", and the review request carries `X-Staff-Id: 4`

#### Scenario: Nobody chosen
- **WHEN** the bed link `/a/bed/<token>` is opened and `GET /api/session` answers 401
- **THEN** nobody is signed in, and `GET /api/session` is the only request sent
- **AND** once Ravi Kumar signs in, the page to open is still `/a/bed/<token>`, not his landing page `/a`

#### Scenario: Stale choice
- **WHEN** the device's session has ended and the app is opened at `/n`
- **THEN** `GET /api/session` answers 401 `sign_in_required`, and the app is signed out, not locked, so the sign-in screen is shown instead of the ward list

#### Scenario: Reads carry no staff id
- **WHEN** Anita Thomas is signed in and the ward list is loaded
- **THEN** the `GET /api/wards` request has no `X-Staff-Id`

#### Scenario: Landing by role
- **WHEN** the app is opened at `/` and Ravi Kumar (attendant), Anita Thomas (nurse), Lakshmi Iyer (matron) or Sana Mirza (dietitian) signs in
- **THEN** Ravi Kumar lands on `/a`, Anita Thomas and Lakshmi Iyer on `/n`, and Sana Mirza on `/d`
- **AND** Sana Mirza's header reads `Sana Mirza · Dietitian`

### Requirement: Demo accounts on the sign-in screen
When `GET /api/session` lists demo accounts, the sign-in screen SHALL show a "Demo accounts" panel listing them by home ward in code order, then those with no home ward by role (the matron, then the dietitian), each as `<name> · <role>`, with the hint `Demo: the password is the first name in lowercase`. Tapping one fills the username. With no demo accounts, as in production, neither the panel nor the hint is shown. It makes no request beyond `GET /api/session`, and no model request.

#### Scenario: Every role labelled
- **WHEN** `GET /api/session` answers 401 with the 11 demo accounts
- **THEN** the panel lists, among others, `Anita Thomas · Nurse` under 3A, `Ravi Kumar · Attendant` under 3A, and `Lakshmi Iyer · Matron` then `Sana Mirza · Dietitian` last
- **AND** tapping `Ravi Kumar · Attendant` fills the username `ravi`, and tapping `Sana Mirza · Dietitian` the username `sana`

#### Scenario: Production shows no demo panel
- **WHEN** `GET /api/session` answers 401 with `demo_accounts: []`
- **THEN** the sign-in screen shows no "Demo accounts" panel and no password hint
