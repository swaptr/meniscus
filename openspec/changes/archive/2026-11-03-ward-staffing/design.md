# Design

## Context

Motivation is in proposal.md, under "Why". The relevant state today:

- **Roster.** The roster is flat: `staff (id, name, role CHECK (role IN ('attendant', 'nurse')))`, written out by hand in `SCHEMA` (`apps/server/src/store/store.ts`). `seedStaff` inserts `DEMO_STAFF` only when the table is empty.
- **Identity.** None. `staffHeader` (`apps/server/src/routes/common.ts`) trusts `X-Staff-Id`, checks it is on the roster (else 400 `invalid_request`) and sets `staffId` or null. Requests without it are stored as "staff not recorded", which also gets around any role rule.
- **Device token.** `bearer` (`apps/server/src/security.ts`) runs on every `/api/*` route except `/api/health` when `MENISCUS_API_TOKEN` is set; the dev and preview proxy adds it (`apps/web/vite.config.ts`). The per-client rate limit covers `/api/ai/*` only.
- **Error bodies.** Chart routes answer `{ error }` or `{ error, issues }`; `/ai` routes `{ error, message, retryable }`. The web's `ApiError` reads `error` and an optional `message`, and `errorText` (`apps/web/src/lib/api.ts`) maps known codes to staff-facing text.
- **Opening the store.** `openStore` runs: PRAGMAs → `migrate` → `SCHEMA` → `migrateMedia` → `seedStaff` → `seed` → `backfill` → prepare statements → `expireMedia`.
- **Old-store fixtures.**
  - No `staff` table: "Pre-history entry" (`apps/server/src/audit.test.ts:171`) and "Pre-ward stores: Legacy file" (`apps/server/src/chart.test.ts:199`).
  - An empty `staff` table with the old CHECK, opened twice: "Stored photos become media: Older store" (`apps/server/src/media.test.ts:303`).
- **Logging.** The server logs nothing per request. `app.ts` logs mapped `/ai` errors and, for unhandled errors, the name and stack frames only.
- **Device state.** `lib/staff.ts` keeps `{ id, name, role }` in localStorage. `StaffPicker` and `StaffDialog` pick from `GET /api/staff`. Avatars compare `role === 'nurse'` (`components/staff-picker.tsx:49`, `components/staff-dialog.tsx:70`).
- **Screens.**
  - `routes/n/w.$ward.tsx` loads only `GET /api/admissions?ward=` and takes the ward name from `beds[0]`.
  - `routes/n/$id.tsx` loads entries and meals in one resource polled every 30 s (`:48-55`). The patient banner (name, MRN, weight) is at `:119-127`.
  - `routes/n/$id_.print.tsx` makes one load.
  - `/` redirects to `/a` in a `beforeLoad` (`apps/web/src/routes/index.tsx:4`), which runs before any component renders, so a gate in the root cannot hold it.
- **Shifts.** `apps/web/src/lib/history.ts` has the DST-safe `shiftStart(ms) → { start, night }` and `shiftLabel` ("Day 08:00–20:00").
- **Clock.** The store takes a `now` clock, and the shift tests use local-time clocks (`new Date(2026, 10, 2, 9)`).
- **Names.** `HOSPITAL_NAME` lives in `store/demo-hospital.ts`. The new staff names (Nikhil Bose, Divya Kapoor, Rekha Gupta) share no first name with a demo patient.

## Types (`packages/shared`)

