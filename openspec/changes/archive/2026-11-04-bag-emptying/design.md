# Design

## Context

See proposal.md, "Why". The current state that shapes the approach:

- **Levels.** Jug and bottle levels live in `level`: `id`, `admission_id`, `container`, `volume_ml`, `created_at`, `evidence` and `media_id` (`apps/server/src/store/store.ts:156`). `addLevel` (`store.ts:1186`) charts a drop from the previous level of the same container within 24 h as an `in`/`water` entry. That entry carries `level_id` and `prev_level_id`, and the levels come back as `levels: { before, after }` through `LEVEL_JSON` (`store.ts:482`). Levels are never deleted, and media linked to a level is never expired (`UNLINKED`, `store.ts:689`).
- **Bag photos today.** A bag photo becomes an ordinary output entry with the bag's full level (`apps/server/src/ai/draft.ts:27`), so successive checks of one bag double count.
- **Prompts.** `chartView` (`apps/server/src/chart/view.ts:15`, added by care-plan) is the single place that builds a bed's prompts, for:
  - the chart reads;
  - `beds_with_alerts`;
  - Explain.

  It calls `careChart` (`chart/care.ts:293`), which calls `alertsFor` (`chart/alerts.ts:17`). `withChart` (`routes/chart.ts:179`) spreads `chartView`'s result into every ward-list item.
- **Charted time and late entries.** Entries take `charted_at`, bounded by `chartedError` (`routes/chart.ts:165`): up to `SKEW_MS` in the future, and no earlier than admission or 24 h ago. The entry then records `created_at` (charted) and `recorded_at` (saved).
- **Who decides.** `DECIDER_ROLES` (`nurse`, `matron`) gate approve, reject, amend and void with 403 `forbidden` (`routes/common.ts:56`). Recording stays open to every role.
- **Wards and clients.** Wards have a `code` and no type. The admission carries `ward_code`. The attendant's bed screen already loads `GET …/entries` (`apps/web/src/lib/care.ts:223`), so `bags` reaches the check screen without a new request.
- **Constraints.**
  - Saving makes no model request. Reminders are computed on read, with no timers or polling.
  - Nothing patient-related is logged.
  - The hackathon deadline favours one table, one new route file and pure functions.

## Goals / Non-Goals

**Goals:**
- One rule, `rise = level − baseline`, applied the same way to on-time, late and missed readings.
- **Invariant:** a bag's charted total always equals what the same set of readings would chart in time order. No existing entry is ever edited to keep it so.
- Every prompt and period is a pure function of `(readings, orders, admission, now)`, so it is tested with a fixed clock.
- The attendant is never blocked from recording. Every reading saves, and the nurse reviews. The one thing an attendant cannot do is clear a fall.

**Non-Goals:**
- Editing or deleting a stored reading.
- Bag schedules (when a bag must be changed).
- More than one bag of a kind per admission.
- A model read of the residual.
- Changing the printable chart, the hourly series, the 24 h totals or the low-output rule (bag entries count at their charted time, as on paper).
- Everything under "Deferred" below.

## Decisions

### 1. Shared types (`packages/shared`, first)

