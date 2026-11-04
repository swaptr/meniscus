# Proposal

## Why

Every staff member can work on every ward today, and an attendant can approve an entry. Who did what rests on an `X-Staff-Id` header the client chooses, and a request without it gets around any role rule. In NHS and US hospitals:
- each ward has its own team (healthcare assistants and registered nurses), with nurses cleared to cover other wards;
- a named nurse is in charge of each ward every shift, and assigns each nurse their beds for the shift;
- a matron oversees a group of wards;
- high-dependency beds are staffed at about one nurse to two patients;
- support staff record intake and output, and a registered nurse is accountable for the chart, balances it and escalates (NMC Code §10 records, §11 delegation);
- staff sign in by name on shared ward devices, and the screen locks when left idle;
- opening a record outside your own care team is allowed in an emergency, but the reason is recorded with your password and reviewed ("break-the-glass").

Practice in Indian public hospitals differs: staff nurses often chart I&O themselves, and 3 × 8 h shifts are common. So the parts that vary are kept in one place, as shared constants in `packages/shared`: the role lists, the shift pattern and the idle times.

Meniscus's entries are AI drafts, so it asks a nurse to approve each one. That rule only means something if the server knows who is asking and an attendant cannot approve. The demo cannot show that today.

## What Changes

- **Ward teams.**
  - Each staff member has a home ward and the wards they are cleared to cover. A matron has the wards they oversee and no home ward.
  - Roles become `attendant`, `nurse` and `matron`.
  - Role policy lives in `packages/shared` as `DECIDER_ROLES` (may approve, reject, amend, void and name a nurse in charge), `IN_CHARGE_ROLES` (may be named nurse in charge or assigned beds) and `OVERSEER_ROLES` (their wards are the wards they oversee). Every policy check on the server and the web reads these lists, or an exhaustive per-role map, instead of naming a role.
  - `GET /api/staff` returns each person's wards as `{ id, code }`, home ward first, and never a username or password hash.
  - New `GET /api/wards/:id/team` returns a ward's nurses and attendants (home before cover), its nurse in charge and its bed assignments for the current shift.
- **Shifts and the nurse in charge.**
  - Shifts come from the shared constant `SHIFTS` (name and start time). The default is day 08:00–20:00 and night 20:00–08:00 (2 × 12 h); a three-shift pattern is three entries. `shiftStart(ms, shifts)` moves into `packages/shared` and returns the shift's start, end and name, so the bed log, the nurse in charge, bed assignments and sessions use the same code.
  - `GET /api/wards` shows each ward's nurse in charge for the current shift.
  - `PUT /api/wards/:id/in-charge` names one:
    - the caller must be a nurse on that ward's team (home or cover) or the matron who oversees it;
    - the person named must be a nurse on that ward's team;
    - a nurse is in charge of one ward per shift, so naming a nurse ends their charge elsewhere;
    - the choice lasts until the shift ends.
- **Bed assignment (small version).**
  - New `PUT /api/wards/:id/assignments` lets the ward's nurse in charge, or the matron who oversees it, assign the ward's beds to nurses on its team for the current shift. Each shift starts unassigned.
  - The ward dashboard shows each bed's nurse. A nurse with beds gets "My beds", on by default. The nurse in charge keeps the ward's other beds with prompts in view.
- **Decisions need a nurse.**
  - When the signed-in person is an attendant, these are refused with HTTP 403 `forbidden`: approving or rejecting an entry, amending one, and voiding a meal. The role is checked before the body or the entry, so an attendant gets 403 even for an unknown entry. Nurses and the matron may do them.
  - Saved entries are nurse-only. An attendant adjusting the AI draft on the check screen before saving it is recording, and stays open to every role, as do recording entries, levels and meals and uploading media.
  - Product choice, stricter than some record-keeping practice: an attendant does not reject their own duplicate or void their own wrong-bed meal. They ask a nurse.
- **Sign-in and sessions.**
  - Every route, `/a/*` and `/n/*` alike, is behind one sign-in screen for every role: username and password, "Recent on this device" (up to 4 people), and, only when demo sign-in is on, a "Demo accounts" panel listing the demo staff by ward with role labels. Deep links such as `/a/bed/<token>` open after sign-in. The role then decides the landing page and the permissions.
  - The server verifies the password (scrypt) and keeps a session (`HttpOnly` cookie, only a hash of the token stored). Sessions end at the end of their shift, or after 30 minutes with no request.
  - New `POST`, `GET` and `DELETE /api/session`. A wrong username or password gets the same 401 `invalid_credentials`.
  - Every non-GET `/api/*` request other than to `/api/session` needs a session, else 401 `sign_in_required`: chart changes, media uploads, `/api/ai/*` and the new ward routes. This closes the gap where an anonymous request got around nurse-only decisions. The server takes identity from the session. `X-Staff-Id` stays for compatibility: with a live session, one naming anyone else gets 401, and `/api/session` ignores it, so a stale header never blocks signing in again. Reads stay open with the device token.
  - Demo staff sign in with their lowercase first name as username and password. Production refuses these unless `MENISCUS_DEMO_LOGIN=1`. The existing per-client rate limit also covers password checks; there is no account lockout.
