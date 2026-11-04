# Proposal

## Why

A catheter bag, a stoma bag or a drain bag fills between emptyings. The ward assistant (our `attendant`) or a nurse empties it at a set time, or early before a transfer or at shift change, and on HDU checks it every hour without emptying it. Today Meniscus charts every bag photo as a fresh output entry, so three hourly checks of one 380 mL bag chart 150 + 260 + 380 = 790 mL, and nothing tells the nurse that a bag reading is due or that a bag was emptied without anyone recording it.

Paper intake and output charts already handle this: they record the bag's level at each check and chart the rise since the last one. Meniscus can do the same from the photos staff already take. The user asked for:

1. "if the janitor empties the bag at a certain time, he/she takes the pictures and the pictures are logged";
2. an after-emptying proof photo;
3. a "reading due" reminder;
4. a time-based baseline and residual rule for partly filled bags emptied at any time;
5. late and missed emptyings handled without breaking the flow of nurses and attendants.

This is the MVP cut for the Nov 4 deadline: all five asks, and nothing else (see "Deferred").

## What Changes

- **Bag readings** (new `charting/bag-periods`). A photo, or a level typed in with or without a photo, of a `urine_bag`, `stoma_bag` or `drain_bag` is saved as a **bag reading**, not as an entry (ask 1):
  - `POST /api/admissions/:id/bag-readings`: the level, the event (`check`, `emptied` or `bag_changed`), the photo and any read evidence, who saved it, and its charted time (late readings follow the late-entry rules);
  - a photo whose level was typed (`source: "photo"`, a `media_id`, no evidence) makes 0 model requests, so the attendant's photo is logged even when no read is possible (request budget spent, API down). It follows the live "Link media to records" rule for a photo level;
  - stored in the existing `level` table (jug levels live there already), which gains the event, a residual, who saved it, the recorded time, the source and an after-emptying photo.
- **Charted output is the rise, never the raw level** (ask 4). Each reading charts one pending output entry of the bag's category for `level − baseline`:
  - after a `check`, the baseline is that check's level;
  - after an emptying, it is the residual left in the bag (0 unless recorded);
  - after a bag change, it is 0;
  - the previous reading counts however old it is; only a bag's first reading starts from 0.

  Over a period between emptyings, the entries sum exactly to the final level. This mirrors `charting/level-pairing` (a jug's drop is intake; a bag's rise is output).
- **A fall is never charted as a drop** (ask 5). A reading below its baseline is saved (the attendant is never blocked), charts its whole level from an unknown baseline, records `fell_from_ml` (the baseline it fell below), and raises the amber prompt `bag_level_fell`: "Urine bag level fell from 500 to 150 mL with no emptying recorded. Was it emptied? Review." An emptying in a long gap between readings shows up the same way.
- **Missed emptyings** (ask 5). A nurse or matron adds the missed emptying as a backdated `emptied` reading. At or above `fell_from_ml` it charts the rise from `fell_from_ml` and clears the prompt; below it, it is a fall itself. An attendant cannot add one (403), so a fall is never cleared without a nurse. The entry it charts waits for approval like any other.
- **Late readings never change a charted entry** (ask 5). A reading charted between two existing readings charts only what the entries already charted do not cover. The bag's charted total is the same as if the readings had come in time order. No approved or pending entry changes its volume. The bed review still shows each reading's own rise, computed on read.
- **After emptying** (ask 2). `POST /api/bag-readings/:id/after-emptying` keeps an optional proof photo (no model read) and an optional residual in mL. The residual becomes the next reading's baseline.
- **Reading due** (ask 3). Computed on every chart read from readings, orders and the clock; no timers, no polling, no model request:

  | Kind | Colour | When |
  |---|---|---|
  | `bag_reading_due` | amber | active catheter order, and more than the reading interval since the later of the newest urine-bag reading and the order's start |
  | `bag_reading_overdue` | red | the same, from twice the interval |
  | `bag_level_fell` | amber | a bag reading below its baseline, charted in the last 24 h, with no emptying recorded between |

  - The reading interval comes from one shared function, `readingInterval(admission)`: 1 h on HDU, 4 h on every other ward, `from: 'default'`. Server, capture screen and round all call it.
  - There is no reminder without a catheter order. A urinal patient's voids stay entries.
- **Capture UX** (`web/capture`, `web/ward-round`): still one photo. Bag drafts gain:
  - the event as one choice of "Check", "Emptied after photo" and "Bag changed", with "Emptied after photo" picked when the bed's interval is 4 h or more, else "Check", and its effect spelled out (`The next reading starts from 0 mL.`);
  - the bag's last reading, what saving charts ("+110 mL since 10:00", the fall warning, or "No rise since 10:02: saving charts nothing"), and a saved message that says only "Waiting for nurse approval" when an entry was charted.

  After an emptying is saved, "Add after-emptying photo" is the screen's first button, with "Left in bag". After a check, "Emptied it now? Add after-emptying photo" records the emptying and then takes the proof photo. The by-hand form gains "Bag level", with an optional photo. The ward round saves bag readings with the bed's default event.