```ts
export const BAG_CONTAINERS = ['urine_bag', 'stoma_bag', 'drain_bag'] as const satisfies readonly ContainerKind[]
export type BagContainer = (typeof BAG_CONTAINERS)[number]
export const BAG_CATEGORY = { urine_bag: 'urine', stoma_bag: 'stoma', drain_bag: 'drain' } as const satisfies Record<BagContainer, Category>
export const BAG_EVENTS = ['check', 'emptied', 'bag_changed'] as const
export type BagEvent = (typeof BAG_EVENTS)[number]
export const BAG_MAX_ML = 5000

/** One source for the bag reading interval: server prompts, the capture screen and the round. */
export interface ReadingInterval { h: number; from: 'default' }
// Private to readingInterval: scale-acuity replaces the body (and this map) with the bed's acuity.
const INTERVAL_H_BY_WARD_CODE: Readonly<Record<string, number>> = { HDU: 1 }
const DEFAULT_INTERVAL_H = 4
export function readingInterval(admission: Pick<Admission, 'ward_code'>): ReadingInterval {
  return { h: INTERVAL_H_BY_WARD_CODE[admission.ward_code] ?? DEFAULT_INTERVAL_H, from: 'default' }
}
/** "Emptied after photo" starts on for intervals of at least this many hours. */
export const EMPTIED_FROM_INTERVAL_H = 4
export const emptiedByDefault = (interval: ReadingInterval): boolean => interval.h >= EMPTIED_FROM_INTERVAL_H

export interface BagReadingInput {
  container: BagContainer
  event: BagEvent
  volume_ml: number // whole mL, 0..BAG_MAX_ML
  source: 'photo' | 'manual'
  media_id?: number // photo only
  confidence?: number | null // photo only, from a read
  evidence?: PhotoEvidence | null // photo only, from a read; none when the level was typed
  notes?: string | null
  urine_colour?: UrineColour | null // urine_bag only
  urine_rgb?: string | null // urine_bag only
  charted_at?: string // as for late entries
}
export interface BagEntryRef { id: number; volume_ml: number; status: EntryStatus }
export interface BagReading {
  id: number
  container: BagContainer
  event: BagEvent
  volume_ml: number
  /** On read, from the readings as they now stand. */
  baseline_ml: number // 0 after a fall
  rise_ml: number
  fell: boolean
  /** The baseline the level fell below; null unless `fell`. A missed emptying's floor. */
  fell_from_ml: number | null
  residual_ml: number | null
  source: 'photo' | 'manual'
  media: MediaRef | null
  proof_media: MediaRef | null
  evidence: PhotoEvidence | null
  created_by: StaffRef | null
  created_at: string // charted
  recorded_at: string
  late: boolean
  /** The entry this reading charted, if any; its volume may differ from rise_ml for a late reading. */
  entry: BagEntryRef | null
}
export interface BagReadingResult { reading: BagReading; entry: Entry | null }
export interface AfterEmptyingInput { media_id?: number; residual_ml?: number } // at least one
export interface BagPeriod {
  container: BagContainer
  start_at: string | null // the opening emptying or bag change; null when unknown
  end_at: string | null // the closing reading; the last reading when a fall followed; null while open
  opened_by: 'emptied' | 'bag_changed' | null
  closed_by: 'emptied' | 'bag_changed' | null
  readings: BagReading[] // oldest first
  total_ml: number // sum of rise_ml
  /** total_ml / hours from start_at to the last reading, whole mL; null when start_at is null or that is 0 h. */
  rate_ml_h: number | null
}
export interface BagChart { interval_h: number; interval_from: ReadingInterval['from']; periods: BagPeriod[] }

// changed
export interface LevelSnapshot { /* … */ event: BagEvent | null; residual_ml: number | null }
export interface EntryList { /* … */ bags: BagChart } // the single-bed read only; AdmissionSummary is unchanged
ALERT_KINDS += 'bag_reading_due', 'bag_reading_overdue', 'bag_level_fell'
RECORD_ALERT_KINDS += 'bag_level_fell'
```

The spec's `rise_ml`, `fell`, `fell_from_ml` and `baseline_ml` in a 201 response are `reading.*`. `periods` is flat: grouped in `BAG_CONTAINERS` order, each bag's periods newest first.

### 2. Layer ownership

| Module | Layer | Owns |
|---|---|---|
| `packages/shared/src/index.ts` | shared | the types, constants, `readingInterval`, `emptiedByDefault` (used by server, capture screen and round) |
| `apps/server/src/chart/bags.ts` (new) | domain, pure | `steps`, `charge`, `clearsFall`, `periods`, `bagChart` (periods and prompts) |
| `apps/server/src/store/store.ts` | storage | the columns, `migrateBags`, `addBagReading` (one transaction: neighbours, fall guard, charge, insert), `afterEmptying`, `bagReadings`, `bagReadingsByWard` |
| `apps/server/src/chart/view.ts` | domain | bag readings in; bag prompts appended after the care prompts; `bags` out |
| `apps/server/src/routes/bags.ts` (new) | HTTP | zod validation, `chartedError` (moved to `routes/common.ts`), error-to-status mapping |
| `apps/web/src/lib/bags.ts` (new) | web, pure | preview and saved text, the save plans, period and row text, the missed-emptying form rules, the entry's rise text |
| `apps/web/src/components/bag-reading.tsx`, `bag-periods.tsx`, lazy `missed-emptying.tsx` | web UI | |