```ts
export const STAFF_ROLES = ['attendant', 'nurse', 'matron'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

// ── Config surface. Shared constants are the hackathon's configuration (no env, no UI); changing one
// ── is a code change reviewed like any other. MENISCUS_DEMO_LOGIN is the only new env var.

// Role policy: the only place roles are tied to permissions.
// Config item: whether a new role (e.g. nursing associates) may sign off is only its membership of
// DECIDER_ROLES, after adding it to STAFF_ROLES.
/** May approve, reject, amend and void, and name a nurse in charge of a ward they are on. */
export const DECIDER_ROLES: readonly StaffRole[] = ['nurse', 'matron']
/** May be named nurse in charge or assigned beds; listed first in a ward team. */
export const IN_CHARGE_ROLES: readonly StaffRole[] = ['nurse']
/** Their wards are the wards they oversee: not in a ward team; assign beds there. */
export const OVERSEER_ROLES: readonly StaffRole[] = ['matron']

/** Shift pattern, local time, sorted by start. Default 2 × 12 h; e.g. 3 × 8 h is three entries. */
export interface ShiftDef {
  name: string
  /** "HH:MM" */
  start: string
}
export const SHIFTS: readonly ShiftDef[] = [
  { name: 'day', start: '08:00' },
  { name: 'night', start: '20:00' },
]
/** The shift containing `ms`: its local start, the next shift's start, and its name. DST-safe. */
export function shiftStart(ms: number, shifts?: readonly ShiftDef[]): { start: number; end: number; name: string }

/** Client: lock the screen after this long with no input. */
export const IDLE_LOCK_MS = 5 * 60_000
/** Server: a session ends this long after its last request (and always at the end of its shift). */
export const SESSION_IDLE_MS = 30 * 60_000

/** Who did something: on entries, events, meals, quality rows, in_charge and access records. */
export interface StaffRef {
  id: number
  name: string
  role: StaffRole
}
export interface WardRef {
  id: number
  code: string
}
/** A roster member (GET /api/staff, and the signed-in person). Never carries a username or password hash. */
export interface Staff extends StaffRef {
  /** Home ward first, then cover wards. An overseer's are the wards they oversee (no home ward). */
  wards: WardRef[]
}

export interface WardSummary extends Ward {
  // …existing fields
  in_charge: StaffRef | null
}

export interface TeamMember extends StaffRef {
  home: boolean
}
export interface BedAssignment {
  admission_id: number
  staff_id: number
}
/** GET /api/wards/:id/team, and the response of both PUTs below. */
export interface WardTeam {
  ward_id: number
  /** Start of the shift `in_charge` and `assignments` belong to (ISO). */
  shift_start: string
  in_charge: StaffRef | null
  team: TeamMember[]
  assignments: BedAssignment[]
}
export interface InChargeInput {
  staff_id: number
}
/** Replaces the ward's assignments for the current shift. */
export interface AssignBedsInput {
  beds: BedAssignment[]
}

/** Break-the-glass: someone opened a ward outside their wards. */
export interface WardAccess {
  id: number
  ward_id: number
  created_by: StaffRef
  /** Staff-written, trimmed, 1–200 characters. Stored, never logged. */
  reason: string
  created_at: string
}
/** The password is checked, never stored or logged. */
export interface WardAccessInput {
  reason: string
  password: string
}

export interface SessionInput {
  username: string
  password: string
}
/** 201 of POST /api/session; 200 of GET /api/session. */
export interface SessionInfo {
  staff: Staff
}
export interface DemoAccount {
  username: string
  name: string
  role: StaffRole
  /** Home ward code; null for an overseer. */
  ward: string | null
}
/** 401 body of GET /api/session. Other 401 `sign_in_required` bodies are `{ error }` only. */
export interface SignInRequired {
  error: 'sign_in_required'
  hospital: string
  /** Empty unless demo sign-in is on. */
  demo_accounts: DemoAccount[]
}
```

`packages/shared` already exports runtime values (`STAFF_ROLES` and other constant lists). `shiftStart` is its first function; it is pure and has no dependencies, so the import boundaries still hold.

## Decisions

**Role policy.** Every role decision reads `DECIDER_ROLES`, `IN_CHARGE_ROLES` or `OVERSEER_ROLES`, or an exhaustive `Record<StaffRole, …>`:

| Rule | Reads | Where |
|---|---|---|
| Approve, reject, amend, void | `DECIDER_ROLES` | server `requireDecider`; web `canDecide` |
| Who may name a nurse in charge | `DECIDER_ROLES` + a `staff_ward` row for the ward | in-charge route |
| Who can be named, assigned beds, sees "Take charge" | `IN_CHARGE_ROLES` + a `staff_ward` row | in-charge and assignment routes; web `canTakeCharge`, `myBeds` |
| Who assigns beds | the ward's current `in_charge`, or `OVERSEER_ROLES` + a `staff_ward` row | assignment route; web `canAssign` |
| Team order and exclusion | `IN_CHARGE_ROLES` first, `OVERSEER_ROLES` dropped | `orderTeam` |
| Landing page, avatar style, labels | `LANDING`, `ROLE_AVATAR`, `ROLE_LABEL` (`Record<StaffRole, …>`) | web |

The staff CHECK is generated from `STAFF_ROLES`. No code compares a role to a string literal: the two avatar comparisons become `ROLE_AVATAR[role]`, and the compiler flags any new role missing from the exhaustive maps.

**Sign-in and sessions (server).** Identification and authentication on a shared ward device, with the device token (`MENISCUS_API_TOKEN`) still the outer boundary.
- New `apps/server/src/auth.ts` (`node:crypto` only):
  - `verifyCredentials(store, username, password, { demoLogin }) → Promise<StaffRef | null>` is the one credential check, used by sign-in, unlock and break-the-glass. OIDC (hospital single sign-on, e.g. NHS CIS2) or a badge tap would replace only this function and the sign-in screen.
  - Passwords are scrypt hashes encoded `scrypt$N=32768,r=8,p=1$<salt>$<hash>` (16-byte random salt per user, 32-byte key, base64url, `maxmem` 64 MiB), compared with `timingSafeEqual`. The parameters live in the hash, so raising them later only affects new hashes.
  - An unknown username, a staff member with no hash, or a stored hash that does not parse (wrong prefix, parameters, or salt or key length) is checked against a fixed dummy hash, so it costs the same time and gets the same `null`. A malformed hash is a 401, never a 500: `timingSafeEqual` throws on unequal lengths, so lengths are checked before it is called.
  - With `demoLogin` off, a staff member whose stored hash is still their entry in `DEMO_PASSWORD_HASHES` gets `null` after the scrypt check has run, so a refused demo password takes the same time as a wrong one.
  - `newToken()` is 32 random bytes in base64url (43 characters); the store keeps only `sha256(token)`.
