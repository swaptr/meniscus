# Spec Delta

## MODIFIED Requirements

### Requirement: Staff on shift
The app SHALL take who is on shift from the server session. On opening it sends one `GET /api/session`; until someone is signed in, every route, `/a/*` and `/n/*` alike, shows the sign-in screen in its place, then the URL that was asked for (from `/`, `/a` for attendants and `/n` for others). The header shows their name and role and "Switch user". Every non-GET request other than to `/api/session` carries their id as `X-Staff-Id`; reads carry none.

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
- **WHEN** the app is opened at `/` and Ravi Kumar (attendant), Anita Thomas (nurse) or Lakshmi Iyer (matron) signs in
- **THEN** Ravi Kumar lands on `/a`, and Anita Thomas and Lakshmi Iyer on `/n`

## ADDED Requirements

### Requirement: Sign in with a username and password
The sign-in screen SHALL show the hospital name from `GET /api/session`, "Who's signing in?", a username field, a password field and "Sign in", which sends one `POST /api/session`; a wrong username or password shows `Wrong username or password` and keeps the username. "Recent on this device" offers up to 4 people who signed in here, keeping only username, name and role; tapping one fills the username. Controls are labelled, at least 44 px.

#### Scenario: Anita signs in
- **WHEN** at `/n`, `anita` and `anita` are typed as username and password and "Sign in" is tapped
- **THEN** after the opening `GET /api/session`, the only request before the ward list is `POST /api/session` with `{ username: "anita", password: "anita" }`
- **AND** the ward list is shown, and the header reads `Anita Thomas · Nurse`

#### Scenario: Wrong password
- **WHEN** `anita` and `wrong` are entered, and `POST /api/session` answers 401 `invalid_credentials`
- **THEN** the screen shows `Wrong username or password`, the username field still holds `anita`, and the password field is empty

#### Scenario: Recent on this device
- **WHEN** Ravi Kumar, Anita Thomas, Grace Lee, Meera Pillai and Lakshmi Iyer signed in on this device in that order
- **THEN** "Recent on this device" lists Lakshmi Iyer, Meera Pillai, Grace Lee and Anita Thomas, each as `<name> · <role>`
- **AND** tapping Grace Lee fills the username `grace` and focuses the password field
- **AND** the device's storage holds no password and no session token

### Requirement: Demo accounts on the sign-in screen
When `GET /api/session` lists demo accounts, the sign-in screen SHALL show a "Demo accounts" panel listing them by home ward in code order, the matron last, each as `<name> · <role>`, with the hint `Demo: the password is the first name in lowercase`. Tapping one fills the username. With no demo accounts, as in production, neither the panel nor the hint is shown. It makes no request beyond `GET /api/session`.

#### Scenario: Every role labelled
- **WHEN** `GET /api/session` answers 401 with the 10 demo accounts
- **THEN** the panel lists, among others, `Anita Thomas · Nurse` under 3A, `Ravi Kumar · Attendant` under 3A, and `Lakshmi Iyer · Matron` last
- **AND** tapping `Ravi Kumar · Attendant` fills the username `ravi`

#### Scenario: Production shows no demo panel
- **WHEN** `GET /api/session` answers 401 with `demo_accounts: []`
- **THEN** the sign-in screen shows no "Demo accounts" panel and no password hint

### Requirement: Lock when idle
After `IDLE_LOCK_MS` (5 minutes) with no input, the app SHALL cover the screen with a lock reading `Locked · <name> · <role>`, offering "Unlock" (their password, one `POST /api/session`) and "Switch user". Unlocking resumes the screen as it was, unsaved work included. A read in flight finishes behind the lock. A 401 `sign_in_required` while signed in shows the same lock. Nothing is retried, and refreshes pause while locked. It makes no model request.

#### Scenario: Locked after 5 minutes idle
- **WHEN** Anita Thomas is signed in on the 3A dashboard, and her last input was at 10:00
- **THEN** at 10:04:59 the dashboard is shown, and at 10:05 it is covered by `Locked · Anita Thomas · Nurse` with "Unlock" and "Switch user"
- **AND** while locked, the dashboard's 30-second refresh sends no request

#### Scenario: Unlock keeps the draft
- **WHEN** Ravi Kumar has an unsaved 450 mL photo draft at 10:00, the app locks at 10:05, and at 10:40 (after his session has ended) he unlocks with the password `ravi`
- **THEN** the only request is `POST /api/session` with `{ username: "ravi", password: "ravi" }` and no `X-Staff-Id`
- **AND** Ravi Kumar is signed in again, his draft is still held as unsaved, and no `/api/ai` request is sent

#### Scenario: Session ends while working
- **WHEN** saving Ravi Kumar's draft gets 401 `sign_in_required`
- **THEN** the app is locked as Ravi Kumar, the save fails without a second request, and the draft is still held as unsaved
- **AND** after unlocking, the only request is `POST /api/session`, until the draft is saved again

### Requirement: Someone else at the lock
When the lock does not know the locked person's username, it SHALL ask for a username with the password. If a different person signs in there, the app SHALL start afresh for them: the screen behind is rebuilt and no unsaved draft or round readings carry over. The locked person signing in there resumes as an unlock does. It makes no model request.

#### Scenario: Grace signs in over Ravi's lock
- **WHEN** Ravi Kumar's session was opened on this device before it knew his username, he has an unsaved 450 mL draft, and the app locks as `Locked · Ravi Kumar · Attendant`
- **THEN** the lock asks for a username and a password
- **AND** when Grace Lee signs in there with `grace` and `grace`, the only request is `POST /api/session` with no `X-Staff-Id`, she is signed in, and nothing unsaved is held

#### Scenario: Ravi himself keeps his draft
- **WHEN** in the same state, Ravi Kumar signs in at the lock with `ravi` and `ravi`
- **THEN** he is signed in and his draft is still held as unsaved

### Requirement: Switch user
"Switch user", in the header or on the lock, SHALL send one `DELETE /api/session` and show the sign-in screen; when the page opened already signed in, the sign-in screen's hospital and demo accounts then take one `GET /api/session`. When a draft or round readings are unsaved, it first asks `<first name>'s unsaved draft will be discarded`; "Cancel" keeps everything as it was. It makes no model request.

#### Scenario: Switch user discards after confirm
- **WHEN** Anita Thomas has unsaved round readings and taps "Switch user"
- **THEN** it asks `Anita's unsaved draft will be discarded`, and "Cancel" sends nothing and keeps the readings
- **AND** confirming sends one `DELETE /api/session`, shows the sign-in screen, and the readings are gone

#### Scenario: Nothing unsaved
- **WHEN** Grace Lee has nothing unsaved and taps "Switch user"
- **THEN** one `DELETE /api/session` is sent with no question, and the sign-in screen is shown

#### Scenario: Opened signed in
- **WHEN** the app opened with Grace Lee's session already live, and she taps "Switch user"
- **THEN** the requests are `DELETE /api/session` and then `GET /api/session`, neither with `X-Staff-Id`
- **AND** the sign-in screen shows `Meniscus Demo Hospital` and the demo accounts
