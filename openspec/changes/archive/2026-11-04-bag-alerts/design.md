# Design

## Context

See proposal.md, "Why". This change applies after bag-emptying, read-outcomes, dietitian, acuity-budget and tray-comparison have archived ("Overlaps"). It builds on their archived text and code. The state that shapes the approach:

- **Bag readings** (bag-emptying):
  - they are rows of `level` with a non-null `event`;
  - `store.addBagReading` (`apps/server/src/store/store.ts:1377`) runs one transaction: load the neighbours `p` and `n`, the fall guard (`clearsFall` → `Forbidden`, 403), `charge`, insert, then the entry for Δ > 0 with `level_id` / `prev_level_id`;
  - an entry's `levels.before` is the bag's previous reading **at save**, and its `created_at` is its reading's charted time.
- **Reading interval** (bag-emptying):
  - `readingInterval(admission)` (`packages/shared/src/index.ts:829`) returns `{ h, from: 'default' }` from a private ward-code map;
  - `bagChart` (`apps/server/src/chart/bags.ts:196`) uses it for the due prompts, and the web uses it for "Emptied after photo".
- **Reading-due clock** (bag-emptying, `apps/server/src/chart/bags.ts:230-235`): `since = max(newest urine-bag reading, active catheter order's start_at)`. A new order row therefore restarts the clock, and its message then names the new order's start.
- **Read links** (read-outcomes): `routes/bags.ts` runs `linkProblem` after the body, 404, `charted_at` and media checks, and before `addBagReading`. The `read_link` row is inserted inside `addBagReading`'s transaction, so a rollback removes it.
- **Low output today** (`apps/server/src/chart/alerts.ts:33`): approved urine charted in `(now − 6 h, ∞)`, gated on `now − admitted ≥ 6 h`, compared unrounded. The web's `urineRate` (`apps/web/src/lib/charts.ts:48`) uses `(t − 6 h, t]`, so the two disagree on an entry charted a little ahead of the clock. Bag entries count whole at their charted time.
  - `chartView` loads entries since `min(now − 24 h, chart-day start)` (`apps/server/src/chart/view.ts:31`);
  - `alertsFor` filters them to its 24 h `day` and `approved` lists (`alerts.ts:25-27`), and the low-output sum reads `approved`.
- **Catheter orders** (care-plan):
  - stored JSON through `CARE_CODEC` (`apps/server/src/chart/care.ts:62`), keys in a fixed order so equal values compare equal;
  - "set before the chart day" and reviews are per order row (`chart/care.ts:251`, `store.ts:1544`);
  - the web offers "Reviewed today" from the active order's `start_at` (`apps/web/src/lib/care.ts:186`);
  - `chartView`'s orders are those active or ended in the last 24 h (`store.careOrders(id, now − 24 h)`, `store.ts:952`; the ward list's `careOrdersByWard`). `care_history` on `GET …/entries` holds the newest `CARE_HISTORY_LIMIT` (50).
- **The round's beds** come from `GET /api/admissions?ward=` (`apps/web/src/routes/a/round.tsx:90`), whose items carry `care.orders`. A bed scanned from another ward comes from `GET /api/beds/:token`, an `Admission` with no care.
- **Constraints.** No new model request anywhere. Prompts are computed on read (no timers). Nothing patient-related is logged. The store has no upgrade path (charting/entries "Store schema version"): the new column goes into `SCHEMA` with a `STORE_SCHEMA_VERSION` bump.

## Goals / Non-Goals

**Goals:**
- One duplicate rule, enforced in the transaction that saves the reading, so two quick taps cannot both pass, and a confirmation names the reading it confirms.
- One urine-counting function shared by the prompt and the chart, so the latest chart point always equals the prompt.
- The catheter interval is optional and local: absent, every bed behaves exactly as under bag-emptying.
- Changing a catheter's interval never resets what belongs to the catheter: its necessity review and its reading-due clock.
- No requirement of read-outcomes, acuity-budget or dietitian changes text.

