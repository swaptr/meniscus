# Tasks

## 1. Shared types

- [x] 1.1 Shared types and config constants in `packages/shared` (contracts only; no requirement of their own):
  - add `'matron'` to `STAFF_ROLES`;
  - add `DECIDER_ROLES`, `IN_CHARGE_ROLES` and `OVERSEER_ROLES`, with the config-item comment from design.md;
  - add `ShiftDef`, `SHIFTS`, `IDLE_LOCK_MS` and `SESSION_IDLE_MS`;
  - move `shiftStart` from `apps/web/src/lib/history.ts`, as `shiftStart(ms, shifts = SHIFTS) → { start, end, name }`;
  - make `StaffRef` its own interface, and give `Staff` the field `wards: WardRef[]`;
  - add `in_charge` to `WardSummary`;
  - add `WardRef`, `TeamMember`, `BedAssignment`, `WardTeam` (with `shift_start` and `assignments`), `InChargeInput`, `AssignBedsInput`, `WardAccess`, `WardAccessInput`, `SessionInput`, `SessionInfo`, `DemoAccount` and `SignInRequired`.

  Then retype the fixtures and callers, so the whole repo compiles:
  - `apps/server/src/audit.test.ts:61-63`;
  - `apps/web/src/lib/audit-fixtures.ts:4-7`;
  - `apps/web/src/lib/staff.test.ts:7-8`;
  - `apps/web/src/lib/lib.test.ts:275`: the `ward()` fixture gets `in_charge: null`;
  - `apps/server/src/store/demo-hospital.ts:81`: `DEMO_STAFF` becomes `(StaffRef & { username })[]`;
  - `apps/web/src/lib/staff.ts:27-33`;
  - `apps/web/src/lib/history.ts`: `Shift.night` becomes `Shift.name`, and `shiftLabel` reads `SHIFTS`;
  - `apps/web/src/lib/history.test.ts:4`: import `shiftStart` from `@meniscus/shared`, or re-export it from `history.ts`;
  - `apps/web/src/lib/history.test.ts:46`: `s.night` becomes `s.name`, expecting `'night'` and `'day'` where it expected `true` and `false`;
  - `apps/web/src/lib/history.test.ts:57-58`: the expected `{ start, night }` becomes `{ start, end, name }`, with the same `start`, `name` `'night'` or `'day'`, and the next shift's start as `end`. Each assertion checks at least what it did before.

  Also add `matron` to the web's `ROLE_LABEL`. Verify: `pnpm typecheck` passes, and the web history tests, including `[web/ward] Intake and output log by shift`, pass with only the retypes above.

## 2. Server

- [x] 2.1 Store, migration and demo staffing.
  - Write the failing tests:
    - In `apps/server/src/audit.test.ts`, change in place:
      - [charting/audit] Staff roster: "Demo roster" (`:66`): 10 staff, Ravi Kumar's wards, and no `username` or `password_hash` field.
      - [charting/audit] Entry history: "Pre-history entry": the roster count at `:208` goes from 6 to 10.
    - In new `apps/server/src/staffing.test.ts`, with local-time clocks and each test asserting 0 upstream requests:
      - [charting/staffing] Demo staffing: "Who works where" (the assignments through `store.team()` until 2.3 adds the route).
      - [charting/staffing] Nurse in charge: "Day shift ends", "Night shift crosses midnight", and "Three shifts" (`shiftStart` called directly with an early 07:00, late 15:00 and night 23:00 list).
      - [charting/staffing] Pre-team stores: "Older demo store" (built with the old DDL; it has admissions), and "Opened again" (asserts `PRAGMA schema_version` is unchanged by the second open).
  - Run them and see them fail. These must stay green throughout:
    - [charting/audit] Entry history: "Pre-history entry" (`audit.test.ts:171`, no `staff` table), with only the roster count above changed;
    - [charting/wards] Pre-ward stores: "Legacy file" (`chart.test.ts:199`, no `staff` table);
    - [charting/media] Stored photos become media: "Older store" (`media.test.ts:303`, an empty old-CHECK `staff` table, opened twice).
  - Implement, in `apps/server/src/store`:
    - `staffDdl` (with `username` and `password_hash`) and `rebuildStaff`: skipped when there is no `staff` table or its normalised SQL matches; `foreign_key_check` fails only on rows whose parent is `staff`; `ROLLBACK` on any error;
    - the `staff_ward`, `ward_shift`, `bed_assignment`, `ward_access` and `session` tables, and the `openStore` order from design.md (no new `openStore` option);
    - `DEMO_STAFF` grows to 10 with usernames, plus `DEMO_TEAMS`, `DEMO_IN_CHARGE` and `DEMO_ASSIGNMENTS`;
    - `DEMO_PASSWORD_HASHES`, generated once by new `apps/server/scripts/demo-passwords.ts` and committed;
    - `seedStaff`: `ON CONFLICT(id) DO NOTHING`, then `UPDATE OR IGNORE` usernames and hashes for demo staff who have none;
    - `seedTeams`;
    - `staff()` (`Staff[]`: id, name, role and wards; never username or hash), `credentials()`, `wards()` with `in_charge`, `team()` with assignments, `setInCharge`, `assignBeds`, `recordAccess` and the session queries, all role-free.