- Demo credentials: `DEMO_STAFF` gains `username` (lowercase first name). `DEMO_PASSWORD_HASHES` holds one scrypt hash per demo staff member of their lowercase first name, each with its own random salt, generated once by `apps/server/scripts/demo-passwords.ts` and committed. Seeding copies them, so opening a store costs no scrypt work (10 hashes per test store would add about half a second each). A test checks every committed hash against its first name.
- `apps/server/src/routes/session.ts`:
  - `POST /session`: `smallJson()` → zod `{ username: string 1–64, password: string 1–200 }` → `verifyCredentials` → delete the session of any presented cookie (rotation on sign-in and unlock) → insert a session → 201 `{ staff }` and `setCookie(c, 'meniscus_session', token, { httpOnly: true, sameSite: 'Strict', path: '/api', secure })`. A failure is 401 `{ error: 'invalid_credentials' }`, with no cookie.
  - `GET /session`: 200 `{ staff }`, or 401 `{ error: 'sign_in_required', hospital: HOSPITAL_NAME, demo_accounts }`; `demo_accounts` comes from `DEMO_STAFF` only when `demoLogin` is on.
  - `DELETE /session`: idempotent and needs no session. It deletes the row of any presented cookie, live or not, calls `deleteCookie(c, 'meniscus_session', { path: '/api', secure })` (`Max-Age=0`) and returns 204, also with no cookie.
  - No log line in any of them. zod issues carry paths and messages, never values.
- `session(store)` middleware (`routes/common.ts`, replacing the per-route `staffHeader`) runs on every `/api/*` route except `/api/health`. It reads time only from `store.now()`, the clock the shift and expiry rules use; `createApp`'s `now` stays the rate limiter's.
  1. It reads `meniscus_session`, looks the hash up, and sets `staff: Staff | null` and `staffId` (GETs too, so reads keep a session alive).
  2. On `/api/session`, any method, it stops there. Those routes ignore `X-Staff-Id`, so a stale header or an ended cookie never blocks signing in again or signing out.
  3. Any other non-GET with no live session: 401 `{ error: 'sign_in_required' }`.
  4. A non-GET with a live session and an `X-Staff-Id`: malformed or not on the roster → the existing 400 `invalid_request` body; any id other than `staff.id` → 401 `sign_in_required`. GETs never look at the header, so this rule refuses no GET.

  The web sends `X-Staff-Id` on every non-GET except to `/api/session`; the server never takes identity from it.
- `app.ts` order: `headers` → (except `/api/health`) `noStore`, `bearer`, `session` → `rateLimit` on `/ai/*`, and a second `rateLimit` instance (same per-minute number, own bucket) on `POST /session` and `POST /wards/:id/access` → routes. No account lockout, which would lock staff out mid-shift.
- Expiry: `expires_at = shiftStart(created_at).end`; a lookup with `expires_at <= now` or `last_seen_at + SESSION_IDLE_MS <= now` deletes the row and returns null; a live lookup sets `last_seen_at = now`. `openStore` runs one `DELETE` of ended sessions. No timers or polling.
- Config (`apps/server/src/config.ts`): `MENISCUS_DEMO_LOGIN: z.stringbool().default(false)`, also in `.env.example`. `createApp` takes `demoLogin` (`NODE_ENV !== 'production' || MENISCUS_DEMO_LOGIN`) and `secureCookie` (`NODE_ENV === 'production'`); tests default to `demoLogin: true`, `secureCookie: false`.
- Test convention: a spec scenario that says "with `X-Staff-Id: n`" or "signed in as n" runs in a session of staff `n`, which the test helper creates.
- Test harness (`apps/server/src/testing.ts`):
  - `signIn(store, staffId)` inserts a session row through the store at `store.now()` and returns the `Cookie` header.
  - `testApp(options)` opens a `:memory:` store unless one is given, builds `createApp`, and returns `{ app, store, request }`. `request` adds a cookie to every non-GET that has none, from a session created at that moment on the store's clock, so tests that move the clock (`audit.test.ts:120`, an hour; "One of each", 31 Oct to 2 Nov) never send an ended session. The default is staff 4 (Anita Thomas, nurse). Given `staff: n`, it signs in `n` and sends `X-Staff-Id: n`; when `n` is not on the roster (999, `abc`), it signs in staff 4 and still sends the header, so those requests keep their 400. A test that sends its own cookie, or `cookie: null`, gets exactly that.
  - Every test file builds its app through `testApp`, including those that call `createApp` without a store today: `ai/ai.test.ts` (7 calls, `:165` to `:253`), `security.test.ts` (`:16`, `:115`), `meal-reading.test.ts:75` and `chart.test.ts:440`.