`packages/meta` and `apps/server/src/ai` are untouched, since no model call changes.

### 3. Data model

The existing `level` table gains its columns. The fresh `CREATE TABLE` in `SCHEMA` has them. `migrateBags(db)` runs after `migrateCare`, adds whichever are missing through `addColumns` (as `migrateMedia`, `store.ts:1396`), and only then creates the index. The index is not in `SCHEMA`: `SCHEMA` runs before the migrations, so on an older file it would name a column that does not exist yet. A second open changes nothing.

```sql
-- level, added by migrateBags (and present in the fresh CREATE TABLE)
event          TEXT CHECK (event IN ('check', 'emptied', 'bag_changed')),  -- NULL: jug or bottle
residual_ml    INTEGER CHECK (residual_ml >= 0),                           -- NULL: none recorded (baseline 0)
recorded_at    INTEGER,                                                    -- NULL on old rows: = created_at
created_by     INTEGER REFERENCES staff(id),
proof_media_id INTEGER REFERENCES media(id),
source         TEXT CHECK (source IN ('photo', 'manual'))
-- then, in migrateBags only:
CREATE INDEX IF NOT EXISTS level_proof_media ON level (proof_media_id);
-- the existing level_admission_container (admission_id, container, created_at) serves the bag queries
```

- **Entries.** A reading that charts writes one `out` entry:
  - category `BAG_CATEGORY[container]`;
  - `level_id` = the reading, and `prev_level_id` = its predecessor at save time (null for the bag's first reading);
  - the reading's `media_id`, `source`, `confidence`, `evidence`, `notes` and urine colour;
  - item `urine bag: 150 → 260 mL` (baseline → level).

  The reading's entry is `entry.level_id = reading.id AND entry.direction = 'out'`.
- **Unchanged paths, extended:**
  - `LEVEL_JSON` gains `event` and `residual_ml`;
  - `UNLINKED` gains `AND NOT EXISTS (SELECT 1 FROM level WHERE proof_media_id = media.id)`;
  - `levels(admissionId)` (`GET …/levels`) and `addLevel`'s `lastLevel` filter `event IS NULL`.
- **Older stores.** Old urine entries keep `level_id` null, so they stay out of every period.

### 4. The increment algorithm

The readings `rs` of one bag (admission × container) are ordered by `(created_at, id)`. `created_at` is the charted time. There is no lookback limit: a reading's predecessor is the one before it, however old.

```
baselineAfter(p) = p.event == 'check'   ? p.volume_ml
                 : p.event == 'emptied' ? (p.residual_ml ?? 0)
                 : 0                                          // bag_changed

prev(rs, r) = the reading just before r in order, or none
next(rs, r) = the reading just after r in order, or none

step(p, r):                                   // p = prev(rs, r) or none
  base = p ? baselineAfter(p) : 0
  if r.volume_ml >= base: return { baseline: base, rise: r.volume_ml − base, fell: false, fell_from: null }
  else:                   return { baseline: 0,    rise: r.volume_ml,        fell: true,  fell_from: base }

steps(rs) = rs.map(r => step(prev(rs, r), r))      // on every read; never stored

charge(p, r, n):        // p, n = the stored readings just before and after r's charted time
  Δ = step(p, r).rise
  if n: Δ += step(r, n).rise − step(p, n).rise     // n's rise with r, minus n's rise without r
  return Δ                                          // an entry of Δ mL when Δ > 0, else none

clearsFall(p, r, n) = r.event in ('emptied', 'bag_changed') and n and step(p, n).fell
```

**Why it holds the invariant.** A reading's rise depends only on its immediate predecessor. Inserting `r` between `p` and `n` therefore changes only `r`'s rise and `n`'s rise. `Δ` is exactly that change in the time-ordered total. By induction, the charted total equals `Σ steps(rs).rise`.

**Why Δ is never negative, so there is no clamp.** When `r` is saved it has no residual: a residual comes only through the after-emptying route, which is closed once a later reading exists. So `baselineAfter(r)` is `r`'s level for a check and 0 otherwise, never above `r`'s level. Let `b = baselineAfter(p)`:

- `n` at or above `b`: `step(p, n).rise = n − b`, and the other two rises are at least `r − b` and `n − baselineAfter(r)`, so `Δ ≥ r − baselineAfter(r) ≥ 0`.
- `n` below `b`, `r` an emptying or bag change: `step(r, n).rise = n = step(p, n).rise`, so `Δ = step(p, r).rise ≥ 0`.
- `n` below `b`, `r` a check: if `n ≥ r`, then `r < b`, the rises are `r`, `n − r` and `n`, and `Δ = 0`; if `n < r`, both of `n`'s rises are `n`, and `Δ = step(p, r).rise ≥ 0`.

A property test over random readings and save orders checks `Δ ≥ 0` and the invariant (tasks 2.1).

Worked timeline of one urine bag, with save order differing from charted order. No reading is more than 24 h from its neighbour, so dropping the 24 h lookback changes no row from the earlier draft:

| Saved | Charted | Event, level | Rise (time order, recomputed) | Entry charted (Δ) | Running charted total |
|---|---|---|---|---|---|
| 08:00 | 08:00 | emptied 600, no earlier reading | 600 | 600 | 600 |
| 09:00 | 09:00 | check 150 (baseline 0 after emptying) | 150 | 150 | 750 |
| 11:00 | 11:00 | emptied 380 | 380 − 150 = 230, then 120 once 10:00 exists | 230 | 980 |
| 11:30 | 10:00 (late) | check 260 | 110 | 110 + (120 − 230) = **0**, no entry | 980 |
| 12:00 | 12:00 | check 100 (baseline 0 after emptying) | 100 | 100 | 1080 |
| 15:00 | 15:00 | check 500 | 400 | 400 | 1480 |
| 18:00 | 18:00 | check 150, below 500: **fell**, `fell_from` 500 | 150, then baseline 0 once 16:30 exists | 150 + `bag_level_fell` | 1630 |
| 18:20 | 16:30 (late, missed emptying, by a nurse) | emptied 550, at or above 500 | 550 − 500 = 50 | 50 + (150 − 150) = **50** | 1680 |

In time order the rises are 600 + 150 + 110 + 120 + 100 + 400 + 50 + 150 = **1680**, equal to what was charted. No entry was changed, and the 16:30 emptying cleared the fall: the 18:00 reading's baseline is now the 16:30 emptying, so `fell` is false and `fell_from` null. Had the nurse typed 450 for the 16:30 emptying, it would itself fall from 500 and chart 450 (Δ = 450 + 150 − 150), and the prompt would move to 16:30.

### 5. Event state machine (per bag, derived from the readings; nothing stored)

```
            first reading, baseline 0
  [none] ─────────────────────────────▶ (see the reading's event)

  check x ≥ base ──▶ [filling(x)]            rise x − base
  check x < base ──▶ [filling(x)] + FELL     rise x, fell_from base, new period (start unknown)
  emptied x      ──▶ [emptied(residual)]     rise as above, closes the period; base = residual ?? 0
  bag_changed x  ──▶ [fresh]                 rise as above, closes the period; base = 0

  [emptied] ── after-emptying (photo and/or residual), once, while no later reading ──▶ [emptied(residual)]
```

A long gap is not a reset. If the bag was emptied in the gap and nobody recorded it, the next reading is usually below the last baseline and shows as a fall for review.

Derived, and clock-based:

| Prompt | Holds when |
|---|---|
| `bag_reading_due` / `bag_reading_overdue` | a urine bag with an active catheter order |
| `bag_level_fell` | per fall reading charted in the last 24 h |

### 6. Late entries, missed emptyings and the audit

- **What a late reading stores.** It is a reading with `created_at` = `charted_at` and `recorded_at` = now. `late` is `recorded_at − created_at > SKEW_MS`. It charts `Δ` as a new entry, which is itself late and audited as a `created` event by the staff member at `recorded_at`.
- **No other entry changes.** No other entry gets a volume, status or `entry_event` change. Approved stays approved.
- **Missed emptying is a nurse's call.** In `addBagReading`, after loading `p` and `n`, `clearsFall(p, r, n)` with an attendant as the saver throws `Forbidden`, which the route maps to 403 `forbidden`; nothing is stored. It runs after validation, the 404 and the media check, because it depends on the body and the stored readings (unlike "Decisions need a nurse", which runs first). A late `check` in the gap stays open to everyone: it never removes a fall, at most moves it to itself. This narrows nothing in `charting/staffing`, whose open recording paths are entries, levels and meals.
- **Why each row can be explained.** The bed review shows each reading's recomputed rise next to its entry's volume. When they differ, it explains: `Late · 90 min · charted with 11:00` names the next reading, whose entry already holds the output.
- **Entry details.** These use the entry's frozen `levels` (the predecessor at save). The rise shown there is the one the entry was charted from, and the timeline says when the entry differs from that rise. A fall entry keeps reading `level fell` after a missed emptying clears the prompt; the bed review shows the recomputed rise.
- **Why not re-chart.** Correcting the 11:00 entry from 230 to 120 and charting 110 at 10:00 would also be honest, but it would change approved entries and their totals behind the nurse's back.

### 7. Periods and prompts: pure functions over readings, orders and now

```
bagChart({ readings, orders, admission, now }):     // readings: the last 48 h, plus each bag's one reading before that
  { h, from } = readingInterval(admission)
  per bag: st = steps(readings of that bag)          // the reading before the window only serves as a predecessor
  periods  = periods(st) with a reading charted in the last 24 h, newest first
  alerts:
    catheter = the active catheter order
    if catheter:
      newest = the newest urine_bag reading, if any
      since  = max(newest?.t, catheter.start_at)
      label  = newest && newest.t >= catheter.start_at
               ? `last ${when(since, now)}`
               : `no reading since the catheter order at ${when(since, now)}`
      if now − since ≥ 2 × h → bag_reading_overdue  "Urine bag reading overdue (<label>). Review."
      elif now − since > h   → bag_reading_due      "Urine bag reading due (<label>). Review."
    per fall step charted in the last 24 h →
      bag_level_fell "<Bag> level fell from <fell_from> to <level> mL with no emptying recorded. Was it emptied? Review.",
      entry_ids [its entry] or [], meal_ids []
```

- **`when`.** care-plan's `when(t, now)` (`chart/care.ts:87`) prints `HH:MM`, prefixed `D Mon` off `now`'s local date, so a reading before midnight reads `2 Nov 22:00`. It is exported for `bags.ts`.
- **Window.** `store.bagReadings(admissionId, now − 48 h)` returns every reading charted since then, plus, per container, the newest one before it. That one gives the first reading in the window its true baseline and gives the reading-due prompt the newest reading however old. A period older than 48 h lists only its readings in the window; the bed review shows the last 24 h, so this only shortens a period that has gone two days without an emptying.
- **Rate.** `rate_ml_h` is `total_ml` over the hours from `start_at` to the period's last reading, rounded to whole mL; null when `start_at` is null or the span is 0 h.
- **Who calls it.** `chartView` reads the bed's readings (or takes the ward's from `bagReadingsByWard`, one query per ward), calls `bagChart`, appends its alerts after the care prompts, and returns `{ alerts, care, bags }`. `GET …/entries` spreads all three. `withChart` keeps `alerts` and `care` only, so the ward list's `AdmissionSummary` is unchanged and carries no `bags`.
- **No timers or polling.** Nothing runs between reads. A prompt appears on the next chart read after the clock passes its threshold, which is how every other prompt behaves.