- [x] 2.2 Sign-in, sessions and the sign-in gate.
  - Write the failing tests:
    - In new `apps/server/src/session.test.ts`:
      - [server/security] Staff sign-in: "Ravi signs in" (cookie flags; stubs `console.log` and `console.error` and asserts no body or log line holds the token, `scrypt$` or the request body), "Same answer for a wrong username or password", "Secure in production".
      - [server/security] Sessions end: "Shift end", "Thirty minutes without a request", "Sign out" (including the second `DELETE` and the one with no cookie).
      - [server/security] Signed-in changes: "No session", "Ended session", "Someone else's id", "Sign in again over an ended session", "Reads stay open".
      - [server/security] Demo sign-in in production: "Demo accounts listed", "Production refuses demo passwords" (through `parseConfig` and `createApp`), "Older store gains sign-in".
      - A check that each committed `DEMO_PASSWORD_HASHES` entry verifies against that person's lowercase first name.
      - A check that a staff member whose stored hash is malformed (`scrypt$bad`) gets 401 `invalid_credentials`, not 500.
    - In `apps/server/src/security.test.ts`: [server/security] Per-client rate limit: "Sign-in attempts".
    - In `apps/server/src/audit.test.ts:108`, rewritten in place: [charting/audit] Chart changes are attributed: "No staff sent".
  - Update the test harness; this is not a weaker test:
    - `apps/server/src/testing.ts` gains `signIn(store, staffId)` and `testApp(options)`, as in design.md. `testApp`'s `request` creates the default session (staff 4) for each non-GET at the store's current clock, so tests that move the clock (`audit.test.ts:120`; "One of each", 31 Oct to 2 Nov) keep a live session.
    - Given `staff: n`, it signs in `n` and sends `X-Staff-Id: n`; when `n` is not on the roster (999, `abc`), it signs in staff 4 and sends the header, so those requests keep their 400.
    - Every app in the server tests comes from `testApp`: the `setup` helpers of `audit`, `chart` (and `:440`), `evidence`, `media`, `meal-reading` and `meals`; `security.test.ts:16` and `:115`; `meal-reading.test.ts:75`; and the 7 `createApp({ ai })` calls in `ai/ai.test.ts` (`:165`, `:197`, `:208`, `:221`, `:233`, `:242`, `:253`), which get a `:memory:` store. No test other than "No staff sent" (`audit.test.ts:112`) asserted a null `created_by` from an anonymous request.
  - Run the whole server suite. Every existing assertion is unchanged except "No staff sent", "Demo roster" and the roster count at `audit.test.ts:208`.
  - Implement:
    - `apps/server/src/auth.ts`: `verifyCredentials` (a malformed stored hash is checked as the dummy; a demo hash refused in production still runs scrypt), scrypt hashing, the dummy hash, tokens;
    - `routes/session.ts`, with `smallJson()` before zod on `POST /session`, and `DELETE /session` idempotent;
    - `smallJson` moved from `routes/chart.ts:129` to `routes/common.ts`;
    - the app-level `session(store)` middleware in `routes/common.ts`, reading only `store.now()`, replacing the per-route `staffHeader`; `/api/session` ignores `X-Staff-Id`, and the header is checked only with a live session;
    - the `app.ts` order, and the password-check rate limit on `POST /session` and `POST /wards/:id/access`;
    - `MENISCUS_DEMO_LOGIN` in `config.ts` and `.env.example`;
    - the `createApp` options `demoLogin` and `secureCookie`, wired in `index.ts`.
