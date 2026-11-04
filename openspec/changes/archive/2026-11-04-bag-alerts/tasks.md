# Tasks

Apply after `acuity-budget` and `tray-comparison` are archived, and archive before `accuracy-views`, `dietitian-care` and `scale-store` (design.md, "Overlaps"). Fixed order: … → tray-comparison → **bag-alerts** → accuracy-views → dietitian-care → scale-store → postgres-store → read-queue → ui-polish.

**Test-first.** For each task: write the citing tests (`[<domain>/<capability>] <Requirement>: <scenario>`), see them fail, implement, see them pass.

**Server tests** go through `testApp` and the fake upstream (`createMetaClient` over a fake `fetch`) on a fixed local clock (`new Date(2026, 10, 3, h, m)`). They assert the upstream request count: 0 everywhere, and exactly 1 for each Explain.

**Web tests** use `createApi` with a fake `fetchImpl` and a `staffId`. They assert the exact requests and that no `/api/ai` request is sent.

No test calls the network. Extend existing tests, never remove assertions: never weaken, skip or loosen one. If an earlier change's test breaks, stop and report.

## Scenario map (reference, not tracked)

| Scope item | Requirement(s) | Tasks |
|---|---|---|
| 1 Duplicate bag photo | [charting/bag-periods] Duplicate bag reading; [web/capture] Duplicate bag reading at the bed; [web/ward-round] Save the round, Bag readings in the round; [web/ward] Missed emptying already recorded, Readings saved anyway | 3.1, 3.2, 6.1, 7.1, 7.2, 8.4, 8.5 |
| 2 Bag nearly full | [charting/bag-periods] Bag nearly full, Bag prompts join the alerts; [web/capture] Nearly full at the bed; [web/ward] Bag prompt colours | 4.1, 4.2, 6.2, 8.2 |
| 3 Low urine output | [charting/alerts] Low urine output; [web/ward] Urine output rate against the threshold | 5.1, 5.2, 8.1 |
| 4 Catheter reading interval | [charting/care-plan] Care order values, Catheter necessity review; [charting/bag-periods] Reading interval, Urine bag reading due; [web/ward] Bag reading interval on the care plan | 2.1–2.5, 8.3 |
| 5 Bag readings in the round | [web/ward-round] Save the round, Bag readings in the round | 7.1, 7.2 |
| 6 web/ward | [web/ward] Urine output rate against the threshold, Bag reading interval on the care plan | 8.1, 8.3 |

| Boundary | Scenario |
|---|---|
| Duplicate at exactly 25 mL and 10 min vs 26 mL and 11 min, both sides | Duplicate bag reading: Bounds |
| Confirmation of an id that is no longer the nearest match | Duplicate bag reading: Response lost, tapped again; Match changed |
| Link check before the duplicate check; a 409 links nothing | Duplicate bag reading: Posted again with its read; Refused, then saved with its read |
| 403 before 409 | Duplicate bag reading: Not a way past the nurse |
| 80% exactly vs 1 mL under | Bag nearly full: At 80%; Stoma and drain (790/800) |
| Window `(from, to]` edges | Low urine output: Window edges; First reading counted whole (03:00 outside `(03:00, 09:00]`) |
| Exactly 2 × interval | Low urine output: Window ends at the newest bag reading (15:59 / 16:00); HDU hourly (10:59 / 11:00) |
| Window starting before the 24 h entries load | Low urine output: Charted 25 hours before |
| Admission 6 h before `to` | Low urine output: Admitted 6 hours before the window's end (14:59 / 15:00) |
| Rounding at the threshold | Low urine output: Rounded to whole mL (239 / 240 mL) |
| Interval 1 and 12 accepted, 0, 3 and 24 refused | Care order values: Boundaries accepted; Invalid values |
| Review state across an interval change | Catheter necessity review: Interval changed while due; Reviewed, then interval changed; Another catheter |
| Reading-due clock across an interval change | Urine bag reading due: Interval changed while overdue |

