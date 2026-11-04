# Tasks

Apply right after `care-plan` is archived (design.md, "Overlaps"). Work test-first: for each task, write the citing tests (`[<domain>/<capability>] <Requirement>: <scenario>`), see them fail, implement, see them pass. Server tests use `createMetaClient` with a fake `fetch` and assert the upstream request count (0 everywhere, except 1 for Explain). Web tests use the fake `fetchImpl` of `createApi` and assert the exact requests, with no `/api/ai` request where the spec says none. No test calls the network. Every kept scenario is cited by exactly the task that names it below.

## Scenario map (reference, not tracked)

| User ask | Requirement(s) | Tasks |
|---|---|---|
| 1 The attendant's emptying photo is logged | [charting/bag-periods] Record a bag reading; Bag readings keep their proof; [web/capture] Bag photos record readings; Bag level by hand (Photo, level typed); [web/ward-round] Save the round | 2.3, 2.5, 5.1, 5.3, 6.4 |
| 2 After-emptying proof photo | [charting/bag-periods] After-emptying record; [web/capture] After-emptying photo; [web/ward] Bag periods on the bed review (Proof) | 3.1, 5.4, 6.1 |
| 3 Reading-due reminder | [charting/bag-periods] Reading interval; Urine bag reading due; Bag prompts join the alerts; [web/ward] Bag prompt colours | 2.5, 4.1, 3.2, 6.3 |
| 4 Time-based baseline and residual | [charting/bag-periods] Output is the rise since the baseline; Emptying and bag change start a new period; Bag periods on the chart read; [charting/level-pairing] Before and after; [web/ward] Bag reading on the entry | 2.1, 2.3, 2.4, 2.5, 3.1, 6.1 |
| 5 Late and missed emptyings without breaking the flow | [charting/bag-periods] Level fell with no emptying recorded; Add a missed emptying; Late readings never change a charted entry; [web/ward] Add a missed emptying | 2.1, 3.2, 3.3, 3.4, 6.2 |

| Boundary | Scenario |
|---|---|
| Exactly at the interval vs 1 min over | [charting/bag-periods] Urine bag reading due: At the interval (12:00 none, 12:01 due); HDU hourly |
| Exactly 2× | Urine bag reading due: Twice the interval (15:59 due, 16:00 overdue) |
| Across midnight | Urine bag reading due: Overnight; [web/ward] Add a missed emptying: Across midnight |
| Previous reading days old (no 24 h reset) | Output is the rise since the baseline: Two days apart; Level fell with no emptying recorded: Two days apart |
| Equal level | Output is the rise since the baseline: Level unchanged |
| Below the baseline | Level fell with no emptying recorded: Emptied but not recorded; Fell to empty; Below the residual |
| Missed emptying at, above and below the floor | Add a missed emptying: Emptied at 10:30; Level not known; Below the floor; From the residual |
| Zero-length period | Bag periods on the chart read: No length |
| Older store | Pre-bag stores: Older store; Opened again |

## 0. Before starting

- [x] 0.1 `care-plan` is archived; rebase on its archived text:
  - `openspec/changes/care-plan/` is gone and `openspec/specs/charting/care-plan/spec.md` exists;
  - the three MODIFIED blocks here (`charting/level-pairing` Before and after, `web/capture` Read result kept as evidence, `web/ward-round` Save the round) still match their live text except for this change's edits; re-copy any that drifted;
  - the code has care-plan's `chartView` (`chart/view.ts`), `careChart`, `when` (`chart/care.ts`), `RECORD_ALERT_KINDS`, `careFlags` and the `INTENDED` guard.

  Verify: `pnpm exec openspec validate bag-emptying --strict` passes.

## 1. Shared contracts

- [x] 1.1 Add to `packages/shared/src/index.ts` the types, constants and helpers of design.md §1:
  - `BAG_CONTAINERS`, `BagContainer`, `BAG_CATEGORY`, `BAG_EVENTS`, `BagEvent`, `BAG_MAX_ML`;
  - `ReadingInterval`, `readingInterval` (with its private ward-code map), `EMPTIED_FROM_INTERVAL_H`, `emptiedByDefault`;
  - `BagReadingInput`, `BagReading` (with `fell_from_ml`), `BagEntryRef`, `BagReadingResult`, `BagPeriod`, `BagChart`, `AfterEmptyingInput`;
  - the three alert kinds, with `bag_level_fell` in `RECORD_ALERT_KINDS`;
  - `LevelSnapshot.event` / `residual_ml` and `EntryList.bags`.

  Then fix the compile errors this causes:
  - the web's exhaustive `ALERT_LABEL` / `ALERT_TONE` (`bag_reading_overdue` red, the other two amber);
  - the `LevelSnapshot` fixtures (`apps/web/src/lib/sources.test.ts`, `lib.test.ts`, `round.test.ts`, server evidence fixtures), with `event: null, residual_ml: null`;
  - `EntryList` fakes, with `bags: { interval_h: 4, interval_from: 'default', periods: [] }`.

  Verify: `pnpm typecheck` passes, and every existing test passes with no assertion changed.