### 8. UX

The specs carry the exact text. The design choices:

- **Check screen** (`bag-reading.tsx`, in the existing capture flow, after the read):
  - one block with the last reading from `bags` and the preview (`+120 mL since 10:00`, the fall warning, `No rise since 10:02: saving charts nothing`, or the first-reading line);
  - the event as one radio group of "Check", "Emptied after photo" and "Bag changed", with "Emptied after photo" picked when `emptiedByDefault(readingInterval(admission))`, else "Check", and a line under it saying what it does: `The next reading starts from 0 mL.` after an emptying or a bag change, `The next reading starts from <level> mL.` after a check;
  - Save keeps its place and is never disabled by a bag rule;
  - the saved message names the event, the level and what was charted, and adds `Waiting for nurse approval.` only when an entry was charted.
- **After emptying.** An inline step on the saved screen. After an emptying or bag change, "Add after-emptying photo" is the first, primary button (it reuses the camera input), then "Left in bag" (a number stepper at 0, emptying only), then "Done". After a check, the same step reads "Emptied it now? Add after-emptying photo": continuing posts an `emptied` reading at the check's level (`source: "manual"`, rise 0, no entry), then the photo and residual on that reading. This serves the HDU nurse who saves a check and then empties the bag.
- **By hand.** A "Bag level" switch on the manual form for urine, stoma and drain output turns the volume into a level and adds the event controls and an optional photo. With a photo it saves as `source: "photo"` with no evidence: the attendant's photo is logged when no read is possible.
- **Nurse.**
  - The "Bags" section sits under the timeline on the bed review: collapsed periods, newest open.
  - "Add missed emptying" opens from the `bag_level_fell` prompt row only (its one action), for nurses and matrons only. It is a lazy chunk, since it is rarely used.
  - Its time field is a time of day. The allowed window is `(max(previous reading, now − 24 h, admitted_at), fall reading)`, which is under 24 h long, so a time of day falls on at most one date inside it; that date is used, across midnight too. A time with no such date shows `Between <from> and <to>`, both through `when`, and disables "Add emptying". The level stepper starts at `fell_from_ml` and its "Less" is disabled there; `missedSubmit` still refuses a lower level as a safeguard.
  - Entry details reuse the jug before/after layout.