**Store (`apps/server/src/store`).** The store stays role-free: no query or check names a role.
- `staff`: `staffDdl(table)` builds `CREATE TABLE IF NOT EXISTS <table> (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN (<STAFF_ROLES quoted>)), username TEXT UNIQUE, password_hash TEXT) STRICT`. `SCHEMA` uses `staffDdl('staff')`.
- `staff_ward`:
  - Columns `(staff_id INTEGER NOT NULL REFERENCES staff(id), ward_id INTEGER NOT NULL REFERENCES ward(id), rank INTEGER NOT NULL)`, `PRIMARY KEY (staff_id, ward_id)`, `UNIQUE (staff_id, rank)`, plus `INDEX staff_ward_ward ON staff_ward(ward_id)`. STRICT.
  - Rank 0 is the home ward; higher ranks are cover wards. A matron's ranks follow ward code order and mean nothing more.
- `ward_shift`: `(ward_id REFERENCES ward(id), shift_start INTEGER, staff_id REFERENCES staff(id), set_by REFERENCES staff(id), set_at INTEGER)`, `PRIMARY KEY (ward_id, shift_start)`, `UNIQUE (staff_id, shift_start)`. STRICT.
- `bed_assignment`: `(ward_id REFERENCES ward(id), shift_start INTEGER, admission_id REFERENCES admission(id), staff_id REFERENCES staff(id), set_by REFERENCES staff(id), set_at INTEGER)`, `PRIMARY KEY (ward_id, shift_start, admission_id)`. STRICT. Old shifts stay; the current shift is found by key, so a new shift starts unassigned.
- `ward_access`: `(id INTEGER PRIMARY KEY, ward_id REFERENCES ward(id), staff_id REFERENCES staff(id), reason TEXT CHECK (length(reason) BETWEEN 1 AND 200), created_at INTEGER)`, plus `INDEX ward_access_ward ON ward_access(ward_id, created_at)`. STRICT, append-only.
- `session`: `(token_hash TEXT PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`. STRICT.
- All columns above are `NOT NULL` except `set_by`.
- The store computes every current `shift_start` with `shiftStart(now())` and the default `SHIFTS`; `openStore` gains no option. The three-shift scenario tests `shiftStart` directly.
- Queries:
  - `staff()` returns `Staff[]`: `id, name, role` and `wards`, joining `staff_ward` and `ward` ordered by rank. It never selects `username` or `password_hash`.
  - `credentials(username)` returns `{ staff: StaffRef, password_hash }`; only `auth.ts` calls it.
  - `wards()` adds `in_charge` with a LEFT JOIN on `ward_shift` for the current `shift_start`.
  - `team(wardId)` returns `WardTeam | undefined` (undefined for an unknown ward), with every `staff_ward` member ordered `rank > 0, id`, no role filter, and the current shift's assignments.
  - `setInCharge(wardId, staffId, setBy)`: one transaction that deletes `staffId`'s row for this `shift_start` on any other ward ("one ward per shift"), then upserts the ward's row.
  - `assignBeds(wardId, beds, setBy)`: one transaction that deletes the ward's rows for this `shift_start` and inserts `beds`.
  - `recordAccess(wardId, staffId, reason)`. Nothing reads the records back in this change; tests read the table directly.
  - `createSession`, `sessionStaff(tokenHash)` (with the expiry rule above), `endSession(tokenHash)`.
  - Callers check roles, teams and wards first.

**Opening the store (`openStore`).** The full order:
1. PRAGMAs (`foreign_keys = ON`, WAL, busy timeout).
2. `rebuildStaff` (below).
3. `migrate()`.
4. `SCHEMA`, now with the generated `staff` DDL, `staff_ward`, `ward_shift`, `bed_assignment`, `ward_access` and `session`.
5. `migrateMedia`.
6. `seedStaff`: `INSERT … ON CONFLICT(id) DO NOTHING` for every `DEMO_STAFF` row (so a store that already has someone else at ids 7–10 still opens), then `UPDATE OR IGNORE staff SET username = ?, password_hash = ? WHERE id = ? AND name = ? AND password_hash IS NULL` for each demo member.
7. `seed`: creates the demo hospital on a fresh store, and only then names `DEMO_IN_CHARGE` and inserts `DEMO_ASSIGNMENTS` for the current shift.
8. `seedTeams`: inserts `DEMO_TEAMS` rows for the demo ward codes present, only when `staff_ward` is empty, so a store is never re-teamed.
9. `backfill`.
10. Prepare statements.
11. `expireMedia`, then delete ended sessions.

`rebuildStaff` is its own step before `migrate()`, so it does not depend on `migrate()`'s pre-ward branch, which returns early for a pre-ward file with no admissions.
- It returns `false` and does nothing when there is no `staff` table (a new store, or the two fixtures without one) or when the stored `sqlite_master.sql` for `staff` equals `staffDdl('staff')` after both are normalised (whitespace collapsed, `IF NOT EXISTS` and a trailing `;` dropped, the table name unquoted). SQLite stores the CREATE text without `IF NOT EXISTS`, and the rename below stores the name as `"staff"`, so a raw compare would rebuild on every open.
- Otherwise it rebuilds and returns `true`, so any later change to `STAFF_ROLES` or the columns rebuilds again:
  1. `PRAGMA foreign_keys = OFF`, outside any transaction, because it is a no-op inside one.
  2. In a `try`:
     1. `BEGIN`;
     2. create `staffDdl('staff_new')`, and copy `id, name, role` (plus `username, password_hash` when the old table has them);
     3. drop `staff`, and rename `staff_new` to `staff`;
     4. run `PRAGMA foreign_key_check`, and throw if any returned row's parent is `staff` (rows pointing at other tables were there before and are not this rebuild's to judge);
     5. `COMMIT`.
  3. On any error, `ROLLBACK` and rethrow. A stored role missing from `STAFF_ROLES` fails the CHECK here, and the file is left as it was.
  4. `PRAGMA foreign_keys = ON`, in a `finally`.