## 0. Before starting

- [x] 0.1 Rebase on the archived earlier changes.
  - **Archived.** `openspec/changes/archive/` holds bag-emptying, read-outcomes, dietitian, acuity-budget and tray-comparison, and `openspec list --specs` shows `charting/bag-periods`. If any is missing, stop: no group below starts.
  - **MODIFIED blocks.** Re-copy each from its live text, keeping only this change's edits:
    - `charting/alerts` Low urine output;
    - `charting/care-plan` Care order values and Catheter necessity review;
    - `charting/bag-periods` Reading interval, Urine bag reading due and Bag prompts join the alerts;
    - `web/ward-round` Save the round;
    - `web/ward` Urine output rate against the threshold and Bag prompt colours.

    Each block stays ≤ 500 characters; Care order values keeps care-plan's live catheter wording plus `, optional \`measure_every_h\` 1, 2, 4, 6, 8, 12 or null`.
  - **Code.** Re-check every `file:line` in design.md "Context" against the code: `addBagReading`, `readingInterval`, the reading-due clock (`bags.ts:230-235`), `linkProblem` in `routes/bags.ts`, `CARE_CODEC`, `chartView`'s entries load (`view.ts:31`), `alertsFor`'s 24 h lists (`alerts.ts:25-27`), `WardReads`, `storyBeds` and `withFluid` (`demo-history.ts:650`, `:662`), and `ALERT_KINDS` ending `…, bag_level_fell, poor_meal_intake`.
  - **Siblings.** Check `accuracy-views`, `dietitian-care`, `read-queue` and `postgres-store` for anything that now touches `addBagReading`, `lib/round.ts`, "Care order values" or the store's transactions (design.md "Overlaps"); report it, without depending on any of them. Known: dietitian-care's `keepTargets` in `store.setCare` and `store.endCare` (its `design.md:211-213`, `:404`) changes the same store and care code as 2.2 and 2.3; merge it textually and keep its 403 `forbidden` path inside the transaction.

  Verify: `pnpm exec openspec validate bag-alerts --strict` passes with no "not found" or "target spec does not exist" INFO line.

## 1. Shared contracts

- [x] 1.1 Add to `packages/shared/src/index.ts` the constants, types and helpers of design.md §1:
  - `BAG_CAPACITY_ML`, `BAG_NEARLY_FULL`, `DUPLICATE_WITHIN_MIN`, `DUPLICATE_TOLERANCE_ML`, `MEASURE_EVERY_H`, `MeasureEveryH`;
  - `CareValues['catheter'].measure_every_h` and the optional `CareInput<'catheter'>` key;
  - `ReadingInterval['from']` widened, and `readingInterval(admission, catheter?)`;
  - `BagReadingInput.confirm_duplicate_of`, `BagReading.confirmed_duplicate_of`, `BagDuplicate`, `DuplicateReadingBody`;
  - `bag_nearly_full` in `ALERT_KINDS` after `bag_level_fell`;
  - the `catheterSince`, `urineWindow` and `urineInWindow` signatures, each throwing `not implemented` for now.

  Then fix the compile errors this causes:
  - the web's exhaustive `ALERT_LABEL` / `ALERT_TONE` (`bag_nearly_full` amber, `Bag nearly full`);
  - `CARE_ROW` / `CARE_HISTORY_TEXT` reading `measure_every_h`;
  - `BagReading` and catheter fixtures, with `confirmed_duplicate_of: null` and `measure_every_h: null`;
  - `interval_from` switches.

  Verify: `pnpm typecheck` passes, and every existing test passes with no assertion changed.

## 2. Server: catheter interval and the catheter chain

