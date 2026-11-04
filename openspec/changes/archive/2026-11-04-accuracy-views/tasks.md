# Tasks

**Order.** The global apply order is tray-segmentation → read-outcomes → dietitian → acuity-budget → tray-comparison → bag-alerts → **accuracy-views** → dietitian-care → scale-store → postgres-store → read-queue. No group here starts before group 0. design.md, "Order and overlaps", lists the files shared with those changes.

**Test conventions.**
- Every test runs without the network. Each test is written first and seen to fail before the code it cites exists.
- Server tests go through `testApp` with the fake upstream (`createMetaClient` over a fake `fetch`). Each asserts the exact upstream request count: a tray read 3 in `sam+spark` mode, 5 with a served photo compared, 1 in `spark` mode; a photo read 3 (1 in `spark`), text 1, voice 2; and 0 for meal saves, amends, voids, approvals and `GET /api/quality/model`.
- Clocks are local (`new Date(2026, 10, 3, h, m)`).
- Staff are `signIn(store, id)`: Ravi Kumar 1, Sunita Devi 2, Anita Thomas 4.
- Where a scenario needs many reads, they are seeded with `store.recordRead(readRow(…))` and linked through the store (design.md "Test strategy"). Tray outputs are fake SAM and Spark answers with staged props only, never a real patient.
- Web tests use `createApi` with a fake `fetchImpl` and a `staffId`. They assert the exact requests and bodies, and that no `/api/ai` request is sent unless the scenario reads a tray.
- Tests are titled `[<domain>/<capability>] <Requirement>: <Scenario>`. A test that read-outcomes or tray-comparison already wrote for a scenario this change edits or moves is retitled or updated in place, never copied.

**Scenario → test file map.** Each task below lists the scenarios it cites.