Ids are kept, so `created_by`, `reviewed_by`, `voided_by`, event staff and the new tables' staff ids still resolve. The "Opened again" test asserts `PRAGMA schema_version` is unchanged by a second open: a second rebuild would leave `sqlite_master.sql` identical but bump the version.

**Demo staffing (`store/demo-hospital.ts`).** `DEMO_STAFF` (typed `(StaffRef & { username: string })[]`) keeps ids 1–6 and adds 7 Nikhil Bose (nurse), 8 Divya Kapoor (nurse), 9 Rekha Gupta (attendant) and 10 Lakshmi Iyer (matron). `DEMO_TEAMS`, in rank order:

| Staff | Wards (home first) |
|---|---|
| 1 Ravi Kumar | 3A, 2C |
| 2 Sunita Devi | 3A |
| 3 Mohan Das | 5B, 2C |
| 4 Anita Thomas | 3A, 5B |
| 5 Grace Lee | 5B, 3A |
| 6 Meera Pillai | 2C, 3A |
| 7 Nikhil Bose | HDU |
| 8 Divya Kapoor | HDU |
| 9 Rekha Gupta | 2C |
| 10 Lakshmi Iyer | 2C, 3A, 5B, HDU |

- `DEMO_IN_CHARGE`: 2C → 6, 3A → 4, 5B → 5, HDU → 7.
- `DEMO_ASSIGNMENTS`, for the shift current at seeding: every occupied 2C bed → 6, 3A → 4, 5B → 5; HDU beds 1 and 2 → 7 and bed 3 → 8. HDU is one nurse to two patients on the demo shift; there is no duty roster, so other shifts depend on who signs in.

**Routes (`apps/server/src/routes`).**
- `routes/common.ts`: `session` (above), `smallJson` (moved from `routes/chart.ts:129`, the 16 KB `bodyLimit`, so `routes/session.ts` uses it too), `requireDecider` (a `staff` whose role is not in `DECIDER_ROLES` gets 403 `{ error: 'forbidden' }`), and `forbidden = { error: 'forbidden' } as const` next to `notFound`. The 403 reuses the `{ error }` shape.
- Decisions: `POST /entries/:id/review`, `POST /entries/:id/amend` and `POST /meals/:id/void` chain `requireDecider → smallJson() → validate → handler`, after the app-level `session`. The role check comes before the body and the target, so an attendant gets 403 for entry 999 or a bad body and learns nothing about the entry. Nothing is written, so no event is recorded and no media is unlinked.
- The existing requirements Nurse review (`charting/entries`), Amend an approved entry (`charting/audit`) and Void a meal (`charting/meals`) keep their unconditional SHALLs and are not modified; `charting/staffing` "Decisions need a nurse" adds the 403 in front of them.
- `apps/server/src/chart/staffing.ts` (pure): `orderTeam(members)` drops `OVERSEER_ROLES` and stable-sorts `IN_CHARGE_ROLES` first, keeping the store's home-then-id order.
- New routes in `routes/chart.ts`, next to `/wards`. "After the sign-in checks" in the specs means after `bearer` (401 `unauthorized`), `session` (401 `sign_in_required`) and the `X-Staff-Id` checks (400, 401):
  - `GET /wards/:id/team`: 404 when `team()` is undefined; the team goes through `orderTeam`.
  - `PUT /wards/:id/in-charge`: unknown ward 404 → caller check 403 (role in `DECIDER_ROLES` and the ward in `staff.wards`: a nurse on the team, home or cover, or the matron who oversees it) → `smallJson()` and zod `{ staff_id: int positive }` → target check 400 (role in `IN_CHARGE_ROLES` and the ward in their `wards`) → `setInCharge` → 200.
  - `PUT /wards/:id/assignments`: unknown ward 404 → caller check 403 (`staff.id` is the ward's current `in_charge`, or role in `OVERSEER_ROLES` with the ward in `staff.wards`) → `smallJson()` and zod `{ beds: { admission_id, staff_id }[] }` (at most the ward's capacity) → 400 when an admission is not on the ward, an admission repeats, or a staff member fails the target check above → `assignBeds` → 200.
  - `POST /wards/:id/access`: unknown ward 404 → `smallJson()` and zod `{ reason: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) }` → `verifyCredentials` with the username of `staff` (401 `invalid_credentials` on failure) → `recordAccess` → 201. No team check: the web posts only for wards outside the person's wards, and a record for one's own ward is harmless.
