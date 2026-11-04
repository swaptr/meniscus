# Design

## 0. Changed types

### packages/shared

```ts
export const ACUITY_LEVELS = ['critical', 'watch', 'stable'] as const
export type AcuityLevel = (typeof ACUITY_LEVELS)[number]
/** Prompt kinds that suggest a level (charting/acuity "Suggested acuity"). Closed lists: a new kind suggests nothing until named here. */
export const ACUITY_SUGGEST = {
  critical: ['low_urine_output', 'overload', 'fluid_limit_reached', 'nil_by_mouth_intake'],
  watch: ['logging_gap', 'appearance', 'fluid_limit_near', 'intake_target_behind'],
} as const satisfies Record<'critical' | 'watch', readonly AlertKind[]>

export interface AcuityStatus {
  level: AcuityLevel
  source: 'order' | 'ward'
  order_id: number | null
  /** Only ever higher than `level`; never stored, never applied. Raises the dashboard group and the budget class. */
  suggested: AcuityLevel | null
  /** Only the bed's alert kinds from ACUITY_SUGGEST[suggested], in alert order; [] when suggested is null. */
  reasons: AlertKind[]
}

// care-plan registry
export const CARE_KINDS = ['acuity', 'nil_by_mouth', 'thickened_fluids', 'fluid_limit', 'intake_target', 'catheter'] as const // BREAKING
export interface CareValues { acuity: { level: AcuityLevel } /* …existing kinds */ }

export interface Ward { /* … */ default_acuity: AcuityLevel } // BREAKING
export interface AdmissionSummary { /* … */ acuity: AcuityStatus } // BREAKING
export interface EntryList { /* … */ acuity: AcuityStatus } // BREAKING

/** 429 body of a refused model action (model-api/http-errors "Local budget refusal"). */
export interface BudgetRefusal {
  error: 'request_budget_exceeded'
  message: string
  retryable: true // BREAKING: was false
  limit: 'hourly' | 'concurrent'
  budget_class: 'critical' | 'routine'
  retry_after_ms: number
}
```

`STATUS_MAX_AGE_MS` and `AcuityStatus.interval_h` are not here: they come with `scale-store`.

### @meniscus/meta (transport only: no acuity, no domain words)

```ts
export type Priority = 'high' | 'normal'
export interface BudgetOptions {
  perHour: number
  maxConcurrent: number
  /** Share of perHour that only `high` reservations may use, 0–90. Default 0 (today's behaviour). */
  reservePct?: number
}
export interface Ticket {
  readonly priority: Priority
  /** Hourly slots held and not yet sent. */
  readonly left: number
  /** Called by the transport once per HTTP request. Takes from the budget that issued the ticket; never throws a budget error. Throws a plain Error when no slot is left. */
  take(): () => void
  /** Returns unsent slots and the in-flight hold. Idempotent; the pipeline calls it in `finally`. */
  release(): void
}
export class RequestBudget {
  /** All or nothing: `requests` hourly slots and `peak` in-flight slots, or MetaBudgetError with nothing held. */
  reserve(requests: number, o?: { priority?: Priority; peak?: number }): Ticket
  /** Would `requests` fit under `priority`'s hourly ceiling? Hourly only: in-flight slots never change the read mode (§3). Pure; no slot taken. */
  fits(requests: number, priority?: Priority): boolean
  /** Unchanged for callers without a ticket: reserve(1, { priority: 'normal', peak: 1 }) taken at once. */
  acquire(): () => void
  stats(): {
    total: number
    lastHour: number
    held: number
    inFlight: number
    perHour: number
    maxConcurrent: number
    reservePct: number
    /** Requests a `high` / `normal` reservation could still take now. */
    remaining: Record<Priority, number>
  }
}
export class MetaBudgetError extends MetaError {
  readonly retryable = true // BREAKING: was false. The client still never retries; callers may after retryAfterMs.
  constructor(message: string, readonly limit: 'hourly' | 'concurrent', readonly retryAfterMs: number, readonly priority: Priority) {}
}
export interface CallOptions { signal?: AbortSignal; ticket?: Ticket }
```