- [x] 2.1 Pure helpers, tests first in `apps/server/src/chart/bags.test.ts` (unit, no citation):
  - `readingInterval({ ward_code: '3A' }, { measure_every_h: 1 })` → `{ h: 1, from: 'catheter' }`;
  - `(HDU, 4)` → `{ h: 4, from: 'catheter' }`;
  - `(3A, null)` and `(3A)` → `{ h: 4, from: 'default' }`;
  - `catheterSince`: a chain of three orders with the same type and insertion, broken by a type change and by a gap, and a chain whose first order ended more than 24 h ago.

  Verify: these pass, and bag-emptying's "reading interval" unit test passes unchanged.
- [x] 2.2 [charting/care-plan] Care order values. Tests in `apps/server/src/care.test.ts` cite Care order values: Every kind, Boundaries accepted, Invalid values (each `measure_every_h` case), No interval, sent either way.
  - **Codec.** `toRow` writes `measure_every_h` only when non-null, and `fromRow` returns `?? null` (design.md §3).
  - **Body.** The zod catheter body gains `measure_every_h: z.union([z.literal(1), …, z.literal(12), z.null()]).optional()`.

  Verify: these tests and care-plan's other `care.test.ts` tests pass unchanged.
- [x] 2.3 [charting/care-plan] Catheter necessity review.
  - **Tests.** Pure tests in `apps/server/src/chart/care.test.ts` and HTTP tests in `apps/server/src/care.test.ts` cite Catheter necessity review: Interval changed while due, Reviewed, then interval changed, Another catheter. The existing Review due, Reviewed, Once a chart day, Set today and No catheter tests pass unchanged.
  - **Rule.** The catheter rule takes the chain (`catheterSince`) and its reviews: `due` from the chain's first `start_at`; `reviewed` and `last_review` over the chain.
  - **Store.** `store.catheterOrders(admissionId)` and `catheterOrdersByWard(wardId)` return the full catheter history (design.md §3); `WardReads` gains the ward's. `chartView` builds the chain from that history, never from its 24 h orders, and passes `store.lastReviewOf(chainIds)`. `reviewCatheter` returns `already_reviewed` when any chain order has a review that chart day, all inside its transaction.
  - **Web.** `lib/care.ts:186` offers "Reviewed today" from `catheterSince(care_history, active)` (checked in 8.3).

  Verify: these tests pass.
- [x] 2.4 [charting/bag-periods] Reading interval.
  - **Interval.** `bagChart` takes the active catheter's value, and `bags.interval_from` returns it.
  - **Storage.** The `level.confirmed_duplicate_of` column goes in `SCHEMA`'s `CREATE TABLE`, and `STORE_SCHEMA_VERSION` goes from 4 to 5 (stop if the live value is not 4). No upgrade step.
  - **Tests** in `apps/server/src/bags.test.ts` cite Reading interval: Catheter interval, Longer than the ward's, Not set, Order ended, each asserting 0 upstream requests. The existing Ward defaults test passes unchanged.

  Verify: these tests and bag-emptying's "Urine bag reading due" tests pass unchanged.
- [x] 2.5 [charting/bag-periods] Urine bag reading due.
  - **Rule.** `bagChart` takes the chain from 2.3 (`BagChartInput` gains it) and counts from `max(newest urine-bag reading, chain[0].start_at)`, replacing the active order's `start_at` (`bags.ts:230-235`). The "no reading since the catheter order at …" message names `chain[0].start_at`. The interval stays the active order's.
  - **Tests** in `apps/server/src/bags.test.ts` cite Urine bag reading due: Interval changed while overdue. Both beds go through `PUT …/care/catheter` at 14:30, then `GET …/entries` at 14:31, asserting the messages and 0 upstream requests.

  Verify: this test passes, and bag-emptying's At the interval, Twice the interval, HDU hourly, No reading since the order, Overnight, Reading taken and No catheter order tests pass unchanged.

## 3. Server: duplicate bag reading