- **Round.** No new control. Each bag reading is saved with `emptiedByDefault(readingInterval(bed))`: `emptied` on general wards, `check` on HDU.

### 9. Proof and retention

- **What is kept.** Reading photos and proof photos are linked media, never expired. They are served by `GET /api/media/:id` under the existing access rules.
- **What is logged.** Nothing about readings beyond path, status and timing.
- **Where the audit lives.** The reading itself (`created_by`, `created_at`, `recorded_at`, `source`, `evidence`), not `entry_event`.

### 10. Config

- **Where.** All constants live in `packages/shared` (section 1). There is no env or UI.
- **Changing a value.** Takes a code change and redeploy. The tests cite the default values.
- **The ward-code map** is private to `readingInterval`, so nothing else can key on ward codes, and scale-acuity swaps one function body.

### 11. Demo (`scripts/demo-history.ts`, fictional, synthetic `bagPhoto`)

Every bag entry on these beds is approved by the ward's nurse except each bed's newest reading's entry, which stays pending. Low urine output is unchanged (approved urine charted in the last 6 h against 0.5 mL/kg/h), so each story keeps enough approved rise inside the last 6 h.

| Bed | Story (times relative to seeding) | Low output check | Guard (`INTENDED`) |
|---|---|---|---|
| HDU-1 (66 kg) | Emptied 4-hourly overnight: 400 at −18.2 h (first reading), 420 at −14.2 h, 380 at −10.2 h and 450 at −6.2 h, so its 24 h balance stays even; then checks every hour from −5.2 h to −0.2 h, rising 62–63 mL each. Its catheter order and review are kept. | Approved −5.2 to −1.2 h: 313 mL ≥ 198 mL | `['catheter_review']` (unchanged) |
| 3A-3 (69 kg) | Catheter order reviewed today. Emptied 380 at −14 h (first), 400 at −10 h; early partial emptying at −7.5 h (185 mL over 2.5 h) with an after-emptying proof photo and a 30 mL residual; emptied 430 at −3.5 h (rise 400); check 120 at −0.5 h. | Approved −3.5 h: 400 mL ≥ 207 mL | `[]` |
| 2C-5 (88 kg) | Catheter order reviewed today. Emptied ~400 mL at −13.5 h, −9.5 h and −5.5 h; check 90 at −4.5 h (newest, so due from −0.5 h). | Approved −5.5 h: 400 mL ≥ 264 mL | `['bag_reading_due']` |
| 2C-6 (61 kg) | No catheter order. Emptied 600 at −14 h, check 300 at −10 h, check 800 at −5.5 h, check 150 at −2 h: a fall, left pending. | Approved −5.5 h: 500 mL ≥ 183 mL | `['bag_level_fell']` |