## 2. Server: storage, the rise and periods (demo-critical)

- [x] 2.1 Pure domain `apps/server/src/chart/bags.ts` (design.md §4–5): `steps`, `charge`, `clearsFall` and `periods`, tests first in new `apps/server/src/chart/bags.test.ts`. Cover:
  - the worked timeline row by row (Δ 600, 150, 230, 0, 100, 400, 150, 50; charted total 1680 = Σ rises in time order), and the 450 variant of the 16:30 row (Δ 450, the fall moves to 16:30);
  - the late emptying between two checks (Δ 260, total 640);
  - a fall to 0 (rise 0, `fell`, `fell_from` 500), and below a residual (`fell_from` 30);
  - the residual as baseline, and `bag_changed` → baseline 0;
  - no lookback: a predecessor 49 h old still sets the baseline;
  - a property test over random readings (levels 0–1000, all three events, no residual at insert) and random save orders: every Δ ≥ 0, and the charted total equals Σ `steps` rises;
  - equal `created_at` ordered by id;
  - `clearsFall` true only for an emptying or bag change whose next reading fell;
  - periods: unknown start, closed by an emptying, ended by a fall, open, rates 95 and 88, and a 0 h period with rate null;
  - `readingInterval` (`HDU` → 1, `3A` → 4, both `from: 'default'`) and `emptiedByDefault` (1 h → false, 4 h → true).

  These are unit tests of named functions; they cite no requirement, and the HTTP tests below do. Verify: the suite passes.
- [x] 2.2 Storage in `apps/server/src/store/store.ts` (design.md §3). Store-level tests first in new `apps/server/src/bags.test.ts` (no citation): a saved reading's row, its entry's `level_id` / `prev_level_id`, and `bagReadings` returning the window plus one earlier reading per bag.
  - the `level` columns in the fresh `CREATE TABLE`, and `migrateBags` after `migrateCare`: missing columns through `addColumns`, then `CREATE INDEX IF NOT EXISTS level_proof_media` (not in `SCHEMA`);
  - `addBagReading` in one transaction: load the stored readings just before and after the charted time, the attendant check (`clearsFall` → `Forbidden`), `charge`, insert the level, then the entry when Δ > 0, with `level_id` / `prev_level_id`, the bag's category, media, evidence, notes and colour, `created_at` = charted and `recorded_at` = now;
  - `bagReadings(admissionId, since)` and `bagReadingsByWard(wardId, since)`, each with the newest reading before `since` per bag;
  - `LEVEL_JSON` with `event` and `residual_ml`;
  - `levels()` and `addLevel`'s previous-level query filtered to `event IS NULL`.

  Verify: these tests, `apps/server/src/media.test.ts` and the existing level tests pass unchanged.
- [x] 2.3 `POST /api/admissions/:id/bag-readings` in new `apps/server/src/routes/bags.ts`, mounted in `src/app.ts`:
  - zod: container in `BAG_CONTAINERS`, event in `BAG_EVENTS`, whole mL 0–`BAG_MAX_ML`, `media_id` / `evidence` / `confidence` only for `photo` (each optional), colour only for `urine_bag`, `notes` bounded as entries;
  - `chartedError`, moved to `routes/common.ts` and reused by `routes/chart.ts`;
  - media linkable for the admission, kind `photo`;
  - 404 after validation, as entries; `Forbidden` → 403 `forbidden`;
  - the signed-in staff member → `created_by`.

  Tests in `apps/server/src/bags.test.ts` cite:
  - [charting/bag-periods] Record a bag reading: Normal emptying, Photo with the level typed, Not a bag reading (all seven bodies), Unknown admission;
  - [charting/bag-periods] Output is the rise since the baseline: Hourly checks, then emptied; Emptied before it was full; Level unchanged; Two days apart; Bags kept apart;
  - [charting/bag-periods] Emptying and bag change start a new period: Bag changed.

  Each asserts 0 upstream requests. Verify: these tests pass.