- [x] 3.1 Pure `duplicateOf(stored, r)` in `apps/server/src/chart/bags.ts`, unit tests first in `apps/server/src/chart/bags.test.ts`:
  - same event at ±25 mL and ±10 min inclusive matches;
  - 26 mL, 10 min 1 s, another event and another container do not;
  - with several matches, the nearest in time wins, then the newest id;
  - the save decision (design.md §4): no match saves with `null`; a match equal to `confirm_duplicate_of` saves with that id; any other `confirm_duplicate_of`, or none, refuses with the match.

  Verify: these pass.
- [x] 3.2 [charting/bag-periods] Duplicate bag reading.
  - **Store.** In `store.addBagReading`, inside its transaction, after the fall guard and before `charge` (design.md §4): load the readings in `[t − 10 min, t + 10 min]` and run `duplicateOf`. Throw `Duplicate` (carrying the `BagDuplicate`) unless `confirm_duplicate_of` equals the match's id, then insert with `confirmed_duplicate_of`.
  - **Route.** `routes/bags.ts` validates `confirm_duplicate_of` as `z.number().int().positive().optional()` and maps `Duplicate` → 409 `{ error: 'duplicate_reading', duplicate_of }`. read-outcomes' `linkProblem` stays before `addBagReading`.
  - **Tests** in `apps/server/src/bag-alerts.test.ts` cite Duplicate bag reading: Emptying saved twice, Saved anyway, Response lost, tapped again, Match changed, Bounds (each case on a fresh store), Different event or bag, Posted again with its read, Refused, then saved with its read (reads from the real `/api/ai/read` over a fake `urine_bag` output, asserting `store.linked`), Not a way past the nurse, Invalid confirmation. Each refused case asserts the bag's readings, entries and links are unchanged, and each post asserts 0 upstream requests.

  Verify: these tests pass. bag-emptying's `bags.test.ts` and `chart/bags.test.ts` and read-outcomes' `read-links.test.ts` pass with no assertion changed. If one of them now gets a 409, stop and report.

## 4. Server: bag nearly full

- [x] 4.1 [charting/bag-periods] Bag nearly full. `bagChart` emits `bag_nearly_full` per bag (design.md §5), after the falls. Tests in `apps/server/src/bag-alerts.test.ts`, on a fixed clock, cite Bag nearly full: At 80%, Stoma and drain, Emptied, Overnight, A day later. Verify: these tests pass.
- [x] 4.2 [charting/bag-periods] Bag prompts join the alerts. Tests in `apps/server/src/bags.test.ts` cite Bag prompts join the alerts: Only nearly full (`GET /api/wards`, then Explain with exactly 1 upstream request whose input holds `bag_nearly_full` and not `Grace Okafor`). Verify: this test and the existing Only a fall test pass.

## 5. Server: low urine output

- [x] 5.1 Shared `urineWindow` and `urineInWindow` (design.md §1, §6), unit tests first in `apps/server/src/chart/alerts.test.ts` (no citation):
  - `to` at now, at the newest bag reading, and back at now from 2 × interval or after a pending or approved non-bag urine entry (a rejected one leaves it);
  - `from` 30 h back at a 12 h interval with the newest reading just under 24 h old;
  - the spread of a 320 mL entry over `(00:00, 08:00]` into `(02:00, 08:00]` = 240;
  - a first reading counted whole at its charted time, in or out of the window;
  - rounding once (179.25 → 179);
  - pending and rejected entries left out.

  Verify: these pass.