- **Seeding.** Readings are seeded through `store.addBagReading` at the scripted clock, so entries, rises and periods come from the real code path. Each bag bed's routine urine rows are dropped, and its intake rows are kept.
- **Guard.** The guard runs after seeding, as today, with the new beds added to `INTENDED`. If a chosen bed already raises another prompt (overload, mismatch, logging gap), pick another bed on the same ward rather than loosening the guard.

### 12. Deviations from the outline

1. **Missed emptying.** It is a backdated `emptied` reading, not a manual output entry. A manual entry would double count the 150 mL already charted from the fall; the reading charts only the rise from `fell_from_ml` (Δ rule). Only nurses and matrons add one.
2. **No 24 h reset.** A bag's baseline is its previous reading however old. An unrecorded emptying in a long gap surfaces as a fall rather than being hidden by a reset to 0.
3. **Late entries.** Entries are never re-charted. The Δ rule keeps the total right while rises are recomputed on read.
4. **Reading interval.** One shared function with a default by ward code, not a ward column or a per-order value.
5. **Reminders.** They are for urine bags with an active catheter order only. Stoma and drain bags get the fall prompt, but no reading-due prompt.
6. **Fall.** The whole new level is charted, with an amber prompt. Nothing is refused, and the drop is never charted.
7. **Photo, level typed.** A photo can be saved with a typed level and no read, so a photo is never lost for lack of a read.

