# Design

## Context

Motivation is in proposal.md, under "Why". The current state that shapes the approach:

- **Alerts.**
  - `alertsFor(admission, entries, now)` (`apps/server/src/chart/alerts.ts`) is pure: admission, entries and clock in, `Alert[]` out. `Alert` is `{ kind, message }`, with no severity.
  - Severity and labels live on the web as exhaustive maps, `ALERT_TONE` and `ALERT_LABEL` (`apps/web/src/lib/labels.ts`). `bedTone` takes the worst tone for the card's status bar and chip (`Review now` / `Review` / `Check`).
  - The tone → chip text map is written twice, as `STATUS` in `routes/n/$id.tsx:44` and `routes/n/w.$ward.tsx:49`.
- **Where alerts are worked out.** In three places, each calling `alertsFor` with `store.recent(id)`, the entries charted in the last 24 h:
  - `withAlerts` (`routes/chart.ts:172`), for `GET /api/admissions` and `GET /api/wards`;
  - `GET /admissions/:id/entries` (`routes/chart.ts:276`);
  - Explain (`routes/ai.ts:80`).
- **Statuses.** Entries are `pending`, `approved` or `rejected`. There is no voided entry: voiding a meal rejects its pending fluid entry and leaves an approved one approved (charting/meals "Void a meal").
- **Store.** One SQLite file, epoch ms columns, STRICT tables.
  - `openStore` runs: `rebuildStaff` → `migrate` → `SCHEMA` → `migrateMedia` → seeds → `backfill`.
  - `migrate()` returns early for an empty pre-ward store. That is why columns every file needs are added after `SCHEMA` (`migrateMedia`, `store.ts:1216`).
- **Amend.** `POST /api/entries/:id/amend` (`routes/chart.ts:299`) runs `requireDecider` → `smallJson()` → `AmendBody` (`routes/chart.ts:96`), and works on approved entries only (409 `not_approved`). The `amended` event already carries `from_colour`/`to_colour` (`store.ts:946`), and the timeline prints them (`lib/timeline.ts:131`). The web's `AmendDialog` sends volume and type only (`amendBody`, `lib/resolve.ts:71`).
- **Roles and routes.**
  - `requireDecider` (`routes/common.ts`) answers 403 from `DECIDER_ROLES` before the body or the target is read. That is the precedent for nurse-only decisions: review, amend and void, as in "Decisions need a nurse: Role checked first".
  - The ward staffing routes check 404 first, because their 403 depends on the ward.
  - `SKEW_MS` (one minute of clock skew for `charted_at`) is a private constant in `routes/chart.ts:156`.
- **Shifts.** `SHIFTS` and `shiftStart(ms, shifts)` (`packages/shared`) are DST-safe through local-time constructors. Server local time is the hospital's time, and tests use local-time clocks (`new Date(2026, 10, 3, 10)`).
- **Web.**
  - The bed review (`routes/n/$id.tsx`) loads `GET entries` and `GET meals` together (`bedLoad`), refreshes every 30 s, and reloads after each change (`changed()` → `bed.reload()`).
  - The ward dashboard loads `GET /api/admissions?ward=` and the team.
  - The attendant's bed screen (`routes/a/bed.$token.tsx`) loads `GET /api/beds/:token` then `GET entries`.
  - Dialog code is lazy (`EntryDetails`, `RejectDialog`, `MissedEntryDialog`). The route budget is ≤ 50 KB gzipped per route on top of a ≤ 120 KB shell (`.claude/rules/web.md`).
- **Demo.** `scripts/demo-history.ts` gives every bed outside `scripted` (`:422`) a prompt-free `routine()` day (`:218`): a drink and an emptied bag about every 3 h. A bed with no routine and no urine rows would raise `low_urine_output` with `intake_incomplete` or `mismatch`, and a bed with no recent drink `logging_gap`.
- **Fixtures** that construct `Entry`, `EntryEvent` or `AdmissionSummary` objects, and so gain the new required fields:
  - `apps/server/src/chart/alerts.test.ts:22`;
  - `apps/web/src/lib/audit-fixtures.ts:12` and `:50`, `lib.test.ts:49` and `:211`, `rota.test.ts:52` and `history.test.ts:33`.

## Goals / Non-Goals

**Goals:**
- One registry of care kinds. Adding a kind fails to compile until it has a value schema, a rule, a label, a badge and a form, as `SOURCE_KINDS` / `MEDIA_TYPES` do for media.
- Rules are pure functions of orders, entries, meals, reviews, the clock and the shared config. Every boundary is unit-testable without HTTP.
- Zero new requests on any screen. Zero model requests anywhere.
- Older store files open unchanged in meaning.

**Non-Goals:**
- A general clinical-orders engine (dose, frequency, prescriber).
- Prompt acknowledgement.
- Per-ward configuration of thresholds.

## Types (`packages/shared`)