- [x] 2.3 Ward team and nurse in charge routes.
  - Write the failing tests in `staffing.test.ts`:
    - [charting/staffing] Ward team: "Team of 3A", "Unknown ward team".
    - [charting/staffing] Name the nurse in charge: "Cover nurse takes charge", "Matron names a nurse", "Not a nurse on the team", "Attendant or nobody", "Nurse off the team", "Unknown ward".
  - Implement:
    - `orderTeam` in new `apps/server/src/chart/staffing.ts`, reading `IN_CHARGE_ROLES` and `OVERSEER_ROLES`;
    - `GET /wards/:id/team` and `PUT /wards/:id/in-charge` in `routes/chart.ts`, checked 404 → 403 → `smallJson()` and zod → 400 after the sign-in checks, as in design.md.
- [x] 2.4 Bed assignment.
  - Write the failing tests in `staffing.test.ts`: [charting/staffing] Assign beds: "Nurse in charge splits HDU", "Matron assigns", "Not in charge", "Invalid assignment", "Next shift starts unassigned".
  - Implement `PUT /wards/:id/assignments` with the checks from design.md (`smallJson()` before zod): the current `in_charge` or `OVERSEER_ROLES` for the caller, and `IN_CHARGE_ROLES` and the team for each nurse.
- [x] 2.5 Decisions need a nurse.
  - Write the failing tests in `staffing.test.ts`: [charting/staffing] Decisions need a nurse: "Attendant approves", "Role checked first", "Attendant amends or voids", "Refused reject or void keeps media", "Matron approves", "Attendant records", "Attendant saves an adjusted draft".
  - Implement `requireDecider` and `forbidden` in `apps/server/src/routes/common.ts`, reading `DECIDER_ROLES`. Chain `requireDecider → smallJson() → validate` on review, amend and meal void.
  - The existing review, amend and void tests run as staff 4, 5 or the default session, or send 999. They stay green unchanged.
- [x] 2.6 Break-the-glass route.
  - Write the failing tests in `staffing.test.ts`: [charting/staffing] Record access to another ward: "Grace opens HDU" (stubs the console and asserts neither the reason nor the password is logged, and the password is in no response or row), "Reason required", "Wrong password", "Unknown ward or no session". They read `ward_access` from the store's database directly.
  - Implement `POST /wards/:id/access` in `routes/chart.ts` (`smallJson()` before zod; password through `verifyCredentials`), with the check order from design.md. No log line.
- [x] 2.7 Demo history (`apps/server/scripts/demo-history.ts`), the three rules in design.md and nothing more:
  - no approval, amendment, rejection or void by an attendant;
  - everyone who acts on a ward has it in their `DEMO_TEAMS` wards;
  - IV fluids are recorded by nurses.

  Verify each rule once over a fresh temporary `DATA_DIR`.

## 3. Web

The web tests fake the session: `createApi` takes a fake `fetch` (answering `/api/session` where needed) and a `staffId`, as `resolve.test.ts` and `meals.test.ts` already do.

- [x] 3.1 Session, sign-in and lock library.
  - Write the failing tests in new `apps/web/src/lib/session.test.ts` and in `staff.test.ts`, with a fake clock and memory storage:
    - [web/staff] Staff on shift:
      - "Nurse on shift" (`staff.test.ts:32`, rewritten: the person comes from the session, so the localStorage check at `:45` goes);
      - "Nobody chosen" (`:48`, rewritten: the state after a 401 check, and `landingPath`);
      - "Stale choice" (`:56`, rewritten: `signed_out`, not `locked`);
      - "Reads carry no staff id";
      - "Landing by role" (`landingPath` and `LANDING`).
    - [web/staff] Sign in with a username and password: "Anita signs in", "Wrong password", "Recent on this device".
    - [web/staff] Demo accounts on the sign-in screen: "Every role labelled" (`demoGroups`), "Production shows no demo panel".
    - [web/staff] Lock when idle:
      - "Locked after 5 minutes idle" (`createIdleTimer`, and a paused `createPoll` sends nothing);
      - "Unlock keeps the draft" (`unlock` sends one `POST /api/session` without `X-Staff-Id`, and a `holdUnsaved` hold survives it);
      - "Session ends while working" (a 401 on a save calls `expired()`, which locks, and nothing is retried).
    - [web/staff] Switch user: "Switch user discards after confirm" (`hasUnsaved`), "Nothing unsaved".
  - Implement:
    - `lib/session.ts` (`expired()` ignores `/api/session` and locks only when signed in; `meniscus.locked` holds `{ username, name, role }`), `lib/idle.ts` and `lib/unsaved.ts`;
    - `lib/staff.ts`: the signed-in `Staff`, `ROLE_AVATAR`, `LANDING`, `landingPath`, `canDecide`, `decisionNotice` and `demoGroups`;
    - `lib/api.ts`: `X-Staff-Id` on every non-GET except to `/api/session`, the 401 hook, and `session`, `signIn` and `signOut`;
    - `lib/poll.ts`: `createPoll({ ms, paused, visible, tick })`, used by `lib/use-resource.ts`, which gains `paused` and `set(data)`.