### 13. Deferred

Each needs its own change after the deadline. The MVP is designed so each can land without rewriting a kept requirement.

| Item | What it would add | Where it hooks in |
|---|---|---|
| Duplicate bag photo (`charting/bag-periods`, `web/capture`) | 409 `duplicate_reading` within 10 min and 25 mL, `confirm_duplicate`, "Same as the reading at 10:02" | `addBagReading` before `charge`; the round's save |
| Bag nearly full | `bag_nearly_full` at 80% of capacity | `bagChart` alerts; needs real bag capacities |
| MODIFIED `charting/alerts` **Low urine output** | bag entries spread over their interval; window ends at the newest current reading | `alertsFor`, through `careChart` |
| `charting/care-plan` **Catheter reading interval** | a per-order `measure_every_h` | `readingInterval` |
| `web/ward-round` **Bag readings in the round** | the per-reading switch and chip | `lib/round.ts` |
| MODIFIED `web/ward` **Urine output rate against the threshold** | the rate chart following the low-output rule | `lib/charts.ts` |
| `web/ward` **Bag reading interval on the care plan** | "Bag reading every" on the catheter form | `components/care-forms.tsx` |

## Risks / Trade-offs

- **[A misread level propagates]** It becomes the next reading's baseline. Approving the entry at a corrected volume does not change the reading, so the next rise is off by the same amount the other way. → The check screen shows the last reading, and a high misread usually surfaces as a fall on the next reading. Editing a reading is out of scope; the README says to correct both entries.
- **[A 0-rise reading charts no entry]** Its urine colour and notes therefore never reach an entry, and the `appearance` rule. → The colour stays in the reading's evidence. A follow-up could carry it to the next entry. A dark or bloody bag is usually also a rising one.
- **[Emptying saved twice]** With the duplicate check deferred, a double tap or a retried save of an emptying charts the level twice (the second has baseline 0). A check saved twice charts nothing more. → The nurse rejects the second entry as `duplicate`, the existing reason; both readings and photos stay visible in the "Bags" section.
- **[Low output with 4-hourly bags]** Low urine output counts a bag entry at its charted time, so a 6 h window can hold one 4-hourly emptying and raise `low_urine_output` for a patient whose rate is fine, or miss one when two land in it. → The prompt says "Review"; the bed review's "Bags" periods give the true rate. The deferred low-output change fixes it.
- **[Long gap, unrecorded emptying, higher level]** If the bag was emptied in a long gap and refilled above the old level, the rise is charted from the old level, an undercount. → The reading-due prompt keeps gaps short on catheter beds, and the bed review shows the gap.
- **[Batch approve]** "Approve all high-confidence" can approve a fall-flagged entry. → The card shows `Bag level fell`; excluding them is a follow-up (proposal, Out of scope).
- **[Demo time decay]** Due and overdue prompts move with the clock: HDU-1 turns amber about 50 minutes after seeding. → Seed right before the demo, as for care-plan's time-based prompts. The guard checks the stories at seed time.
- **[Mixed flows double count]** A typed or voice note "emptied catheter bag 400 mL" still drafts a full entry. → README guidance: use the bag photo or "Bag level". Notes about bags are out of scope.
- **[More reads per chart]** Each chart read loads up to 48 h of readings per bed, plus one per bag. → One indexed query per bed, and one per ward for the ward list (`bagReadingsByWard`).