- None of these routes logs; a test stubs `console.log`/`console.error` around sign-in, break-the-glass and the access POST and asserts no reason, password, token or hash appears.

**Demo history (`apps/server/scripts/demo-history.ts`).** It writes through the store, so it needs no session. Three rules, nothing more:
- no attendant approves, amends, rejects or voids anything;
- everyone who records, reviews or voids something has that ward in their `DEMO_TEAMS` wards;
- IV fluids are recorded by nurses.

The hard-coded staff that break these: the global `ATTENDANTS`, `NURSES` and `WARD_ROTA` (`:242-244`) with their uses (`:416`, `:456`), `EXTRA` HDU bed 1 (`:178`) and 2C bed 3 (`:180-195`), and the meal loop (`:506`, `:529`, `:533`). Only who did what changes; volumes, times and the 5B story stay. The script writes no access records or sessions.

**Web (`apps/web`).**
- Session and lock:
  - New `lib/session.ts`, `createSession({ api, storage, now })`. Its state is `checking`, `signed_out`, `signed_in` or `locked`, plus `staff` and the sign-in screen's `hospital` and `demo_accounts`. It provides:
    - `check()`: one `GET /api/session`;
    - `signIn(username, password)`;
    - `unlock(password)`: `signIn` with the locked person's username;
    - `lock()`;
    - `expired()`: called by `api.ts` on a 401 `sign_in_required` from any path other than `/api/session`. It locks only when the state is `signed_in`; in any other state it changes nothing. The `GET /api/session` check on opening goes to `signed_out`, never `locked`.
    - `switchUser()`: `DELETE /api/session` (always 204), then `signed_out`. A network error also signs out locally. When the page opened signed in (no hospital or demo accounts yet), one `GET /api/session` follows for the sign-in screen.
    - Signing in as someone other than the locked or previous person clears unsaved work, and `SessionGate` keys the screen by staff id, so nothing carries over to them.
  - "Recent on this device": localStorage `meniscus.recent`, up to 4 `{ username, name, role }`, newest first, updated on each sign-in. Never a password or token; the cookie is `HttpOnly`. The lock takes its username from here.
  - The lock persists as localStorage `meniscus.locked`, `{ username, name, role }`, so a reload with a live session stays locked and the lock can show its line and unlock without `meniscus.recent`. If the opening `GET /api/session` returns 401, the app goes to `signed_out` and clears `meniscus.locked` ("Stale choice"). Signing in or switching user clears it too.
  - New `lib/idle.ts`, `createIdleTimer({ ms: IDLE_LOCK_MS, now, onIdle })`: reset on `pointerdown`, `keydown`, `wheel` and `touchstart`. It ignores work in flight: the lock can come at any time, because unlocking resumes everything.
  - New `lib/unsaved.ts`: `holdUnsaved()` returns a release, and `hasUnsaved()`. The capture draft, the meal form and the ward round hold while they have unsaved work. Only "Switch user" consults it.
  - `use-resource.ts` gains `paused` (true while locked: no polls) and `set(data)`. Its polling moves into a pure `lib/poll.ts`, `createPoll({ ms, paused, visible, tick })`, which `useResource` wraps; the tests drive `createPoll` with a fake clock, since the web tests run no React hooks.
- `lib/api.ts`:
  - Every non-GET except to `/api/session` sends `X-Staff-Id` (the `staff` flag follows the method, so `/ai/*` calls send it too). Reads send none. Requests are same-origin, so the cookie goes with them; the Vite dev and preview proxy passes `Cookie` and `Set-Cookie` through, and `Path=/api` matches.
  - A 401 `sign_in_required` calls `session.expired()` and throws. Nothing is retried; `/api/ai/*` is never re-sent.
  - New calls: `session`, `signIn`, `signOut`, `team`, `setInCharge` (PUT), `assignBeds` (PUT) and `recordAccess`. The `change` helper (the same as `post`) goes.
  - `errorText` maps `forbidden` to `Not allowed for your role on this ward. Ask the nurse in charge.`
- `lib/staff.ts`:
  - It holds the signed-in `Staff`, no longer a localStorage choice. `StaffPicker`'s roster check and `StaffDialog` are removed; the header shows the name, role and "Switch user".
  - `ROLE_LABEL` gains `matron: 'Matron'`.
  - `ROLE_AVATAR: Record<StaffRole, style>` replaces the `role === 'nurse'` comparisons.
  - `LANDING: Record<StaffRole, '/a' | '/n'>`, and `landingPath(path, staff)`: the path asked for, or `LANDING[staff.role]` when it is `/`.
  - `canDecide(staff)`: role in `DECIDER_ROLES`.
  - `decisionNotice(staff)` returns the attendant text or null.
  - `demoGroups(accounts)` groups demo accounts by home ward, the overseer last.