- **Idle lock and switching user.**
  - After `IDLE_LOCK_MS` (5 minutes) with no input, the app locks over the current screen (`Locked · Anita Thomas · Nurse`). Unlocking with the same person's password resumes exactly where they were, unsaved drafts and round readings included. A model read in flight finishes behind the lock.
  - "Switch user" signs out after confirming that unsaved work will be discarded.
  - A 401 `sign_in_required` mid-work shows the same lock. Nothing is retried, so no model request is repeated.
- **Break-the-glass.**
  - Opening the ward dashboard or a bed review of a ward outside your wards asks for a reason and your password first, as Epic does. Cancelling leaves you where you were. The printable chart is not gated (a known gap; it is read-only).
  - New `POST /api/wards/:id/access` checks the password against the signed-in person and stores the reason (trimmed, 1–200 characters), the staff member, the ward and the time. A wrong password gets 401 `invalid_credentials` and stores nothing.
  - After a reason is recorded, that ward opens without asking again for the rest of the shift, for that person on that device.
  - Nothing is asked or recorded for your own wards (the matron's are all four).
  - The records are stored for review. No endpoint or screen reads them back in this change.
  - The reason is staff-written text, stored in the database and never logged. The password is never logged or stored.
- **Demo staffing.**
  - The roster grows from 6 to 10 fictional staff, keeping ids 1–6.
  - 2C, 3A and 5B each have a home nurse and home attendants.
  - Renal HDU has two nurses of its own and no attendants: its nurses chart their own patients. On the demo shift both are assigned, one nurse to two patients.
  - One matron oversees the four wards.
  - Each ward starts with a nurse in charge and its beds assigned, for the shift current at seeding.
  - Demo history is recorded and approved by each ward's own team.
- **Web.**
  - The sign-in screen, the idle lock and "Switch user" in the header.
  - The nurse ward list (`/n`) shows "Your wards" first, and each card shows its nurse in charge, which is also the matron's cross-ward summary.
  - A ward dashboard or bed review outside your wards asks for the reason and password, then shows a notice.
  - The ward dashboard shows the nurse in charge, each bed's nurse, "My beds" and, for a nurse on the team, "Take charge". The nurse in charge and the matron get a nurse picker per bed.
  - An attendant sees no Approve, Reject, Amend, batch approval or meal Void. Their "Add missed entry" saves the entry for a nurse to approve, without approving it.

## Access and audit

Designed along the HIPAA Security Rule technical safeguards (45 CFR 164.312); not a compliance claim:

| Safeguard | Meniscus |
|---|---|
| Unique user identification, (a)(2)(i) | Named sign-in, one account per staff member |
| Emergency access procedure, (a)(2)(ii) | Break-the-glass with a reason and a password check |
| Automatic logoff, (a)(2)(iii) | 5-minute idle lock, and server sessions that end after 30 idle minutes or at the end of the shift |
| Audit controls, (b) | Entry events and access records |
| Person or entity authentication, (d) | Password sign-in |

Caveat: the demo uses demo credentials (lowercase first names), guessable by design. They are refused in production unless `MENISCUS_DEMO_LOGIN=1`. The device token (`MENISCUS_API_TOKEN`) stays the outer boundary. Break-the-glass and the idle lock are enforced in the browser; the server records the reason and ends sessions on its own clock. Known gaps are in design.md under Risks (printable chart, CSRF stance, scrypt cost, rate limit per address).

Model requests per user action: none before, none after. No action in this change calls a model, and unlocking or signing in again never re-sends a model request.

Config items (shared constants, no env or UI):
- `SHIFTS` (shift names and start times).
- `DECIDER_ROLES`: whether a role, such as nursing associates, may sign off.
- `IN_CHARGE_ROLES` and `OVERSEER_ROLES`.
- `IDLE_LOCK_MS` (5 minutes) and `SESSION_IDLE_MS` (30 minutes).

The one new env var is `MENISCUS_DEMO_LOGIN`.

Changed shapes:
- `packages/shared`:
  - `STAFF_ROLES` adds `'matron'`. **BREAKING** for exhaustive `Record<StaffRole, …>` maps; the web's `ROLE_LABEL` and the timeline labels are updated in this change.
  - **BREAKING**: `StaffRef` becomes its own `{ id, name, role }` instead of an alias of `Staff`. `Staff` (the roster) adds `wards: { id, code }[]`, which the web reads.
  - **BREAKING**: `WardSummary` adds `in_charge: StaffRef | null`, which the web reads on the ward cards.
  - New:
    - role lists `DECIDER_ROLES`, `IN_CHARGE_ROLES`, `OVERSEER_ROLES`;
    - shifts and idle times `ShiftDef`, `SHIFTS`, `shiftStart`, `IDLE_LOCK_MS`, `SESSION_IDLE_MS`;
    - wards `WardRef`, `TeamMember`, `BedAssignment`, `WardTeam`, `InChargeInput`, `AssignBedsInput`;
    - access `WardAccess`, `WardAccessInput`;
    - sessions `SessionInput`, `SessionInfo`, `DemoAccount`, `SignInRequired`.
- HTTP:
  - `GET /api/staff` items gain `wards`. `GET /api/wards` items gain `in_charge`.
  - New `GET /api/wards/:id/team`, and `PUT /api/wards/:id/in-charge` and `PUT /api/wards/:id/assignments`, which return the ward team.
  - New `POST /api/wards/:id/access` (201, one `WardAccess`).
  - New `POST /api/session` (201 `{ staff }`, sets `meniscus_session`), `GET /api/session` (200 `{ staff }`, or 401 `{ error, hospital, demo_accounts }`) and `DELETE /api/session` (always 204, clears the cookie, needs no session).
  - **BREAKING**: every non-GET `/api/*` request other than to `/api/session` needs a session, and gets 401 `sign_in_required` without one. That includes chart changes, media uploads and `/api/ai/*`.
  - New error codes `forbidden` (403), `sign_in_required` (401) and `invalid_credentials` (401). They reuse the existing `{ error }` shape, except the `GET /api/session` 401 above; there is no new general error shape. The web's `errorText` maps `forbidden`.
  - `forbidden` appears on the endpoints of the existing requirements Nurse review, Amend an approved entry and Void a meal. Those keep their wording, except that Void a meal now records the signed-in person instead of the `X-Staff-Id` staff (`charting/meals` delta); the rule lives in `charting/staffing` "Decisions need a nurse".

Live scenarios and tests this change rewrites (a MODIFIED block must keep every scenario name, so none is dropped and no requirement is REMOVED):

| Scenario | Now | Citing test |
|---|---|---|
| `[charting/audit]` Chart changes are attributed: "No staff sent" | Signed in, no header → attributed to the session; no session → 401 | `apps/server/src/audit.test.ts:108` |
| `[charting/audit]` Staff roster: "Demo roster" | 10 staff with `wards`, and no username or password hash | `apps/server/src/audit.test.ts:66` |
| `[charting/audit]` Entry history: "Pre-history entry" | Scenario unchanged; the test's roster count goes from 6 to 10 | `apps/server/src/audit.test.ts:208` |
| `[web/staff]` Staff on shift: "Nurse on shift" | Header with "Switch user"; the person comes from the session, so the localStorage check goes | `apps/web/src/lib/staff.test.ts:32` (check at `:45`) |
| `[web/staff]` Staff on shift: "Nobody chosen" | The deep link waits for sign-in | `apps/web/src/lib/staff.test.ts:48` |
| `[web/staff]` Staff on shift: "Stale choice" | An ended session signs out (not a lock) | `apps/web/src/lib/staff.test.ts:56` |
| `[web/ward]` Hospital ward list: "Busy ward", "Quiet ward" | Each card adds the in-charge line | `apps/web/src/lib/lib.test.ts:288`, `:299` |
| `[web/ward]` Ward dashboard per ward: "Open ward 5B" | 1 request becomes 2 (admissions and the ward team) | `apps/web/src/lib/lib.test.ts:309` |
| `[web/ward]` Intake and output log by shift: "Two shifts" and the early-morning test | Scenarios unchanged; `night` is retyped to `name` (plus `end`), checking at least as much | `apps/web/src/lib/history.test.ts:46`, `:57-58` |

Other tests that change data now run in a session that the test helpers create. Their assertions are unchanged; this is a harness update, not a weaker test.

### Out of scope

- Single sign-on (OIDC, e.g. NHS CIS2), badge tap and fast user switching, and password change or reset. `verifyCredentials` is the seam they would replace.
- Account lockout.
- Duty rosters by shift. A ward team says who may work there, not who is on tonight. Nurses in charge and bed assignments are set in the app each shift, not read from a duty roster or carried over.
- Bed assignment for attendants, assignment templates, and per-nurse pending queues on the bed review.
- Reading access records back, in the app or through an endpoint. They are stored for review (a database read).
- Gating the printable chart behind break-the-glass.
- A team list on the ward dashboard. It shows the nurse in charge and each bed's nurse.
- A reason for attendant capture (`/a`, bed QR, ward round). Recording at any bed stays open to anyone signed in.
- Configuring shifts or timeouts at runtime (env or UI). They are code constants.
- Nursing associates (a config item, above), and 6-hourly or 24-hour balance sign-off.
- Enforcing wards on writes. Anyone signed in may record at any bed, as a floating attendant does; the record shows who.
- Editing ward teams or staff in the app.

## Capabilities

### New Capabilities
- `charting/staffing`: who works where and who decides. Covers ward teams, shifts and the nurse in charge, bed assignment, nurse-only chart decisions, break-the-glass access records, the demo hospital's staffing, and older stores.

### Modified Capabilities
- `charting/audit`:
  - **Staff roster**: adds the `matron` role and each person's `wards`, never credentials. The demo roster becomes 10 staff.
  - **Chart changes are attributed**: staff come from the session; "No staff sent" is rewritten.
- `server/security`:
  - **Per-client rate limit**: also limits password checks.
  - Adds **Staff sign-in**, **Sessions end**, **Signed-in changes** and **Demo sign-in in production**.
- `web/staff`:
  - **Staff on shift**: the sign-in gate, the header and "Switch user", and `X-Staff-Id` on every non-GET except to `/api/session`.
  - Adds **Sign in with a username and password**, **Demo accounts on the sign-in screen**, **Lock when idle** and **Switch user**.
- `web/ward`:
  - **Hospital ward list**: the order can put your wards first, and each card shows the nurse in charge.
  - **Ward dashboard per ward**: the dashboard also loads the ward team once, and waits for the reason on another ward.
  - **Resolve from the bed review**: an attendant's missed entry is saved without approval.
  - Adds **Your wards first**, **Nurse in charge on the ward**, **My beds**, **Assign beds from the dashboard**, **Decisions need a nurse** and **Reason to open another ward**.

## Impact

- `packages/shared`: staff, ward, team, access and session types; the role lists, `SHIFTS` and idle times; `shiftStart` moved from `apps/web/src/lib/history.ts`.
- `apps/server`:
  - New `auth.ts` (`verifyCredentials`, scrypt, tokens) and `routes/session.ts`.
  - App-level `session` middleware, which replaces the per-route `staffHeader`, and `requireDecider`, both in `routes/common.ts`.
  - `config.ts` and `.env.example`: `MENISCUS_DEMO_LOGIN`.
  - Store: a `staff` rebuild migration (DDL generated from `STAFF_ROLES`, with `username` and `password_hash`), and new `staff_ward`, `ward_shift`, `bed_assignment`, `ward_access` and `session` tables.
  - Seed: the demo staff, teams, in-charge, assignments and committed demo password hashes, with `scripts/demo-passwords.ts`.
  - New routes; `scripts/demo-history.ts`.
  - Test helpers: a default session.
- `apps/web`:
  - New `lib/session.ts`, `lib/idle.ts`, `lib/unsaved.ts` and `lib/rota.ts`.
  - `lib/staff.ts`, `lib/api.ts`, `lib/ward.ts`, `lib/resolve.ts`, `lib/history.ts`, `lib/timeline.ts` and `lib/use-resource.ts`.
  - New `components/sign-in.tsx`, `components/lock.tsx` and `components/access-gate.tsx`. `StaffDialog` is removed.
  - Screens: the app shell and root (the `/` redirect moves into the gate), the ward list, the ward dashboard, the bed review, entry details, meals and the resolve dialogs.
- README:
  - "Access and audit", with sources.
  - Demo notes: sign in as a demo account; at 08:00 and 20:00, take charge and assign beds; as Grace Lee, open Renal HDU to show break-the-glass.
  - "Production-like": the command gains `MENISCUS_DEMO_LOGIN=1`, with a warning that plain HTTP on a LAN address drops the `Secure` cookie.
- No new dependencies (`node:crypto` and `hono/cookie` only). No model calls.
