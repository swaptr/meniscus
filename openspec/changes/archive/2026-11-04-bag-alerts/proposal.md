# Proposal

## Why

`bag-emptying` shipped bag readings for the deadline and deferred seven pieces (its proposal, "Deferred", and design §13). Without them:
- an emptying saved twice charts twice;
- nothing says a bag is about to overflow;
- `low_urine_output` counts a 4-hourly emptying at its charted time, so a patient whose rate is fine is flagged between emptyings, and one whose 6 h window holds two emptyings is missed;
- a patient on hourly urine output on a general ward is still reminded every 4 hours;
- the round always saves the ward's default event;
- the rate chart and the care plan say nothing about bags.

The user wants every feature built, with no cuts. This change builds the whole deferred list on bag-emptying's archived behaviour: `readingInterval()`, `fell_from_ml`, the photo whose level was typed, and nurse-only missed emptyings.

## What Changes

- **Duplicate bag reading** (`charting/bag-periods`, `web/capture`, `web/ward-round`, `web/ward`).
  - **What counts.** A duplicate is a reading of the same bag and the same event, within 25 mL of the level, charted within 10 minutes of an existing reading (both bounds inclusive, either side). A different event is never a duplicate, so "Emptied it now?" after a check is never refused.
  - **The answer.** `POST /api/admissions/:id/bag-readings` answers 409 `duplicate_reading` with `duplicate_of` (the nearest matching reading's id, event, level and time), and stores and links nothing.
  - **Saving anyway.** A staff tap on "Save anyway" resends the same body with `confirm_duplicate_of: <that reading's id>`. The reading is saved, recording `confirmed_duplicate_of`, only while that id is still the nearest match; otherwise the answer is a new 409 naming the new match. So a re-tap after a lost response meets the reading it saved and does not save twice. Nothing is resent automatically.
  - **Order of checks.** read-outcomes' link checks run first, so a re-post of a linked reading still answers 400 `already linked`, and a 409 links nothing. Then the 403 for an attendant's missed emptying, then the duplicate check.
  - **Where it is handled.** The check screen, "Bag level" by hand, "Emptied it now?", the round and the nurse's "Add missed emptying" form each show `Same as the reading at 11:00: emptied at 380 mL.`. The bed screen offers "Save anyway" and "Discard" (apps/web/DESIGN.md §3.2); the nurse's form "Save anyway" and "Cancel". The bed review marks a reading saved anyway.
- **Bag nearly full** (`charting/bag-periods`, `web/capture`, `web/ward`).
  - **The prompt.** `bag_nearly_full` (amber) is raised when a bag's newest reading, charted in the last 24 h, is a check at or above 80% of its capacity: `Urine bag nearly full: 1600 of 2000 mL at 10:30. Review.`.
  - **Capacities.** Urine 2000, stoma 500 and drain 1000 mL, in shared config. No catheter order is needed.
  - **At the bed.** The check screen says `Nearly full: 1650 of 2000 mL. Empty it now?` and leads with "Emptied it now?" after saving.
- **Low urine output with bag readings** (MODIFIED `charting/alerts` **Low urine output**). The live rule is kept for beds without bag readings, apart from the half-open window. The window becomes `(to − 6 h, to]`:
  - `to` is now, or the newest urine-bag reading's charted time while that is less than twice the bed's reading interval old and no pending or approved urine entry not charted from a bag reading is charted after it;
  - the admission must be at least 6 h before `to`;
  - an approved bag entry counts spread evenly from the reading before it at save to its own reading, or whole at its reading when there is none;
  - with a 12 h interval the window can start up to 30 h back, so the rule loads entries from `min(now − 24 h, chart-day start, window start)` and counts from its own approved list;
  - the total is rounded to whole mL;
  - when the window ends at a bag reading, the message says so: `Urine output 150 mL in the 6 h to the 08:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.`.
- **Catheter reading interval** (MODIFIED `charting/care-plan` **Care order values** and **Catheter necessity review**; MODIFIED `charting/bag-periods` **Reading interval** and **Urine bag reading due**). **Decision: keep it, as an optional per-catheter override** (design §7).
  - **The value.** `catheter` gains `measure_every_h`: 1, 2, 4, 6, 8 or 12, or null. When set, it takes precedence over the default interval (and, once `scale-store` lands, over the acuity interval). `bags.interval_from` then reads `catheter`.
  - **The catheter, not the order row.** Changing only the interval starts a new catheter order, because orders are immutable ranges. So the daily necessity review and the urine-bag reading-due clock both follow the catheter: its orders of the same `type` and `inserted_at`, taken from the full order history (`catheterSince`). Without that, editing the interval would hide that day's "is it still needed?" prompt and restart the reading-due clock, so tightening an overdue bed to 2 h would clear its `bag_reading_overdue`.
- **Bag readings in the round** (`web/ward-round`). Each bag reading has one choice-chip radio group, `Check · Emptied · Bag changed` (apps/web/DESIGN.md §4.8 and §7.1). It starts at `Emptied` when the bed's interval (catheter override included) is at least 4 h, otherwise at `Check`. "Save all high-confidence" saves each with its own event. A 409 leaves the reading for individual review, with "Save anyway".
- **Nurse views** (`web/ward`).
  - MODIFIED **Urine output rate against the threshold**: points are counted as the prompt counts, and anchored at the prompt's window end, captioned `To the 08:00 bag reading`, so the latest point always equals the prompt.
  - New **Bag reading interval on the care plan**: `Bag reading every 2 h`, or `Bag reading every 4 h · Ward default` (apps/web/DESIGN.md §7.5's wording), on the catheter row, and "Bag reading every" with `Ward default (<h> h)` on the catheter form.
  - MODIFIED **Bag prompt colours** for `bag_nearly_full`.
- **No upgrade path.** `level.confirmed_duplicate_of` goes into `SCHEMA` with a `STORE_SCHEMA_VERSION` bump; an older store file fails to open (charting/entries "Store schema version"). A catheter order set without an interval reads `measure_every_h: null` (the default interval).
- **Demo** (`scripts/demo-history.ts`, fictional): 2C-2 gets a catheter with a 2-hourly interval, urine-bag checks every 2 h and a drain bag at 820 mL. It stays out of `storyBeds`, so its meals keep their fluids. The guard gains `'2C-2': ['bag_nearly_full']`. Every existing guard row (care-plan, bag-emptying, read-outcomes, dietitian) is unchanged, as recomputed under the new low-output rule in design §11.

### Upstream model requests per user action (before → after)

| Action | Before | After |
|---|---|---|
| Photo read of a bag (`sam+spark` / `spark`) | 3 / 1 | 3 / 1 (unchanged) |
| Saving a bag reading: answered 201 or 409, and "Save anyway" (including a re-tap answered 409) | 0 | 0 |
| Round "Save all high-confidence", including a 409 | 0 | 0 |
| Setting a catheter's reading interval; recording a catheter review | 0 | 0 |
| `bag_nearly_full`, low-output window, rate chart, care-plan row | 0 | 0 |
| `POST /api/ai/explain` | 1 | 1 (its prompt list may hold `bag_nearly_full` and the new low-output message; still no patient name) |

### Config (named constants in `packages/shared`; code, no env, no UI, as bag-emptying's)

| Constant | Default | Used by |
|---|---|---|
| `BAG_CAPACITY_ML` | `{ urine_bag: 2000, stoma_bag: 500, drain_bag: 1000 }` | `bag_nearly_full`, the check screen |
| `BAG_NEARLY_FULL` | `0.8` | the same |
| `DUPLICATE_WITHIN_MIN` | `10` | the duplicate check |
| `DUPLICATE_TOLERANCE_ML` | `25` | the duplicate check |
| `MEASURE_EVERY_H` | `[1, 2, 4, 6, 8, 12]` | catheter validation, the catheter form |

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `CareValues['catheter']` gains `measure_every_h: MeasureEveryH | null`; `CareInput<'catheter'>` takes it as optional. The web's catheter row, form, history text and fixtures must handle it.
  - **BREAKING**: `ReadingInterval['from']`, and so `BagChart.interval_from`, widen from `'default'` to `'catheter' | 'default'`. `readingInterval(admission, catheter?)` gains the active catheter's value as its second argument.
  - **BREAKING**: `ALERT_KINDS` / `AlertKind` gain `bag_nearly_full`, after `bag_level_fell`. The web's exhaustive `ALERT_LABEL` and `ALERT_TONE` must add it. It is not a record alert.
  - **BREAKING**: `BagReading` gains `confirmed_duplicate_of: number | null`. Fixtures change.
  - `BagReadingInput` gains optional `confirm_duplicate_of: number` (a positive integer, the id the staff member confirmed).
  - New: `BAG_CAPACITY_ML`, `BAG_NEARLY_FULL`, `DUPLICATE_WITHIN_MIN`, `DUPLICATE_TOLERANCE_ML`, `MEASURE_EVERY_H`, `MeasureEveryH`, `BagDuplicate`, `DuplicateReadingBody`, and the pure helpers `catheterSince`, `urineWindow` and `urineInWindow` (one source for the server's prompt and the web's chart).
- HTTP:
  - **BREAKING**: `POST /api/admissions/:id/bag-readings` may answer 409 `{ error: "duplicate_reading", duplicate_of }`. It accepts `confirm_duplicate_of`, and its readings return `confirmed_duplicate_of`.
  - **BREAKING**: `PUT /api/admissions/:id/care/catheter` accepts `measure_every_h`. Catheter orders return it on every read (`care.orders`, `care_history`).
  - `bags.interval_from` may be `catheter`.
  - `low_urine_output` may carry the bag-reading message.
  - `GET /api/admissions` and `GET /api/wards` change only through the alerts they already carry.
- Web: `ApiError` keeps the 409 body's `duplicate_of`.

### Out of scope

- **Per-bag capacities** (a 750 mL leg bag, a named drain): one capacity per bag kind.
- **Prompt dismissal or snoozing**: `bag_nearly_full` lasts until an emptying, a bag change or 24 h.
- **Re-charting old entries.** Spreading changes how the prompt and the chart count entries. No entry's volume, time or status changes.
- **The printable chart, the hourly series and the 24 h totals**: bag entries still count at their charted time there, as the paper I&O chart records them.
- **Excluding a reading saved anyway, or a fall, from "Approve all high-confidence"**: still a follow-up.
- **Reading-due prompts for stoma and drain bags**: still catheter only (bag-emptying).
- **Acuity-based intervals**: `scale-store` (after this change; design "Overlaps").
- **Automatic capture, notifications, escalation, and any retry or auto-resend.**

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `charting/bag-periods` (added by bag-emptying): adds **Duplicate bag reading**, and **Bag nearly full**; MODIFIED **Reading interval** (catheter override), **Urine bag reading due** (counts from the catheter's start) and **Bag prompts join the alerts** (fourth kind).
- `charting/alerts`: MODIFIED **Low urine output**.
- `charting/care-plan`: MODIFIED **Care order values** (`measure_every_h`) and **Catheter necessity review** (follows the catheter).
- `web/capture`: adds **Duplicate bag reading at the bed** and **Nearly full at the bed**.
- `web/ward-round`: MODIFIED **Save the round** (bag-emptying's text); adds **Bag readings in the round**.
- `web/ward`: MODIFIED **Urine output rate against the threshold** and **Bag prompt colours** (bag-emptying's); adds **Bag reading interval on the care plan**, **Missed emptying already recorded** and **Readings saved anyway**.

17 requirements: 8 added and 9 modified. Five MODIFIED blocks copy bag-emptying's text: `Reading interval`, `Urine bag reading due`, `Bag prompts join the alerts`, `Save the round` and `Bag prompt colours`. `charting/bag-periods` is bag-emptying's capability. `openspec validate` reports the bag-periods delta and `Bag prompt colours` as INFO until bag-emptying archives.

## Impact

- `packages/shared/src/index.ts`: the types, constants and pure helpers above.
- `apps/server`:
  - `src/store/store.ts`: `level.confirmed_duplicate_of` in `SCHEMA` and the `STORE_SCHEMA_VERSION` bump; the duplicate check in `addBagReading`'s transaction; the full catheter history and review lookups by catheter chain;
  - `src/chart/bags.ts`: `duplicateOf`, the nearly-full prompt and the reading-due clock from the catheter's start;
  - `src/chart/alerts.ts`: the low-output window;
  - `src/chart/care.ts`: the catheter codec (`measure_every_h`) and the review chain;
  - `src/chart/view.ts`: the interval, the window, the entries loaded back to the window's start, and the catheter chain wiring;
  - `src/routes/bags.ts`: `confirm_duplicate_of`, and the 409;
  - `src/routes/care.ts`: the catheter body and the review route;
  - `scripts/demo-history.ts`.
- `apps/web`:
  - `lib/bags.ts`, `lib/round.ts`, `lib/charts.ts`, `lib/care.ts`, `lib/labels.ts`, `lib/api.ts`;
  - `components/bag-reading.tsx`, `components/bag-periods.tsx`, `components/missed-emptying.tsx`, `components/care-forms.tsx`, `components/care-plan.tsx`, `components/bed-charts.tsx`;
  - `routes/a/round.tsx`.
- README: "Emptying bags" gains duplicates, nearly full, the catheter interval and the low-output window.
- No new dependencies, no env vars, no new model calls.
- Order (fixed): … → tray-comparison → **bag-alerts** → accuracy-views → dietitian-care → scale-store → postgres-store → read-queue → ui-polish. bag-alerts archives before dietitian-care and scale-store. It shares no requirement with dietitian-care, which adds "Diet order values" rather than modifying "Care order values"; only scale-store rebases its MODIFIED blocks on this change's archived text (design "Overlaps").