- [x] 3.2 Ward library.
  - Write the failing tests in `apps/web/src/lib/rota.test.ts`, `lib.test.ts` and `resolve.test.ts`. Request scenarios go through `createApi` with a fake fetch and assert the exact requests:
    - [web/ward] Hospital ward list: "Busy ward" (`lib.test.ts:288`) and "Quiet ward" (`:299`), rewritten in place for the in-charge line.
    - [web/ward] Ward dashboard per ward: "Open ward 5B" (`lib.test.ts:309`, rewritten from 1 request to 2), through `wardLoads`: admissions and team, then admissions alone on refresh.
    - [web/ward] Resolve from the bed review: "Attendant adds a missed drink".
    - [web/ward] Your wards first: "Grace on shift", "Outside the team", "Matron's wards".
    - [web/ward] Nurse in charge on the ward: "In charge on 3A", "Take charge", "Who sees Take charge", "Shift changes while open", "Nobody in charge".
    - [web/ward] My beds: "Divya's beds", "In charge keeps prompts", "No beds, no filter", "Shift ends while open".
    - [web/ward] Assign beds from the dashboard: "Nikhil moves bed 2", "Who sees the pickers".
    - [web/ward] Decisions need a nurse: "Attendant on the bed review", "Nurse or matron", through `canDecide` and `decisionNotice`. The call sites are checked in 3.3.
    - [web/ward] Reason to open another ward:
      - "Reason before HDU opens": `needsReason`, `reasonBody`, and `grantAccess` sending exactly one `POST /api/wards/4/access` with the reason, the password and `X-Staff-Id: 5`;
      - "Wrong password at the reason": a 401 `invalid_credentials` keeps no grant;
      - "Bed review by direct link": `needsReason` for the bed's ward, and a paused `createPoll` sends nothing over a fake minute;
      - "Asked once a shift": grants keyed by staff, ward and shift start;
      - "Cancel stays put": no grant, no request, and `cancelTo`;
      - "Own ward or matron".
  - Implement:
    - `lib/rota.ts` (design.md);
    - `lib/ward.ts`: `wardLoads`;
    - `lib/api.ts`: `team`, `setInCharge`, `assignBeds`, `recordAccess`, and `errorText` for `forbidden`;
    - `lib/resolve.ts`: the `approve` option;
    - `lib/timeline.ts`: role labels.
- [x] 3.3 Screens:
  - **Root and app shell:** `SessionGate` with `components/sign-in.tsx` and `components/lock.tsx`; "Switch user" in the header, with the unsaved-work confirm; the idle timer. Remove the `beforeLoad` redirect in `routes/index.tsx:4`; `SessionGate` sends `/` to `landingPath` once signed in. The capture screen, meal form and ward round register unsaved work.
  - **Avatars:** `components/staff-picker.tsx:49` uses `ROLE_AVATAR`. `components/staff-dialog.tsx` (its `role === 'nurse'` at `:70`) is removed with the dialog.
  - **Ward list (`/n`):** "Your wards" and "Other wards", and the in-charge line on each card.
  - **Access gate:** new `components/access-gate.tsx` (reason and password; "Cancel" follows `cancelTo`), around the ward dashboard body (both loaders inside it), and around the whole bed review tree once its first load returns. The bed review passes no poll interval while gated. The printable chart is not gated.
  - **Ward dashboard (`/n/w/$ward`):**
    - `wardLoads`, with the team loaded with no poll interval;
    - the in-charge line (lucide `UserIcon`) and "Take charge"; no team list;
    - each bed's nurse, the nurse pickers, "My beds", and the outside-team notice.
  - **Bed review:** the outside-team notice (same text as the dashboard) once open; gate every decision call site by `canDecide`:
    - `components/entry-details.tsx:76` (approve), and its "Reject…" and "Amend" buttons (`:123`, `:131`);
    - `components/resolve.tsx:87` (reject), `:150` (amend), `:229` (missed entry: `approve` false for attendants, and its wording) and `:311` (meal void);
    - `components/meals.tsx:75` (the "Void…" button);
    - `routes/n/$id.tsx:203` (batch approval), `:225` (approve) and `:357` ("Reject…"). The `:213` "Pick who's on shift" notice becomes the decision notice.

  Verify in the browser at 390 and 1100 px, through the Vite proxy, checking that `meniscus_session` is set and sent:
  - sign in as Ravi Kumar, Grace Lee, Nikhil Bose and Lakshmi Iyer from the demo panel;
  - with the keyboard only and a screen reader, at 390 px only: sign in, unlock and the reason dialog;
  - `/` lands on `/a` for Ravi Kumar and on `/n` for the others;
  - a deep link to `/a/bed/<token>` shows the sign-in screen in place of the bed, then that bed's capture screen, still at `/a/bed/<token>`;
  - idle for 5 minutes: the lock covers the draft; unlock and the draft is on screen, unsaved;
  - unlock after the session has ended (sign out from another tab, or wait past 30 minutes): it signs in afresh and the draft is still there;
  - a save that gets 401 shows the lock over the draft;
  - "Switch user" with unsaved round readings;
  - as Ravi Kumar, none of the call sites above shows a button;
  - as Grace Lee: opening Renal HDU from `/n` asks for a reason and password, and "Cancel" returns to `/n`; a wrong password shows `Wrong password`; the right one opens it; a second visit does not ask; a direct link to an HDU bed shows only the dialog, with no patient name, MRN or weight;
  - as Nikhil Bose, "My beds" and the nurse pickers on HDU.

  In the network panel:
  - the dashboard sends nothing before the reason, then one POST and two GETs;
  - nothing refreshes while locked;
  - no model requests.