- `lib/history.ts`: `Shift.night` becomes `Shift.name`. `shiftLabel` builds `<Name> <start>–<end>` from `SHIFTS`, still "Day 08:00–20:00" by default, so the live "Intake and output log by shift" requirement is unchanged.
- `lib/timeline.ts`: uses `ROLE_LABEL`, which now has `matron`.
- `lib/ward.ts`: `wardLoads(api, wardId)` returns `{ beds(signal), team(signal) }`, the dashboard's two loaders. The route polls `beds` and loads `team` once, so the "Open ward 5B" test runs the real loaders.
- New `lib/rota.ts`:
  - `splitWards(wards, staff)`: `{ yours, others }`.
  - `inChargeLine(ward)` for the ward cards.
  - `outsideTeam(wardId, wardName, staff)`: the notice or null.
  - `inChargeText(team, now)`: `In charge: <short name> · <shiftStart(now).name> shift`, or `No nurse in charge this shift` once `shiftStart(now)` is past `team.shift_start`.
  - `canTakeCharge(team, staff, now)` and `takeCharge(api, wardId, staffId)`.
  - `assignmentsNow(team, now)`: empty after the team's shift.
  - `bedNurse(team, admissionId, now)`: `Nurse: <short name>` or `Unassigned`.
  - `myBeds(beds, team, staff, now)`: `null` when the person has no beds there this shift; otherwise their beds, plus the beds with prompts when they are the nurse in charge.
  - `canAssign(team, staff, now)`, and `assignBed(api, team, admissionId, staffId | null)`, which sends every bed's assignment with the one change.
  - Break-the-glass:
    - `accessGrants(storage)`: localStorage `meniscus.access`, a list of `{ staff_id, ward_id, shift_start }`. Grants from earlier shifts are dropped on each write.
    - `needsReason(wardId, staff, now, grants)`: true when the ward is not in `staff.wards` and there is no grant for `(staff.id, wardId, shiftStart(now).start)`. The staff id is in the key, so a second person on the same device is asked for their own reason.
    - `reasonBody(reason, password)`: `{ reason, password }` with the reason trimmed, or null when either is blank or the reason is over 200 characters.
    - `grantAccess(api, wardId, staffId, input, now, grants)`: one `recordAccess`, then the grant is saved. A 401 `invalid_credentials` saves nothing and returns `Wrong password`.
    - `cancelTo(canGoBack)`: `'back'` when there is a page to go back to, else `'/n'`.
- `lib/resolve.ts`: `addMissedEntry(api, admissionId, draft, iso, { approve })` makes one request when `approve` is false.
- Components:
  - New `components/sign-in.tsx`, used in place of the routes and inside the lock. It has:
    - the hospital name and "Who's signing in?";
    - "Recent on this device";
    - labelled username and password inputs (`autocomplete="username"` and `current-password`);
    - "Sign in";
    - "Demo accounts" (`demoGroups`) with the hint, only when `demo_accounts` is not empty.

    Targets are at least 44 px. Errors are announced with `role="alert"`, and focus moves to the password after a recent or demo account is chosen.
  - New `components/lock.tsx`: an opaque cover with `Locked · <name> · <role>`, a password field, "Unlock" and "Switch user". The screen behind is `inert` and `aria-hidden`, and stays mounted, so drafts and round readings survive. A model read in flight completes into that state. It is a plain `role="dialog"` `aria-modal` portal (no dialog library in the first load) that makes the rest of the body inert and moves focus to its first field. `SignIn`, the Switch user confirm and the reason dialog load lazily.
  - "Switch user" (header and lock): when `hasUnsaved()`, a confirm dialog `<first name>'s unsaved draft will be discarded` with "Cancel"; then `switchUser()`.
  - New `components/access-gate.tsx`, `AccessGate({ wardId, children })`: while `needsReason`, it renders only the reason-and-password dialog, not its children. "Cancel" follows `cancelTo(useCanGoBack())`: `router.history.back()`, or navigate to `/n`.
- Screens:
  - **Root (`routes/__root.tsx`, `components/app-shell.tsx`):** a `SessionGate` shows a splash while checking, `SignIn` in place of `<Outlet />` when signed out (the URL is kept, so a deep link such as `/a/bed/$token` opens after sign-in), the routes when signed in, and the routes under `Lock` when locked. The `beforeLoad` redirect in `routes/index.tsx` goes; once signed in, `SessionGate` navigates (with `replace`) to `landingPath(location, staff)` when that differs.
  - **Ward list (`/n`):** `splitWards`, and `inChargeLine` on each card.
  - **Ward dashboard:**
    - The route body is wrapped in `AccessGate`, and both `wardLoads` loaders live inside it, so an ungranted ward fetches nothing.
    - The team loads with no poll interval, and `set(data)` applies the PUT responses.
    - A one-minute tick re-evaluates the in-charge line and the assignments, with no request.
    - The header shows the in-charge line (`UserIcon`) and the outside-team `Notice`. It does not list the team.
    - Each bed card shows `bedNurse`, plus a nurse picker when `canAssign`.
    - "My beds" is a toggle shown when `myBeds` is not null, on by default.
  - **Bed review:** its first load names the ward (`admission.ward_id`). Once it returns, the whole route tree, the patient banner included, is wrapped in `AccessGate`, and the bed review passes no poll interval to `useResource` while a reason is needed. Once open, the bed review shows the same `You are not on the <ward name> team…` notice as the dashboard.
  - **Printable chart:** not gated in this change (see Risks).
  - **Bed review, `EntryDetails`, `MealsSection` and `MissedEntryDialog`:** gated by `canDecide`. The bed review's pending section shows `decisionNotice`.