- [x] 5.2 [charting/alerts] Low urine output.
  - **Rule.** `alertsFor(…, { nilByMouth, window })` with the default `(now − 6 h, now]`, the admission gate on `window.to`, and the two messages. The sum reads its own approved urine list over every entry passed in, not the 24 h `approved` (`alerts.ts:25-27`); every other rule keeps its own window filter.
  - **Wiring.** `careChart` passes `window` through. `chartView` computes it from the bag readings it already loads, the base entries and the interval of 2.4, then loads entries from `min(now − 24 h, chart-day start, window.from)` (design.md §6, one more `store.recent` call only when `window.from` is earlier).
  - **Pure tests** in `apps/server/src/chart/alerts.test.ts` cite Low urine output: Window edges, Window ends at the newest bag reading, Spread from the reading before, Rounded to whole mL, HDU hourly, Admitted 6 hours before the window's end, Urinal after the bag, First reading counted whole, Charted 25 hours before. The existing 60 kg patient, 120 mL in 6 h, Enough output and "not before 6 h of admission or without weight" tests pass unchanged.
  - **HTTP tests** in `apps/server/src/bag-alerts.test.ts`, through `POST …/bag-readings`, approve and `GET …/entries`, each asserting 0 upstream requests:
    - one repeats Window ends at the newest bag reading;
    - one repeats Charted 25 hours before, so the 13:00 entry reaches the rule only through `chartView`'s wider load.

  Verify: these tests pass. The existing `chart.test.ts` "Alerts on chart reads" and "Intake and output mismatch" tests, acuity-budget's acuity tests and dietitian's alert tests pass unchanged.

## 6. Web: capture

- [x] 6.1 [web/capture] Duplicate bag reading at the bed.
  - **API.** `lib/api.ts`'s `ApiError` keeps a 409 body's `duplicate_of`.
  - **Plan.** `lib/bags.ts` keeps each bag save's first body (its `media_id` and the `read_id` decided at the first attempt), and builds the duplicate line and the one-shot "Save anyway" plan (`confirm_duplicate_of: duplicate_of.id`, no upload). A 409 answer to that plan replaces the line with its new `duplicate_of`.
  - **UI.** `components/bag-reading.tsx` shows the panel, "Save anyway" (secondary) and "Discard" (primary), for the check screen, "Bag level" by hand and "Emptied it now?".
  - **Tests** in `apps/web/src/lib/bags.test.ts` cite Duplicate bag reading at the bed: Saved twice, Save anyway, Response lost, Discard, By hand.

  Verify: these tests and bag-emptying's and read-outcomes' web tests pass unchanged.
- [x] 6.2 [web/capture] Nearly full at the bed. `lib/bags.ts` builds the nearly-full line from `BAG_CAPACITY_ML`, and the after-save step leads with "Emptied it now?". Tests in `apps/web/src/lib/bags.test.ts` cite Nearly full at the bed: Check at 1650 mL, Under 80%, or emptied, Stoma bag by hand. Verify: these tests pass.

## 7. Web: ward round

- [x] 7.1 [web/ward-round] Bag readings in the round.
  - **State.** In `lib/round.ts`, `RoundBed.interval` is set in `setWard` from each ward-list item's active catheter (`readingInterval(a, catheter)`), and from `readingInterval(bed, null)` for a bed found by token.
  - **Readings.** `Reading.bag.event` starts at `emptied` when `emptiedByDefault(bed.interval)`, else `check`. `Reading.duplicate` holds a 409's `duplicate_of`.
  - **Saving.** `saveBag(reading, { confirmOf })` reuses the stored `media_id` and sends `confirm_duplicate_of: confirmOf`.
  - **UI.** `routes/a/round.tsx` shows, per bag reading, one choice-chip radio group `Check · Emptied · Bag changed` (apps/web/DESIGN.md §4.8 and §7.1; no switch, no separate chip), the duplicate line, "Save anyway" and the saved message.
  - **Tests** in `apps/web/src/lib/round.test.ts` cite Bag readings in the round: Per-reading event, Bag changed, Catheter interval, Duplicate, Saved message.

  Verify: these tests pass.
- [x] 7.2 [web/ward-round] Save the round. "Save all high-confidence" uses each reading's event and skips readings with `duplicate` set. Tests in `apps/web/src/lib/round.test.ts` cite Save the round: Duplicate left for review. The existing Mixed round and Two wards tests pass unchanged, as do read-outcomes' Round reads and saves carry their read and Round saves resume after a failure tests. Verify: these tests and the whole web suite pass.

## 8. Web: nurse views

