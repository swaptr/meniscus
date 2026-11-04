# Tasks

Test-first: in each group, write the citing tests, run them and see them fail for the right reason, then implement, then tick. Test titles are `[<domain>/<capability>] <Requirement>: <Scenario>`.

Every test runs without the network:
- Server tests go through `testApp` and the fake upstream (`createMetaClient` over a fake `fetch`, `src/testing.ts`). They assert the exact `requests` list (`sam:dish`, `sam:food`, `spark:object`, …) and that every Responses API body has `store: false`.
- Pure tests (image size, matching, portions, tray lab) build inputs by hand.
- Web tests use `createApi` over a fake `fetch` and assert every request sent.
- Clocks are local (`new Date(2026, 10, 4, h, m)`). Fixtures are staged props and fictional patients only.
- No task sends a live request. The one live read is the user's (11.2).

## Scenario → test map

| Requirement (scenarios) | Test file | Task |
|---|---|---|
| (unit tests for design §5; no requirement cited) | `apps/server/src/ai/image-size.test.ts` (new) | 2.1 |
| [capture/meal-reading] Served dishes matched by place (all 5); Portion measured from the served tray (all 5) | `apps/server/src/ai/compare.test.ts` (new) | 3.1, 3.2 |
| [capture/meal-reading] Tray reading (all 3, Half-eaten lunch now with `comparison: null`); Tray segmentation degrades (the 4 unchanged; Collected SAM fails with a served photo); Tray reads name their bed (all 3); Served and collected trays (all 6); Served photo with the same bytes (both); Served photo comparison degrades (all 3); Photo sizes needed to compare (all 3); Tray read fits a saved meal (Long read, Large dish mask, Long warning unchanged; Largest compared read) | `apps/server/src/meal-reading.test.ts` | 4.1–4.3 |
| [capture/meal-reading] Served and collected trays: Lunch served and collected (pipeline ordering, delayed SAM replies) | `apps/server/src/ai/ai.test.ts` | 4.4 |
| [capture/read-budget] Budget class of a model action (Tray read for a critical bed; Classes at the routine ceiling unchanged); Whole action admitted up front (Served tray admitted for five, sends three; the other 4 unchanged); Read mode fits the budget (all 5, unchanged, In-flight minimum from config included); Served tray reads fit the budget (all 5) | `apps/server/src/ai/budget.test.ts`, `apps/server/src/ai/budget-policy.test.ts` (acuity-budget's) | 4.7 |
| [charting/media] Upload media (all 5; Voice recording gains `served_meal: null`); Media goes with its record (all 4) | `apps/server/src/media.test.ts` | 5.1, 5.6 |
| [charting/meals] Served tray photo (both); Served tray of a bed (both); Served photo linked to the meal (all 4); Comparison bound to its photos (all 5); Tray evidence stored with the meal (all 3); Compared read kept as evidence (both); Tray proof stored with the meal (all 4; Lunch proof gains `proof.served: null`) | `apps/server/src/meals.test.ts` | 5.1–5.7 |
| [charting/meals] Amend a meal (all 4); Amended dishes set the items (all 3); Meal amendments need a nurse (all 4); Meal amendment history (all 3) | `apps/server/src/meal-amend.test.ts` (new) | 6.1–6.4 |
| [charting/model-accuracy] Tray eval labels from the dataset (both); Tray eval report (all 4); Synthetic trays in the tray eval (both); Served and collected pairs in the tray eval (all 3) | `apps/server/src/chart/tray-lab.test.ts` (new) | 7.1–7.4 |
| [web/capture] Meal capture (all 4, after the served-tray lookup); Meal follows the served tray (both); Served tray photo at the bed (both); Collected tray compared at the bed (all 5) | `apps/web/src/lib/meals.test.ts` | 8.1–8.3 |
| [web/ward] Tray proof on the bed review (both); Served tray in the proof (both) | `apps/web/src/lib/tray.test.ts` (tray-segmentation's) | 8.4 |
| [web/ward] Amend a meal from the bed review (all 5) | `apps/web/src/lib/meal-amend.test.ts` (new) | 8.5 |
| (fake server stays local; no requirement cited) | `apps/server/src/lab/fake-server.test.ts` (new) | 9.2 |

## 0. Before applying

- [x] 0.1 bag-emptying, tray-segmentation, read-outcomes, dietitian and acuity-budget are archived: `pnpm exec openspec list` shows none of them, and `openspec/specs/capture/read-budget/spec.md` and `openspec/specs/charting/model-accuracy/spec.md` exist.
- [x] 0.2 Rebase onto those archives, then re-copy each MODIFIED block from `openspec/specs/**`, keeping this change's edits:
  - [capture/meal-reading] Tray reading, Tray read fits a saved meal, Tray segmentation degrades;
  - [capture/read-budget] Budget class of a model action, Whole action admitted up front, Read mode fits the budget;
  - [charting/meals] Tray evidence stored with the meal, Tray proof stored with the meal;
  - [charting/media] Upload media, Media goes with its record;
  - [web/capture] Meal capture;
  - [web/ward] Tray proof on the bed review.

  Verify: `pnpm exec openspec validate tray-comparison --strict` passes with no "Archive would refuse" line, and every ADDED and MODIFIED statement is at most 500 characters as OpenSpec counts them (every non-blank line before the first scenario, bullets included; `validate` skips this for MODIFIED blocks, and three sit at exactly 500). Check it with a scratch merge: copy `openspec/` to a temp directory, run `openspec archive tray-comparison --yes` there, then `openspec validate --specs --strict`, and delete the copy.
- [x] 0.3 Re-check the line references in design.md (`store.ts:796` `UNLINKED`, `:813` `db.exec(SCHEMA)`, `:1494` `voidMeal`, `routes/chart.ts:347`, `routes/ai.ts:60` `/status`, `routes/common.ts:70`, `testing.ts:134`, `lab/synth.ts:37`) and fix design.md where they moved.
- [x] 0.4 Re-diff the five acuity-budget blocks before apply: Tray reading, Tray segmentation degrades, Budget class of a model action, Whole action admitted up front and Read mode fits the budget. Compare each with acuity-budget's delta as archived (it gained `MODEL_API_MAX_CONCURRENT` ≥ 2, "a status check 1" and the scenario In-flight minimum from config on 2026-11-04, and may change again). Every acuity-budget scenario must be copied as it stands, and the statements may differ only by the edits design.md §14 "Spec text notes" names. Verify: a block-by-block diff shows only those edits and this change's added scenarios.

## 1. Shared contracts

- [x] 1.1 In `packages/shared/src/index.ts`, add the types and constants exactly as design.md §1: `PORTION_BASES` + `measured`, `SERVED_TRAY_HOURS`, `MATCH_MAX_DISTANCE`, `MIN_SERVED_COVERAGE`, `MAX_TRACE_STEPS`, `ImageSize`, `RegionMatch`, `TrayComparison`, `DishMeasure`, `MealValues`, `MealAmendment`, `AmendMealInput`, `ServedTray`; `MealDish.model_portion` and `.measure`; `comparison` on `MealReadResult` and `MealEvidence`; `MealInput.served_media_id`; `MealProof.served`; `Meal.served_media`, `.amendments`, `.amended_at`; `MediaRef.served_meal`. Move the dish-name join to `joinItems(dishes)` here (list order, never sorted by index, ", ", cut to 200), as tray-segmentation's draft and `toMealInput` join. Verify: `pnpm --filter @meniscus/shared typecheck` passes.
- [x] 1.2 Make the apps build with neutral values and no new behaviour: `toMediaRef` `served_meal: null`; `toMeal` `served_media: null`, `amendments: []`, `amended_at: null`, `proof.served: null`; `toMealReading` `model_portion: portion`, `measure: null`; `readMeal` `comparison: null`; fixtures in `apps/web/src/lib/*.test.ts`, `audit-fixtures.ts`, `scripts/demo-history.ts` likewise. Verify: `pnpm typecheck` passes, and `pnpm test` passes except the tests later tasks change on purpose (4.1, 5.4, 5.1).

## 2. Image size (pure)

- [x] 2.1 Write failing unit tests in new `apps/server/src/ai/image-size.test.ts` (titled `imageSize: …`; the requirement is cited by the route tests in 4.2):
  - `png(1000, 800)` → `{ width: 1000, height: 800 }`;
  - a GIF, a WebP `VP8 `, `VP8L` and `VP8X` header, each built by hand → their sizes;
  - a JPEG with APP0 then SOF0 (and one with SOF2) → its size; DHT `C4` before SOF is skipped;
  - `FF D8 FF D9`, a PNG cut after 20 bytes, a JPEG whose segment length runs past the end → null, never a throw.
- [x] 2.2 Implement `apps/server/src/ai/image-size.ts` per design §5, and `png(w, h)` in `src/testing.ts`. Verify: 2.1 passes.

## 3. Matching and portions (pure)

- [x] 3.1 Write failing tests in new `apps/server/src/ai/compare.test.ts` citing every scenario of [capture/meal-reading] Served dishes matched by place (Same tray, larger photo; At the limit; Two bowls equally near; Different size; Two collected dishes near one served dish), with the boxes, sizes and `distance2` values in the spec. Add helper tests:
  - `centreOf` rounds half up: box 100–401 on a 1000-wide photo (exact centre 250.5) → 251; box 100–400 (exact 250, no rounding) → 250; collected 2000 × 1600 box 240,200–840,1000 → 270,375;
  - the size rule on 65 535 × 65 535 photos does not lose precision (BigInt);
  - matches come out sorted by collected index, whatever the input order;
  - `servedCheck`: the same bytes → `same_bytes` before any size is read; a served `FF D8 FF D9` → `size_unknown`; two `png(1000, 800)` of different bytes → both sizes.
- [x] 3.2 Write failing tests citing every scenario of [capture/meal-reading] Portion measured from the served tray (Half eaten; Halves round up; Served tray nearly empty; More on the tray than served; Two dishes on one plate), plus a `quarters` table test covering every row of design §7's table and asserting `quarters(80, 70) === 1`, `quarters(160, 140) === 1`, `quarters(320, 280) === 1` and `quarters(640, 560) === 1` (the float trap), and the clamp at −1 → 0.
- [x] 3.3 Implement `apps/server/src/ai/compare.ts` (`servedCheck`, `centreOf`, `shareOk`, `matchRegions`, `quarters`, `measureDishes`) in integers per design §3–§7. Verify: 3.1 and 3.2 pass.

## 4. Tray read with a bed (server)

- [x] 4.1 Update `apps/server/src/meal-reading.test.ts` first:
  - [capture/meal-reading] Tray reading: Half-eaten lunch also asserts `comparison: null`;
  - Rate-limited tray read and Not a meal are unchanged;
  - Tray segmentation degrades: the four acuity-budget scenarios are unchanged.

  Then add failing tests for every scenario of:
  - Tray segmentation degrades: Collected SAM fails with a served photo (3 requests, none with the served image, `comparison.served_media_id: 41`);
  - Tray reads name their bed (Unknown bed; Meal without a bed; Not sent upstream). Not sent upstream compares the 3 request bodies pairwise, then asserts that no body has an `admission_id` or `meal` key (all three bodies are JSON: parse each and check its keys) and that no body contains bed 3's patient name. It does not search bodies for the admission id's digits, which also occur in `sam-3.1` and in the base64 image;
  - Served and collected trays (Lunch served and collected: the 5 requests in order, the trace steps, `comparison`, the Spark prompt line, and the draft: rice portion 50, `basis: measured`, `model_portion: 25`, the reading's `items` and the draft's dishes at 50, draft items `rice`; No served photo; Wrong time, meal or bed, including the 09:29 / 09:30 boundary; Newest unlinked; Nothing found on the collected tray; Spark mode with a served photo);
  - Served photo with the same bytes (Same photo twice: 3 requests, `comparison: null`, the warning, then the save with no `served_media_id` returns 201; Same photo in Spark mode: 1 request, the warning).

  The fake `sam` answers per image (served vs collected fixture). Every SAM and Spark body is asserted `store: false`.
- [x] 4.2 Add failing tests for every scenario of [capture/meal-reading] Served photo comparison degrades (Served SAM overloaded; Served tray with no dishes; Cancelled during the served segmentation: abort while the served pair is in flight, so exactly 4 requests and no Spark) and Photo sizes needed to compare (Photo size unknown: served `jpeg` fixture, 3 requests, the warning; Size unknown and nothing on the collected tray: exactly the two warnings; Size unknown in Spark mode: 1 request, no `comparison unavailable` warning).
- [x] 4.3 Add [capture/meal-reading] Tray read fits a saved meal: Largest compared read (the same 15 dish boxes of different sizes on two 1000 × 800 photos, 25 names of 90 characters: 12 + 12 regions, exactly 12 matches, each `distance2: 0`, 20 dishes, 5 trace steps; then the meal post returns 201). The three existing scenarios stay as they are.
- [x] 4.4 Add a failing pipeline test in `apps/server/src/ai/ai.test.ts` citing [capture/meal-reading] Served and collected trays: Lunch served and collected. The fake SAM port holds each reply on a deferred promise the test resolves. While the two collected SAM requests are pending, it asserts that exactly 2 SAM requests have started and none with the served image. It then resolves one collected reply and asserts there is still no served request, resolves the other, and asserts that the two served requests start only then. The in-flight count never exceeds 2, and Spark starts only after both served replies settle.
- [x] 4.5 Raise the read-side bounds: `MAX_TRACE_STEPS` 5 in `toMealReading`'s trace cut and `MEAL_BOUNDS`. Verify: every existing `meal-reading.test.ts` test still passes, including the three tray-segmentation scenarios of Tray read fits a saved meal (Largest compared read needs 4.6).
- [x] 4.6 Implement:
  - `store.servedPhoto(admissionId, meal | null, now)` (design §3) (its `media_served` index is in 5.1's `SCHEMA`);
  - `MealForm` + `admission_id`, `meal` (`.refine` meal needs admission), the 404, and the bed's status for the class in `src/routes/ai.ts`;
  - `servedCheck` before `plan()`; `readMeal({ …, served })` in `src/ai/pipeline.ts` (design §4 flow: same bytes and sizes first, collected pair, served pair only with ≥ 1 collected region and only after the collected pair settles, then Spark), with `sam:served-dish` / `sam:served-food` trace steps, abort/budget rethrow after the served pair settles, warnings per design §8 (each cut to 200);
  - `trayContext(seg, served)` with `, served <p>%` and the explanation line;
  - `measureDishes` applied after `toMealReading`; draft dishes and `items` from the final portions;
  - the route adds `served_media_id` and `served_at`, and leaves `comparison: null` for `same_bytes`;
  - the header comment counts in `pipeline.ts` (3, 5 with a compared served photo, 1).

  Verify: 4.1–4.4 pass, and every existing `meal-reading.test.ts` and `ai.test.ts` test still passes.
- [x] 4.7 Budget. In `apps/server/src/ai/budget.test.ts` / `budget-policy.test.ts`, add failing tests:
  - [capture/read-budget] Budget class of a model action: Tray read for a critical bed (HDU bed 1 at 84 in use → 200, 3 requests; 3A bed 4 → 429 `routine`);
  - Whole action admitted up front: Served tray admitted for five, sends three (10 in use → 13 after, 2 returned);
  - every scenario of Served tray reads fit the budget (Room for five at 79, Room for four at 80, Room for four, photo size unknown at 80, Room for two at 82, None left at 84), each asserting the exact SAM and Spark fetch counts and the warnings. Room for four, photo size unknown asserts that the only warning is `comparison unavailable: photo size unknown`;
  - a `plan` table test covering every row of design §4's table, and peak 2 for a compared read.

  The existing acuity-budget tests citing the copied scenarios stay unchanged. Implement `plan('tray', mode, class, budget, { served })` with `served` = comparable (found, other bytes, both sizes readable), and the class from `admission_id` in the route. Verify: all pass, including "Classes at the routine ceiling" (a tray read with no bed stays routine).

## 5. Served photos and the meal save (server)

- [x] 5.1 In `apps/server/src/media.test.ts`, update [charting/media] Upload media: Voice recording to assert `served_meal: null`, and assert the 201 body's keys are exactly `{ id, kind, mime, size, duration_ms, created_at, sha256, served_meal }`. The other 4 scenarios stay. In `apps/server/src/meals.test.ts`, add failing tests for [charting/meals] Served tray photo (Served lunch; Not a served photo). Then add `media.served_meal`: the column in `SCHEMA`'s `CREATE TABLE` and the `media_served` index in `SCHEMA`, with `STORE_SCHEMA_VERSION` up by one (no upgrade step). Also add the upload field (`z.enum(MEAL_KINDS).optional()`, refused with `kind: voice`), `MEDIA_JSON` and `toMediaRef`. Verify: they pass.
- [x] 5.2 Add failing tests for every scenario of [charting/meals] Served photo linked to the meal (Lunch with its served tray; Wrong served photo, all 6 cases; Same bytes uploaded twice: 400 with an issue at `served_media_id`; By-hand meal with a served photo) and Comparison bound to its photos (Both photos bound; Comparison without its served photo; Served photo without a comparison; Another served photo; Served fingerprint differs). Each asserts that no meal was stored and that the upstream got no request.
- [x] 5.3 Implement the checks in design §10 order in `src/routes/chart.ts` and `store.addMeal`: `meal.served_media_id`, the same-bytes refusal (`invalid(c, 'served_media_id', 'same photo as the tray')`), the `meal_served_media` unique index (in `SCHEMA`; its constraint error → 400), and `proof.served`. Verify: 5.2 passes, and so does a race test: two saves of one served photo in one tick, where exactly one gets 201.
- [x] 5.4 Update [charting/meals] Tray evidence stored with the meal: Body too large to 70 KB, and Malformed tray evidence gains 6 trace steps and `basis: guessed`. Add [charting/meals] Compared read kept as evidence (Compared read kept; Malformed comparison: 13 served regions, 13 matches, a match citing region 13, `distance2: 40001`, a `measured` dish with `measure: null`). `measured` and a 4- or 5-step trace are now valid, so the tray-segmentation tests that refused them change on purpose. Then `MealEvidenceSchema` gains `comparison` (bounded: 12 served regions, 12 matches, `distance2` 0–40 000), `model_portion`, `measure` (non-null exactly when `basis: measured`), `measured` and `MAX_TRACE_STEPS`, and the meal route's body limit becomes 64 KB. Add the size test (design §9): build the maximal post from the schema with 3-byte names, and assert that it parses and that 65 536 is at least 1.4 × its byte size. Do not assert a fixed byte cap, so accuracy-views' `read_id` fits without editing the test. Verify: all pass.
- [x] 5.5 Add `meal.served_media_id`, `meal.amended_at`, both indexes, `meal_event`, its index and triggers to `SCHEMA` (design §11), no upgrade step. Verify: a store opened on an empty `DATA_DIR` has them, and `PRAGMA user_version` is `STORE_SCHEMA_VERSION` = 4 (stop before editing if the live value is not 3).
- [x] 5.6 In `apps/server/src/media.test.ts`, add failing tests for [charting/media] Media goes with its record: Voided tray with its served photo and Served photo in use (clock at 13:00 on 3 Nov). Shared recording and Voided tray stay. In `apps/server/src/meals.test.ts`, [charting/meals] Tray proof stored with the meal: Lunch proof also asserts `proof.served: null`, and its other three scenarios stay. Implement the merged `UNLINKED` (design §11, beside `level.proof_media_id`) and `voidMeal` clearing and collecting both photos. Verify: all pass, and bag-emptying's after-emptying photo tests still pass.
- [x] 5.7 Add failing tests for [charting/meals] Served tray of a bed (Lunch waiting; Nothing waiting). Implement `GET /api/admissions/:id/served-tray` over `store.servedPhoto(id, null, now)` (design §3). Verify: they pass, and the upstream got no request.
- [x] 5.8 Verify: `pnpm --filter @meniscus/server test` passes.

## 6. Amend a meal (server)

- [x] 6.1 Write failing tests in new `apps/server/src/meal-amend.test.ts` for every scenario of [charting/meals] Amend a meal (Rice finished after all; Portion only; Amended portion counts, through dietitian's `poor_meal_intake` alert; Refused amendments, including `fluid_ml`, 409 `voided` and 404) and Amended dishes set the items (Dish renamed; List order kept: rice at index 1 then dal at index 0 stays `rice, dal`; Items with dishes). Each asserts that the upstream got no request, and that `evidence`, `proof`, `fluid_ml`, the fluid entry and media are byte-for-byte unchanged.
- [x] 6.2 Write failing tests for every scenario of [charting/meals] Meal amendments need a nurse (Attendant amends; Role checked first; Dietitian amends, Sana Mirza 11; Matron amends, Lakshmi Iyer 10).
- [x] 6.3 Write failing tests for every scenario of [charting/meals] Meal amendment history (Two amendments, at 14:30 and 15:10; Database refuses changes: `UPDATE meal_event` and `DELETE FROM meal_event` on the open store file each throw, and the meal still reads both; Kept after a void).
- [x] 6.4 Implement `meal_event` with both triggers and its index in `SCHEMA` (design §11), `MEAL_SQL`'s `amendments` and `amended_at`, `store.amendMeal` (design §12, `joinItems` in list order), `AmendMealBody` (`.strict()`) and `POST /meals/:id/amend` behind `requireDecider` in `src/routes/chart.ts`. Verify: 6.1–6.3 pass.

## 7. Tray eval

- [x] 7.1 Write failing tests in new `apps/server/src/chart/tray-lab.test.ts`, with a fake `fetch` that must stay uncalled unless a test approves:
  - [charting/model-accuracy] Tray eval labels from the dataset: Tray labels, with a temp folder and manifest holding `tray-002`, `hard-041`, `ubag-001` and the augmented `tray-002__blur_gauss_strong` as in the spec (plan 6 / 2, `2 photos without tray labels, skipped`; the augmented record's `expected_items` and `expected_outcome_after` are never read);
  - Flags that do not apply to trays: `trayEvalArgs` refuses `--container-labels` and `--no-hint` with exit 2 and plans nothing.
- [x] 7.2 Write failing tests for every scenario of [charting/model-accuracy] Tray eval report (Dishes paired by kind; Portions by basis; Unscored values, including the soup with `volume_ml_estimate: null` in the fluid kind table and in no mL pair; Tray outcomes), over hand-built read rows.
- [x] 7.3 Write failing tests for every scenario of [charting/model-accuracy] Synthetic trays in the tray eval (Synthetic labels: meal portion from the top-level `labels.meal_portion_eaten`, no outcome row; Real and synthetic apart) and Served and collected pairs in the tray eval:
  - Pair planned: 8 / 2, with the before resolved to `images/food_tray/tray-001.jpg` beside the manifest;
  - Pair read: the job runs through `createAi` over the fake upstream, and the test asserts exactly 5 requests in order with the after image, then the before image, then one Spark request with the after image only;
  - Before not found: 3, with the message.
- [x] 7.4 Implement `apps/server/src/chart/tray-lab.ts` (`trayEvalArgs`, `trayLabels`, `synthLabels`, `trayPairs`, `trayJobs`, `trayReport`) and `--tray-labels` in `apps/server/scripts/eval.ts`. It checks the plan against acuity-budget's `routineCeiling(config)` and stays a dry run without `--yes`. Verify: 7.1–7.3 pass. Then dry-run it once **without** `--yes` and without `--env-file` (so `.env` is not loaded): `cd apps/server && MODEL_API_KEY=fake pnpm exec tsx scripts/eval.ts ../../../attend-realworld-dataset/eval/classify-trays-1 --tray-labels ../../../attend-realworld-dataset/manifest.jsonl --modes sam+spark`. It prints 23 trays and `plan: 69 model requests` (under the routine ceiling of 84; both default modes would plan 92 and exit 2), and sends nothing.

## 8. Web

- [x] 8.1 Write failing tests in `apps/web/src/lib/meals.test.ts` for every scenario of [web/capture] Meal follows the served tray (Lunch collected late: at 15:10 the one `GET /api/admissions/1/served-tray`, lunch preselected, `Served lunch tray from 14:30 waiting`, and the read's `meal: lunch`; No served tray waiting: `media: null` and a 500 each give snack, no resend). Update [web/capture] Meal capture's four tests so the served-tray lookup (answering `media: null`) comes first and the asserted requests follow it. Implement `api.servedTray`, `mealOnOpen(now, servedTray)` in `lib/meals.ts`, and the call when Meal opens in `routes/a/bed.$token.tsx`.
- [x] 8.2 Write failing tests for every scenario of [web/capture] Served tray photo at the bed (Lunch served at 12:40: after the lookup, the only request and the message; Served photo not kept: the message and no other request). Implement `uploadServed(api, admissionId, meal, file, now)` in `lib/meals.ts`, `api.uploadMedia`'s `served_meal`, and the lazy `components/served-tray.tsx` tile in `routes/a/bed.$token.tsx`.
- [x] 8.3 Write failing tests for every scenario of [web/capture] Collected tray compared at the bed (Lunch compared, with the chips' reason `Meal fixed to lunch by the served tray. Retake to change it.`; Served photo not compared; No served photo; Tray photo not kept; Retaken for another meal), driving `lib/meals.ts` (`mealReadForm`, `comparisonNote`, `mealPost`, `mealLocked`, `mealLockedReason`) over a fake `fetch`. Implement them, and wire `components/meal-form.tsx` (banner, `measured` mark, meal chips disabled with the reason under them per DESIGN.md §4.10, Retake).
- [x] 8.4 Write failing tests in `apps/web/src/lib/tray.test.ts` for every scenario of [web/ward] Tray proof on the bed review (Lunch proof and Voided lunch, unchanged) and Served tray in the proof (Compared lunch: the served photo as the before of a `BeforeAfter` pair, the fingerprint `9b1c…e2`, the stat line `1 rice · 80% served · 40% left · Half eaten`, the `measured` row, and exactly two media GETs; Voided compared lunch). Implement `lib/tray.ts` (served proof lines, eaten-share stat line, measured rows, served overlay labels) and `components/tray-proof.tsx` on `source-view.tsx`'s `BeforeAfter` layout (DESIGN.md §7.2 "Comparison (before and after tray)": side by side ≥ 641 px, before / stat line / after on phones, no new chart). Add `sam:served-dish` and `sam:served-food` to `STEP_LABEL` in `lib/labels.ts`.
- [x] 8.5 Write failing tests in new `apps/web/src/lib/meal-amend.test.ts` for every scenario of [web/ward] Amend a meal from the bed review:
  - Rice finished after all: the amend body, then `GET /api/admissions/1/meals`, and the row text;
  - Nothing to save yet: `amendBody` null, Save disabled;
  - Portion of a meal by hand;
  - Not offered: attendant, dietitian, voided;
  - Voided meanwhile: the message, no resend.

  Implement `lib/meal-amend.ts` (`amendBody`, `canAmend`, `amendedLine`), `api.amendMeal`, the lazy `components/amend-meal-dialog.tsx` and the row line in `components/meals.tsx`. The dialog follows DESIGN.md §4.11: Base UI Dialog on the `sheet` recipe with StyleX and the existing chip and field components, and `Saved in the name of <staffLabel>.` above the error notice and the actions.
- [x] 8.6 Verify: `pnpm --filter @meniscus/web test` and `pnpm --filter @meniscus/web typecheck` pass.

## 9. Demo, fake server, docs

- [x] 9.1 `apps/server/scripts/demo-history.ts`: served lunch photos for two fictional beds, one compared lunch with fixture evidence (one `measured` dish), and one amendment by Anita Thomas. Use `png(w, h)` bytes and no model request. None of these is on 2C-2, whose meal fluids bag-alerts' demo guard depends on. Verify: from `apps/server`, `DATA_DIR=$(mktemp -d) pnpm exec tsx scripts/demo-history.ts` (never `pnpm demo`, which loads `.env` through `--env-file-if-exists`); then `GET /api/admissions/<id>/meals` returns the served media, the measured dish and the amendment, and 2C-2's meals are unchanged.
- [x] 9.2 New dev-only `apps/server/scripts/fake-server.ts` per design §16, with its logic in `src/lab/fake-server.ts`. Before any import of `src/config.ts`, it sets the Model API base URL to `http://127.0.0.1:9/v1` and the API key to the literal `fake` in `process.env`, overriding the shell, and then loads the app with a dynamic `import()`. Add the script `"fake": "tsx scripts/fake-server.ts"` with no `--env-file`. It refuses to start without an explicit `DATA_DIR`. `upstream()`'s `sam` gets the image so fixtures answer per photo. First write a failing test, `apps/server/src/lab/fake-server.test.ts` (titled `fake server: /status stays local`):
  - start a loopback sentinel HTTP server that counts requests;
  - spawn the script with a temp `DATA_DIR` and, in its environment, the base URL pointing at the sentinel;
  - call `GET /api/ai/status` once;
  - assert the response is not 200 (the upstream at 127.0.0.1:9 refuses), the sentinel received 0 requests, and the child's log names only step names and statuses, so no request left 127.0.0.1.

  Verify: the test passes; `DATA_DIR=$(mktemp -d) pnpm --filter @meniscus/server fake` starts, and its log shows only step names and statuses.
- [x] 9.3 Docs. Re-grep first: tray-segmentation's task 5.5 changes these lines, and acuity-budget's 7.1 may reword them per mode. After 5.5 lands, AGENTS.md:52 and README.md:84 say "meal tray photo 3, or 1 in Spark-only mode", and the README Meal trays row says "3 per tray photo (1 in Spark-only mode)".
  - AGENTS.md's request-count list ("Model API credits are limited"): "meal tray photo 3, 5 with a served photo, or 1 in Spark-only mode".
  - `README.md`, "Meta models, and why each one": the same count in the request-count paragraph (`:84` today), and in the Meal trays row (`:82` today): SAM on the served and collected trays, "3 per tray photo, 5 with a served photo (1 in Spark-only mode)".
  - `README.md`, "What it does", the attendant's **Meal** (`:17` today): the meal is preselected by the bed's waiting served photo, else by the time of day; "Served tray" uploads it, and a tray photo is then compared with it.
  - `README.md`, "Roadmap" (`:224` today): drop "meal-tray before/after comparison".
  - The `pipeline.ts` header and `meal-form.tsx`'s comment: the same counts. `docs/accuracy.md` gains "Trays" (design §15).

  Verify: `rg -n "meal tray photo|per tray photo|tray photo 1\b|before/after comparison|preselected by the time" AGENTS.md README.md apps/server/src/ai/pipeline.ts` shows only the new text, which agrees with [capture/read-budget] Whole action admitted up front.

## 10. Verify

- [x] 10.1 Browser check, with no live model request:
  1. `DATA_DIR=$(mktemp -d)`;
  2. seed it from `apps/server` with `pnpm exec tsx scripts/demo-history.ts` on that `DATA_DIR`, never `pnpm demo`;
  3. start `pnpm --filter @meniscus/server fake` on it, and the web dev server proxying to it;
  4. Playwright at **390 px** and **1100 px** wide.

  On bed 1 as Ravi Kumar:
  - Meal: the network log shows one `GET …/served-tray` on opening;
  - "Served tray" → upload a staged PNG: one `POST …/media` with `served_meal`, and the message;
  - reopen Meal: lunch preselected with `Served lunch tray from …`;
  - then "Photo of the tray" with a second staged PNG: one `POST /api/ai/meal`, while the fake server's log shows exactly `sam:dish`, `sam:food`, `sam:dish`, `sam:food`, `spark:object`;
  - the banner `Compared with the served tray from …`, the `measured` mark, the meal chips disabled with `Meal fixed to lunch by the served tray. Retake to change it.`;
  - Save: exactly `POST …/media` and `POST …/meals` with `served_media_id`.

  Sign in as Anita Thomas:
  - "What the AI read" shows the served and tray photos as a before and after pair with the eaten-share stat line between them, the fingerprints and the measured row, with two media GETs;
  - "Amend…" → the dialog shows `Saved in the name of Anita T.`; All on rice, reason `tray rechecked` → one `POST /api/meals/<id>/amend` and the `Amended …` line;
  - as Ravi, no "Amend…".

  Take screenshots at both widths, check no text overflows and no console errors, then delete the temp `DATA_DIR`.
- [x] 10.2 `pnpm verify` passes (format, lint, `openspec validate --all --strict`, spec:check with every scenario above cited, typecheck, tests).

## 11. Workflow follow-up

- [x] 11.1 Run the `spec-reviewer` agent on `tray-comparison` before `/opsx:apply`, and again before `/opsx:archive`.
- [x] 11.2 **Deferred to the user** (recorded in design.md Open Questions; its result feeds a follow-up change, not this design). **User-run live gate** (agents never run it), after 10.2 and before 11.3, while design.md is still under `openspec/changes/` and can be edited: one served-and-collected read, **exactly 5 model requests**, with a staged prop tray pair (no people, no names) on a temp `DATA_DIR`, the real server and `MEAL_USE_SAM=true`:
  1. Upload the served photo for one demo bed (not 2C-2) with `served_meal: lunch`: 0 requests.
  2. Read the collected photo once with that bed's `admission_id` and `meal: lunch`: exactly 5 (SAM `dish`, SAM `food`, SAM `dish`, SAM `food`, Spark).

  Check: `comparison.served` is non-null, `matches` is plausible, at least one dish is `measured` or explained by a rule in design §7, and every Spark body had `store: false`. Do not retry. If anything fails, record it and stop. Its result is recorded in design.md "Open Questions" as tuning input, before archive.
- [x] 11.3 `pnpm exec openspec archive tray-comparison --yes`. The Purpose of `openspec/specs/capture/meal-reading/spec.md` (archive does not touch Purpose) still needs a hand edit mentioning the served photo and the 5-request compared read: a protected path, done in a commit of its own with the user's approval. Verify: `pnpm verify` passes after the archive.
- [x] 11.4 Tell the owners of these changes about the overlaps in design.md §14:
  - accuracy-views: copy this change's "Tray reading" word for word, then add `read_id`;
  - dietitian-care: the `meal_event` fields hold no fluid;
  - read-queue: served photo looked up at enqueue. Its MODIFIED "Whole action admitted up front" and "Read mode fits the budget" paraphrase the tray count ("a tray read with a served photo 5", without "comparable") and drop "a status check 1"; they must copy this change's text, and scale-store's where it edits them, word for word, then add only the queue's edits;
  - postgres-store: the `meal_event` triggers;
  - scale-store: `UNLINKED` and `linked_at`.
- [x] 11.5 scale-store follow-up (design §14 scale-store row). (1) Its MODIFIED "Read mode fits the budget" copies acuity-budget's text. Archived after this change, it would drop `unless "Served tray reads fit the budget" applies` and "Requests in flight never change the mode", so it must copy this change's text instead. (2) Its "Reads under budget pressure" says nothing about served-tray reads and calls every tray read bedless. It must say that a tray read with `admission_id` takes the bed's class, and what a tray read with a comparable served photo does under pressure. (Verified present in the downstream changes at pre-archive review.)
- [x] 11.6 acuity-budget and tray-segmentation follow-up. This change MODIFIES acuity-budget's "Tray segmentation degrades" (a SAM failure on the *collected* photo costs 3) and tray-segmentation's "Tray proof stored with the meal" (voiding deletes *both* photos' bytes), copying their delta text. Those changes need no edit. Any edit to either block, or to the other four acuity-budget blocks copied here (Tray reading, Budget class of a model action, Whole action admitted up front, Read mode fits the budget), must be re-copied here before apply (task 0.4 re-diffs the five acuity-budget blocks). acuity-budget's tray counts (its 7.1 docs task, its design §4.3 table, "every tray read is routine") and tray-segmentation's "meal tray photo 3, or 1 in Spark-only mode" (its 5.5) are superseded by this change's 9.3. (Verified present in the downstream changes at pre-archive review.)
- [x] 11.7 bag-alerts follow-up: this change's demo seed never touches 2C-2, whose meal fluids its guard depends on. Its browser check may reuse `scripts/fake-server.ts`, which keeps `GET /api/ai/status` on 127.0.0.1 (9.2). (Verified present in the downstream changes at pre-archive review.)
