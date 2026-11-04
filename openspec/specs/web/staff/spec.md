# web/staff Specification

## Purpose
Who is using the app on this device. The user picks themselves from the hospital roster, and every chart change carries their id, so entries and reviews are attributed. This is attribution for the demo, not authentication.

## Requirements

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
When `GET /api/session` lists demo accounts, the sign-in screen SHALL show a "Demo accounts" panel listing them by home ward in code order, then those with no home ward by role (the matron, then the dietitian), each as `<name> · <role>`, with the hint `Demo: the password is the first name in lowercase`. Tapping one fills the username. With no demo accounts, as in production, neither the panel nor the hint is shown. It makes no request beyond `GET /api/session`, and no model request.

#### Scenario: Every role labelled
- **WHEN** `GET /api/session` answers 401 with the 11 demo accounts
- **THEN** the panel lists, among others, `Anita Thomas · Nurse` under 3A, `Ravi Kumar · Attendant` under 3A, and `Lakshmi Iyer · Matron` then `Sana Mirza · Dietitian` last
- **AND** tapping `Ravi Kumar · Attendant` fills the username `ravi`, and tapping `Sana Mirza · Dietitian` the username `sana`

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

#### Scenario: A refresh after the session ended
- **WHEN** Anita Thomas is signed in on the 3A dashboard, her session has ended on the server, and the 30-second refresh's `GET /api/admissions?ward=2` answers 401 `sign_in_required`
- **THEN** the dashboard is covered by `Locked · Anita Thomas · Nurse`, the refresh is not sent again, and no further request is sent until she unlocks

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

### Requirement: Landing page
Signed out, `/` SHALL show a landing page that says what Meniscus does and links to sign-in, with an illustration of a read. Its animations move only opacity, transform and stroke-dashoffset, and none runs under reduced motion. It loads nothing from another site, fits a 320 px screen, and sends no request beyond the opening `GET /api/session`. Signed in, `/` opens the role's landing page. It makes no model request.

#### Scenario: Opened signed out
- **WHEN** the app is opened at `/` and `GET /api/session` answers 401
- **THEN** the landing page shows `Meniscus` and a pitch naming a photo or voice note at the bed, a draft chart entry a nurse approves, and Muse Spark, SAM 3.1 and speech-to-text
- **AND** one frame plays, in turn and crossfading, a urine bag filling, an IV bag dripping and draining, a glass of water drunk down and a meal tray eaten a quarter at a time; on each, a scan detects it (`SAM 3.1 · urine bag 0.97`), its outline and the region inside are traced, the level is measured (`450 mL · fill 45%`), and a Muse Spark draft chip appears: `450 mL urine · <colour>`, then `Emptied 420 mL` as the bag drains to a residual; `IV 250 mL`; `Water 180 mL`; and, a bite at a time, `Lunch ¼ eaten` to `Lunch ¾ eaten` with the plate's label at `coverage 25%`
- **AND** every value shown is the drawn level times the container's capacity (45% of a 1000 mL bag reads 450 mL), and the plate's labels match the portions left
- **AND** each time the urine bag comes round its colour is one of the app's urine colours, picked at random, and the chip names it, as `450 mL urine · dark amber`
- **AND** it shows three steps in order, "Capture at the bed", "AI drafts the entry" and "Nurse approves", the note `Not a diagnostic device; nurses approve every entry`, and "Sign in" linking to `/login`
- **AND** `GET /api/session` is the only request sent

#### Scenario: Reduced motion
- **WHEN** the landing page is shown with `prefers-reduced-motion: reduce`
- **THEN** no animation runs and the reads do not cycle: the urine bag is shown as one still frame, filled, outlined and measured, with its draft chip, and the steps at rest

#### Scenario: Opened signed in
- **WHEN** Anita Thomas's session is live and the app is opened at `/`
- **THEN** the app opens `/n`, and the landing page is not shown

### Requirement: Sign-in page
The sign-in screen SHALL live at `/login`. After sign-in the app opens `next` when it is a path on this site (it starts with one `/`, and is not `/login` itself), otherwise the role's landing page; signed in, `/login` does the same at once. It makes no request beyond those of the sign-in screen, and no model request.

#### Scenario: Deep link
- **WHEN** `/n/w/3` is opened signed out, and Anita Thomas signs in at `/login?next=/n/w/3`
- **THEN** the app opens `/n/w/3`

#### Scenario: Next to another site
- **WHEN** Anita Thomas signs in at `/login?next=//evil.example/x`, or with `next=https://evil.example`
- **THEN** the app opens `/n`

#### Scenario: Already signed in
- **WHEN** Ravi Kumar's session is live and the app is opened at `/login`
- **THEN** the app opens `/a`, and the sign-in screen is not shown