| Requirement | Test file |
|---|---|
| [capture/meal-reading] Tray reading | `apps/server/src/meal-reading.test.ts` (tray-comparison's tests, unchanged) |
| [charting/model-accuracy] Tray reads are logged, Read log holds no text | `apps/server/src/read-log.test.ts` (read-outcomes') |
| [charting/model-accuracy] Link a meal to its read | `apps/server/src/read-links.test.ts` (read-outcomes') |
| [charting/model-accuracy] Outcome of a saved meal, Retaken tray reads, Unsaved drafts, Negative reads, Dish scoring, Portion agreement, Fluid with a meal, Outcomes per container, Top corrections, Positive drafts not kept, Model accuracy summary | `apps/server/src/model-quality.test.ts` (read-outcomes') |
| (uncited extras) meal rows M1–M7, row R0 (`retaken`) and its edges, the saved-values rule, `pairDishes`, `portionAgreement`, `topCorrections`, container order | `apps/server/src/chart/model-accuracy.test.ts`, `apps/server/src/chart/scoring.test.ts` |
| [charting/model-accuracy] Tray eval report | `apps/server/src/chart/tray-lab.test.ts` (tray-comparison's four tests unchanged, three new) |
| [web/capture] Meal saves carry their read | `apps/web/src/lib/read-links.test.ts` (read-outcomes') |
| [web/ward] Outcome bars, Outcome colours | `apps/web/src/lib/outcome-bars.test.ts` (new) |
| [web/ward] Model accuracy view, Chart or table, Class table picker, Kept drafts, meal fluid and top corrections, Hospital model accuracy view | `apps/web/src/lib/model-accuracy.test.ts` (read-outcomes') |
| [web/ward] Hospital ward list | `apps/web/src/lib/lib.test.ts` (existing tests, unchanged) |
| Rendered state no lib test can see: [web/ward] Chart or table: "Chart first"; Outcome bars: "Opened by a tap"; Outcome colours: "Hues" (the label colour); Hospital model accuracy view: "Open the model view", "Back to wards", "Unknown view" | Browser check 9.1 asserts each, step by step. Their lib tests above assert only the pure part: the default view `chart`, the popup lines, the swatches, `hospitalView` and `hospitalModelLoad` |

## 0. Base

- [x] 0.1 Prerequisites archived; rebase.
  - Check: `openspec/changes/archive/` holds read-outcomes, tray-segmentation, acuity-budget, tray-comparison and bag-alerts, and `openspec list --specs` shows `charting/model-accuracy` with "Model accuracy summary" and "Tray eval report", and `capture/meal-reading` with tray-comparison's "Tray reading" (5 with a served photo). If any is not archived, stop: no group below starts.
  - Rebase on their archived specs (`openspec/specs/**`) and code: `readRow`, `linkProblem`, `outcomes`, `modelQuality` and `scoring.ts` (read-outcomes); `MealReadResult`, `DISH_KINDS`, `MealProof.confirmed` (tray-segmentation); the budget's downgrade and refusal on `/meal` (acuity-budget); `admission_id` and `meal` on `/meal`, `comparison`, `amendMeal` and `meal_event`, `tray-lab.ts`, `--tray-labels` and `scripts/fake-server.ts` (tray-comparison); and the demo story guards (bag-alerts). Re-check every `file:line` and function name cited in design.md against the rebased code.
  - Verify: `pnpm verify` passes on the base before 1.1.
- [x] 0.2 Re-copy the MODIFIED blocks from the archived text.
  - Replace the base of `specs/capture/meal-reading/spec.md` "Tray reading" with the archived requirement word for word, then re-apply only this change's two edits: "It saves nothing." → "It saves only its read.", and "Half-eaten lunch"'s "nothing is saved" → "no meal or entry is saved". Its other scenarios stay word for word.
  - Do the same for `charting/model-accuracy` "Tray eval report" from tray-comparison's archived text: its four scenarios word for word (the soup `AND` line of "Unscored values" included), then this change's three added scenarios. Its statement is this change's reworded one (design.md §9): check that every rule of the archived statement is still in it, and that it is ≤ 500 characters as OpenSpec counts them (`node /tmp/speclen/check.mjs "$PWD"`, since validate skips MODIFIED blocks).
  - Do the same for "Read log holds no text", "Negative reads", "Unsaved drafts", "Model accuracy summary", web/ward "Model accuracy view" and "Hospital ward list" from the archived read-outcomes and web/ward specs (for "Unsaved drafts", re-apply only the "that is not `retaken` ("Retaken tray reads")" clause), keeping every archived scenario word for word apart from the ones this change edits ("Kinds always listed", "No names", "Two requests", "Read kinds", "No reads"). Keep "Read kinds" and "Type table" in "Model accuracy view": a MODIFIED block that drops a scenario fails validation.
  - Verify: `pnpm exec openspec validate accuracy-views --strict` passes with no INFO about a missing target.

## 1. Shared contracts

- [x] 1.1 Shared types and config (design.md "Types").
  - Write the failing test first, in `apps/web/src/lib/model-accuracy.test.ts`: [web/ward] Chart or table: "Tray row", calling `kindRows` with a six-row `kinds`. Here it asserts only the `Tray (SAM + Spark)` row and its seven cells; 6.3 adds the "no `Photo (Spark only)` row" assertion with the empty-kind skip. It fails to compile, because `'tray'` is not a `ReadKind` yet.
  - Then add, in `packages/shared/src/index.ts`: `READ_KINDS` + `'tray'`; `READ_OUTCOMES` + `'retaken'` after `'abandoned'`; `READ_RETAKE_MINUTES = 10`; `NEGATIVE_ISSUES` = `['no_container', 'not_a_meal']` typed `readonly (ReadingIssue | MealIssue)[]`; `CLASS_TABLES` + `'dish_kind'`; `TOP_CORRECTIONS = 5`; `trayDrafts`; `MealInput.read_id?`; `KindRow.edited_at_capture`, `KindRow.corrected_by_nurse` and `KindRow.mode`'s new comment; `ContainerRow`, `PortionAgreement`, `MealFluidScore`, `Positives` (with `retaken`), `TopCorrection`; the `ModelQuality` additions and the `negatives.overridden_as` comment.
  - Fix every exhaustive map the compiler names (`KIND_LABEL`, `Record<ClassTable, …>`, `Record<ReadOutcome, …>`), with `Tray (SAM + Spark)` and `Tray (Spark only)`, and every `KindRow` fixture it names (the two new rates, and `outcomes.retaken: 0`).
  - Verify: `pnpm typecheck` passes, this test passes, and every other test passes except read-outcomes' "Kinds always listed", which 3.6 updates through this change's MODIFIED scenario.

## 2. Server: tray reads in the log

- [x] 2.1 Tray reads are logged (design.md §1).
  - Write the failing tests:
    - in `apps/server/src/read-log.test.ts`: [charting/model-accuracy] Tray reads are logged: "Tray read" (3 requests; the `read_id` names the row), "Spark-only tray read" (1), "Served photo compared" (tray-comparison's upload with `served_meal: lunch` at 12:40, then the read at 13:30 with `meal: lunch`; 5 requests; `served: true`, basis `measured`), "No draft" (`not_a_meal`; a `read_id`, 0 drafts; 1 request), "Failed tray read" (429, no `read_id`, no row, 1 request), "Refused by the budget" (acuity-budget's cap of 120, 30 % reserve and 84 in use; 429 `request_budget_exceeded`, no `read_id`, no row, 0 requests);
    - in `apps/server/src/read-log.test.ts`: [charting/model-accuracy] Read log holds no text: "Tray read" (paneer tikka and masala chai; scan every column of the row as text, walk `output` for string leaves and check each against `READ_KINDS`, `DISH_KINDS`, `MEAL_FLUID_KINDS`, `PORTION_BASES` or `MEAL_ISSUES`; no `image_sha256`, name, mask or box; capture `console.log`/`console.error` during the request). Re-run its "Voice note" and "Photo read" unchanged;
    - `apps/server/src/meal-reading.test.ts`: tray-comparison's [capture/meal-reading] Tray reading tests stay as they are. "Half-eaten lunch" already asserts that the bed's meals and entries are unchanged, which is its edited "no meal or entry is saved"; no assertion is added or removed.
  - Implement the `tray` arm of `ReadOutput` and `ReadOutputSchema`, `readRow('tray', result, ctx)` copying only the enumerated fields and counting drafts with `trayDrafts`, and `/meal` recording its read after the pipeline returns and answering `Logged<MealReadResult>`.
  - Verify: these tests, `ai/ai.test.ts`, `meals.test.ts`, `evidence.test.ts`, `security.test.ts` and the read-budget tests pass.
- [x] 2.2 Link a meal to its read (design.md §2).
  - Write the failing tests in `apps/server/src/read-links.test.ts`: [charting/model-accuracy] Link a meal to its read: "Lunch linked" (read 61; `read_link` row with `meal_id`; 0 requests on the save), "Refused meal links" (each of the 7 bullets on a fresh store: 400 `invalid_request` at `read_id`, no meal, no entry, no link), "Bedless tray read" (read 62), "Empty tray read" (read 63, `not_a_meal`, no draft; the photo lunch without `read_id` is 201, no `read_link` row, read 63 still `negative_confirmed`), "Meal posted again" (`already linked`, one meal).
  - Implement `read_id` on `MealBody`, the tray ↔ meal ↔ photo row of `linkProblem`, the check before `addMeal`, and the `read_link` insert inside `addMeal`'s transaction after the proof is built. `ReadLinkTaken` maps the conflict to the same 400.
  - Verify: these tests and read-outcomes' link tests pass unchanged.

## 3. Server: outcomes, scoring and the summary

- [x] 3.1 Dish pairing and portions (design.md §4).
  - Write the failing tests:
    - in `apps/server/src/chart/scoring.test.ts` (uncited extras): `pairDishes` kind first, then in order, left-overs paired with `none`, same kind twice; `portionAgreement` quarters, unknown portions left out, floors at `MIN_N`; `topCorrections` ordering and ties;
    - in `apps/server/src/model-quality.test.ts`: [charting/model-accuracy] Dish scoring: "Kind changed", "Removed and added", "Same kind twice"; [charting/model-accuracy] Portion agreement: "Quarters" (exact 2/5 `40%`, within a quarter 3/5 `60%`, `quarters_off` `[2, 1, 1, 0, 1]`), "Meal portion after an amend".
  - Implement `pairDishes`, `portionAgreement` and `topCorrections` in `src/chart/scoring.ts`.
  - Verify: these tests and read-outcomes' scoring tests pass.
- [x] 3.2 Outcome of a saved meal (design.md §3).
  - Write the failing tests:
    - in `apps/server/src/chart/model-accuracy.test.ts` (uncited extras): rows M1–M7 one by one; the saved-values rule (`proof.confirmed`, else the first `meal_event`'s before-values, else the current values); the sorted `(dish_kind, portion)` multiset;
    - in `apps/server/src/model-quality.test.ts`: [charting/model-accuracy] Outcome of a saved meal: "Accepted lunch", "No fluid", "Edited at capture", "Amended by a nurse" (through `POST /api/meals/:id/amend`), "Renamed only" (an amend of `items` and a dish name only stays `accepted`), "Fluid entry rejected", "Voided and pending". Each asserts 0 upstream requests for the saves, amend, void and summary.
  - Implement meal rows in `store.readOutcomeRows` and the meal arm of `outcomes`.
  - Verify: these tests and read-outcomes' "Outcome of a saved draft" and "Outcome of a saved level" tests pass unchanged.
- [x] 3.3 Retaken tray reads (design.md §3, "Retaken tray reads").
  - Write the failing tests first:
    - in `apps/server/src/model-quality.test.ts`: [charting/model-accuracy] Retaken tray reads: "Lunch read twice" (Ravi Kumar, id 1, reads 3A bed 1's lunch through `/api/ai/meal` at 12:00 and 12:04 in `sam+spark` mode with no served photo, reads 70 and 71, then saves the lunch with `read_id: 71`; read 70 `retaken` at 12:05 and at 00:05 the next day; the `tray` `sam+spark` row `abandoned` 0 and `retaken` 1; exactly 3 upstream requests per read, 0 for the save and each summary), "Not a retake" (each bullet on a fresh store: Sunita Devi, id 2, at 12:04; Ravi at 12:11; Ravi on 3A bed 2 at 12:04; read 70 `open` at 12:15 and `abandoned` at 00:05), "No bed" (two bedless reads 3 minutes apart, both `open`, `retaken` 0), "Negative draft retaken" (a `not_a_meal` read with rice, retaken; `retaken` at 00:05, not `negative_confirmed`; negatives over 0 reads);
    - re-run read-outcomes' [charting/model-accuracy] Unsaved drafts: "Never saved" and "One draft of two saved" unchanged, since the MODIFIED requirement keeps them word for word;
    - uncited extras in `apps/server/src/chart/model-accuracy.test.ts`: row R0 before the unlinked rows; a later read exactly `READ_RETAKE_MINUTES` after is a retake and one a minute more is not; a later read with a different meal is a retake; a read with 0 drafts is never marked; a linked read is never marked; `retaken` is in `drafts` and `outcomes` and in no decided count, rate, volume error, positive rate or negative count.
  - Implement the `retaken` flag in `store.readOutcomeRows` (one `EXISTS` over `model_read`, no new column or index) and row R0 in `outcomes`.
  - Verify: these tests, and read-outcomes' "Unsaved drafts" and "Negative reads" tests, pass.
- [x] 3.4 Negative reads (design.md §1, §3).
  - Write the failing tests in `apps/server/src/model-quality.test.ts`: [charting/model-accuracy] Negative reads: "Not a meal, confirmed" (spark, 1 request), "Not a meal, charted anyway" (counted as `meal`), "Tray with nothing drafted" (`tray_empty_unclear`). Re-run read-outcomes' "No container, confirmed", "No container, overridden", "Unsaved negative draft" and "Nothing drafted" unchanged.
  - Implement `NEGATIVE_ISSUES` in the negatives fold, and `meal` as the override class.
  - Verify: these tests pass.
- [x] 3.5 Meal fluid, containers, top corrections and positives (design.md §5).
  - Write the failing tests in `apps/server/src/model-quality.test.ts`:
    - [charting/model-accuracy] Fluid with a meal: "Soup kept and re-volumed", "Added and removed";
    - [charting/model-accuracy] Outcomes per container: "Two containers" (urinal 5/6 = 83, 1/6 = 16; `water_jug` 2/2 withheld), "No container read";
    - [charting/model-accuracy] Top corrections: "Six changes" (`TOP_CORRECTIONS` 5, ordering);
    - [charting/model-accuracy] Positive drafts not kept: "Kept and not kept" (46/50 = 92, 4/50 = 8; the 2 retaken in neither rate, `retaken` 2), "Negatives left out".
  - Uncited extras in `apps/server/src/chart/model-accuracy.test.ts`: container row order, ties in top corrections.
  - Implement `mealFluid`, `containerRows`, `positives` and the `top_corrections` fold in `src/chart/model-accuracy.ts`, all over the same per-draft outcomes as the kind rows.
  - Verify: these tests pass.
- [x] 3.6 Model accuracy summary (design.md §5, §6).
  - In `apps/server/src/model-quality.test.ts`, update read-outcomes' own tests in place, keeping their titles; no copy is written:
    - [charting/model-accuracy] Model accuracy summary: "Kinds always listed": six rows, tray rows last, empty `containers` and `top_corrections`, zeroed `of` values;
    - [charting/model-accuracy] Model accuracy summary: "No names": add the tray lunch whose read names `paneer tikka` (`curry_vegetables`), and assert that the body does not contain `paneer`. Its `bed`, `patient` and `mrn` field check stays as read-outcomes wrote it; there is no `name` field check, because the body's `ward` has a `name`.
  - Write the failing test [charting/model-accuracy] Model accuracy summary: "Rates per outcome" (20 / 2 / 3 / 1 of 26: accepted 76, edited_at_capture 7, corrected_by_nurse 11, corrected 19, rejected 3).
  - Re-run "Window and errors", "No session" and "Ward and hospital" unchanged.
  - Implement the new `ModelQuality` fields and the two `KindRow` rates (`rate()`) in `modelQuality` and the route.
  - Verify: the whole server suite passes.

## 4. Tray eval report

- [x] 4.1 Unknown kinds as `other`, and scoring through `scoring.ts` (design.md §9).
  - Write the failing tests in `apps/server/src/chart/tray-lab.test.ts`: [charting/model-accuracy] Tray eval report: "Left-over dishes paired in order", "Same tolerance and floors" (175 vs 176 mL; the `model` row's exact `42% · 3/7`), "Out-of-vocabulary values" (`pizza` → `other`, paired with the read `other` 1 quarter apart; `coffee` → `other`, kept, within tolerance; `portion_eaten_pct: 30` in no portion pair). The fake `fetch` stays uncalled in every scenario.
  - tray-comparison's tests for "Dishes paired by kind", "Portions by basis", "Unscored values" and "Tray outcomes", for "Tray eval labels from the dataset" (the plan, 6 / 2) and for the pairs (5 requests) stay unchanged and keep passing.
  - Implement the rule in `trayLabels`: a true `dish_kind` outside `DISH_KINDS`, or a `fluid_kind` outside `MEAL_FLUID_KINDS` other than `none`, becomes `other`.
  - Refactor, citing no requirement of its own: `tray-lab.ts` calls `pairDishes`, `portionAgreement`, `volumeError` at `VOLUME_TOLERANCE_ML`, `tallyClasses(…, 'final')` and `rate()`, and refuses through `NEGATIVE_ISSUES` and `trayDrafts`. Remove any local copy those replace. Flags, plan, sidecars and pairs stay tray-comparison's.
  - Verify: all tray-lab tests pass. A dry run, `pnpm --filter @meniscus/server eval <dataset>/eval/classify-trays-1 --tray-labels <dataset>/manifest.jsonl`, prints the plan and sends nothing. Never run with `--yes` without the user's approval.

## 5. Demo

- [x] 5.1 Tray reads, links and the reduced mix (design.md §11).
  - Implement in `apps/server/scripts/demo-history.ts`: a tray read a minute before every photo meal with evidence, `readId` on its save, the mix table, the open 3A-6 read by Ravi Kumar, the one retake (a 3A photo meal more than 12 h old, outside `storyBeds`, with an unsaved first tray read by the same staff 4 minutes before its linked read), and this change's guard lines, including tray `retaken` = 1 with `abandoned` still 1. Update the header comment.
  - In the same task, edit read-outcomes' guard in that script (its design §11, `negative_confirmed = 1`): it becomes `negative_confirmed` = 2, checked per kind, `photo` 1 and `tray` 1. Its other lines stay as they are. Without this edit the script throws on the new `not_a_meal` read.
  - Verify: one run over a fresh temporary `DATA_DIR` succeeds (`DATA_DIR=$(mktemp -d) pnpm --filter @meniscus/server demo`), with read-outcomes' (as edited), care-plan's, bag-emptying's, bag-alerts' and dietitian's guards passing. The script makes 0 model requests.

## 6. Web: data

- [x] 6.1 Meal saves carry their read (design.md §2).
  - Write the failing tests in `apps/web/src/lib/read-links.test.ts`: [web/capture] Meal saves carry their read: "Tray lunch" (`admission_id` 16 on the read, then the media upload and the meal post with `read_id: 61`), "Meal by hand" (no `read_id`), "Empty tray read" (`not_a_meal`, no dishes, `fluid_ml: null`; media then meal post with no `read_id`; 201; `Saved lunch, half eaten.`), "Stale tray read" (saved at 19:55, no `read_id`), "Retried meal save" (19:54 then 19:56, one model request in total), "Already linked" (the retried post answers 400 `already linked`; the result reads `Saved lunch, half eaten. 150 mL waiting for nurse approval.`; no error and no further request).
  - Implement `readMeal` typed `Logged<MealReadResult>`; the read stamp in `lib/meals.ts` through `decideRead`, `readFields` and `trayDrafts`; `already linked` on a retry returned as the saved result; `saveMealText` over `Pick<Meal, 'meal' | 'portion' | 'fluid_ml'>`; and the call site in `components/meal-form.tsx`.
  - Verify: these tests, `meals.test.ts` and read-outcomes' read-link tests pass.
- [x] 6.2 Outcome hues and bars (design.md §7).
  - Run `node <dataviz skill>/scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100" --mode light --surface "#ffffff"`. It must print `ALL CHECKS PASS`. Record any change from design.md §7, step 3 in design.md.
  - Write the failing tests in new `apps/web/src/lib/outcome-bars.test.ts`:
    - [web/ward] Outcome bars: "Photo bar" (widths 76.92 / 7.69 / 11.54 / 3.85; `76% · 20/26 accepted`; the four popup lines, taken from the row's rates: a fixture whose `edited_at_capture` rate is not 2/26's shows the fixture's value), "Too few to chart" (`Typed note` with `· 4 decided`, `Photo (Spark only)` with `· 0 decided`, no `Voice note`), "Legend and an empty segment" (legend order; two segments, 75 and 25), "Opened by a tap" (the pure part: the row's `popup` holds the four lines of "Photo bar"; 9.1 taps, hovers and presses Enter);
    - [web/ward] Outcome colours: "Hues" (swatches in order; none of `#15803d`, `#a15c07`, `#b91c1c`, `#6d28d9`; 9.1 checks the label's computed colour, `#0f172a`);
    - uncited extras: `CATEGORY_HUE` keeps its seven values over `SLOT`; the per-bar `ariaLabel` sentence, which contains the visible `76% · 20/26 accepted` word for word (WCAG 2.5.3): `Photo (SAM + Spark), 76% · 20/26 accepted: edited at capture 7% · 2/26, corrected by a nurse 11% · 3/26, rejected 3% · 1/26`.
  - Implement `SLOT`, `CATEGORY_HUE` over it, and `OUTCOME_HUE` in `lib/hues.ts` (each hex once), and new `lib/outcome-bars.ts`.
  - Verify: these tests and `charts.test.ts` pass.
- [x] 6.3 The section's rows and lines (design.md §8).
  - In `apps/web/src/lib/model-accuracy.test.ts`, update read-outcomes' own tests in place; no copy is written:
    - [web/ward] Model accuracy view: "Read kinds", title kept, now asserting the seven headers and `26`, `76% · 20/26`, `7% · 2/26`, `11% · 3/26`, `3% · 1/26`, `1`;
    - [web/ward] Model accuracy view: "Type table", title and assertions unchanged;
    - [web/ward] Model accuracy view: "Two requests" (picking Table and each class table sends nothing more) and "No reads" (no chart, table, picker or lines), titles kept; "Volume and negatives" and "Mean error withheld" unchanged.
  - Write the failing tests:
    - [web/ward] Model accuracy view: "Meal overridden" (`Meal 1`);
    - [web/ward] Chart or table: "Chart first" (the pure part: the section's default view is `chart`; 9.1 checks the screen), and extend 1.1's "Tray row" with the "no `Photo (Spark only)` row" assertion;
    - [web/ward] Class table picker: "Dish table" (`Removed 1`, `Not read (added by staff)`), "Portion table", "Container table" (the seven headers), "Empty tables" (`No tray reads in the last 7 days` ×3, `No urine colour drafts in the last 7 days`), "Tray reads not yet reviewed" (`No reviewed tray meals in the last 7 days` ×3);
    - [web/ward] Kept drafts, meal fluid and top corrections: "Kept drafts" (retaken 0, no `retaken` part), "Retaken drafts" (`(3 rejected, 1 abandoned, 2 retaken)`), "Fluid with meals" (no `with no volume read` part), "Most changed", "Nothing changed".
  - Implement in `lib/model-accuracy.ts`: `CLASS_PICKS`, the seven-column `kindRows` skipping kinds with 0 drafts, `containerRows`, `dishRows`, `portionRows`, `portionText`, `emptyText(pick, q)`, `positivesText`, `mealFluidText`, `correctionsText` and `meal` in `negativesText`.
  - Verify: these tests and `quality.test.ts` pass.
- [x] 6.4 Hospital view data (design.md §8).
  - Write the failing tests in `apps/web/src/lib/model-accuracy.test.ts`: [web/ward] Hospital model accuracy view: "Open the model view" (`hospitalView({ view: 'model' })`; `hospitalModelLoad` sends exactly `GET /api/quality/model?days=7`, with no `ward`), "Back to wards" (`hospitalView({})`; no quality request), "Unknown view" (`hospitalView({ view: 'x' })` is `{}`). These are the pure parts; 9.1 checks the screens and the network.
  - Implement `hospitalView`, `hospitalModelLoad` and `api.modelQuality(ward | null, days, signal)`.
  - Verify: these tests and `lib.test.ts` pass. Its [web/ward] Hospital ward list: "Busy ward" and "Quiet ward" tests are unchanged.

## 7. Web: screens

All UI follows `apps/web/DESIGN.md`: tokens only, the named recipes, 44 px targets, the focus ring, no text under 12 px. Until the polish change adds `space.xs`, `radius.sm`, `text.xs`, `layout.tap` or `SelectField`, use the nearest listed token with a `// DESIGN.md` note.

- [x] 7.1 `components/popover.tsx` (new, beside `tooltip.tsx`): Base UI's Popover in the tooltip's style (`fg` fill, `bg` text, `xs`, `radius.md`), its trigger a native `<button>` with `openOnHover` and `delay={150}`. Check the props against the installed `@base-ui/react` 1.9.0 (`popover/trigger/PopoverTrigger.d.ts`) before writing it.
- [x] 7.2 `components/outcome-bars.tsx` (new, imported statically by `model-accuracy.tsx`): the legend, each kind's row as a 44 px popover trigger with `touchAction: pan-y`, the bar's sentence as the button's `aria-label` with its visual children `aria-hidden`, the popup lines, `Too few to chart` rows as plain text, the grid, the `<figcaption>`, and the forced-colors border (design.md §7).
- [x] 7.3 `components/model-accuracy.tsx`: the `Section` with `ChartIcon` and its subtitle, `Segmented` `Chart | Table`, the bars rendered directly (no `Suspense` of their own), the seven-column kinds table, the `Table` select as a form row, the class tables on the §4.14 recipe with empty tables kept, and the stat lines (design.md §8).
- [x] 7.4 `components/form-fields.tsx`: `SelectField` on `f.input`, if the polish change has not added it.
- [x] 7.5 `routes/n/index.tsx`: `validateSearch: hospitalView`, `Segmented` `Wards | Model accuracy` under the census header, and the lazy hospital section in place of the cards. Do not edit `routeTree.gen.ts`; if the router plugin regenerates it, commit what it writes.
- [x] 7.6 Verify: `pnpm typecheck`, `pnpm lint` and the web tests pass.
- [x] 7.7 (Superseded: DESIGN.md v2, written by the ui-polish redesign, covers outcome bars, outcome hues and `/n?view=model`; ui-polish applies the v2 recipes to these screens.) Update `apps/web/DESIGN.md` (design.md §7, step 1, and §12, items 9–11):
  - §4.15.1: accuracy is tables and text, plus the outcome bars (this change's "Outcome bars");
  - §4.15.2: a fifth job, outcome → `OUTCOME_HUE` (slots 1–4 of `SLOT`, never a status colour);
  - §4.15.5: the exception: stacked outcome bars carry no direct labels, because interior 12 px segments have no free end; the legend, the printed accepted rate, the row's popup and the table view carry the values;
  - §4.15.6: Base UI's Tooltip opens on mouse hover and keyboard focus only, so a value a phone user must read goes in a Popover; segments too small for 44 px share one row target that opens a popover on a tap, a click, Enter or (`openOnHover`) a mouse hover;
  - §4.15.7: an interactive mark row puts the `aria-label` sentence on its button, since a button hides a `role="img"` child;
  - §4.15: the outcome-bar recipe (12 px bars, `xs` gaps, `radius.sm` ends, the legend, no direct labels and why, the 44 px row popover listing all four outcomes, the sentence on the row button, the seven-column table view);
  - §7.3: rewrite the "**Tables only**, per the spec" bullet, which the bars contradict: the outcome bars (the §4.15 outcome-bar recipe) are the default view, with the kinds table as their table view and the class tables on the 4.14 recipe, every rate written by `rate()` and never a bare percentage or a coloured cell;
  - §7.3: replace the "If accuracy-views adds a chart later" bullet with a pointer to that recipe.

## 8. Docs

- [x] 8.1 README "Accuracy in the ward": trays, the outcome chart, the class tables, the hospital view, and the `retaken` outcome. `docs/accuracy.md`: a "Trays" section (dish pairing by kind, portions in quarters, meal fluid, `not_a_meal`, `retaken` within `READ_RETAKE_MINUTES`, unknown kinds as `other`, the tray eval scored through the ward's `scoring.ts`). No patient data and no real names in either.

## 9. Browser check and bundle

- [x] 9.1 Browser check at 390 and 1100 px, through the Vite proxy, on a demo store from 5.1 in a fresh temporary `DATA_DIR`, seeded straight before. (Swipe-to-scroll on a real touch device is unverified: synthetic touch events did not scroll; `touchAction: pan-y` is set at `outcome-bars.tsx:121`.)
  - **Server.** Start it over tray-comparison's `scripts/fake-server.ts`, or with `MODEL_API_BASE_URL=http://127.0.0.1:9/v1` and the same `DATA_DIR`, so no request can reach the real upstream. Never read or print `.env`.
  - **Browser.** Playwright aborts `/api/ai/**`, except in the one step below that fulfils `/api/ai/meal`. That route handler parses the posted multipart body, hashes the `image` part's bytes (the shrunk photo the form will upload) with `node:crypto` SHA-256, and fulfils with a valid `MealReadResult` carrying the demo's open 3A-6 read's `read_id` and draft (lunch at 50, `rice` 50, `dal_lentils` 100, 150 mL) and that `image_sha256`, so the meal post's evidence binds to its media (design.md "Test strategy"). Nothing here sends a model request.
  - **Signed in as `anita` (Anita Thomas, nurse):**
    - 3A → Data quality: `Model accuracy` with `Last 7 days`; `Chart` pressed, the outcome bars shown and no kinds table ("Chart first"); the legend in order, with swatch colours `#2a78d6`, `#eb6834`, `#1baf7a` and `#eda100`, and each `<rate> accepted` label's computed colour `rgb(15, 23, 42)` ("Hues"); a `Tray (SAM + Spark)` bar and a `Photo (SAM + Spark)` bar; a kind under `MIN_N` reads `Too few to chart · <n> decided`;
    - "Opened by a tap": at 390 px, tapping a bar row opens its popup with four lines and tapping elsewhere closes it, and a vertical swipe starting on a row scrolls the page without opening it; at 1100 px, hovering a row with the mouse opens it, and Tab to a row shows the focus ring, Enter opens it and Escape closes it with focus back on the row;
    - `Table`: the kinds table with tray rows, no empty kinds, and the seven headers `Read`, `Decided`, `Accepted`, `Edited at capture`, `Corrected by a nurse`, `Rejected`, `Abandoned`;
    - the `Table` select: each of the six tables, `Dish` with `Removed` or `Not read (added by staff)` where the demo has them, and a tray table on 5B keeping its header over `No tray reads in the last 7 days` if 5B has none;
    - the lines: `Drafts kept …`, `Fluid with meals: …` with `1 removed` and no `with no volume read`, `Most changed: …`;
    - "Open the model view": `/n` → `Model accuracy`: the address is `/n?view=model`, `Hospital census` and `Model accuracy` pressed stay, no ward card shows, and the section reads `All wards · Last 7 days` with its chart, picker and lines;
    - "Back to wards": `Wards` returns to `/n` and the cards, with no further `/api/quality/model` request;
    - "Unknown view": `/n?view=x` shows the cards with `Wards` pressed and sends no `/api/quality/model` request.
  - **Signed in as `ravi` (Ravi Kumar, attendant):** on bed 3A-6, the meal form takes a tray photo, the fulfilled `/api/ai/meal` fills the open read's lunch, and Save posts the media and then the meal with that `read_id`, answering 201. The next `GET /api/quality/model?ward=2&days=7` body's 3A `tray` `sam+spark` row shows `open` 1 lower and `pending` 1 higher, because the lunch's 150 mL entry is pending.
  - **Back as `anita`:** approve that 150 mL entry unchanged on 3A-6. The Table's `Tray (SAM + Spark)` row then shows `Decided` 1 higher and the accepted count 1 higher, and the body's `pending` is back down by 1.
  - **Both widths:** no label collision or overflow in the bars, the rows are at least 44 px tall, the tables scroll inside their wrapper, the page does not scroll sideways at 390 px, and forced-colors mode keeps the segments apart.
  - **Network panel:** the Data quality view sends exactly its two GETs, the hospital view exactly `GET /api/wards` and `GET /api/quality/model?days=7`, toggles, picks and popups send nothing, and no `/api/ai` request is attempted apart from the fulfilled meal read.
  - Attach screenshots at both widths and paste DESIGN.md §9's checklist into the PR.
- [x] 9.2 Bundle. Run `pnpm --filter @meniscus/web build` and read Vite's gzip column:
  - the shell (entry and its preloads) ≤ 120 KB;
  - `/n`'s own chunk, and `/n` plus the lazy `model-accuracy` chunk, ≤ 50 KB;
  - `/n/w/$ward`'s own chunk plus `ward-quality` and `model-accuracy` ≤ 50 KB;
  - the outcome bars and the popover are inside the `model-accuracy` chunk, with no chunk of their own, and are not in the shell or in `/n`'s Wards view.
  - Record the figures, before and after, in the PR. If any is over budget, stop and report it.

## 10. Verification

- [x] 10.1 `pnpm verify` passes (format, lint, `openspec validate --all --strict`, spec:check, typecheck, tests).

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply`, and again before `/opsx:archive`.
- Archive with `openspec archive accuracy-views --yes` once 10.1 passes and the PR is merged.