```ts
// ---------- chart day ----------

/** Limits and targets reset here each day, server local time. By default, the first shift's start. */
export const CHART_DAY_START: string = SHIFTS[0]!.start // '08:00'

/** The chart day containing `ms`: its local start and the next day's start. DST-safe (23 h or 25 h days). */
export function chartDay(ms: number, start: string = CHART_DAY_START): { start: number; end: number } {
  const { start: s, end } = shiftStart(ms, [{ name: 'chart day', start }])
  return { start: s, end }
}

// ---------- care plan (orders a nurse records; prompts say "review", never diagnose) ----------

/**
 * Order kinds, in display order (safety-critical first). Adding one is a compile error until the server's
 * CARE_VALUE and CARE_RULES, and the web's CARE_BADGE, CARE_ROW, CARE_HISTORY_TEXT and CARE_FORMS, have it.
 */
export const CARE_KINDS = ['nil_by_mouth', 'thickened_fluids', 'fluid_limit', 'intake_target', 'catheter'] as const
export type CareKind = (typeof CARE_KINDS)[number]
export const CARE_LABEL: Record<CareKind, string> = {
  nil_by_mouth: 'Nil by mouth',
  thickened_fluids: 'Thickened fluids',
  fluid_limit: 'Fluid limit',
  intake_target: 'Intake target',
  catheter: 'Catheter',
}

export const FLUID_SCOPES = ['oral', 'total'] as const
export type FluidScope = (typeof FLUID_SCOPES)[number]
/** Which intake categories each scope counts. An intake target counts `oral`. */
export const SCOPE_CATEGORIES: Record<FluidScope, readonly EntryCategory[]> = { oral: ['water', 'food'], total: ['water', 'food', 'iv'] }

export const CATHETER_TYPES = ['urethral', 'suprapubic'] as const
export type CatheterType = (typeof CATHETER_TYPES)[number]

/** IDDSI drink levels (https://iddsi.org/framework/drink-testing-methods). Level 0 is thin, so it is not an order. */
export const IDDSI_DRINK_LEVELS = [
  { level: 0, name: 'Thin' },
  { level: 1, name: 'Slightly thick' },
  { level: 2, name: 'Mildly thick' },
  { level: 3, name: 'Moderately thick' },
  { level: 4, name: 'Extremely thick' },
] as const
export type IddsiLevel = (typeof IDDSI_DRINK_LEVELS)[number]['level']
export type ThickenedLevel = Exclude<IddsiLevel, 0>

/** Each kind's value, as returned. Times are ISO at the edge. */
export interface CareValues {
  nil_by_mouth: { until: string | null }
  thickened_fluids: { level: ThickenedLevel }
  fluid_limit: { ml: number; scope: FluidScope }
  intake_target: { ml: number }
  catheter: { type: CatheterType; inserted_at: string }
}
/** Body of PUT /api/admissions/:id/care/:kind. Nil by mouth may leave `until` out (no planned end). */
export type CareInput<K extends CareKind = CareKind> = K extends 'nil_by_mouth' ? { until?: string | null } : CareValues[K]

interface CareOrderOf<K extends CareKind> {
  id: number
  admission_id: number
  kind: K
  value: CareValues[K]
  start_at: string
  /** Null while active. */
  end_at: string | null
  set_by: StaffRef | null
  ended_by: StaffRef | null
}
/** Discriminated on `kind`, so `order.value` narrows. `CareOrder<'catheter'>` is one kind's order. */
export type CareOrder<K extends CareKind = CareKind> = { [P in K]: CareOrderOf<P> }[K]

/** Counted intake for the chart day: approved + pending, rejected left out. */
export interface CareProgress {
  /** Chart day start (ISO). */
  since: string
  ml: number
  pending_ml: number
  of_ml: number
  /** floor(100 × ml / of_ml). */
  percent: number
}
export interface CareReview {
  id: number
  order_id: number
  at: string
  by: StaffRef | null
}
/** On GET /api/admissions items and GET /api/admissions/:id/entries. */
export interface CareStatus {
  /** Active orders, at most one per kind, in CARE_KINDS order. */
  orders: CareOrder[]
  fluid_limit: (CareProgress & { scope: FluidScope; left_ml: number }) | null
  /** `next_check`: today's next INTAKE_TARGET_CHECKS time and the mL due by then; null after the last. */
  intake_target: (CareProgress & { next_check: { at: string; ml: number } | null }) | null
  catheter: { day: number; review_due: boolean; last_review: CareReview | null } | null
}

// ---------- config (code constants; see proposal.md "Config") ----------
export const FLUID_LIMIT_WARN = 0.8
export const FLUID_LIMIT_RANGE = { min: 500, max: 3000, step: 50, default: 1500 } as const
export const INTAKE_TARGET_RANGE = { min: 500, max: 3000, step: 50, default: 1600 } as const
export const INTAKE_TARGET_CHECKS: readonly { at: string; fraction: number }[] = [
  { at: '14:00', fraction: 0.5 },
  { at: '20:00', fraction: 0.75 },
]
export const CATHETER_REVIEW_FROM: string = CHART_DAY_START
export const NIL_BY_MOUTH_MAX_HOURS = 48
export const CATHETER_MAX_AGE_DAYS = 365
export const CARE_HISTORY_LIMIT = 50
/** History rows the bed review shows before "Show all". */
export const CARE_HISTORY_SHOWN = 10
```

Changed types:

```ts
export const ALERT_KINDS = [
  'low_urine_output', 'mismatch', 'intake_incomplete', 'overload', 'logging_gap', 'appearance',
  // care plan
  'nil_by_mouth_intake', 'nil_by_mouth_overdue', 'drink_too_thin', 'drink_consistency_unrecorded',
  'fluid_limit_near', 'fluid_limit_reached', 'intake_target_behind', 'catheter_review',
] as const

/** Prompts about particular records, which the web badges. */
export const RECORD_ALERT_KINDS = ['nil_by_mouth_intake', 'drink_too_thin', 'drink_consistency_unrecorded'] as const
export type RecordAlertKind = (typeof RECORD_ALERT_KINDS)[number]

/** Discriminated on `kind`: record prompts always carry both id lists (possibly []), the others never do. */
export type Alert =
  | { kind: Exclude<AlertKind, RecordAlertKind>; message: string }
  | { kind: RecordAlertKind; message: string; entry_ids: number[]; meal_ids: number[] }

export interface Entry {
  // …existing fields…
  /** Drinks (`water`) only; null when none was recorded. */
  iddsi_level: IddsiLevel | null
}
export interface EntryInput {
  // …existing fields…
  /** `water` entries only. */
  iddsi_level?: IddsiLevel | null
}
export interface AmendInput {
  // …existing fields…
  /** Allowed when the entry is `water` after the amendment. */
  iddsi_level?: IddsiLevel
}
export interface EntryEvent {
  // …existing fields…
  /** Amended: the drink's level before and after, when it changed (cleared → null). */
  from_iddsi: IddsiLevel | null
  to_iddsi: IddsiLevel | null
}
export interface AdmissionSummary extends Admission {
  // …existing fields…
  care: CareStatus
}
export interface EntryList {
  // …existing fields…
  care: CareStatus
  /** Newest start first, at most CARE_HISTORY_LIMIT; active orders included. */
  care_history: CareOrder[]
}
```

`DraftEntry` (the model's draft) is **not** changed: drafts never carry a consistency, so the AI contracts and prompts are untouched. The web's `Pending` (`lib/capture.ts`) gains `iddsi_level?: IddsiLevel`.

The `Alert` union keeps every existing `{ kind: 'logging_gap', message }` literal valid. Code that builds an alert from a variable `AlertKind` (web fixtures) is retyped in task 1.1.

## Decisions

### 1. Data model: orders as time ranges, rows as the audit trail

```sql
CREATE TABLE IF NOT EXISTS care_order (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admission(id),
  kind TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  set_by INTEGER REFERENCES staff(id),
  ended_by INTEGER REFERENCES staff(id),
  created_at INTEGER NOT NULL,
  CHECK (end_at IS NULL OR end_at >= start_at)
) STRICT;
-- At most one active order per admission and kind, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS care_order_active ON care_order (admission_id, kind) WHERE end_at IS NULL;
CREATE INDEX IF NOT EXISTS care_order_admission ON care_order (admission_id, start_at);
-- One necessity review per catheter order and chart day.
CREATE TABLE IF NOT EXISTS care_review (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES care_order(id),
  chart_day INTEGER NOT NULL, -- chartDay(at).start
  at INTEGER NOT NULL,
  staff_id INTEGER REFERENCES staff(id),
  UNIQUE (order_id, chart_day)
) STRICT;
```

- **Change.** `setCare` runs in `tx()` (`BEGIN IMMEDIATE`). It ends the active row (`end_at = t`, `ended_by`) and inserts the new one with `start_at = t`, using the same `t`. An entry charted exactly at `t` is judged by the new order, since the start is included and the end excluded.
- **Unchanged value.** `PUT` with a value equal to the active one returns 200 and writes nothing, so a double tap leaves no history noise. Both sides go through the codec before comparing, `careJson(kind, careValue(kind, stored))` against `careJson(kind, input)`, so time formats, key order and keys this build does not know make no difference.
- **No edits or deletes.** Rows are only ended, so `care_order` and `care_review` are the audit trail (who set or ended what, and when) without a separate events table.
- **Times in `value`.** They are stored as epoch ms, like every other column, and converted to ISO at the edge by a per-kind codec in the server registry.
- **No CHECK on `kind`.** A CHECK generated from `CARE_KINDS` would need a table rebuild to add a kind, as `rebuildStaff` does for roles. The route validates the kind instead, and the partial unique index gives the safety that matters.
- **`created_at` and `start_at`.** Both are kept. They are equal today; `start_at` is the clinical time and leaves room for backdated orders later (out of scope).
- Alternatives considered:
  - A JSON column on `admission` holding the current orders. It loses history and the time an order was in force, which the per-entry rules need.
  - An append-only event log. It makes "the order in force at t" a fold instead of a range query.

### 2. The registry pattern

- **Server, in `apps/server/src/chart/care.ts` (domain, pure).**
  - `CARE_RULES: { [K in CareKind]: CareRule<K> }`. Each rule takes a `CareContext<K>`, holding its orders overlapping the window, the active order, entries, meals, reviews, `now` and `chartDay(now)`. It returns its slice of `CareStatus` and its `Alert[]`.
  - A mapped type over `CARE_KINDS`, so a missing kind is a compile error.
  - The per-kind value codec (row JSON ⇄ edge value, and equality) lives in the same file.
- **HTTP, in `apps/server/src/routes/care.ts`.**
  - `CARE_VALUE: { [K in CareKind]: z.ZodType<CareInput<K>> }`, with strict per-kind zod schemas built from the shared ranges.
  - Time-relative checks (`until` after now and within `NIL_BY_MOUTH_MAX_HOURS`, `inserted_at` within `CATHETER_MAX_AGE_DAYS` and at most 60 s ahead) take `store.now()` in a refine. They use `SKEW_MS`, moved from `routes/chart.ts:156` to `routes/common.ts` and exported, so entries and care orders share the one-minute skew. `until` must be strictly after now, and `inserted_at` at or after `now − CATHETER_MAX_AGE_DAYS × 24 h`.
- **Web, in `apps/web/src/lib/care.ts`.** `CARE_BADGE`, `CARE_ROW`, `CARE_HISTORY_TEXT`: `{ [K in CareKind]: (order: Extract<CareOrder, { kind: K }>, care: CareStatus, now: number) => string }`.
- **Web, in `apps/web/src/components/care-forms.tsx` (lazy).** `CARE_FORMS: { [K in CareKind]: ComponentType<CareFormProps<K>> }`.
- **Web, in `lib/labels.ts`.** `ALERT_LABEL` and `ALERT_TONE` stay `Record<AlertKind, …>`, so the 8 new kinds fail to compile until labelled and coloured.

### 3. Rule evaluation

One composition point, `chartView(store, admission, orders?)` in new `apps/server/src/chart/view.ts`. It reads the store and calls the pure rules, and returns `{ alerts, care }`. The ward list passes the orders it read for the whole ward (`orders`). `GET entries` reads `care_history` itself, with `store.careHistory(id, CARE_HISTORY_LIMIT)`.

The three callers use it: `withAlerts` (renamed `withChart`), `GET entries` and Explain. So the chart, `beds_with_alerts` and Explain see the same prompt list ("Care prompts join the alerts").

Order of work:
1. The window is `since = min(now − 24 h, chartDay(now).start)`, which covers a 25 h DST chart day. Entries come from `store.recent(id, since)`; the existing rules still filter by their own hours.
2. Orders come from `store.careOrders(id, now − 24 h)`: active, or ended after that time, for the per-entry rules.
3. Meals come from `store.meals(id)`, only when a nil-by-mouth order overlaps the window.
4. Reviews: the latest review of the active catheter order.
5. `alertsFor(admission, entries, now, { nilByMouth: active NBM })`. `logging_gap` is decided inside `alertsFor`, where its requirement lives.
6. The care rules in `CARE_KINDS` order, appended after the existing alerts.

Rules by kind (exact messages are in the spec scenarios; the templates are in `care.ts`):

| Kind | Order used | Window | Counts | Prompt(s) |
|---|---|---|---|---|
| `nil_by_mouth` | the order in force at each record's charted time, `[start, end)` | rolling 24 h, as `appearance` | `water`/`food` entries not rejected; meals not voided with `portion > 0` | `nil_by_mouth_intake` (danger), with `entry_ids` (every counted entry, a meal's own fluid entry included, so its card is badged) and `meal_ids`; `nil_by_mouth_overdue` (warn) when active and `now ≥ until` |
| `thickened_fluids` | the order in force at each entry's charted time | rolling 24 h | `water` entries not rejected, by their current `iddsi_level` | `drink_too_thin` (danger) for `iddsi_level < level`; `drink_consistency_unrecorded` (warn) for null; each with its `entry_ids` and `meal_ids: []` |
| `fluid_limit` | the active order | chart day | `SCOPE_CATEGORIES[scope]`, not rejected | `fluid_limit_near` (warn) at `ml ≥ 0.8 × of`; `fluid_limit_reached` (danger) at `ml ≥ of`, replacing near |
| `intake_target` | the active order | chart day, up to now | `oral`, not rejected | `intake_target_behind` (warn) at the latest passed check whose time is ≥ the order's start, when `ml < expected`, `expected = ceil(fraction × of)`; none while NBM is active |
| `catheter` | the active order | chart day for the review | — | `catheter_review` (info) when `start_at < day.start`, `now ≥ reviewFrom(day)` and there is no review in `day` |