- **Nurse UX** (`web/ward`):
  - a "Bags" section on the bed review: one line per period, e.g. `08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h`, then each reading with its photo, rise, event, who saved it and its after-emptying photo;
  - "Add missed emptying" on `bag_level_fell`, for nurses and matrons only, bounded to the fall's gap, the last 24 h and the admission;
  - entry details show the previous and current bag photos with `150 mL → 260 mL · +110 mL`;
  - prompts use the existing colours and status chips.
- **Proof** (ask 1, 2). Every reading keeps its photo (as media), the after-emptying photo, any read evidence, the event, who saved it, and its charted and recorded times. None of it is logged. Rejecting the entry a reading charted keeps the reading and its photos, as for jug levels.
- **Demo** (`scripts/demo-history.ts`, fictional):
  - HDU-1: hourly checks and one emptying, beside its catheter story;
  - 3A-3: 4-hourly emptyings, one early and partial, plus one after-emptying photo with a 30 mL residual;
  - 2C-6: a missed-emptying fall;
  - 2C-5: a reading due (amber).

  Every bag entry but each bed's newest is approved. care-plan's per-bed prompt guard is extended to these beds.

### Upstream model requests per user action

| Action | Before | After |
|---|---|---|
| Photo read of a bag (`sam+spark` / `spark`) | 3 / 1 | 3 / 1 (unchanged) |
| Saving a bag reading (read photo, photo with a typed level, or by hand) | 0 (saved as an entry) | 0 |
| After-emptying photo or residual, including "Emptied it now?" | n/a | 0 |
| Add missed emptying | n/a | 0 |
| Reminders, fall prompts, bag periods on chart reads | n/a | 0 |
| Ward round read per photo | 3 / 1 | 3 / 1 (unchanged) |
| `POST /api/ai/explain` | 1 | 1 (its prompt list may now hold bag prompts; still no patient name) |

**Read volume the reminders imply.** Reminders never read anything themselves, but each reading answered with a photo read costs one read:

- an HDU bed read every hour: 3 requests per bed per hour in `sam+spark` mode (72 a day), or 1 in `spark` mode (24 a day);
- a general-ward bed read every 4 hours: 18 requests per bed per day (6 in `spark` mode).

With the default budget (`MODEL_API_MAX_REQUESTS_PER_HOUR` 120), hourly `sam+spark` reads alone use it up at 40 beds. A typed level, with or without a photo, costs 0, and is the path when the budget or the API is out.

### Config (named constants in `packages/shared`; code, no env, no UI)

| Constant | Default | Used by |
|---|---|---|
| `BAG_CONTAINERS` | `urine_bag`, `stoma_bag`, `drain_bag` | which reads are bag readings |
| `BAG_CATEGORY` | urine, stoma, drain | the output entry's category |
| `BAG_EVENTS` | `check`, `emptied`, `bag_changed` | reading validation, labels |
| `BAG_MAX_ML` | `5000` | reading validation |
| `readingInterval(admission)` | HDU 1 h, every other ward 4 h (a private ward-code map) | reading interval, "Emptied after photo" default |
| `EMPTIED_FROM_INTERVAL_H` | `4` | "Emptied after photo" is on when the interval is at least this |

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `ALERT_KINDS` and `AlertKind` gain `bag_reading_due`, `bag_reading_overdue` and `bag_level_fell`. `RECORD_ALERT_KINDS` gains `bag_level_fell`, which carries `entry_ids` (and an empty `meal_ids`). The web's exhaustive `ALERT_LABEL` and `ALERT_TONE` and care-plan's record-flag map are updated.
  - **BREAKING**: `LevelSnapshot` gains `event: BagEvent | null` and `residual_ml: number | null` (null for jugs). Fixtures are updated.
  - **BREAKING**: `EntryList` gains `bags: BagChart`. `AdmissionSummary` (the ward list) does not change.
  - New:
    - `BAG_CONTAINERS`, `BagContainer`, `BAG_CATEGORY`, `BAG_EVENTS`, `BagEvent`, `BAG_MAX_ML`;
    - `BagReadingInput`, `BagReading` (with `fell_from_ml`), `BagEntryRef`, `BagReadingResult`, `BagPeriod`, `BagChart`, `AfterEmptyingInput`;
    - `ReadingInterval`, `readingInterval`, `EMPTIED_FROM_INTERVAL_H`, `emptiedByDefault`.