- [x] 8.1 [web/ward] Urine output rate against the threshold. `lib/charts.ts`'s `urineRate` takes `bags` and anchors on `urineWindow(…).to`, counting with `urineInWindow`; `rateCaption` gives `To the <time> bag reading`; `components/bed-charts.tsx` shows the caption. Tests in `apps/web/src/lib/charts.test.ts` cite Urine output rate against the threshold: Ends at the bag reading, Reading overdue, Spread like the prompt. The existing Low rate now, No weight, Recent admission and Just under the line tests pass unchanged. Verify: these tests pass.
- [x] 8.2 [web/ward] Bag prompt colours. Tests in `apps/web/src/lib/care.test.ts` cite Bag prompt colours: Worst prompt wins (its fourth bed added), Flagged entry (unchanged). Verify: these tests pass.
- [x] 8.3 [web/ward] Bag reading interval on the care plan.
  - **Row and history.** `lib/care.ts` gives the catheter row's interval line from `bags`, with ` · Ward default` when `interval_from` is `default` (apps/web/DESIGN.md §7.5), and the history text.
  - **Form.** "Bag reading every" with `Ward default (<h> h)` from `readingInterval(admission, null)`, saved with the stored `type` and `inserted_at`.
  - **Reviewed today.** Offered from `catheterSince(care_history, active)`.
  - **UI.** `components/care-forms.tsx` and `care-plan.tsx`.
  - **Tests** in `apps/web/src/lib/care.test.ts` cite Bag reading interval on the care plan: Set by the order, Default, Change it, Back to the default, Form defaults, History.

  Verify: these tests and care-plan's and acuity-budget's `care.test.ts` tests pass unchanged.