How the times and numbers are worked out:
- **Check times.** A check's instant is the first local `HH:MM` at or after `day.start`, so a check before `CHART_DAY_START` falls on the next calendar day. `reviewFrom(day)` works the same way.
- **Thresholds.** The limit is compared as exact numbers (`ml ≥ FLUID_LIMIT_WARN × of`). `percent` is floored for display only, so 799 of 1000 shows 79% with no prompt, and 800 shows 80% with one. A target's `expected` and `next_check.ml` are `Math.ceil(fraction × of)`, so 0.75 × 1550 = 1162.5 gives 1163; with integer mL, `ml < expected` is the same test as `ml < fraction × of`.
- **Nil-by-mouth message.** `<n> entry|entries (<mL>)` counts listed entries that are not a listed meal's own fluid entry; `<n> meal|meals[ (<mL>)]` counts listed meals, with the volume of their pending or approved fluid entries when any. Parts are joined with `, `, and an empty part is left out.
- **Consistency after an amend.** The rule reads each entry's current `iddsi_level`, so an amend that meets the order clears the prompt on the next read; nothing is stored on the alert.
- **Catheter day.** `localDate(now) − localDate(inserted_at) + 1`, from local-midnight constructors with `Math.round` of the day difference (DST-safe).
- **Time in messages.** Formatted `HH:MM` from `getHours`/`getMinutes`, not `toLocaleTimeString`, so ICU builds cannot vary it. A time not on today's date is prefixed `D Mon`.
- **Numbers in messages.** Plain integers (`1600 mL`), as the existing prompts print `2100 mL`.

### 4. Chart day and counting

- **The window.** `chartDay` reuses `shiftStart` with a single-entry shift list, so DST handling is shared and already tested. Every other total (24 h totals, hourly series, the existing prompts) keeps its rolling window. The UI always names the window: "today since 08:00".
- **What is counted.** Approved and pending, with rejected entries left out. A pending entry is a real drink until a nurse rejects it, so for a **limit** this errs on the safe side.
- **The target's caveat.** For a **target**, counting pending is the optimistic side: an unreviewed entry can hide a shortfall. It is kept so both bars mean the same thing, and the pending part is always shown (`incl. 100 mL pending`).
- **Voided meals.** Voiding rejects a pending fluid entry, so "voided" needs no separate rule.
- **Existing prompts.** `low_urine_output`, `mismatch`, `intake_incomplete` and `overload` keep approved-only volumes, and `logging_gap` and `appearance` keep pending + approved, as specified today.
- **A limit or target started mid-day** counts the whole chart day. A 1.5 L/day limit includes this morning's drinks.