## 4. Docs and verification

- [x] 4.1 README:
  - **"Who works where":** roles, ward teams, the nurse in charge, bed assignment, nurse-only decisions and break-the-glass. Say where Indian practice differs, and that `SHIFTS` and `DECIDER_ROLES` are the config items.
  - **"Access and audit":** the 45 CFR 164.312 mapping from the proposal, worded "designed along", never "compliant". Right beside it, state plainly:
    - the demo credentials are lowercase first names, guessable by design and refused in production unless `MENISCUS_DEMO_LOGIN=1`;
    - the session is verified on the server and roles come from it;
    - the device token (`MENISCUS_API_TOKEN`) stays the outer boundary;
    - access records are stored for review and shown nowhere in the app yet; the printable chart is not gated;
    - OIDC single sign-on and badge tap are future work that changes only `verifyCredentials` and the sign-in screen.

    Cite:
    - 45 CFR 164.312: https://www.govinfo.gov/content/pkg/CFR-2024-title45-vol2/xml/CFR-2024-title45-vol2-sec164-312.xml
    - Break-the-glass with a reason and password (Epic): https://epicsupport.sites.uiowa.edu/epic-resources/break-glass
    - NHS Summary Care Record emergency access, explained and audited by each organisation's privacy officer: https://digital.nhs.uk/services/summary-care-records-scr/information-governance-for-scr
    - Fluid charting delegated to non-registered staff with registered-nurse oversight, at one NHS trust (say so): https://wwl.nhs.uk/media/FOI/202425/November%202024/10227%20-%20Staffing%20Levels.pdf
    - Badge tap and fast user switching as the future step: https://www.imprivata.com/sites/imprivata/files/2026-05/7042-2026_EAM-DS-fast-user-switching.pdf
    - NHS CIS2 is OIDC, so OIDC is the future single sign-on: https://digital.nhs.uk/services/care-identity-service/applications-and-services/cis2-authentication

    Label the 5-minute idle time "HHS Security Series example, secondary source", with no URL. Check that every cited URL resolves: one `curl -sIL` per URL, by hand, no loop or retry.
  - **"Production-like"** (`README.md:128`): the server command gains `MENISCUS_DEMO_LOGIN=1`. Warn that over plain HTTP on a LAN address the browser drops the `Secure` cookie, so sign-in fails; use `localhost` or HTTPS.
  - **Demo notes:**
    - sign in from "Demo accounts";
    - after 08:00 or 20:00, take charge and assign beds;
    - as Grace Lee, open Renal HDU to show break-the-glass;
    - leave the device for 5 minutes to show the lock.
  - **API list:** the session, team, in-charge, assignment and access endpoints, and the test count.
- [x] 4.2 Record each route's gzipped size from `pnpm --filter @meniscus/web build` in one line of the PR description. No bundle work.
- [x] 4.3 `pnpm verify` passes (format, lint, typecheck, tests, specs, traces).
- [ ] 4.4 After `openspec archive ward-staffing --yes`, the user updates the `web/staff` Purpose by hand (agents cannot write `openspec/specs/**`): it still says the user picks themselves from the roster and that this is not authentication. Suggested text: "Who is using the app on this device. Staff sign in with a username and password, the app locks when left idle, and every chart change is attributed to the signed-in person."