## Migration Plan

- **Deploy.** `migrateBags` is additive: nullable columns, then the `level_proof_media` index. Old levels are jugs (`event IS NULL`), and old urine entries are unaffected.
- **Rollback.** The previous build ignores the new columns. Its `GET …/levels` would list bag readings beside jugs, which is acceptable for a demo store and avoided by reseeding.

## Overlaps

Apply order: **care-plan** (archived first) → **bag-emptying** → **tray-segmentation** → **read-outcomes** → **dietitian**. **image-synthesis** runs in parallel. **scale-acuity** applies last.

- **care-plan** (archived; this change rebases on its archived text and code):
  - **Reused:** `chartView`, `careChart`, `when`, `SKEW_MS`, `RECORD_ALERT_KINDS` and the web record-flag map (`careFlags`), `STATUS_LABEL`, the demo guard `INTENDED`.
  - **Not touched:** the catheter codec and form, and the `charting/care-plan` spec (the catheter interval is deferred).
  - **Extended:** the guard gets three new beds, and HDU-1's routine urine output becomes bag readings while its guard stays `['catheter_review']`.
  - **Ordering:** bag alerts come after the care prompts.
- **tray-segmentation** (next):
  - **Media fingerprint:** it adds `media.sha256`, which applies to reading and proof photos unchanged; photos stored before it lands return `sha256: null`.
  - **Store:** its `migrateTray` runs after `migrateBags`. Its deferred served photo will add a `meal.served_media_id` clause to `UNLINKED`; keep this change's `proof_media_id` clause beside it.
  - **Shared edits:** `scripts/demo-history.ts` and `synthetic-photo.ts` (textual merges).
- **read-outcomes:**
  - **Route:** it adds `read_id` to `POST …/bag-readings` ("Link a bag reading to its read"), checked before anything else this change checks after validation, and links the reading, not its entry. A typed-level photo reading has no read, so it carries no `read_id`.
  - **Duplicate check deferred:** its text and scenarios that rely on 409 `duplicate_reading` and `confirm_duplicate` (the "a 409 `duplicate_reading` links nothing" clause, "Duplicate, then saved anyway", the "not 409 `duplicate_reading`" in "Posted again", and the "Save anyway" step of web/capture "Bag photo") have nothing to test until the deferred duplicate change lands. read-outcomes must drop or defer them; "Posted again" still holds through `already linked`.
  - **Scoring:** for bag readings it uses `BAG_CATEGORY`, and settles the read at save from the saved level.
  - **Shared edits:** both touch `capture.ts` and `round.ts`. This change MODIFIES `web/ward-round` "Save the round"; read-outcomes ADDs other requirements there.
- **dietitian:**
  - **Care plan:** it no longer modifies `charting/care-plan`, and neither does this change.
  - **Alert order:** `ALERT_KINDS`, `ALERT_LABEL` and `ALERT_TONE` end with this change's three bag kinds (`bag_reading_due`, `bag_reading_overdue`, `bag_level_fell`; not four), then dietitian's `poor_meal_intake`. `chartView` appends care prompts, bag prompts, then `poor_meal_intake`.
  - **Ward reads:** `withChart` passes `bagReadingsByWard` to `chartView`; dietitian folds it into its `WardReads` object, keeping it.
  - **Demo:** the beds are disjoint.
- **image-synthesis** (in parallel): no requirement shared; both may touch `synthetic-photo.ts`.
- **scale-acuity** (last). What it must change once this change is archived:
  - swap the body of `readingInterval(admission)` (and its private ward-code map) for the bed's effective acuity, widening `ReadingInterval['from']` to include `'acuity'`; every caller, server and web, follows unchanged;
  - its MODIFIED **Reading interval** must copy this change's archived text and drop its catheter clause (`measure_every_h`, `interval_from: catheter`, and the "Catheter order" scenario), since the per-order interval is deferred;
  - "Emptied after photo" already derives from the interval (`emptiedByDefault`), so its note about keying `EMPTIED_DEFAULT` on acuity needs no separate map;
  - its `UNLINKED` rework must keep this change's `proof_media_id` clause (and set `linked_at` for it).

## Open Questions

None for the MVP. Bag capacities are a question for the deferred "Bag nearly full".