- [x] 2.4 Level pairing for bag entries. Tests in `apps/server/src/media.test.ts` (beside the existing "Jug before and after") cite [charting/level-pairing] Before and after: Bag before and after, First bag reading. Verify: these and the existing Jug before and after test, unchanged, pass.
- [x] 2.5 `bags` on `GET /api/admissions/:id/entries` only:
  - `chartView` (`src/chart/view.ts`) reads `bagReadings(id, now − 48 h)` (or takes the ward's), calls `bagChart` (periods and interval only for now) and returns `bags`;
  - `routes/chart.ts`: `GET …/entries` spreads `bags`; `withChart` passes `bagReadingsByWard` and keeps only `alerts` and `care`.

  Tests cite:
  - [charting/bag-periods] Bag periods on the chart read: One period closed, Emptied early, Open period, No length, No bag, Not on the ward list;
  - [charting/bag-periods] Reading interval: Ward defaults;
  - [charting/bag-periods] Bag readings keep their proof: Rise rejected, Saved late.

  Verify: these tests pass, and the existing `chart.test.ts` "Alerts on chart reads" tests pass unchanged.
- [x] 2.6 Older stores. Tests in `apps/server/src/bags.test.ts` cite [charting/bag-periods] Pre-bag stores: Older store, Opened again. Build the old file with the pre-change `level` DDL (no `event`, `residual_ml`, `recorded_at`, `created_by`, `proof_media_id` or `source`), then compare `PRAGMA schema_version` across two opens. Verify: these tests pass.

## 3. Server: after emptying, falls, missed emptyings and late readings

- [x] 3.1 `POST /api/bag-readings/:id/after-emptying`:
  - store `afterEmptying`: 404 for an id that is not a bag reading, closed once set or once a later reading of the bag exists;
  - `UNLINKED` gains `proof_media_id`.

  Tests cite:
  - [charting/bag-periods] After-emptying record: Proof photo (served 25 h later, with the clock advanced), Residual, Closed, Invalid, Not a bag reading;
  - [charting/bag-periods] Emptying and bag change start a new period: Residual left in the bag.

  Verify: these tests and the media expiry tests in `media.test.ts` pass.
- [x] 3.2 Falls and the alert wiring:
  - `bagChart` emits `bag_level_fell`, one per fall reading charted in the last 24 h, with `entry_ids` and the `fell_from` level in the message;
  - `chartView` appends the bag alerts after the care prompts, so they reach the chart reads, `beds_with_alerts` and Explain.

  Tests in `apps/server/src/bags.test.ts` cite:
  - [charting/bag-periods] Level fell with no emptying recorded: Emptied but not recorded, Fell to empty, Below the residual (residual set through 3.1's route), Two days apart, A day later;
  - [charting/bag-periods] Bag prompts join the alerts: Only a fall (`GET /api/wards`, then Explain with exactly 1 upstream request whose input holds `bag_level_fell` and not `Fatima Khan`).

  Verify: these tests and the existing Explain and "Alerts on chart reads" tests in `chart.test.ts` pass unchanged.
- [x] 3.3 Missed emptyings. Tests cite [charting/bag-periods] Add a missed emptying: Emptied at 10:30, Level not known, From the residual, Below the floor, Not by an attendant. Assert that the 12:00 entry's volume, status and `GET /api/entries/<id>/events` are unchanged, and that the 403s store no level and no entry. Verify: these tests pass.
- [x] 3.4 Late readings. Tests cite [charting/bag-periods] Late readings never change a charted entry: Check added between two readings, Emptying added between two checks, After the newest reading, Out of range. Assert the history of every earlier entry, before and after. Verify: these tests pass.

## 4. Server: reading due

- [x] 4.1 `bagChart` reading prompts, per design.md §7: `since` = the later of the newest urine-bag reading and the catheter order's start, the two labels, and `when` exported from `chart/care.ts`. Tests in `apps/server/src/bags.test.ts`, on a fixed clock, cite [charting/bag-periods] Urine bag reading due: At the interval, Twice the interval, HDU hourly, No reading since the order, Overnight, Reading taken, No catheter order. Verify: these tests and care-plan's existing `chart/care.test.ts` pass unchanged.

## 5. Web: capture (demo-critical)

- [x] 5.1 `apps/web/src/lib/bags.ts`, tests first in new `apps/web/src/lib/bags.test.ts`:
  - the check-screen preview from `bags` and a draft: `Last reading 260 mL at 10:00`, `+120 mL since 10:00`, the fall line, `No rise since 10:02: saving charts nothing`, `First reading of this bag: saving charts 600 mL`;
  - the event's default ("Emptied after photo" when `emptiedByDefault(readingInterval(admission))`, else "Check") and its line, `The next reading starts from <n> mL.`;
  - the saved message (rise, nothing to chart, fall), with `Waiting for nurse approval.` only when an entry was charted;
  - the save plan: media upload, then `api.addBagReading`.

  `lib/capture.ts` routes bag drafts to it, and `lib/api.ts` gains `addBagReading` and `afterEmptying`. Tests cite [web/capture] Bag photos record readings: Emptied on a general ward, Hourly check on HDU, Bag changed, Level fell, Nothing to chart, First reading, Adjusted bag reading, Urinal. In `apps/web/src/lib/evidence.test.ts`, [web/capture] Read result kept as evidence: Adjusted photo draft now uses a urinal; its Voice draft and Long model text tests pass unchanged. Verify: these tests and the whole web suite pass.
- [x] 5.2 Check screen UI: `components/bag-reading.tsx` in the capture flow of `routes/a/bed.$token.tsx`, with the event as one radio group ("Check", "Emptied after photo", "Bag changed") and its line, the preview and the saved message. Save is never disabled by a bag rule. Verify: `pnpm typecheck` and `pnpm lint` pass; the screen is checked in 8.1.
- [x] 5.3 By hand: "Bag level" on the manual form, with an optional photo (upload, then `source: "photo"`, its `media_id`, no evidence). Tests in `apps/web/src/lib/bags.test.ts` cite [web/capture] Bag level by hand: Emptied now, Earlier time, Photo, level typed, Not a bag. Verify: these tests pass.
- [x] 5.4 After-emptying step, in the saved state of `bag-reading.tsx`: "Add after-emptying photo" first after an emptying or bag change, "Left in bag" for an emptying, and "Emptied it now? Add after-emptying photo" after a check (posts the `emptied` reading at the check's level, then the photo and residual). Tests cite [web/capture] After-emptying photo: Proof photo, Residual only, Nothing added, After a check, Check left as it is. Verify: these tests pass.

## 6. Web: bed review, missed emptying, prompts and round

- [x] 6.1 Bed review "Bags" section and entry details:
  - `lib/bags.ts` period and row text;
  - `components/bag-periods.tsx` in `routes/n/$id.tsx`;
  - `lib/sources.ts` and `components/source-view.tsx` for the bag before/after, including `level fell`;
  - `lib/timeline.ts` for `Saved <mL> mL, the rise since <time>`, the first-reading, fall and late-reading lines.

  Tests cite:
  - [web/ward] Bag periods on the bed review: Closed period, Open period and unknown start, Fall, Late reading already charted, Proof, No extra request (exactly the entries and meals GETs);
  - [web/ward] Bag reading on the entry: Rise since a check, After an emptying, First reading, Fall, Late emptying, Reject a bag entry.

  Verify: these tests pass, and the existing timeline and sources tests pass unchanged.
- [x] 6.2 Missed emptying: the form rules in `lib/bags.ts` (floor at `fell_from_ml`; the time window `(max(previous, now − 24 h, admitted_at), fall)` and the one date that puts a time of day in it) and lazy `components/missed-emptying.tsx`, opened from the `bag_level_fell` prompt row only (not the fall row), for `DECIDER_ROLES` only. Saving sends the reading, then reloads the bed review; no approve. Tests cite [web/ward] Add a missed emptying: Nurse adds it, Floor at the residual, Level not known, Attendant, Refused on the device, Across midnight, Older than a day. Verify: these tests pass, and the build shows `missed-emptying` as its own chunk, not preloaded.
- [x] 6.3 Prompt colours and the badge:
  - `ALERT_LABEL` / `ALERT_TONE` in `lib/labels.ts`;
  - `careFlags` in `lib/care.ts` gains `Bag level fell` (amber).

  Tests in `apps/web/src/lib/care.test.ts` cite [web/ward] Bag prompt colours: Worst prompt wins, Flagged entry. Verify: these tests pass.
- [x] 6.4 Round: `lib/round.ts` saves bag readings through `api.addBagReading` with `event` from `emptiedByDefault(readingInterval(bed))`; no new control on `routes/a/round*.tsx`. Tests in `apps/web/src/lib/round.test.ts` cite [web/ward-round] Save the round: Mixed round (its expectation updated from one entry to one bag reading), Two wards. Verify: these tests and the whole web suite pass.

## 7. Demo and README

- [x] 7.1 `apps/server/scripts/demo-history.ts`, as design.md §11:
  - HDU-1, 3A-3, 2C-5 and 2C-6 bag stories through `store.addBagReading` at the scripted clock, in time order, with synthetic `bagPhoto` media, and one after-emptying proof photo with a 30 mL residual on 3A-3 (set before its next reading);
  - every bag entry approved by the ward's nurse except each bed's newest;
  - catheter orders for 3A-3 and 2C-5, reviewed today by the ward's nurse;
  - routine urine rows dropped on those beds;
  - `INTENDED` gains `'3A-3': []`, `'2C-5': ['bag_reading_due']` and `'2C-6': ['bag_level_fell']`, and HDU-1 stays `['catheter_review']` (so none of the four raises `low_urine_output`);
  - the header comment lists the bag beds.

  Verify: one `pnpm --filter @meniscus/server demo` run over a fresh temporary `DATA_DIR` succeeds, so the guard passes, and the script makes no model request.
- [x] 7.2 README, new section "Emptying bags":
  - readings, not entries;
  - the rise rule, with the 150/110/120 example, and no reset after a long gap;
  - emptying, residual and bag change;
  - a fall, and "Add missed emptying" (nurses and matrons);
  - late readings and why no entry changes;
  - the reading interval (HDU 1 h, other wards 4 h) and the three prompts with their colours;
  - the photo with a typed level when a read is not possible, and the read volume the reminders imply;
  - "use the bag photo or Bag level, not a note"; an emptying saved twice is rejected as a duplicate;
  - correcting a misread on both entries;
  - "documents readings; not a diagnostic device".

  Also update the demo notes (the bag beds) and the API list (the two routes, `bags`). Verify: `pnpm format` leaves README unchanged, and every route named exists in `src/app.ts`.

## 8. Integration

- [x] 8.1 Browser check at 390 and 1100 px, through the Vite proxy, on the demo store from 7.1, run straight after seeding. Block `/api/ai/*` in the browser (Playwright `route(…, abort)`); nothing here needs a model. Photos are the demo's synthetic `bagPhoto` PNGs, added through the by-hand "Bag level" photo; volumes are typed.
  - **Signed in as `ravi` (Ravi Kumar, attendant; 3A and 2C):**
    - `/a/bed/<3A-3 token>`: "Bag level" for urine at 400 mL with a photo and "Emptied after photo" on (the default, with `The next reading starts from 0 mL.`), saved. The screen reads the charted rise and `Waiting for nurse approval.`; the network panel shows exactly one media upload and one `POST …/bag-readings` with `source: "photo"` and no evidence.
    - Then "Add after-emptying photo", the first button, with a photo and "Left in bag" 20 mL, then "Done": one media upload and one `POST …/after-emptying`.
    - 2C-6, after the break-the-glass reason if asked: `Bag level fell` is shown with no "Add missed emptying".
  - **Signed in as `anita` (Anita Thomas, nurse; 3A and 5B):**
    - The 3A dashboard: 3A-3 shows no bag prompt.
    - The 3A-3 bed review:
      - the "Bags" section with the early partial period and its rate, and the proof rows with `Before emptying`, `After emptying` and `Left in bag 30 mL` (seeded) and `Left in bag 20 mL` (Ravi's);
      - entry details of a check show both photos and `… mL → … mL · +… mL`.
    - 2C, after the break-the-glass reason:
      - 2C-5 shows `Bag reading due` (amber, `Review`);
      - 2C-6 shows `Bag level fell`, with its entry badged;
      - "Add missed emptying" at a time between the readings and a level at or above the one it fell from sends exactly one `POST …/bag-readings`; after the reload the prompt is gone and the new entry is pending with Approve and Reject.
    - Renal HDU, after the reason: HDU-1 shows `Catheter day 6` and its hourly periods, and no bag prompt.
  - **In the network panel:**
    - opening a bed review sends exactly the entries and meals GETs;
    - no `/api/ai` request is attempted.
- [x] 8.2 `pnpm spec:check` lists all 23 requirements of this change (13 in `charting/bag-periods`, 1 in `charting/level-pairing`, 4 in `web/capture`, 1 in `web/ward-round`, 4 in `web/ward`) as cited, with no unknown citation. Verify: the command exits 0.
- [x] 8.3 `pnpm verify` passes: format, lint, `openspec validate --all --strict`, spec:check, typecheck and tests (specs and traces included).

## Workflow follow-up

- Run the `spec-reviewer` agent on `bag-emptying` before `/opsx:apply`, and again before `/opsx:archive`.
- `openspec archive bag-emptying --yes` once 8.3 passes, then `pnpm spec:check`.
- After this change: `tray-segmentation`, `read-outcomes` and `dietitian` rebase on it, in that order, and `scale-acuity` last, as design.md "Overlaps" lists (read-outcomes drops or defers its duplicate-reading clauses; scale-acuity drops its catheter clause).