- [x] 8.4 [web/ward] Missed emptying already recorded. `components/missed-emptying.tsx` shows the 409 line with "Save anyway" (one resend with `confirm_duplicate_of` the shown reading's id, then the reload) and "Cancel" (the reload only), from rules in `lib/bags.ts`. Tests in `apps/web/src/lib/bags.test.ts` cite Missed emptying already recorded: Added by someone else, Cancel, Save anyway. Verify: these tests and bag-emptying's Add a missed emptying tests pass unchanged.
- [x] 8.5 [web/ward] Readings saved anyway. `lib/bags.ts` adds the row suffix, shown by `components/bag-periods.tsx`. Tests in `apps/web/src/lib/bags.test.ts` cite Readings saved anyway: Repeat emptying. Verify: this test and bag-emptying's Bag periods on the bed review tests pass unchanged.

## 9. Demo and README

- [x] 9.1 `apps/server/scripts/demo-history.ts`, as design.md §11.
  - **The story.** 2C-2's catheter (`measure_every_h: 2`, reviewed today), urine-bag checks and the one emptying, and the drain bag, all through `store.setCare`, `store.reviewCatheter` and `store.addBagReading` at the scripted clock, in bag-emptying's bag section.
  - **Reads and links** for its photo readings, as read-outcomes does for the other bag beds.
  - **Rows, meals and approvals.** 2C-2 goes into `BAG_STORIES` only, never `careBeds` or `scripted`, so it stays out of `storyBeds` and `withFluid` (`demo-history.ts:662`) keeps its meal fluids. Its routine urine rows are dropped, and every bag entry but each bag's newest is approved by 2C's nurse.
  - **Guard.** `INTENDED` gains `'2C-2': ['bag_nearly_full']`, and every other row is unchanged.
  - **Header.** The header comment lists 2C-2 and its decay: `bag_reading_due` just after +1.5 h (more than the 2 h interval), then `bag_reading_overdue`, `low_urine_output` and `Suggested critical · Review` at +3.5 h.

  Verify:
  - one run over a fresh temporary `DATA_DIR` succeeds, with care-plan's and bag-emptying's `INTENDED`, read-outcomes' outcome counts and alerts snapshot, and dietitian's `poor_meal_intake` assertion all passing;
  - `GET /api/admissions/<2C-2>/entries` on that file shows `bags.interval_from: "catheter"` and `interval_h: 2`, and 2C-2's meals carry fluid entries;
  - the script makes no model request.
- [x] 9.2 README "Emptying bags" gains:
  - duplicates: 10 min and 25 mL, the same event only, "Save anyway" recorded, and why it confirms one reading's id;
  - nearly full and the three capacities;
  - the catheter's "Bag reading every", why it follows the catheter, not acuity, and why the review and the reading-due clock follow the catheter across an interval change;
  - the low-output window: its end at the newest reading until 2 × interval, the spread, a first reading counted whole, rounding, the message;
  - the API list: the 409 and `confirm_duplicate_of`, and `measure_every_h`.

  Verify: `pnpm format` leaves README unchanged.

## 10. Integration

- [x] 10.1 Browser check at 390 and 1100 px, through the Vite proxy, on a demo store from 9.1 in a fresh temporary `DATA_DIR`, seeded straight before.
  - **Server.** Start it in-process over `testing.ts`'s fake upstream, from a scratch script outside the repo that is never committed, or from tray-comparison's dev-only `apps/server/scripts/fake-server.ts` when its fixtures can give the answer below; never the real upstream. Every photo read answers a `urine_bag` at 380 mL at confidence 0.9 in `spark` mode, so each read is 1 fake upstream request.
  - **Signed in as `ravi`** (Ravi Kumar, attendant; 3A and 2C):
    - 3A-3, by-hand "Bag level", urine, emptied at 400 mL with a photo: saved. Saving the same again at once shows `Same as the reading at <time>: emptied at 400 mL.` with "Save anyway" and "Discard". "Discard" sends nothing; repeating and tapping "Save anyway" sends exactly one bag-reading post with `confirm_duplicate_of` the first reading's id and no second upload.
    - 2C-2, a photo read on the check screen: the event starts at `Check`, not `Emptied` (bag-emptying's "Emptied after photo" off; 2 h interval). A by-hand drain check at 850 mL shows `Nearly full: 850 of 1000 mL. Empty it now?`, and after saving "Emptied it now?" is the first button.
    - Round on 3A, within 10 minutes of that 400 mL emptying: photos for beds 3 and 5, both read as 380 mL. Each reading shows one `Check · Emptied · Bag changed` radio group starting at `Emptied` (4 h interval), with no switch beside it. Pick `Check` on bed 5, then "Save all high-confidence":
      - bed 3's emptying, 20 mL from the 400 mL one, answers 409 and shows its line and "Save anyway";
      - bed 5's is saved as `check`;
      - tapping "Save all" again sends nothing for bed 3.
  - **Signed in as `anita`** (Anita Thomas, nurse; 3A and 5B; break-the-glass for 2C):
    - 2C dashboard: 2C-2 shows `Bag nearly full` (amber, `Review`); 2C-5 and 2C-6 keep `Bag reading due` and `Bag level fell`.
    - 2C-2 bed review: the catheter row reads `Bag reading every 2 h`; the rate chart is captioned `To the <time> bag reading`. 3A-3's catheter row reads `Bag reading every 4 h · Ward default`.
    - Change 2C-2's interval to 1 h: one PUT and the reload. "Reviewed today" still shows if the review was due, History shows both orders, and any urine-bag prompt names the last reading (`last <time>`), never `no reading since the catheter order`.
    - 3A-3 bed review: the saved-anyway row reads `… · Saved anyway · same as <time>`.
    - 2C-6: open "Add missed emptying" in two tabs, and save the same time and level in each. The second shows `Same as the reading at <time>: emptied at <level> mL.`, and "Cancel" sends only the reload.
  - **Network log:**
    - opening a bed review sends exactly the entries and meals GETs;
    - the only `/api/ai` requests are the round's and the check screen's reads, each 1 fake upstream request;
    - no console errors.
- [x] 10.2 `pnpm spec:check` lists all 17 requirements of this change as cited, with no unknown citation:
  - 5 in `charting/bag-periods`, 1 in `charting/alerts` and 2 in `charting/care-plan`;
  - 2 in `web/capture`, 2 in `web/ward-round` and 5 in `web/ward`.

  Verify: the command exits 0.
- [x] 10.3 `pnpm verify` passes: format, lint, `openspec validate --all --strict`, spec:check, typecheck and tests (specs and traces included).

## Workflow follow-up

- Run the `spec-reviewer` agent on `bag-alerts` before `/opsx:apply`, and again before `/opsx:archive`.
- `openspec archive bag-alerts --yes` once 10.3 passes, then `pnpm spec:check`.
- **accuracy-views** archives after this change. It needs no edit; its demo guard reruns this change's story guards. A refused duplicate's read that is discarded becomes `abandoned` after 12 h, which counts in read-outcomes' `Abandoned` and accuracy-views' "not kept" figures (design.md "Overlaps").
- **dietitian-care** archives **after** bag-alerts and shares no requirement with it. It no longer MODIFIES "Care order values": it adds "Diet order values" (`openspec/changes/dietitian-care/specs/charting/care-plan/spec.md:73`), so "Care order values" archives as this change leaves it and dietitian-care rebases nothing on it. Its `keepTargets` in `setCare` / `endCare` is a textual merge with tasks 2.2 and 2.3 (design.md "Overlaps").
- **scale-store** is the only later change that rebases on this one (its task 1.1). The complete list:
  - **bag-periods "Reading interval"** (`scale-store/specs/charting/bag-periods/spec.md:5`):
    - rebase on this change's text, catheter first, then acuity;
    - keep the Catheter interval, Longer than the ward's, Not set and Order ended scenarios, with `default` → `acuity`;
    - add a scenario where the catheter beats acuity.
  - **acuity spec :20:** reword to "the level's interval, which the bed uses unless its catheter order sets one".
  - **New MODIFIED web/ward block:** "Bag reading interval on the care plan".
  - **scale-store design.md:**
    - :15-16, the `interval_from: 'catheter' | 'acuity'` type and `readingInterval(acuity, catheter)`;
    - :66 and :203, which say acuity never affects `low_urine_output` (no longer true);
    - :126, `ruleEntries` carries `levels.before.created_at` and loads back to `window.from`;
    - the cached status unit's inputs: urine-bag reading times and the catheter value;
    - :197, the apply order.
  - **Other scale-store files:** proposal.md :10 and :45; tasks.md :15, :22 and :58.
- **postgres-store** (`openspec/changes/postgres-store/`). Its admission `FOR UPDATE` (`design.md:147`) already covers the duplicate check, the neighbour load, `charge` and the review insert, which all run inside a transaction that reads first. Only read-outcomes' `linkProblem` runs in the route, outside `addBagReading`'s transaction; `read_link`'s unique index (`design.md:148`) stops a double link, but the second concurrent post would get a 500. postgres-store should run `linkProblem` inside `addBagReading`'s locked transaction, as its first check (preferred), or else map the `read_link` unique violation to 400 `already linked`. No advisory lock and no SERIALIZABLE, which it rejects (`design.md:149`). The places:
  - its `design.md` §4.1 "Isolation", as a bullet after the admission `FOR UPDATE` bullet (`design.md:147`): the link check runs inside the locked transaction;
  - its `tasks.md` 4.5 concurrency tests (`tasks.md:56-60`), adding two identical bag readings for one bag at the same instant (one 201 and one 409, titled under [charting/bag-periods] Duplicate bag reading) and two posts with the same `read_id` (one link, one 400 `already linked`, never a 500);
  - its `design.md` §1 Context line for bag-alerts (`design.md:83`), which should say `linkProblem` moves into `addBagReading`'s transaction, beside `level.confirmed_duplicate_of`.
