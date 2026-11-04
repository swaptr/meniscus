## MODIFIED Requirements

### Requirement: Staff on shift
The app SHALL take who is on shift from the server session. On opening it sends one `GET /api/session`; until someone signs in, `/` shows the landing page, `/login` the sign-in screen, and every other route (`/a/*`, `/n/*` and `/d` alike) redirects to `/login?next=<the URL asked for>`. After sign-in the app opens that URL (from `/` or `/login` with no usable `next`: `/a` for attendants, `/d` for dietitians and `/n` for others). The header shows their name, role and "Switch user". Every non-GET request other than to `/api/session` carries their id as `X-Staff-Id`; reads carry none. It makes no model request.

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

## ADDED Requirements

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