## Risks / Trade-offs

- [Demo credentials] → Demo usernames and passwords are the lowercase first name: guessable by design and only for the demo. Production refuses them unless `MENISCUS_DEMO_LOGIN=1`. There is no password change or reset, so a real deployment needs real credentials, or OIDC or a badge, behind `verifyCredentials`.
- [What the sign-in is] → It is identification and authentication of staff on a shared ward device. The session is verified on the server, and roles come from it, not from the client. The device token stays the outer boundary for every request. The plumbing would survive swapping in real passwords, OIDC or a badge; only the credential check and the sign-in screen change.
- [Lock versus server expiry] → The lock is client-side: anyone with the unlocked device's devtools could lift it. The server still ends the session 30 minutes after its last request and at the end of its shift. Polls pause while locked, so an idle device does not keep its session alive.
- [Unlock after the session ended] → Unlock always signs in afresh, so it works either way. Whoever unlocks owns what they then save; only the locked person's username is offered.
- [`Secure` cookie] → Production must be served over HTTPS, or from `localhost`, where browsers accept `Secure` cookies over HTTP.
- [Break-the-glass is client-enforced] → The server records the reason, after re-checking the password, but does not refuse reads of another ward; reads stay open with the device token. The records are stored for review outside the app (a database read); no screen or endpoint shows them in this change.
- [The printable chart is not gated] → Known gap. `/n/<id>/print` of another ward opens without a reason. The gate is client-side anyway, and the print view is read-only; gating it is a follow-up.
- [CSRF] → The bearer token is added by the dev and preview proxy, not by the page, so it gives no CSRF protection: a cross-site form post through the same proxy would carry it. The defence is the session cookie's `SameSite=Strict`, which a cross-site request does not carry, and the JSON bodies: a cross-site `application/json` POST or PUT needs a CORS preflight, which the server never grants. Multipart and other form-type posts are also refused by Hono's `csrf()` origin check (`security.ts` `sameSite()`, after the session check): they pass only with `Sec-Fetch-Site: same-origin` or an `Origin` that is the request's own or `http://localhost:5173`. A request with neither header is not a browser and skips that check; it still needs the device token and a session.
- [scrypt cost] → N = 2^15 (r 8, p 1) is below OWASP's 2^17 recommendation, chosen so a sign-in stays fast on a small demo server. Acceptable for the demo; the parameters are stored in each hash, so a real deployment can raise them for new hashes. A stored hash asking for more than N = 2^20, r = 16, p = 4 or 128 · N · r = 64 MiB counts as malformed (the dummy hash runs, then 401), so a bad row cannot ask for gigabytes.
- [Rate limit per socket address] → The limiter keys on the socket's remote address. Devices behind one reverse proxy or NAT share one bucket, so a busy ward could hit the sign-in limit together. Acceptable for the demo; a deployment behind a proxy needs a trusted forwarded address.
- [The bed review loads before it asks] → Its one load is what names the ward. Nothing of it is shown, and nothing more is fetched, until the reason is recorded; the dashboard fetches nothing before.
- [Access records and sessions grow] → Demo scale. Access records are append-only. Sessions are deleted lazily.
- [The reason is free text] → Staff could type patient details. It is stored like a rejection or amend reason and never logged. Fixtures use staff-written reasons only.
- [At each shift change every ward shows "No nurse in charge" and no bed is assigned] → This is realistic, but a demo recorded across 20:00 will show it. The README tells the presenter to take charge and assign beds first.
- [Shift boundaries use server local time] → Server and browser share a timezone in the demo, and both use the same `shiftStart` and `SHIFTS`.
- [The migration on an existing file] → It runs in one transaction with foreign keys off, rolls back on any error, and runs `foreign_key_check` before commit. Tests reopen the old fixtures and check that the staff ids and `created_by` survive and the second open changes no schema.
- [Demo history changes who did what] → Ward data quality numbers change. Its tests use their own fixtures.

## Migration Plan

Opening an existing store upgrades it in place:
1. Rebuild `staff` when its DDL no longer matches (roles, `username`, `password_hash`).
2. Create `staff_ward`, `ward_shift`, `bed_assignment`, `ward_access` and `session`.
3. Add the missing demo staff, and demo usernames and passwords for demo staff who have none.
4. Add team rows for the demo wards present.
5. Name nobody in charge and assign no beds.

Every device must sign in after the upgrade: requests that change data now need a session. Rolling back to the previous build keeps the rebuilt table: `CREATE TABLE IF NOT EXISTS` does nothing, and the extra tables and columns are ignored. The hazard is the old web build: `lib/timeline.ts` calls `ROLE_LABEL[s.role].toLowerCase()`, which throws on a matron. Roll back the web and server together, or don't record anything as the matron.