### 5. HTTP

New `careRoutes(store)` in `apps/server/src/routes/care.ts`, mounted beside `chartRoutes` in `app.ts`. It sits behind the app-level `session` and `sameSite` guards.

| Route | Chain | Answers |
|---|---|---|
| `PUT /admissions/:id/care/:kind` | `requireDecider` → `careTarget` → `smallJson()` → `validate('json', AnyCareBody)` → handler | 403 · 404 (admission or kind) · 413 · 400 (value, then cross-order conflict) · 201 new / 200 unchanged |
| `DELETE /admissions/:id/care/:kind` | `requireDecider` → `careTarget` → handler | 403 · 404 (admission, kind or nothing active) · 200 |
| `POST /admissions/:id/care/catheter/review` | `requireDecider` → `careTarget` → handler | 403 · 404 (admission or no active catheter) · 409 `already_reviewed` · 201 |

- **`careTarget`** is a middleware like `wardFound`. It answers 404 for an unknown admission or a `:kind` outside `CARE_KINDS`.
- **The body.** `AnyCareBody = z.record(z.string(), z.unknown())` (in `routes/care.ts`) only checks for a JSON object, so an array, `null` or bad JSON gets the usual 400 before any kind is looked at. The handler then parses with `CARE_VALUE[kind]`, the kind read from the path, and maps zod issues to the usual `{ error: 'invalid_request', issues }`.
- **The cross-order conflict** (target vs limit) is a 400 with an issue at `ml`. The message names the other order: `above the active fluid limit of 1500 mL` or `below the active intake target of 1600 mL`.
- **Amend.** `AmendBody` gains `iddsi_level: IddsiLevel.optional()`, where `IddsiLevel` (`routes/chart.ts`) is the literal union `z.union(IDDSI_DRINK_LEVELS.map((l) => z.literal(l.level)))`, so 0–4 come from the shared list and the parsed type is `IddsiLevel`. The entry body uses the same schema. `store.amend` answers `invalid_request` when the entry is not `water` after the amendment, or when nothing changes. It writes the level and records `from_iddsi`/`to_iddsi` on the `amended` event, by the session's staff, as it does for the colour. Leaving `water` clears the level and records `to_iddsi: null`. The route chain and its 403/404/409 answers are unchanged.
- **Reviews.** The handler inserts with `ON CONFLICT (order_id, chart_day) DO NOTHING RETURNING id`. Getting no row back means 409.
- **Reads.**
  - `GET /admissions` items gain `care`. The ward list reads orders in one query per ward (`careOrdersByWard`) and meals only for beds with a nil-by-mouth order, so the extra cost is small next to today's per-bed `recent()` calls.
  - `GET /admissions/:id/entries` gains `care` and `care_history` (`CARE_HISTORY_LIMIT` rows, newest start first).
  - Explain builds its prompt list through `chartView`. Its context lines still come from the 24 h `recent()`, and its prompt text and its single request are unchanged.

### 6. Permissions

- Setting, ending and reviewing are non-GET requests, so the app-level `session` gives 401 without a session.
- `requireDecider` reads `DECIDER_ROLES`: nurses and the matron pass, and attendants get 403. No role string is written in the new code.
- Reads stay open, as all GETs are, so attendants see orders read-only.
- Break-the-glass is a web gate, as for other ward data. The bed review's whole tree, the Care plan section included, sits inside `AccessGate`. The server does not check wards on writes, the same stance as entries ("Enforcing wards on writes" is out of scope in ward-staffing).

### 7. Web