image-synthesis leaves `CallOptions` unchanged (its `timeoutMs` is on the image params and the internal `RequestInit`), so `ticket` is the only new field.

### Server config (`config.ts`, `.env.example`)

- `CRITICAL_RESERVE_PCT`: integer 0–90, default 30, passed to the budget as `reservePct`.
- `MODEL_API_MAX_CONCURRENT`: now at least 2 (was at least 1; default 4 unchanged), so a `sam+spark` read, which holds 2 in-flight slots, can ever be admitted (§3). 1 is rejected at startup.
- `routineCeiling(config)` = `C − ⌊C · CRITICAL_RESERVE_PCT / 100⌋`, used by `scripts/eval.ts` and the synthesis script's dry run.

### Server ports (`src/ai/ports.ts`)

```ts
export interface AiPorts {
  /* responses, sam, asr: unchanged */
  budget: Pick<MetaClient['budget'], 'fits' | 'reserve'> // new: the live client and testing.ts's client satisfy it
}
```

### Layer ownership

| Module | Layer | Role |
| --- | --- | --- |
| `packages/meta/src/budget.ts` | `@meniscus/meta` | Reservations, tickets and priorities |
| `apps/server/src/ai/budget-policy.ts` | domain, over `AiPorts` | Class, mode, reservation and the ticketed run of each action, with the `budget pressure` warning |
| `apps/server/src/chart/acuity.ts` | domain, pure | Effective and suggested acuity |
| `apps/server/src/routes/ai.ts` | HTTP | Validation, bed lookup and its status, the response and 429 mappings |
| `apps/web/src/lib/ward.ts`, `lib/acuity.ts`, `lib/capture.ts`, `lib/round.ts` | web | Sort, filter, acuity row, refusal state, round wording |

## 1. Context: what we measured (Phase A)

The bench sat outside the repo (`/tmp/meniscus-bench.rHHd/`). It is one-off: `scale-store` ports it into the repo as `pnpm --filter @meniscus/server bench`. The README "Scaling" section quotes this section.

**Setup.**
- The app ran in-process over `testing.ts`'s fake upstream. It counted **0 upstream requests and 0 network calls**, with `fetch` replaced by a thrower, and `.env` was never read.
- Data: 20 wards × 25 beds, 3 days, about 30 entries per patient-day (44,636 entries and 87,092 events), 12,000 jug levels, 4,500 meals and 32,188 media (≈ 17 photos of 150 KB and ≈ 5 recordings of 40 KB per patient-day). All fictional.
- Each size ran twice: media bytes in `media.bytes` ("full", as today) and 64-byte stand-ins ("tiny", the store after `scale-store`).
- The laptop's load average was 7–10 throughout, so absolute numbers are upper bounds; the ratios are the signal.

### Latency (p50 / p95 ms)

| Operation | 100 beds tiny | 100 full | 500 tiny | 500 full |
| --- | --- | --- | --- | --- |
| Store open | 32 / 35 | 20 / 24 | 104 / 120 | 265 / 303 |
| `GET /api/wards` | 214 / 309 | 354 / 570 | 1,254 / 1,478 | **2,401 / 5,803** |
| `GET /api/admissions` (whole hospital; 529 KB at 500) | 312 / 375 | 333 / 377 | 1,267 / 1,683 | 2,050 / 2,466 |
| Ward dashboard (2 requests, 25 KB) | 74 / 92 | 90 / 121 | 75 / 118 | 105 / 154 |
| Bed review (2 requests, 125 KB) | 18 / 22 | 15 / 34 | 10 / 17 | 34 / 45 |
| Entry save | 5.3 | 3.7 | 3.3 | 2.9 |
| Approval | 5.4 | 3.5 | 3.4 | 2.9 |
| Media upload (150 KB) | 11.6 | 11.1 | 40.5 | 30.6 |

From 100 to 500 beds, hospital-wide reads grow ×4–7; per-ward and per-bed reads and writes stay flat.

### Store size

The 500-bed store is **4,234 MB with media in-row and 46 MB without**: 99.1 % of it is the `media` table, growing ≈ 1.4 GB a day.