- HTTP:
  - new `POST /api/admissions/:id/bag-readings` (201 `BagReadingResult`; 403 `forbidden` for an attendant's emptying or bag change inside a fall's gap);
  - new `POST /api/bag-readings/:id/after-emptying` (200 `BagReading`, 404 `not_found`, 409 `after_emptying_closed`);
  - `GET /api/admissions/:id/entries` gains `bags`; `GET /api/admissions` does not;
  - output entries charted from a bag reading return `levels: { before, after }`, as jug drops do;
  - `GET /api/admissions/:id/levels` still lists jugs and bottles only.

### Deferred (after the deadline; each is its own change)

- **Duplicate bag photo** (`charting/bag-periods` and `web/capture`): the 409 `duplicate_reading`, `confirm_duplicate` and "Same as the reading at 10:02". Until then a check saved twice charts nothing more, and an emptying saved twice charts twice; the nurse rejects the second as `duplicate`.
- **Bag nearly full** (`bag_nearly_full`, bag capacities).
- **Low urine output with bag readings** (MODIFIED `charting/alerts` **Low urine output**: spreading a bag entry over its interval and ending the window at the newest current reading). Until then a bag entry counts at its charted time, as any urine entry does today.
- **Catheter reading interval** (`charting/care-plan`: a per-order `measure_every_h`). The interval is the default only.
- **Bag readings in the round** (`web/ward-round`: a per-reading "Emptied after photo" switch). The round saves the bed's default event.
- **Urine output rate against the threshold** (MODIFIED `web/ward`), which would follow the deferred low-output rule.
- **Bag reading interval on the care plan** (`web/ward`), which needs the catheter interval.

### Out of scope

- **Reading the residual by model.** The after-emptying photo is stored as proof, with no model request, so every action keeps a fixed request count. Staff type a residual if there is one.
- **Correcting a stored reading's level.** A misread is corrected on its entry (approve at another volume, amend or reject). The reading itself stays as saved, and the check screen shows the last reading so a misread is caught before saving.
- **More than one bag of a kind per patient** (two drains), named bags, and bag-change schedules (e.g. a weekly catheter bag change).
- **Voice and typed notes about bags.** They still draft entries, not readings.
- **Prompt dismissal.** Like `appearance`, a fall prompt lasts while its reading is in the 24 h window, unless a missed emptying is added.
- **Paper.** No change to the printable chart, the hourly series or 24 h totals. Bag entries count at their charted time there, as the paper I&O chart records them.
- **Automatic capture, notifications and escalation.** Reminders are prompts only. Excluding fall-flagged entries from "Approve all high-confidence" is a follow-up.

## Capabilities

### New Capabilities
- `charting/bag-periods`: bag readings and their events, the rise-since-baseline rule, periods between emptyings, falls and missed emptyings, late readings, after-emptying proof and residual, the reading interval and its reminder, bag periods on chart reads, and older stores.

### Modified Capabilities
- `charting/level-pairing`: **Before and after** also covers output entries charted from a bag reading.
- `web/capture`: **Read result kept as evidence** covers bag readings. Adds **Bag photos record readings**, **Bag level by hand** and **After-emptying photo**.
- `web/ward-round`: **Save the round** saves bag readings with the bed's default event.
- `web/ward`: adds **Bag periods on the bed review**, **Add a missed emptying**, **Bag prompt colours** and **Bag reading on the entry**.

23 requirements: 13 in `charting/bag-periods`, 1 in level-pairing, 4 in capture, 1 in ward-round, 4 in ward.

## Impact

- `packages/shared/src/index.ts`: the types, constants and pure helpers above.
- `apps/server`:
  - new `src/chart/bags.ts` (domain, pure): steps, charge, periods and the prompts;
  - new `src/routes/bags.ts` (HTTP): the two routes, mounted in `src/app.ts`;
  - `src/store/store.ts`: `level` columns and `migrateBags` (with its index), `addBagReading`, `afterEmptying`, `bagReadings`, `bagReadingsByWard`, `LEVEL_JSON` and `UNLINKED` (proof photo), and `levels` filtered to jugs and bottles;
  - `src/chart/view.ts`: bag readings in, bag prompts and `bags` out;
  - `src/chart/care.ts`: `when` exported for the prompt text;
  - `src/routes/chart.ts`: `bags` on `GET …/entries` only;
  - `scripts/demo-history.ts`.
- `apps/web`:
  - new `lib/bags.ts`, `components/bag-reading.tsx`, `components/bag-periods.tsx`, and lazy `components/missed-emptying.tsx`;
  - updated `lib/capture.ts`, `lib/round.ts`, `lib/api.ts`, `lib/sources.ts`, `lib/timeline.ts`, `lib/labels.ts`, `lib/care.ts`;
  - updated `components/source-view.tsx`;
  - updated routes `a/bed.$token.tsx`, `a/round*.tsx`, `n/$id.tsx`.
- README: "Emptying bags".
- No new dependencies, no env vars, no new model calls.
- Order: care-plan → **bag-emptying** → tray-segmentation → read-outcomes → dietitian, with image-synthesis in parallel and scale-acuity last. See design.md, "Overlaps".