- **Labels and colours.** `lib/labels.ts` gains the 8 kinds in `ALERT_LABEL` and `ALERT_TONE` (danger: `nil_by_mouth_intake`, `drink_too_thin`, `fluid_limit_reached`; warn: `fluid_limit_near`, `nil_by_mouth_overdue`, `intake_target_behind`, `drink_consistency_unrecorded`; info: `catheter_review`). `bedTone` and the card colours follow unchanged.
- **Status chip text.** `STATUS_LABEL: Record<ReturnType<typeof bedTone>, string>` moves to `lib/labels.ts`, replacing the two `STATUS` copies (`routes/n/$id.tsx:44`, `routes/n/w.$ward.tsx:49`), so "Worst prompt wins" tests the text both screens show.
- **"Add missed entry".** `lib/resolve-rules.ts`: `GAP_PROMPTS` gains `intake_target_behind`.
- **`lib/care.ts`** holds the DOM-free logic every web scenario tests:
  - `careBadges`, `litres` (`1000 → '1'`, `1500 → '1.5'`, `1250 → '1.25'`), `limitCaption`, `targetCaption`;
  - `limitTone(progress)`: `ml ≥ of_ml` → red, `ml ≥ FLUID_LIMIT_WARN × of_ml` → amber, else neutral, the same test as the server's prompts and no literal 80;
  - `formDefaults(kind, care)`: the shared ranges' defaults, with the target at `min(INTAKE_TARGET_RANGE.default, active limit ml)` so its form never opens in conflict;
  - `reviewedToday(review, now)`: the review falls in `chartDay(now)`, not the calendar day;
  - `CARE_ROW`, `CARE_HISTORY_TEXT`;
  - `nbmWarning(care, what, now)`, `consistencyDefault(care, category)`, `thinnerNotice(level, care)`;
  - `careFlags(entry, alerts)`, `mealFlags(meal, alerts)`;
  - `untilFrom('HH:MM', now)` (an earlier time means tomorrow), `insertedFrom('YYYY-MM-DD')` (local midnight), `targetConflict(care, kind, ml)`;
  - the catheter form keeps the insertion time: "Change…" fills `inserted` (`YYYY-MM-DD`) and `exact` (the order's `inserted_at`) from the active order, and while the date is unchanged the request sends `exact` back, not `insertedFrom(inserted)`. Changing only the type therefore resends the same `inserted_at`, and a new date is sent as local midnight;
  - `limitCaption(p, now)` and `targetCaption(p, now)` name `since` as `when` does, so between 00:00 and 08:00 the caption reads `today since 2 Nov 08:00`, like the server's prompt.
- **`lib/api.ts`.** `setCare(id, kind, value)`, `endCare(id, kind)`, `reviewCatheter(id)`.
- **`components/care-plan.tsx`** (in the `/n/$id` route chunk):
  - the section, the rows and the history;
  - progress bars as a `div` with `role="progressbar"`, `aria-valuenow` and `aria-valuetext` set to the caption, so colour is never the only signal;
  - for deciders (`canDecide`): "Add order", a toggle that shows an inline button group (`role="group"`) of the inactive kinds (`addableKinds`), one button per kind opening its form; "Change…", "End…" (Base UI `AlertDialog`) and "Reviewed today", all ≥ 44 px (`size="touch"`). "Reviewed today" is not offered on the chart day the catheter order was set, since setting it counts as that day's review (as `catheter_review` does on the server).
- **`components/care-forms.tsx`** (lazy, `React.lazy` like `RejectDialog`): `CARE_FORMS`, built from the existing `Stepper`, `Segmented`, chip radio groups (`UrineColourPicker`'s pattern) and the sheet styles. A form disables Save on `targetConflict`.
- **`components/care-badges.tsx`.** Neutral `Chip`s, used by `BedCard` (`routes/n/w.$ward.tsx:276`) and the attendant banner (`routes/a/bed.$token.tsx:360`). Badges are neutral because the prompts already carry the severity.
- **`components/consistency-field.tsx`.** IDDSI chips `0 Thin` … `4 Extremely thick`, used by the capture check screen, the by-hand form, `MissedEntryDialog` (`components/resolve.tsx:211`) and `AmendDialog` for drinks.
- **Amend.** `amendBody(e, volumeMl, category, reason, iddsi?)` adds `iddsi_level` only when the result is `water` and the level changed; `AmendDialog` shows the field only for drinks, with no chip picked when the entry has no level. `lib/timeline.ts` adds `consistency <from> → IDDSI <to>` (`none` for null) to the amended line, beside the colour part.
- **`Pending` and `toEntryInput`.** `Pending.iddsi_level` is seeded from `consistencyDefault` when a water draft enters review or its type changes to water. `toEntryInput` sends `iddsi_level` only for `water`.
- **Nil-by-mouth warning.** A `Notice tone="warn"` above Save, and the button text `Save anyway`. The `MealForm` gains a `care` prop for it.
- **Flags.** `careFlags` badges are added beside `entryFlags` in the pending card, the entry log and the entry details. `mealFlags` goes on the meals list. `entryFlags` itself is unchanged, and so is "Flagged only" (data quality, not care).
- **Icons.** New lucide icons (e.g. `clipboard-list`, `utensils-crossed`) are exported from `components/icons.tsx`, one file per icon, like the existing ones.
- **Bundle.**
  - `care-plan.tsx` and `lib/care.ts` go in the `/n/$id` chunk (estimate ≤ 4 KB gzipped).
  - Badges and the consistency field go in `/n/w/$ward` and `/a/bed/$token` (≤ 2 KB each).
  - The forms are their own lazy chunk.
  - The shell is unchanged. Measured in tasks.

### 8. Migration

- New tables come from `CREATE TABLE IF NOT EXISTS` in `SCHEMA`.
- `entry.iddsi_level INTEGER`, `entry_event.from_iddsi INTEGER` and `entry_event.to_iddsi INTEGER` are in the `SCHEMA` DDL for new files. A new `migrateCare(db)` step after `SCHEMA` (beside `migrateMedia`, for the same early-return reason) adds whichever is missing to older files with `ALTER TABLE … ADD COLUMN`.
- There is no CHECK on the added column (the route validates 0–4), so a re-open does nothing and `PRAGMA schema_version` stays put.
- Older entries read `iddsi_level: null`, older events `from_iddsi`/`to_iddsi: null`, and older admissions have no orders.
- Rollback: the previous build ignores the new tables and the column, since every query names its columns.

### 9. Demo seed

Orders are written by `scripts/demo-history.ts` only, through the store API (`setCare`, `reviewCatheter`), with `clock.t` moved as for entries. The store's own seed is not used: a fresh store (tests, "Fresh store", "Quiet ward") stays free of orders, so no live scenario changes.

Each order is set by the ward's own nurse. The story beds keep the routine rows that hold the other prompts off, and change only what their story needs:
- **HDU-1** keeps its whole `routine()` day and adds no story rows: the catheter prompt needs no entries.
- **HDU-3, 2C-1 and 3A-4** keep their routine **output** rows, `routine(ward, bed, n).filter((r) => CATEGORY_DIRECTION[r[3]] === 'out')`, so `low_urine_output`, and with it `mismatch` or `intake_incomplete`, stays off. Only their intake rows are replaced, by the story rows below.
- **5B-6** is already scripted (its `STORY` rows): its drinks gain levels, and two story drinks are added.
- HDU-3, 2C-1 and 3A-4 join `storyBeds`, whose meals carry no fluid, so meal soup cannot move a limit, a target or the nil-by-mouth prompt. 2C-1 also gets no meal inside its nil-by-mouth window.

| Bed | Order (set) | Rows | Intended prompts |
|---|---|---|---|
| HDU-3 Elena Novak | `fluid_limit { 1000, total }`, by Divya Kapoor, at admission + 30 min | Intake: approved water 400 mL, approved IV 220 mL and pending tea 200 mL, in the last 3 h clamped into the current chart day → 820 mL, 82%; the latest drink keeps `logging_gap` off. Older drinks before the chart day. Output: routine | `fluid_limit_near` |
| HDU-1 Nadia Rahman | `catheter { urethral, inserted_at: local 11:00 five calendar days ago }`, by Nikhil Bose, at admission + 30 min | The full routine day and its late-entry fixed record. A review in the previous chart day at 09:10 by Nikhil Bose, none today → `Catheter day 6` | `catheter_review` |
| 5B-6 Kofi Mensah | `thickened_fluids { 2 }`, by Grace Lee, at admission + 30 min | Its `STORY` drinks carry `iddsi_level: 2`. Added: a 150 mL voice "water" at `iddsi_level: 0` by Mohan Das, 5.5 h ago; an approved 200 mL drink 7 h ago with no level, as the ward round saves it | `drink_too_thin`, `drink_consistency_unrecorded` |
| 2C-1 Arjun Nair | `nil_by_mouth { until: 14:00 on the chart day's date }`, by Meera Pillai. It starts at the earlier of 10:00 on that date and now − 1 h, so `until` is always after the start | Intake: drinks only before the start, plus a pending 150 mL water halfway between the start and now; `logging_gap` is held while it is active. Output: routine | `nil_by_mouth_intake`, plus `nil_by_mouth_overdue` from 14:00 to the next 08:00 |
| 3A-4 Mei Lin | `intake_target { 1600 }`, by Anita Thomas, at admission + 30 min | Intake: 3 × 200 mL approved water in the last 3 h, clamped into the chart day → `Target 600/1600`. Output: routine. Keeps its voided-meal fixed record | `intake_target_behind` from 14:00 to the next 08:00, none before |

Runs between 14:00 and 08:00 show every prompt, and the header comment says so. Earlier runs show the target and NBM badges without those two prompts. A guard reads each story bed's alerts after seeding and throws unless they equal the intended set for the time of the run, so a drift in the routine data, a missing routine row or a stray prompt is caught when the script runs.

### 10. Test strategy

- **Pure rules** in `apps/server/src/chart/care.test.ts`:
  - every rule boundary from the specs: 79/80/100%, start included and end excluded, a mid-day start, a check before the order's start, the rounded-up 1163 mL, NBM at 13:59/14:00, catheter midnight, a review across 07:59/08:00, levels thinner, equal, thicker and none, pending and rejected;
  - "Chart day: Clock change", a 25 h DST chart day: `process.env.TZ = 'Europe/London'` inside the test, restored after it (Node applies TZ changes at run time), with clocks on 24–25 Oct 2026. No existing test sets TZ, so this is the first, and it is kept to that one test;
  - the 07:59/08:00 chart-day edge and the pending/rejected counting also run here as uncited extra assertions; their cited scenarios ("Across the start", "Mixed statuses") need `totals.in_ml`, so they are tested over HTTP.
  - Exact messages are asserted. Clocks are local (`new Date(2026, 10, 3, h, m)`).
- **HTTP** in new `apps/server/src/care.test.ts`, through `testApp`:
  - set, values, end, permissions (`staff: 1` for 403, `cookie: null` for 401), history, target vs limit, status on reads, the review route and pre-care stores;
  - "Chart day: Across the start" and "Counted intake: Mixed statuses", seeded through `POST …/entries` (`charted_at`), `POST /api/entries/:id/review`, `POST …/meals` and `POST /api/meals/:id/void`, then read with `GET …/entries` (`care` and `totals`);
  - "Thickened fluids: Recorded afterwards", through `POST /api/entries/:id/amend`;
  - each asserting the fake upstream's `requests` is empty, except the Explain scenario, which asserts exactly one request whose input holds `catheter_review` and not the patient's name.
- **Existing suites:**
  - `chart/alerts.test.ts` gains the Logging gap "Nil by mouth" scenario;
  - `chart.test.ts` gains "Drink consistency on the entry";
  - `audit.test.ts` gains "Amend a drink's consistency";
  - the `Entry` fixture gains `iddsi_level: null`.
- **Web lib** in new `apps/web/src/lib/care.test.ts`:
  - every `web/ward` and `web/capture` care scenario through `lib/care.ts`;
  - request scenarios through `createApi` with a fake `fetch`, asserting the exact requests and `X-Staff-Id`.
- `resolve.test.ts` gains "Correct a drink's consistency" (`amendBody`), and `timeline.test.ts` its timeline line.
- `resolve.test.ts:74` "Gap prompts offer a missed entry" is rewritten in place to include `intake_target_behind`. It checks one more kind, so it is not weaker.
- **Browser** (tasks.md): 390 and 1100 px, `/api/ai/*` blocked, as Anita Thomas and Ravi Kumar.

### 11. Deviations from the outline, and why

1. **Check order 403 → 404 → 400, not 404 → 403 → 400.** The care routes' 403 depends only on the role, so they reuse `requireDecider` as review, amend and void do ("Decisions need a nurse: Role checked first"). The ward staffing routes put 404 first only because their 403 needs the ward. Within that, `smallJson` still runs before zod.
2. **Eight prompt kinds** instead of one per order kind. Severity is a per-kind web map (`ALERT_TONE`), and `Alert` has no severity, so amber versus red at 80% and 100% needs two kinds. The same goes for nil by mouth's intake (red) and overdue (amber), and for a drink recorded too thin (red) versus one with no consistency recorded (amber). Two kinds fit the exhaustive `ALERT_TONE`/`ALERT_LABEL` maps with no new field; a severity field on `Alert` would bypass them.
3. **Order in force at the charted time for per-entry rules only.** Nil by mouth and thickened fluids judge each record by the order then in force. Limits and targets are daily totals, so they use the active order over the whole chart day, including intake before a mid-day start; otherwise a limit set at 15:00 would ignore the morning's 900 mL.
4. **Entry-based care prompts use the rolling 24 h** (as `appearance` does), not the chart day, so a 07:30 drink while nil by mouth does not vanish at 08:00.
5. **An intake target counts oral intake only.** A minimum-intake target is about drinking, and IV would hide poor oral intake. A limit keeps `oral`/`total`.
6. **No consistency recorded is flagged, amber, and fixable.** The ward round, jug levels and older clients save drinks with no level. Silence would let a jug of thin water pass for a dysphagia patient, but a red prompt lasting 24 h with no way to clear it would be alert fatigue on every round. So it is its own amber kind, `drink_consistency_unrecorded`, and a nurse records the level through the existing Amend (approved drinks, reason, attributed event), which clears it. A drink recorded thinner than ordered stays red, as does intake while nil by mouth, for 24 h like `appearance`.
7. **Nil by mouth also counts meals** with some portion eaten (`meal_ids`), and the Meal form warns. Food is the bigger fasting risk, and a meal with no fluid makes no entry.
8. **`logging_gap` is held while nil by mouth** (MODIFIED), and so is `intake_target_behind`: "Check jug and meals" is the wrong nudge for a fasting patient. This is the one change to an existing prompt.
9. **Catheter.**
   - Setting the order counts as that chart day's review, so there is no prompt the day it is set.
   - The day number is by calendar date (day of insertion = day 1, the CAUTI surveillance convention), while the review follows the chart day.
10. **Wording.**
    - Every care message ends exactly `Review.`, so one test covers all eight. The overdue message is therefore `…past its planned end of 14:00 and still active. Review.` rather than "Review whether to lift".
    - Numbers have no thousands separator, to match the existing `2100 mL`.
11. **Demo orders come from `demo-history.ts` only**, not the store's seed, so fresh stores and every live scenario stay unchanged.
12. **"Bed card"** means the ward dashboard card and the attendant's banner, not the printed QR card. Paper does not update when an order changes.
13. **Added beyond the outline:**
    - `entry_ids` and `meal_ids` on the record kinds of a discriminated `Alert`, for the per-record flags the request asks for ("gets a review flag");
    - `iddsi_level` on amend, with `from_iddsi`/`to_iddsi` on the `amended` event;
    - `STATUS_LABEL` shared by both screens, and `CARE_HISTORY_SHOWN`;
    - an unchanged-value `PUT` → 200;
    - `NIL_BY_MOUTH_MAX_HOURS`, `CATHETER_MAX_AGE_DAYS` and `CARE_HISTORY_LIMIT`, plus `step` and `default` in the two ranges;
    - Explain sharing the chart's prompt list.

## Risks / Trade-offs

- [The ward round and jug levels set no consistency] → Drinks from them raise the amber "no consistency recorded" for a thickened-fluids patient until a nurse records the level through Amend (see 11.6), and the README says so. A pending drink needs approving first, as for urine colour. A follow-up can add the field to the round's check screen once its bed lookup carries `care`.
- [A meal's fluid is not checked against a thickened-fluids order] → It is stored as a `food` entry, and the thickened-fluids rule reads `water` only, so a thin soup raises neither `drink_too_thin` nor `drink_consistency_unrecorded`. The README says so. A follow-up can add consistency to meal fluid (out of scope here).
- [Red care prompts last 24 h] → `nil_by_mouth_intake` and `drink_too_thin` stay until the record leaves the window, as `appearance` does; there is no dismissal. A level saved by mistake is corrected through Amend, which records who changed it and why.
- [Counting pending entries in the target can hide a shortfall] → The pending part is always shown, and the logging-gap prompt still fires.
- [Server and device time zones differ] → Messages use server local time and the web formats in the device's. Ward devices share the hospital's zone, as shifts already assume. The UI shows the server's `since`.
- [The demo depends on the time of day] → The demo stories are placed relative to the chart day. The script documents the 14:00 – 08:00 window and checks its own story prompts.
- [The ward list does more reads per request] → One orders query per list, plus meals only for nil-by-mouth beds. That is fine at 21 beds; batch the meals if a ward grows past ~100 beds.
- [A clinical misreading of a prompt] → Every message ends `Review.`, nothing is blocked, and the README says Meniscus documents orders made elsewhere and is not a diagnostic device.

## Migration Plan

1. Deploy server and web together; the shape changes are additive, but the web reads the new fields.
2. On first open, an older file gains the two tables and `entry.iddsi_level`. A second open changes nothing ("Pre-care stores").
3. Rollback: run the previous build on the same file. The extra tables and column are ignored. Orders entered meanwhile stay in the file for a later upgrade.