### Model budget

One `RequestBudget` per process: 120/h and 4 in flight by default, one slot per HTTP request. So a `sam+spark` read with 1–2 slots left spends 1–2 SAM requests, then fails at Spark; a voice note can spend its ASR request, then fail.

Demand at 500 beds (450 general beds 4-hourly, 50 HDU beds hourly; jugs 5, trays 3, voice notes 3, text notes 1 and Explain 0.2 per patient-day; busiest hour 2× the average):

| Scenario | Requests/day | Busiest hour | × cap |
| --- | --- | --- | --- |
| A: today, all `sam+spark` | 24,300 | 2,025 | **16.9** |
| B: today, all Spark-only | 11,500 | 958 | 8.0 |
| C: A with segmented trays (3 per tray) | 27,300 | 2,275 | **19.0** |
| D: acuity mix (50 critical hourly `sam+spark`, 100 watch 2-hourly `sam+spark`, 350 stable 4-hourly Spark-only) | 18,400 | 1,533 | **12.8** |
| E: D with segmented trays (trays have no bed, so all 1,500 a day are routine `sam+spark`) | 21,400 | 1,783 | 14.9 |

- At the busiest hour, 120/h serves 33 general beds in `sam+spark`, 67 Spark-only, or 14 HDU beds.
- In D, critical demand is 405 of 1,533 at the busiest hour (26 %; it counts the critical beds' trays, which in fact run routine because trays have no bed).
- **What the reserve covers.** At C = 120 the reserve is 36 an hour: about 12 `sam+spark` reads or 18 voice notes, a floor for critical beds, not cover for their 405. Only once C is sized to busiest-hour demand (≈ 1,533/h) does 30 % keep 459 (⌊0.3 × 1,533⌋, ≈ 460) for critical's 405. Hence the default of 30: right for a sized cap, a floor at the default one.
- D's stable Spark-only reads are `scale-store`'s pressure rule; this change ships the class, the reserve and whole-action admission.

## 2. Goals / Non-Goals

**Goals**
- Every model action is admitted whole or not at all, and under overload critical beds are served first.
- A critical bed is recognisable at a glance on the dashboard, including a suggested one.
- Nothing about acuity is ever applied by the tool.

**Non-Goals**
- Store, read-path and metrics work (`scale-store`).
- Changing alert thresholds or reading intervals per acuity. Acuity changes dashboard order and budget class only. In particular it changes no `low_urine_output` window: bag-emptying's MVP defers its MODIFIED "Low urine output" (the window that would end at a bag reading), so no alert reads the interval until bag-alerts, which ends that window at the newest bag reading and adds a catheter interval, never an acuity one.
- Background workers, queues, retries; cost accounting in dollars.

## 3. Budget model

The symbols:
- C = cap (`MODEL_API_MAX_REQUESTS_PER_HOUR`);
- R = ⌊C · `CRITICAL_RESERVE_PCT` / 100⌋;
- used = requests sent in the rolling hour + requests held by open tickets.

The ceilings:
- a `high` (critical class) action is admitted iff used + n ≤ C;
- a `normal` (routine class) action iff used + n ≤ C − R;
- every action also needs in-flight held + peak ≤ `MODEL_API_MAX_CONCURRENT`, where peak is 2 for a `sam+spark` read (its two SAM requests run together) and 1 for every other action.

**The guarantee at the defaults (C 120, R 36).** Routine actions stop at 84, so in any rolling hour critical actions can always use at least 36 requests, however busy routine beds are: **12 `sam+spark` reads**, or 36 text notes or `spark` reads, or 18 voice notes. More when routine demand is lower. The demo HDU (3 beds read hourly in `sam+spark`) needs 9 an hour.

**Decision: critical reads stay `sam+spark` past C − R.** Moving critical reads to `spark` once used passes C − R would stretch the reserve from 12 reads to 36, but it costs accuracy exactly on the beds that need it most. The reserve covers critical demand only once C is sized to busiest-hour demand (≈ 1,533/h, where 30 % keeps 459 for critical's 405). At C = 120 it guarantees critical beds only 36 an hour (about 12 `sam+spark` reads or 18 voice notes), more while routine demand is low; critical demand beyond what is left of C is refused, not served by downgrading earlier. A critical read drops to `spark` only when 3 no longer fit under C ("Read mode fits the budget"). `scale-store` revisits this with measured data, beside its stable-bed pressure rule. A hospital needing more sizes C (README "Scaling").

**Decision: requests in flight never change the mode.** `fits` checks the hourly ceiling only. When the planned mode's peak does not fit in flight, `reserve` refuses the action with `limit: "concurrent"` and `Retry-After: 5`; a `sam+spark` read with only 1 free slot does not fall to `spark`. A burst clears in seconds, while a downgrade would cost that reading its segmentation for good, on any bed. So `MODEL_API_MAX_CONCURRENT` must be at least 2, validated in `config.ts`: with 1, no `sam+spark` read could ever be admitted. Scenario: "Read mode fits the budget: Busy, not downgraded".

## 4. Decisions

### 4.1 Acuity is a care-order kind, with a ward column for the default

**Chosen.** `acuity` joins `CARE_KINDS`, first because it governs monitoring. It stores `{ level }`. `ward.default_acuity` is a `TEXT NOT NULL DEFAULT 'stable'` column.

**Why a care order.** Acuity is a nursing order with exactly care-plan's semantics: a time range per change (which class a read had at 10:05), `set_by` and `ended_by` (who stepped a patient down), one active order per kind (the partial unique index), `DECIDER_ROLES`, and the existing PUT, DELETE and history routes.

**Alternatives rejected.** An `admission.acuity` column needs its own audit table, routes and role checks. A ward-type table cannot express a bed whose need changes inside a ward.

**Ward default without a route.** The column ships now so `Ward.default_acuity` has its final shape; only the seed writes it. `scale-store` adds the matron's `PUT /api/wards/:id/default-acuity` with who and when.

**How care-plan is affected.**
- The value is specified in `charting/acuity` "Acuity order", not by modifying "Care order values".
- `CARE_CODEC`, `CARE_RULES`, `CARE_VALUE` and the web `CARE_*` registries gain `acuity`. Its rule contributes no prompt.
- "Care status on chart reads" lists `acuity` first. "Fresh store" holds unchanged.
- On the web, acuity has its own chip and bed-review row, so the care-plan order rows, badges and add-order control skip it (MODIFIED in `web/ward`). History keeps acuity rows, labelled `Acuity <level>`, so the audit trail is visible.

### 4.2 Suggestion

`chart/acuity.ts` (pure) computes `acuityFor(order, ward, alerts)`:
- level and source: the active order, else `ward.default_acuity`;
- `suggested`: `critical` if level < critical and alerts ∩ `ACUITY_SUGGEST.critical` ≠ ∅; else `watch` if level is `stable` and alerts ∩ `ACUITY_SUGGEST.watch` ≠ ∅; else null;
- `reasons`: alerts ∩ `ACUITY_SUGGEST[suggested]`, in alert order. Kinds of the other list are not listed (a bed with `low_urine_output` and `logging_gap` gives `["low_urine_output"]`).

**What a suggestion does, exactly.** It raises the bed's dashboard group (`web/ward`) and its budget class (`capture/read-budget`). It is never stored, never changes `level` or any order, and is never applied. The screen says "Review"; a nurse confirms with one PUT. Suggestions only ever raise: a step-down is a clinical decision.

The lists are closed. bag-emptying's `bag_reading_due`, `bag_reading_overdue`, `bag_level_fell`, `bag_nearly_full` and dietitian's `poor_meal_intake` suggest nothing unless a later change names them. The server owns the lists rather than deriving them from the web's `ALERT_TONE`: tone is presentation, the suggestion is a rule tests cite.

### 4.3 Budget: one gate, reserved per action

**Who does what.** `routes/ai.ts` stays HTTP: it validates, resolves the bed and its status, and maps the result or the 429. `ai/budget-policy.ts` is the domain module, over `AiPorts` (which gains `budget`, §0), that classes, plans, reserves and runs each action. No route touches the budget; `/status` keeps its direct `models.list` call (the rule's one exception), which goes through `acquire()` at `normal`.

**Flow for one model action:**

1. Route: validate the body (400, 0 requests). Resolve `admission_id` where the route takes one (read-outcomes: `/read`, `/note`, `/voice-note`; `/explain` by its own id): unknown gets 404 with 0 requests. `/meal` takes none in tray-segmentation's MVP. Compute the bed's status fresh, `chartView` for that one admission (≈ 2–4 ms at 500 beds), and pass it to the pipeline as `status` (null without a bed).
2. Policy: `budgetClass(status)` is `critical` when `level` or `suggested` is `critical`, else `routine`; null is `routine`.
3. Policy: `plan(kind, requestedMode, class, budget)` returns `{ mode, requests, peak, priority }`:

   | Action | `sam+spark` requests (peak) | `spark` requests (peak) |
   | --- | --- | --- |
   | Photo read | 3 (2) | 1 (1) |
   | Tray read | 3 (2) | 1 (1) |
   | Voice note | — | 2 (1) |
   | Text note, Explain | — | 1 (1) |

   - `sam+spark` iff it was requested (or is the `READ_USE_SAM` / `MEAL_USE_SAM` default) and `budget.fits(3, priority)`. `fits` is hourly only, so `peak` never changes the mode (§3).
   - Otherwise `spark` iff `fits(1, priority)`, with the warning `budget pressure: read without segmentation` when `sam+spark` was wanted.
   - Otherwise the action is refused through `budget.reserve(n_min, …)`, which throws the `MetaBudgetError` carrying the retry time.
   - `fits` is a pure check: nothing is sent or retried. This is choosing a mode before any request, not a fallback chain.
4. Policy: `ticket = ports().budget.reserve(requests, { priority, peak })`.
5. Policy: `withBudget` runs the pipeline with `{ signal, ticket }` on every port call; the transport takes each slot from the ticket. On a downgrade it adds the warning `budget pressure: read without segmentation`.
6. Policy: in `finally`, `ticket.release()` returns unsent slots: a voice note whose ASR fails returns its Spark slot (hour + 1); SAM failures still count as sent.
7. Route: map the response; on `MetaBudgetError`, 429 `BudgetRefusal` with `budget_class` from `err.priority` (`high` → `critical`, `normal` → `routine`, so `/api/ai/status` maps as `routine`) and `Retry-After` = ⌈ms / 1000⌉, at least 1.

The ticket is **all or nothing**: a read never spends SAM and then fails at Spark. Steps 2–4 run in `withBudget` with no `await` between `plan` and `reserve`, so in Node's single thread they cannot race. The pipeline's budget-error rethrow after SAM (`pipeline.ts:110`) goes: SAM can no longer meet a budget refusal.

**Retry time.**
- Hourly: with k = used + n_min − ceiling, `retryAfterMs` is when the k-th oldest send leaves the hour, at least 1 s ("Request budget: Retry time"). If the excess is held by running actions rather than sent, 60 s ("Retry time when the excess is held"). If n_min alone exceeds the class's ceiling (a tiny cap), 1 h ("Retry time when the action exceeds its ceiling"). Each maps to a whole-second `Retry-After` (60 and 3600) under "Local budget refusal".
- Concurrent: a fixed 5,000 ms (`Retry-After: 5`).

**429 body.** The code stays `request_budget_exceeded` (the server already returns it and tray-segmentation specifies it). `retryable` becomes `true`, as for upstream 429s; this is the BREAKING change in the body.

**Alternatives rejected.** Queue and fire later (delays silently, may fire after the nurse charted by hand, breaks the no-polling rule). Per-request slots, as today (partial actions). Per-ward quotas (fragment the budget; acuity, not ward, is the clinical signal). Client-sent priority (the server knows the bed).

### 4.4 @meniscus/meta stays generic

- `priority: 'high' | 'normal'` and `reservePct` carry no acuity words.
- A `Ticket` is bound to the `RequestBudget` that issued it: `take()` takes from that budget, whichever client's transport calls it. A transport given a ticket from another budget throws a plain `Error('ticket from another budget')` before sending, so one action can never draw on two budgets.
- Callers without a ticket (`models.list`, the scripts) keep per-request `acquire()` at `normal`, so they are subject to the reserve.
- `MetaBudgetError.retryable` is `true`; the client still never retries.

### 4.5 Web

- **`lib/ward.ts`.** `wardOrder` sorts by `groupLevel(a)`, the higher of `acuity.level` and `acuity.suggested`, then today's key. `filterByAcuity(beds, level | 'all')` is pure.
- **Bed card.** An acuity chip and a `Suggested … · Review` chip; reasons use `ALERT_LABEL`. Care badges skip `acuity`.
- **Bed review** (`lib/acuity.ts` `acuityView(status, role)`). The acuity row shows level and source. A nurse or matron gets a level select with "Ward default" (one DELETE) and, for a suggestion, Confirm (one PUT). The care-plan section skips acuity in its rows and add-order kinds; History labels it `Acuity <level>`.
- **Capture** (`lib/capture.ts`). The state gains `refused: { until, budgetClass, limit }` from a 429 `BudgetRefusal`: the media is kept, Enter by hand opens at once, Read again is disabled until `until` via `useNow`. The copy follows `limit`: `hourly` says reads are used up until `HH:MM` (naming routine beds when `budgetClass` is `routine`); `concurrent` says they are busy, read again in a few seconds. No timer fires a request.
- **Ward round** (`lib/round.ts`). The button keeps `Read <n> · <k> model requests`, with k the most the waiting reads can make (3 per photo, 1 in fast mode, 2 per recording), as read-outcomes' "Round reads and saves carry their read" keeps it. Each reading's mode and warnings come from its response: a photo makes 3 in `sam+spark` or 1 in `spark`, and 0 when refused. A refusal marks the reading failed, with Retry disabled until its `Retry-After` via `useNow`.

### 4.6 Scripts at normal priority

- `metaClient()` passes `reservePct: CRITICAL_RESERVE_PCT`, so scripts sharing it see the reserve.
- The synthesis script (`scripts/synth-images.ts:13`, which calls `main` in `src/lab/synth.ts`) passes `reservePct: CRITICAL_RESERVE_PCT` in `main`'s deps. `main` (`src/lab/synth.ts:417`) takes `left = stats().remaining.normal` with `--yes`, and `perHour − ⌊perHour · reservePct / 100⌋` in a dry run, which is `routineCeiling(config)` (MODIFIED "Hourly budget checked first").
- `scripts/eval.ts:88-90` compares its plan with `routineCeiling(config)` instead of `MODEL_API_MAX_REQUESTS_PER_HOUR`, and names it in the message. A plan between 84 and 120 is now refused up front instead of failing at request 85.

## 5. Data flow

```
photo ─► POST /api/ai/read {image, mode?, admission_id?}
         │ route: validate (400, 0 req) ─► bed? (404, 0 req) ─► status(bed), fresh
         ▼
         budget-policy (over AiPorts): class = critical | routine
         │ plan: sam+spark (3) | spark (1) | refuse          (hourly ceiling only)
         │ ports.budget.reserve(n, {priority, peak}) ── MetaBudgetError ─► route: 429 request_budget_exceeded, Retry-After (0 req)
         ▼
         pipeline(ticket): SAM×2 ─► Spark ─► draft     (each request: ticket.take())
         finally ticket.release()                       (unsent slots back)
         route: response {mode, warnings[+budget pressure], …}
```

## 6. Migration plan

**Schema.** `ward.default_acuity TEXT NOT NULL DEFAULT 'stable'` goes into `SCHEMA`'s `CREATE TABLE ward`, and `STORE_SCHEMA_VERSION` goes from 2 to 3. If the live `STORE_SCHEMA_VERSION` is not 2 at apply time, stop: changes were applied out of order. There is no upgrade step: a store file from before this change fails to open (charting/entries "Store schema version"); delete `DATA_DIR` or re-seed it with `scripts/demo-history.ts`. `seed()` writes HDU as critical.

**Rollback.** An older build refuses a file at this schema version, so roll back with a fresh `DATA_DIR`.

## 7. Risks / Trade-offs

- **Critical demand starves routine.** If critical demand reaches C, routine actions are refused for the hour, and red prompts inflate the critical class through `suggested`. → Manual entry always works at 0 requests; the lists are closed (4 kinds); the fix is to size C (README "Scaling").
- **Concurrency is not reserved.** A critical read can get 429 `concurrent` in a burst. → `peak` is held per action; the read is refused for 5 s rather than downgraded; config enforces `MODEL_API_MAX_CONCURRENT` ≥ 2, and README "Scaling" advises ≥ 8 at hospital scale.
- **A short budget reads with Spark only.** → The response names the mode, the nurse sees `budget pressure`, and low confidence still gates review.
- **Per-process state.** The budget resets on restart, as today.
- **Status per action.** Each model action computes one bed's status fresh (a few ms); `scale-store` keeps that fresh rather than reusing the dashboards' cached status.

## 8. Overlaps with in-flight changes

Fixed apply order: care-plan (archived 3 Nov) → bag-emptying → tray-segmentation → read-outcomes → dietitian → **acuity-budget** → tray-comparison → bag-alerts → accuracy-views → dietitian-care → scale-store → postgres-store → read-queue. image-synthesis archived on 3 Nov. tray-comparison MODIFIES five of this change's requirements (three in `capture/read-budget`, two in `capture/meal-reading`) and copies their archived text.

| Change | Overlap | Resolution |
| --- | --- | --- |
| **care-plan** (archived) | `CARE_KINDS`, registries, `chartView`, "Care status on chart reads", the web care-plan section, badges and add-order control | Acuity joins through the registries. MODIFIED blocks copy the live text. |
| **bag-emptying** | Reading interval by ward code (`HDU` 1 h, else 4 h, `interval_from: default`); bag prompts | Untouched here. Its HDU 1 h agrees with HDU's `critical` default. Its MVP has no catheter `measure_every_h` and defers the "Low urine output" MODIFIED, so no alert reads the interval until bag-alerts (after tray-comparison), and acuity changes no interval and no alert. Bag prompts suggest no acuity (closed lists). Intervals by acuity are `scale-store`. |
| **tray-segmentation** | Tray reads 3 (`sam+spark`) or 1 (`spark`); "Tray segmentation degrades" and its "Budget spent" scenario; no `admission_id` and no 5-request served-photo path in its MVP | Tray reads are routine (no bed). MODIFIED "Tray reading" and "Tray segmentation degrades": 1–2 left runs `spark` with 1; none left is 429 with 0. "Budget spent" becomes stricter (0 sent, not 1), through the spec. |
| **read-outcomes** | `admission_id` on `/read`, `/note`, `/voice-note`; "Reads name their bed" | MODIFIED: the bed sets the class; request bodies never vary with it; counts per mode, 0 when refused. A refused read answers 429, so "Reads are logged" stores no read for it. Downgraded reads store `mode: spark`, so its accuracy view splits them. Its ADDED `web/ward-round` "Round reads and saves carry their read" stays valid: the button keeps `Read <n> · <k> model requests` (`Read 5 · 13 model requests` for its Imported queue), and a photo read is still 3, or 1 in `spark` mode. |
| **dietitian** | `charting/nutrition` on chart reads; `poor_meal_intake` (amber) | No overlap in specs: dietitian adds no care kind and does not modify "Care status on chart reads". `poor_meal_intake` suggests no acuity. |
| **image-synthesis** | `@meniscus/meta` `images.*`; the synthesis script's `left = perHour − lastHour` | `CallOptions` is unchanged by it, so `ticket` is additive. MODIFIED "Hourly budget checked first": `left` is `remaining.normal` (dry run: the routine ceiling). |
| **scale-store** | Everything deferred | Applies after this change and builds on its archived specs. |

## 9. Open questions

- The busiest-hour factor (2×) and the per-patient-day counts are assumptions from PLAN §10. Pilot data changes only the sizing advice, not the design.