**Non-Goals:**
- Editing or re-charting any stored entry or reading (bag-emptying's invariant stays).
- Capacities per bag instance; stoma or drain reading-due prompts; acuity intervals (scale-store).

## Decisions

### 1. Shared types and helpers (`packages/shared`, first)

```ts
// config (code constants, as bag-emptying's)
export const BAG_CAPACITY_ML = { urine_bag: 2000, stoma_bag: 500, drain_bag: 1000 } as const satisfies Record<BagContainer, number>
export const BAG_NEARLY_FULL = 0.8
export const DUPLICATE_WITHIN_MIN = 10   // inclusive, either side of the charted time
export const DUPLICATE_TOLERANCE_ML = 25 // inclusive
export const MEASURE_EVERY_H = [1, 2, 4, 6, 8, 12] as const
export type MeasureEveryH = (typeof MEASURE_EVERY_H)[number]

// care plan (BREAKING)
CareValues['catheter'] = { type: CatheterType; inserted_at: string; measure_every_h: MeasureEveryH | null }
CareInput<'catheter'> = { type: CatheterType; inserted_at: string; measure_every_h?: MeasureEveryH | null }
/**
 * The catheter an active order belongs to: walk back through orders ending where the next starts, same type and inserted_at.
 * `orders` is the admission's full catheter history: the server's `store.catheterOrders`, the web's `care_history`.
 */
export function catheterSince(orders: readonly CareOrder[], active: CareOrder<'catheter'>): CareOrder<'catheter'>[] // the chain, oldest first

// reading interval (BREAKING: `from` widens; a second argument)
export interface ReadingInterval { h: number; from: 'catheter' | 'default' }
export function readingInterval(
  admission: Pick<Admission, 'ward_code'>,
  catheter?: Pick<CareValues['catheter'], 'measure_every_h'> | null, // the ACTIVE catheter order's value
): ReadingInterval // measure_every_h ?? ward-code default

// bag readings
BagReadingInput += { confirm_duplicate_of?: number } // a positive integer: the id of the reading the staff member was shown
BagReading += { confirmed_duplicate_of: number | null } // BREAKING (fixtures)
export interface BagDuplicate { id: number; event: BagEvent; volume_ml: number; created_at: string }
export interface DuplicateReadingBody { error: 'duplicate_reading'; duplicate_of: BagDuplicate }

// alerts (BREAKING)
ALERT_KINDS: … 'bag_reading_due', 'bag_reading_overdue', 'bag_level_fell', 'bag_nearly_full', 'poor_meal_intake' (dietitian's, last)

// urine counting: one source for the server's prompt and the web's chart (pure)
export interface UrineWindow { from: number; to: number; bagAt: number | null } // bagAt: to, when it is a bag reading
export function urineWindow(i: {
  urineBagReadingsAt: readonly number[] // charted times of the admission's urine-bag readings, any event
  entries: readonly Entry[]             // to find urine entries not charted from a bag reading
  intervalH: number
  now: number
}): UrineWindow
/** Approved urine in (from, to]: bag entries spread over (levels.before.created_at, created_at], else whole at created_at; whole mL (Math.round). */
export function urineInWindow(entries: readonly Entry[], from: number, to: number): number
```

`urineWindow`:

```
newest = max(urineBagReadingsAt ∩ (−∞, now])          // none → to = now
other  = pending or approved urine entries with levels === null (not charted from a bag reading)
to     = newest when newest exists and now − newest < 2 × intervalH h and no `other` is charted after newest
         else now
from   = to − 6 h                                      // at most 30 h back: newest < 24 h old at the 12 h maximum
```

`urineInWindow`, per approved `urine` entry `e`:
- `end = created_at(e)` and `start = e.levels?.before?.created_at`;
- with a `start` before `end`, it counts `volume × |(start, end] ∩ (from, to]| / (end − start)`;
- otherwise (no reading before it at save, as for a bag's first reading, or not a bag entry) it counts whole when `end ∈ (from, to]`.

The sum is rounded once, at the end. `levels.before` is the reading before at save. The entry's volume was charged against that reading, so the spread covers exactly the span the volume came from.

### 2. Layer ownership

| Module | Layer | Owns |
|---|---|---|
| `packages/shared/src/index.ts` | shared | constants, types, `readingInterval`, `catheterSince`, `urineWindow`, `urineInWindow` |
| `apps/server/src/chart/bags.ts` | domain, pure | `duplicateOf(stored, r)`; the `bag_nearly_full` prompt and the reading-due clock from the catheter's start in `bagChart` |
| `apps/server/src/chart/alerts.ts` | domain, pure | `alertsFor(…, { nilByMouth, window })`: the windowed rule over its own approved list, and its two messages |
| `apps/server/src/chart/care.ts` | domain, pure | the catheter codec; the review state over the chain; `careChart` passes `window` through |
| `apps/server/src/chart/view.ts` | domain | the active catheter → interval; the full catheter history → chain; the readings → `urineWindow`; entries back to `window.from` |
| `apps/server/src/store/store.ts` | storage | `confirmed_duplicate_of` in `SCHEMA` and the `STORE_SCHEMA_VERSION` bump, the duplicate check in `addBagReading`, `catheterOrders(admissionId)` and `catheterOrdersByWard(wardId)` (the full catheter history), chain-aware `reviewCatheter` and `lastReviewOf(orderIds)` |
| `apps/server/src/routes/bags.ts`, `routes/care.ts` | HTTP | `confirm_duplicate_of` (zod `z.number().int().positive().optional()`), `Duplicate` → 409; the catheter body |
| `apps/web/src/lib/bags.ts`, `round.ts`, `charts.ts`, `care.ts`, `labels.ts`, `api.ts` | web, pure | duplicate text and resend plans, nearly-full line, round events, rate series, care row, form and history text, labels |
| `apps/web/src/components/bag-reading.tsx`, `missed-emptying.tsx`, `bag-periods.tsx`, `care-forms.tsx`, `care-plan.tsx`, `bed-charts.tsx`, `routes/a/round.tsx` | web UI | |

`packages/meta` and `apps/server/src/ai` are untouched.

### 3. Data model

```sql
-- level, in SCHEMA's CREATE TABLE; STORE_SCHEMA_VERSION goes from 4 to 5
confirmed_duplicate_of INTEGER REFERENCES level(id)   -- NULL: not saved as a confirmed duplicate
```

- **Version.** `STORE_SCHEMA_VERSION` goes from 4 to 5. If the live `STORE_SCHEMA_VERSION` is not 4 at apply time, stop: changes were applied out of order.
- **No upgrade.** No upgrade step: a store file from before this change has the previous schema version and fails to open (charting/entries "Store schema version"). Delete `DATA_DIR` or re-seed it with `scripts/demo-history.ts`.
- **Catheter values.** No schema change; the value lives in `care_order.value` JSON.
  - `toRow` writes `measure_every_h` only when it is non-null, so `{type, inserted_at}` and `{type, inserted_at, measure_every_h: null}` store identical JSON. An order set without an interval keeps that JSON, and the 200 "same value" rule holds for both.
  - `fromRow` returns `measure_every_h ?? null`.
- **Reviews** keep `order_id`. The chain is derived from the orders and never stored.
- **Catheter history.** `catheterOrders(admissionId)` selects every `care_order` of kind `catheter` for the admission, oldest first, on the existing `care_order_admission (admission_id, start_at)` index. `catheterOrdersByWard(wardId)` does the same for a ward's admissions in one query, beside `careOrdersByWard` in `WardReads`.

### 4. Duplicate check (`addBagReading`, inside its transaction)

The order of checks for `POST …/bag-readings`:

1. route: zod, including `confirm_duplicate_of`, → 400;
2. route: admission → 404;
3. route: `charted_at` → 400;
4. route: media → 400;
5. route: read-outcomes' `linkProblem` → 400 (`already linked` among others);
6. transaction: neighbours, then the fall guard → 403;
7. transaction: `duplicateOf` → 409, unless `confirm_duplicate_of` equals the match's id;
8. transaction: `charge`, insert (with `confirmed_duplicate_of`), entry, `read_link`.

```
duplicateOf(stored, r) = the stored reading x of the same admission and container with
  x.event == r.event and |x.volume_ml − r.volume_ml| ≤ 25 and |x.t − r.t| ≤ 10 min,
  the nearest in time (then the newest id) when several match
save when  no match                              → confirmed_duplicate_of: null
           match and confirm_duplicate_of == id  → confirmed_duplicate_of: id
           match otherwise                       → Duplicate(match), 409
```

- **Query.** One indexed query on `level_admission_container` over `[t − 10 min, t + 10 min]`.
- **Why inside the transaction.** node:sqlite runs writes one at a time, so a double tap's second request sees the first reading and gets 409. A route-level check could let both through between check and insert.
- **Why an id, not a flag.** A boolean confirms whatever matches at the time it arrives:
  - **Lost response.** "Save anyway" saves reading 102, the response is lost, and the re-tap would save a third reading. With the id, the re-tap's nearest match is 102 itself (nearer in time than the reading it confirmed, or the newest id at equal distance), so it gets a 409 naming 102 and saves nothing.
  - **Match changed.** If another staff member saved a nearer match between the 409 and the tap, the tap gets a fresh 409 naming it, rather than a blind confirmation.
- **Why 403 before 409.** A refusal that a nurse must make is never turned into a confirmation that would only lead to the refusal. "Not a way past the nurse" shows `confirm_duplicate_of` cannot skip the 403.
- **Why the link check is first.** A re-post of a linked reading (its response lost) answers `already linked`. read-outcomes' round already counts that as saved. A 409 rolls back the whole transaction, so it links nothing, and "Save anyway" can resend the same `read_id`.
- **The answer.** `Duplicate` (a new error class beside `Forbidden`) carries the `BagDuplicate`, and the route returns `{ error: 'duplicate_reading', duplicate_of }` with 409.
- **`confirm_duplicate_of` on a reading that repeats nothing** is ignored, and the reading is stored with `confirmed_duplicate_of: null`. The id is not checked to exist: it only ever has to equal the current match.
- **Different events.** "Emptied it now?" posts an emptying at the check's level a moment after the check; the different event keeps it from being refused.
- **Late readings.** The window covers both sides of the charted time, so a late duplicate is caught too.

### 5. Bag nearly full (`bagChart`)

- **The rule.** Per bag: `newest` is the bag's newest reading by `(t, id)`. The prompt is raised when `newest.event === 'check'`, `newest.volume_ml ≥ BAG_NEARLY_FULL × BAG_CAPACITY_ML[container]` and `now − newest.t < 24 h`.
- **The message.** `${BAG_WORDS[container]} nearly full: ${level} of ${capacity} mL at ${when(t, now)}. Review.`
- **Order.** Bag prompts are due/overdue, falls, then nearly full, in `BAG_CONTAINERS` order. `chartView` appends them after the care prompts and before dietitian's `poor_meal_intake`.
- **Acuity.** `bag_nearly_full` is in neither of acuity-budget's `ACUITY_SUGGEST` lists, so it suggests nothing and leaves the budget class alone.

### 6. Low urine output

- **Wiring.** `chartView` already loads the bag readings for `bagChart`. It now:
  1. finds the active catheter in its orders;
  2. computes `interval = readingInterval(admission, catheter?.value)`;
  3. loads the base entries as today, since `min(now − 24 h, chart-day start)`;
  4. computes `window = urineWindow({ urineBagReadingsAt, entries: base, intervalH: interval.h, now })`. The base is enough here: `window.to` can be a bag reading only while it is under 2 × 12 h old, so any urine entry charted after it is in the base;
  5. when `window.from` is earlier than the base's start (a newest reading over 18 h old, which needs an interval of 10 h or more), loads the entries since `window.from` instead, in one more `store.recent` call. Entries are thus loaded from `min(now − 24 h, chart-day start, window.from)`;
  6. passes `window` to `careChart`, then to `alertsFor`.

  `alertsFor`'s default window is `(now − 6 h, now]` with `bagAt: null`, so every existing caller and test keeps its behaviour.
- **Its own approved list.** The low-output sum no longer reads `alertsFor`'s 24 h `approved` (`alerts.ts:25-27`). It counts `urineInWindow(entries.filter(approved urine), from, to)` over everything loaded. Every other rule keeps its own filter (`day`, `approved`, `within(h)`, the chart day), so the entries loaded further back change nothing else, including the mismatch and intake-incomplete companions, which keep their 24 h intake.
- **The rule.** It is `w && window.to − admitted ≥ 6 h && urineInWindow(approvedUrine, from, to) < 0.5 × w × 6`.
- **The two messages:**
  - `bagAt === null`: the live text, `Urine output ${ml} mL in 6 h, below ${t} mL (0.5 mL/kg/h at ${w} kg). Review.`;
  - otherwise: `Urine output ${ml} mL in the 6 h to the ${when(bagAt, now)} bag reading, below ${t} mL (0.5 mL/kg/h at ${w} kg). Review.`.
- **Why end at the newest reading.** Output since the last reading has not been measured, so a window ending now counts a 4-hourly bag's unmeasured hours as 0 mL. Twice the interval matches `bag_reading_overdue`. From then on a missing reading is itself a reason to review, and the window returns to now.
- **Why "no pending or approved urine entry not charted from a bag reading after it".** After a catheter comes out, urinal entries are measured output after the bag's last reading. Ending the window at the bag reading would ignore them. A pending one counts here, though not in the sum, because it already shows the bag is no longer the measure; a rejected one does not.
- **Why spread from the reading before at save.** Each bag entry's volume was charged against that reading (`charge`), so the volume belongs to that span:
  - on-time readings: exact;
  - a late reading inserted between two others: its Δ is spread over `(p, r]` while part of it belongs to `(r, n]`. Totals over any window covering whole spans stay exact; only the split near a window edge is approximate. The bed review's periods give each reading's true rise.
- **Why whole at its reading when there is none.** A bag's first reading has no span to spread over: its volume was in the bag before anyone measured it, and bag-emptying charts it at the reading. Counting it whole there matches bag-emptying's entry.
- **Why round once.** The comparison and the message use the same whole number, so `179 mL … below 180 mL` can never read `180 mL … below 180 mL`.
- **Pending entries.** As before, only approved urine counts. The newest reading's pending entry does not count until approved, even though the window ends at it.
- **Web.** `urineRate` takes `bags` and uses the same two functions. Its anchor is `window.to`, with points at `to − i h` for `i = 0…` while `≥ now − 24 h`, each over `(t − 6 h, t]` with `urineInWindow`. The caption is `To the ${when(bagAt)} bag reading` when `bagAt` is set.
  - The web's `urineBagReadingsAt` comes from `bags.periods`, which hold every reading of the last 24 h. With `measure_every_h ≤ 12`, a newest reading under 2 × interval old is always in that window, which is one reason the range stops at 12.
  - The web already has every entry of the admission (`GET …/entries`), so a window reaching 30 h back needs no new request.

### 7. Catheter reading interval: keep it, as an optional per-catheter override

**Decision.** `catheter.measure_every_h` (1, 2, 4, 6, 8 or 12, or null). When set it takes precedence over the default interval (`interval_from: catheter`), and once scale-store lands over the acuity interval too. When null the bed's default applies, unchanged.

**Why keep it, rather than drop it in favour of acuity:**
- **It is the clinical order.** "Hourly urine output" is prescribed per patient: after major surgery, in AKI or sepsis, on a fluid challenge. Many of those patients stay on a general ward. Acuity is a coarse three-level class that also sets the model budget class and the dashboard group (acuity-budget). Raising a bed to `critical` only to get hourly readings would spend the critical reserve and reorder the dashboard: two decisions forced into one.
- **It lives where it has effect.** Reading-due prompts already need a catheter order (bag-emptying), so the override is scoped to the thing being measured. Removing the catheter removes the interval, with no stale per-bed setting left behind.
- **Acuity stays the default.** With no override, scale-store's acuity intervals apply to every bed. Nothing about acuity is weakened.
- **It is available now.** Acuity intervals arrive only with scale-store, after the deadline. Without the override, a general-ward patient on hourly output gets 4-hourly reminders until then.

**Alternatives rejected:**
- *Drop it; use acuity* (above).
- *A separate care kind, e.g. `urine_output_every`*: it would need its own lifecycle, and it means nothing without a catheter.
- *A per-bed interval column*: it outlives the catheter, and is not audited like care orders.

**Consequence: the review and the reading-due clock follow the catheter.** Care orders are immutable ranges, so changing only the interval ends the order and starts a new one. Under the live rules, that new order is "set today", which hides that day's necessity review and restarts `last_review`; and it restarts bag-emptying's reading-due clock (`bags.ts:230-235`), so tightening an overdue bed to 2 h would clear its `bag_reading_overdue`. The catheter is the active order plus the orders it replaced with the same `type` and `inserted_at`, from `catheterSince` over the **full** catheter history (`store.catheterOrders`; the ward list's `catheterOrdersByWard`), never `chartView`'s 24 h orders, which can miss the chain's start.
- MODIFIED **Catheter necessity review**:
  - `due` uses the chain's first `start_at`;
  - `reviewed` and the 409 look at reviews of any order in the chain for that chart day;
  - `last_review` is the chain's latest.
- MODIFIED **Urine bag reading due**: `since = max(newest urine-bag reading, chain[0].start_at)`, and the "no reading since the catheter order at …" message names `chain[0].start_at`. The interval is still the active order's, so a tightened interval applies at once to the true elapsed time.

`catheterSince` is shared. The web's "Reviewed today" offer (`lib/care.ts:186`) uses the same start, over `care_history`. A new `type` or `inserted_at` is a new catheter, which is the live behaviour.

**What scale-store must then keep**: see "Overlaps", scale-store. Its delta is not edited here.

### 8. UX

The specs carry the exact text. The design choices:

- **Duplicate panel** (check screen, "Bag level", "Emptied it now?"):
  - **Layout.** It replaces the saved message in place: the duplicate line, then "Save anyway" (secondary) and "Discard" (primary). The safe choice is the easy one, and "Discard" is apps/web/DESIGN.md §3.2's word for undoing a capture before saving.
  - **Event words.** `emptied`, `checked`, `bag changed`.
  - **The resend.** `lib/bags.ts` keeps the first attempt's body (with its `media_id` and the `read_id` decision read-outcomes fixes at the first attempt). "Save anyway" posts that body plus `confirm_duplicate_of: duplicate_of.id`, exactly once per tap. The button is disabled while the post is in flight. A 409 answer to it (a lost response re-tapped, or a new match) replaces the line with the new match, and the next "Save anyway" confirms that one.
  - **"Discard".** It sends nothing and leaves the uploaded photo unlinked; the existing media expiry removes it.
- **Nearly full.** The check screen shows one line under the preview when the drafted level and event qualify. Once that check is saved, the after-save step leads with "Emptied it now? Add after-emptying photo" (bag-emptying's flow), with no other change.
- **Round** (`lib/round.ts`, `routes/a/round.tsx`):
  - `Reading.bag = { event }`, set at read time to `emptied` when `emptiedByDefault(bed.interval)` (interval ≥ 4 h), else `check`;
  - the event is **one choice-chip radio group**, `Check · Emptied · Bag changed` (apps/web/DESIGN.md §4.8: `role="radio"` in a `radiogroup`, min 48 px, accent fill when selected; §7.1), with no switch beside it;
  - `RoundBed` gains `interval: ReadingInterval`, computed in `setWard` from each ward-list item's active catheter (`care.orders`). A bed from another ward, looked up by token, has no care and takes `readingInterval(bed, null)`; the chips let staff correct it;
  - a 409 sets `Reading.duplicate`. "Save all" skips readings with `duplicate` set, and "Save anyway" calls `saveBag(reading, { confirmOf: reading.duplicate.id })` with the stored `media_id`. A second 409 replaces `duplicate`.
- **Care plan.**
  - The row line comes from `bags.interval_h` and `interval_from`, already on `GET …/entries`: `Bag reading every <h> h`, plus ` · Ward default` when `interval_from` is `default`. That is apps/web/DESIGN.md §7.5's source wording, used here instead of a bare `default`.
  - The form's first option, `Ward default (<h> h)`, comes from `readingInterval(admission, null)`.
  - Saving keeps `type` and `inserted_at` exactly as stored (`exact`, `lib/care.ts:238`), so the catheter day and the chain hold.
  - "Reviewed today" is offered from `catheterSince(care_history, active)[0].start_at`.
  - History text: `CARE_HISTORY_TEXT.catheter` appends `, bag reading every <h> h` when set.
- **Rate chart.** `bed-charts.tsx` shows the caption under the plot; the series comes from `urineRate`.
- **Missed emptying.** The 409 replaces the form's footer with the line and two buttons. "Save anyway" resends once with `confirm_duplicate_of`. "Cancel" (the sheet's close, apps/web/DESIGN.md §4.11) reloads the bed review, so the other nurse's emptying shows.
- **Saved anyway.** The `bag-periods.tsx` row suffix is computed from `confirmed_duplicate_of` against the period's readings, falling back to the bag's readings in `bags`.

### 9. Proof and logging

- **What is kept.** `confirmed_duplicate_of` keeps the staff decision with the reading, beside `created_by` and `recorded_at`. The 409 body carries only ids, levels, events and times.
- **What is logged.** Nothing new beyond path, status and timing.

### 10. Config

All constants are in `packages/shared` (§1), as bag-emptying's config is. Changing one is a code change. Tests cite the default values.

### 11. Demo (`scripts/demo-history.ts`, fictional)

- **Seeding.** The 2C-2 story is seeded in bag-emptying's bag section, through `store.setCare`, `store.reviewCatheter` and `store.addBagReading` at the scripted clock. That is before read-outcomes' alerts snapshot, so the snapshot already includes it.
- **Reads and links.** Its photo readings get synthetic reads and links the way read-outcomes seeds bag-emptying's bag beds. That adds only `accepted` outcomes, so read-outcomes' exact counts (abandoned 1, negatives 1 and 1, nothing drafted 0) are unchanged.
- **Routine rows and meals.** 2C-2 joins `BAG_STORIES`, and so `bagBeds`, like the other bag beds: its routine urine rows are dropped and its intake rows are kept. It joins neither `careBeds` nor `scripted`, so it stays out of `storyBeds` (`demo-history.ts:650`), and `withFluid = !story && …` (`demo-history.ts:662`) keeps its meal fluids as for any routine bed. Its intake is its routine drinks plus those meal fluids.

| Bed | Story (times relative to seeding) | Low-output check under the new rule | Guard (`INTENDED`) |
|---|---|---|---|
| 2C-2 (64 kg, threshold 192 mL), new | Urethral catheter inserted and ordered at −24.5 h with `measure_every_h: 2`, reviewed today by 2C's nurse (as 3A-3). Urine bag changed at 0 mL at −24.5 h, then checks every 2 h, about 110 mL a time, emptied once at −12.5 h, newest check at −0.5 h at 660 mL. Drain bag checked at 300 mL (−9 h), 560 mL (−5 h) and 820 mL (−1 h). Every entry approved except each bag's newest. | Interval 2 h; `to` = −0.5 h; `(−6.5, −0.5]` holds the approved −4.5 h and −2.5 h checks, 220 mL ≥ 192 mL | `['bag_nearly_full']` |
| HDU-1 (66 kg, 198 mL), unchanged | bag-emptying's hourly checks | `to` = −0.2 h; `(−6.2, −0.2]`: 5 approved checks ≈ 310 mL | `['catheter_review']` |
| 3A-3 (69 kg, 207 mL), unchanged | bag-emptying's 4-hourly emptyings | `to` = −0.5 h; `(−6.5, −0.5]`: 3 of the −3.5 h emptying's 4 h = 300 mL | `[]` |
| 2C-5 (88 kg, 264 mL), unchanged | bag-emptying's | `to` = −4.5 h; `(−10.5, −4.5]`: 100 mL of −9.5 h's + 400 mL of −5.5 h's = 500 mL | `['bag_reading_due']` |
| 2C-6 (61 kg, 183 mL), unchanged | bag-emptying's fall | `to` = −2 h; `(−8, −2]`: 2.5 of the −5.5 h check's 4.5 h ≈ 278 mL; the fall is pending | `['bag_level_fell']` |

- **Other beds.** care-plan's beds (HDU-3, 5B-6, 2C-1, 3A-4), dietitian's (3A-6, 3A-7) and 5B-4's low-output story have no bag readings. Their window is `(now − 6 h, now]`, the same entries as before, so their prompts are unchanged.
- **Reading-due clock.** No demo catheter order is replaced, so each chain is its one order and bag-emptying's reading-due prompts are unchanged.
- **Nearly full.** None of the four bag-emptying beds has a newest check at 80% or more.
- **The guard** gains one row, `'2C-2': ['bag_nearly_full']`. If 2C-2 raises anything else at seed time (for example overload from its intake, meal fluids included), lengthen the approved urine story rather than loosening the guard. 2C-2 is the only bed on 2C left free.
- **Header comment.** It gains 2C-2.
- **Time decay.** Seed right before the demo, as for bag-emptying's beds. 2C-2 changes twice with no write:
  - just after +1.5 h (once more than 2 h has passed since the −0.5 h check; the rule says "more than" the interval) it gains `bag_reading_due`;
  - at +3.5 h (twice the interval) `bag_reading_overdue` replaces it, and the low-output window returns to now: `(−2.5, +3.5]` holds no approved urine (the −0.5 h check is still pending), so it also raises `low_urine_output` with its `mismatch` or `intake_incomplete` companion. Through acuity-budget's "Suggested acuity", `low_urine_output` then gives 2C-2 (ward default `stable`) `Suggested critical · Review`, and it moves into the dashboard's critical group. Approving the −0.5 h entry adds only 110 mL, still under 192 mL;
  - `bag_nearly_full` (the −1 h drain check) lasts until +23 h.

### 12. Deviations from the outline

1. **The review and the reading-due clock follow the catheter** (§7). Neither is in the deferred list, but without them the catheter interval would hide the day's necessity review and clear an overdue reading prompt.
2. **`confirmed_duplicate_of` and the bed-review mark.** Not in the deferred list; they keep the staff decision on record next to the reading it repeats.
3. **"No pending or approved urine entry not charted from a bag reading after it"** in the window rule, so the window cannot end at a bag reading the patient has stopped using.
4. **Nearly full at the bed.** The attendant who empties the bag sees it at once, not only the nurse's dashboard.

## Risks / Trade-offs

- **[A real second emptying within 10 min and 25 mL is refused]** → "Save anyway" saves it with one tap, and the decision is recorded. Physically, a bag that was just emptied cannot read the same level minutes later, so this is rare.
- **[A duplicate that differs by more than 25 mL]** (a misread second photo) is not caught. → bag-emptying's existing path still applies: the nurse rejects the entry as `duplicate`.
- **[A lost "Save anyway" response]** → The re-tap gets a 409 naming the reading it saved (§4), so the screen shows that reading, and "Discard" leaves one saved copy.
- **[One capacity per bag kind]** A 750 mL leg bag never reaches 1600 mL, and a 4 L night bag prompts early. → The message gives the level and capacity and says "Review". Per-bag capacities are out of scope.
- **[Low output can now fire later]** Ending at the newest reading delays a true low by up to 2 × interval. → `bag_reading_overdue` (red) fires at that same moment for catheter beds. A shorter catheter interval tightens both.
- **[A window reaching 30 h back]** A bed on a 10 h or 12 h interval whose newest reading is over 18 h old needs a second, wider entries query (§6). → Bounded by the 12 h maximum; every other bed keeps one query.
- **[A late reading's spread is approximate near a window edge]** (§6). → Totals over whole spans stay exact, and the bed review's periods show each reading's true rise.
- **[Interval change starts a new order]** The care plan history gains a row per change. → That is the audit trail; the catheter chain keeps the review state and the reading-due clock.
- **[`care_history` holds 50 orders]** A catheter changed more than 49 times without a new type or insertion would give the web a chain starting at the oldest order it holds, so it could withhold "Reviewed today" while the server raises the review. → The server's chain uses the full history, so the prompt is right; the nurse can still review from the prompt.
- **[Round bed from another ward]** Its default ignores a catheter interval (§8). → The event chips are visible and editable.
- **[Pending newest entry]** Until approved it does not count, so a fresh low reading can flag before the nurse approves. → As today; prompts say "Review".

## Migration Plan

- **Deploy.** `SCHEMA` gains one nullable column and `STORE_SCHEMA_VERSION` goes from 4 to 5, so existing store files are refused until `DATA_DIR` is deleted or re-seeded. A catheter value without the key reads `measure_every_h: null`.
- **Rollback.** The previous build refuses a file at this version, so roll back with a fresh `DATA_DIR`. Its codec reads a catheter value with an extra key, which its codec drops on read. Its `PUT` of the same `{ type, inserted_at }` on an order with an interval answers 201 (a new order without the interval), which is acceptable.

## Overlaps

Apply order (fixed): care-plan (archived) → bag-emptying → tray-segmentation → read-outcomes → dietitian → acuity-budget → tray-comparison → **bag-alerts** → accuracy-views → dietitian-care → scale-store → postgres-store → read-queue → ui-polish. bag-alerts archives **before** accuracy-views and dietitian-care.

- **bag-emptying** (archived first):
  - **MODIFIED here:** "Reading interval", "Urine bag reading due", "Bag prompts join the alerts", `web/ward-round` "Save the round" and `web/ward` "Bag prompt colours". Each block copies its archived text; task 0.1 re-checks it.
  - **Reused:** `readingInterval`, `emptiedByDefault`, `fell_from_ml`, the fall guard, the photo whose level was typed, `bagChart`, `bagReadingsByWard`.
  - **No bag-emptying test changes.** Its store tests post no two same-event readings within 10 minutes and 25 mL: its 10:02 / 10:13 pair is 11 minutes apart. Its property test is pure (`charge`). Its "Urine bag reading due" tests replace no catheter order, so each chain is one order and they pass unchanged.
- **read-outcomes** (archived):
  - its link check stays before the duplicate check (§4);
  - a 409 links nothing;
  - "Save anyway" resends the read decided at the first attempt;
  - its round "already linked counts as saved" is unchanged;
  - its demo outcome and snapshot guards hold (§11);
  - **a refused duplicate's read.** When a 409 is followed by "Discard", or "Save anyway" is never tapped, the read stays unlinked and becomes `abandoned` after `READ_ABANDON_HOURS` (12 h). Each such refusal adds one to read-outcomes' `Abandoned` figures for its kind and mode. The demo seeds no refused duplicate, so its counts are unchanged.

  It edits no read-outcomes requirement. Its scenarios "Posted again with its read" and "Refused, then saved with its read" exercise the order end to end.
- **acuity-budget** (archived):
  - **Suggestions.** `low_urine_output` drives `suggested: critical`, so bag beds now get the suggestion, and the budget class it raises, only when the windowed rule fires. Its own scenarios use beds without bag readings and hold.
  - **Care orders.** `CARE_KINDS` holds `acuity` first. The catheter row and form are separate from acuity's own row, and its MODIFIED "Change care orders from the bed review" is not touched. The new form field is its own ADDED requirement.
  - **Wording.** The care-plan line uses its `Ward default` source wording (apps/web/DESIGN.md §7.5).
- **dietitian** (archived): `ALERT_KINDS` order (§1); prompt order care → bag → `poor_meal_intake`; `WardReads` keeps `bagReadingsByWard` and gains `catheterOrdersByWard`; the demo beds are disjoint. Its design's "Overlaps" line that "bag-emptying MODIFIES Low urine output … adds Catheter reading interval" describes this change.
- **tray-segmentation, tray-comparison** (archived before): no shared requirement (tray-comparison's design §14, "Order and overlaps", agrees); `scripts/demo-history.ts` is a textual merge. tray-comparison's served photos, compared lunch and amendment use other beds and never touch 2C-2, whose meal fluids this change's demo guard depends on (its §16). This change's browser check (task 10.1) may reuse tray-comparison's dev-only `apps/server/scripts/fake-server.ts` instead of a scratch script. Task 0.1 re-checks both.
- **accuracy-views** (archives after this change): no shared requirement.
  - Its "Positive drafts not kept" counts `abandoned` as not kept, so the refused-duplicate reads above count there too.
  - Its demo guard reruns this change's story guards (its design, "Order and overlaps"), which hold.
  - `scripts/demo-history.ts` and `packages/shared` are textual merges.
- **dietitian-care** (archives after this change): **no shared requirement.**
  - It no longer MODIFIES `charting/care-plan` "Care order values": the diet values are its ADDED "Diet order values" (`openspec/changes/dietitian-care/specs/charting/care-plan/spec.md:73`), and its only care-plan MODIFIED block is "Care orders need a nurse", which this change does not touch. So "Care order values" archives as this change leaves it (498 characters), with its catheter `measure_every_h` wording and its four scenarios, and dietitian-care rebases nothing on it.
  - **Shared code.** Its `keepTargets` on `store.setCare` and `store.endCare` (its design §4, `dietitian-care/design.md:211-213` and `:404`) sits in the same store and care code as this change's catheter interval (tasks 2.2, 2.3): a textual merge.
  - Its "Catheter necessity review" is unaffected: dietitians get 403 on the review route.
- **scale-store** (after), the only later change that rebases on this one. **bag-alerts must precede it**: both MODIFY `charting/bag-periods` "Reading interval", and archive replaces the block whole. If scale-store archived first, this change's archive would silently put the ward-code default back over the acuity interval. Its version triggers already cover `level` and `care_order`, so `confirmed_duplicate_of` and interval changes bump the bed with no new table. When it rebases (its task 1.1), it must change:
  - **bag-periods "Reading interval"** (`scale-store/specs/charting/bag-periods/spec.md:5`):
    - rebase on this change's text, catheter first, then acuity;
    - keep the Catheter interval, Longer than the ward's, Not set and Order ended scenarios, with `default` → `acuity`;
    - add a scenario where the catheter beats acuity.
  - **acuity spec :20** ("Reading interval by acuity"): reword to "the level's interval, which the bed uses unless its catheter order sets one".
  - **A new MODIFIED web/ward block:** "Bag reading interval on the care plan".
  - **scale-store design.md:**
    - :15-16, the `interval_from: 'catheter' | 'acuity'` type and `readingInterval(acuity, catheter)`;
    - :66 and :203, which say acuity never affects `low_urine_output` (no longer true: the interval also ends the low-output window);
    - :126, `ruleEntries` carries `levels.before.created_at` and loads back to `window.from`;
    - the cached status unit's inputs: urine-bag reading times and the catheter value;
    - :197, the apply order.
  - **Other scale-store files:** proposal.md :10 and :45; tasks.md :15, :22 and :58.

  Its 30 s reuse bound covers the window's time-only change at 2 × interval, like its other clock prompts. If the order were ever reversed, this change would have to be rebased onto scale-store's archived text (`interval_from: 'catheter' | 'acuity'`) first.
- **postgres-store** (after scale-store; `openspec/changes/postgres-store/`; not a dependency):
  - **Concurrency.** Its design §4.1 "Isolation" (`postgres-store/design.md:147`) already runs `SELECT … FROM meniscus.admission … FOR UPDATE` first in every write transaction that reads before it writes. That serializes everything this change does inside `addBagReading`'s transaction (the neighbour load, the fall guard, the duplicate check (§4) and `charge`) and the chain-aware review insert in `reviewCatheter`, so none needs another lock. The one gap is read-outcomes' link check: `linkProblem` runs in the route (§4, step 5), before the transaction. `read_link`'s unique index (`postgres-store/design.md:148`) still stops a double link, but the second of two concurrent posts with the same `read_id` would fail at the insert with a 500 rather than 400 `already linked`. The fix, in order of preference: run `linkProblem` inside `addBagReading`'s locked transaction, as its first check, so the order of answers stays §4's; or map the unique violation on `read_link` to 400 `already linked`. postgres-store rejects SERIALIZABLE (`:149`), and no advisory lock is needed. Where this goes in postgres-store is in tasks.md "Workflow follow-up".
  - **Schema.** `level.confirmed_duplicate_of` is part of the fresh schema postgres-store mirrors; there is no older-store requirement to map.
  - **Catheter JSON.** It must keep "absent key = null" for catheter JSON (`jsonb` equality for the 200 "same value" rule).
  - **Shared files.** `store.ts` and its `SCHEMA`.
- **read-queue** (after postgres-store in the fixed order; not a dependency):
  - **What stays the same.** Its server-side save uses `defaultBagEvent(interval)` (bag-emptying's `emptiedByDefault` plus this change's catheter override), the same starting event as the round's chips, and maps this change's 409 to `not_saved` with `duplicate_reading`. It never sends `confirm_duplicate_of`: "Save anyway" stays a staff tap.
  - **The round's control.** Its design's overlaps row still names a "round per-reading switch"; the round now has one event choice per reading, and a queued reading takes its starting event.
  - **Shared files.** `lib/round.ts` and `lib/bags.ts`.
- **ui-polish** (last; not yet proposed): the round's event chips, the duplicate panel's "Discard" and the care-plan `Ward default` line already follow apps/web/DESIGN.md (§4.8, §3.2 and §7.5), so it only restyles them.

## Open Questions

None that change the specs. Whether `BAG_CAPACITY_ML` should become per hospital (a 750 mL leg bag) is a later change. Both the server's prompt and the web's check screen read it from `packages/shared` (§1), so that change would have to serve the capacities to the web (for example on `bags`) and replace the web's constant.
