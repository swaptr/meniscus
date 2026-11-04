# Tasks

MVP for the Nov 4, 9 PM ET deadline. Deferred items (served photos, amend, eval) are listed in proposal.md "Deferred" and have no tasks here.

Every test runs without the network:
- Server tests go through `testApp` and the fake upstream (`createMetaClient` over a fake `fetch`). They assert the exact `requests` list, and every recorded SAM and Spark body (`store: false` on all of them).
- Pure geometry tests build `TrayMask`s by hand (box + raster), with no parser.
- Web tests use `createApi` over a fake `fetch` and assert every request sent.
- Clocks are local (`new Date(2026, 10, 3, h, m)`).

Scenario → test file map (every kept scenario):

| Requirement (scenarios) | Test file | Task |
|---|---|---|
| [capture/meal-reading] Dish coverage (all 8); Tray read fits a saved meal (Large dish mask); Tray segmentation grounding (Rounded coverage) | `apps/server/src/ai/tray.test.ts` (new) | 2.1, 2.3, 2.4 |
| [capture/meal-reading] Dishes and fluids in the reading (Plate and a cup of tea, Region that does not exist) | `apps/server/src/ai/tray.test.ts` | 3.1 |
| [capture/meal-reading] Tray reading (all 3); Tray segmentation grounding (One plate, No dishes found); Spark-only tray reading (both); Tray segmentation degrades (all 3); Tray read fits a saved meal (Long warning); Tray upload validation (both) | `apps/server/src/meal-reading.test.ts` | 5.2, 5.3 |
| [capture/meal-reading] Tray read fits a saved meal (Long read: read, then save) | `apps/server/src/meal-reading.test.ts` | 6.1 |
| [charting/media] Media fingerprint (both); Upload media (Voice recording gains the `sha256` check; the other 4 unchanged) | `apps/server/src/media.test.ts` | 4.1 |
| [charting/meals] Dishes on a meal; Tray evidence stored with the meal; Tray evidence bound to its photo; Tray proof stored with the meal; Older meals read as dishes (all scenarios) | `apps/server/src/meals.test.ts` | 6.1, 6.2 |
| [web/ward] Tray overlay (all 3); Tray proof on the bed review (both); Media fingerprint shown (both) | `apps/web/src/lib/tray.test.ts` (new); the request assertion of "Photo entry" in `apps/web/src/lib/sources.test.ts` | 7.1, 7.3 |
| [web/capture] Dishes on the meal form (all 3) | `apps/web/src/lib/meals.test.ts` | 8.2 |

## 0. Before applying

- [x] 0.1 `care-plan` is archived: `pnpm exec openspec list` no longer shows it, and its specs are in `openspec/specs/`.
- [x] 0.2 `bag-emptying` is archived if it goes first (its proposal orders it before this change). If it has, `migrateBags` exists in `store.ts`, and `migrateTray` (4.2, 6.3) goes after it. If not, `bag-emptying` rebases onto this change later (design.md "Overlaps").
- [x] 0.3 Rebase this branch on those archives. Re-check the line references in design.md "Context" (`store.ts:688`, `:837`, `:478`, `pipeline.ts:11`, `:80`, `routes/chart.ts:126`, `meal-form.tsx:75`) and fix design.md if they moved. Verify: `pnpm exec openspec validate tray-segmentation --strict` passes.

## 1. Shared contracts and config

- [x] 1.1 Shared types, in `packages/shared/src/index.ts`, exactly as design.md "Types". Contracts only, with no requirement of their own:
  - `DISH_KINDS`, `DishKind`, `MEAL_FLUID_KINDS` (`satisfies readonly FluidKind[]`), `MealFluidKind`, `PORTION_BASES` (`['model']`), `PortionBasis`;
  - `MAX_TRAY_REGIONS = 12`, `MASK_GRID = 32`, `MAX_READ_WARNINGS = 6`, `MAX_WARNING_CHARS = 200`;
  - `MaskBits`, `TrayRegion`, `TraySegmentation`, `DishValue`, `MealDish`, `MealFluid`, `TrayPhotoProof`, `MealProof`;
  - the changed `MealReading`, `MealDraft`, `MealReadResult` (`mode`, `image_sha256`, `segmentation`, `warnings`), `MealEvidence`, `MealInput`, `Meal` (`dishes`, `proof`) and `MediaRef` (`sha256`).

  Verify: `pnpm --filter @meniscus/shared typecheck` passes. The apps fail to typecheck until 1.3.
- [x] 1.2 `MEAL_USE_SAM: z.stringbool().default(true)` in `apps/server/src/config.ts`, plus a commented line in `.env.example` (`# MEAL_USE_SAM=true  # tray reads: SAM dish + food + Spark (3 requests); false: Spark only (1)`). Add `createAi(ports, opts = { mealUseSam: config.MEAL_USE_SAM })`.
  - Verify: a `parseConfig` test in `apps/server/src/ai/ai.test.ts` shows the default true and that `'false'` parses to false. Do not read `.env`.
- [x] 1.3 Make the apps build against the new types with neutral placeholders and no new behaviour. Groups 3–8 put the real values in.
  - Builders:
    - `apps/server/src/store/store.ts:553` `toMediaRef`: `sha256: null`;
    - `store.ts:733` `toMeal`: `dishes: []`, `proof: null` (and `MealRow` omits both);
    - `apps/server/src/ai/pipeline.ts:191` `readMeal`: `mode: 'spark'`, `image_sha256: ''`, `segmentation: null`, `warnings: []`;
    - `apps/server/src/ai/meal.ts` `clampMealReading`: `dishes: []`, and each fluid `index: 0`, `fluid_kind: 'other'`; `toMealDraft`: `dishes: []`;
    - `apps/web/src/lib/meals.ts:80` `toMealInput`'s evidence: `mode`, `image_sha256`, `segmentation` and `warnings` copied from the read (the placeholders above);
    - any other site `pnpm typecheck` names. `routes/chart.ts:361` passes the old `MealBody` evidence to `addMeal`: give it a type-only cast to `MealInput` (no runtime change), removed when 6.3 switches `MealBody` to `MealEvidenceSchema`.
  - Fixtures that build a `Meal`, `MediaRef`, `MealReading`, `MealReadResult` or `MealEvidence`: `dishes: []`, `proof: null`, `sha256: null`, `mode: 'spark'`, `segmentation: null`, `warnings: []`, …:
    - `apps/web/src/lib/meals.test.ts`, `sources.test.ts`, `lib.test.ts`, `round.test.ts`, `care.test.ts`, `audit-fixtures.ts`;
    - `apps/server/src/chart/care.ts` and `care.test.ts` (from care-plan);
    - `apps/server/scripts/demo-history.ts`.
  - `image_sha256` placeholder: `''` wherever a `MealReadResult` is built. Its type stays `string`, as design.md "Types"; 5.4 puts the real hash there. A `MealEvidence` fixture may use `null`, which that type allows for older meals.

  Verify: `pnpm typecheck` passes. Leave every assertion as it is. `pnpm test` passes except the tests whose expected shape the spec changes, which later tasks update: the draft in [capture/meal-reading] Tray reading: Half-eaten lunch (5.2); [capture/meal-reading] Tray read fits a saved meal: Long read, since the old strict `MealBody` refuses the read's new keys (6.1); and the posted evidence in [web/capture] Meal capture: Tray photo (8.1).

## 2. Tray geometry (pure)

- [x] 2.1 Write failing tests first, in new `apps/server/src/ai/tray.test.ts`, for every [capture/meal-reading] Dish coverage scenario, with hand-built rectangle and full-raster masks at step 1:
  - Half-full plate (0.5);
  - Empty bowl (0, `loose_food: null`);
  - Two foods in one bowl (0.8);
  - Food beside the plate (0.5, `loose_food: 0.333`);
  - Bowl on a plate (region 1 plate coverage 0, region 2 bowl coverage 1: centres tie, larger first);
  - One above the other (same centre x: the dish at 0,0–100,100 is region 1, whatever order SAM returned them in);
  - Crowded tray (12 dishes of 100 × 100 px in a row and 3 of 30 × 30 px → 12 regions numbered 1–12 left to right, none of the small ones);
  - Crumb (15 × 15 dropped).

  Add uncited tests for:
  - a dish hidden entirely under a smaller one is dropped;
  - the step `s` for a 1280 × 960 union is 6;
  - position words (`top left`, `centre`, `bottom`, a single region is `centre`).
- [x] 2.2 Implement `apps/server/src/ai/tray.ts`, as design.md §5:
  - `TRAY_DISH_CONCEPT = 'dish'`, `TRAY_FOOD_CONCEPT = 'food'`, `MIN_DISH_PX = 400`;
  - `toTrayMask(rec)` (from `decodeMaskToRaster` + `bounds`), `inMask`, `area`, `layoutTray(dishes, foods)` with the index order of step 6, and `positionOf`.

  Verify: the 2.1 tests pass.
- [x] 2.3 Mask packing.
  - Test first: [capture/meal-reading] Tray read fits a saved meal: Large dish mask. A 120 × 90 box gives 32 × 24 cells and `bits` of 128 base64 characters. Uncited: a 2 × 1 box with the left cell set gives `gA==` (the value the web overlay scenario uses), and a 1 × 400 box gives width 1, height 32.
  - Implement `packMask`. Verify: the tests pass.
- [x] 2.4 `coveragePercent` and `trayContext(seg)`.
  - Tests first: [capture/meal-reading] Tray segmentation grounding: Rounded coverage (0.125 → `food covers 13%`, 0.995 → `food covers 100%`). Uncited: 0.004 → 0%; the one-plate segmentation gives exactly `Dish 1: x 211–271, y 228–255, centre, food covers 0%.`; the `Food outside the dishes` line appears only when `loose_food > 0`.
  - Implement both as design.md §5 step 9 and §6 "Context" (integer arithmetic, no `Math.round(c × 100)`). Verify: the tests pass.

## 3. Spark contract and mapping

- [x] 3.1 Tests first, in `apps/server/src/ai/tray.test.ts`:
  - [capture/meal-reading] Dishes and fluids in the reading: Plate and a cup of tea. The cup is cited only by a fluid: it is no dish, and its fluid has `index` 2 and `fluid_kind: tea`.
  - [capture/meal-reading] Dishes and fluids in the reading: Region that does not exist (region 7 of 2, and any region with `seg` null, become 0, with `box`/`coverage` null).
  - Uncited: `MEAL_JSON_SCHEMA` has no `pattern` keyword anywhere, no enum allows null, `dish_kind` and `fluid_kind` list exactly `DISH_KINDS` and `MEAL_FLUID_KINDS`, and `additionalProperties: false` is set on every object.
  - Uncited: `items` equals the dishes' `{ name, portion }`, every dish has `basis: 'model'`, and the draft's `dishes` drop `basis`, `box` and `coverage`.
  - Uncited, in `apps/server/src/evidence.test.ts`: `MealEvidenceSchema` accepts a 3-step trace, 6 warnings of 200 characters and 12 regions; it refuses a 4-step trace, a 7th warning, a 201-character warning, a `basis: 'measured'` and an `image_sha256` that is not 64 lowercase hex.
- [x] 3.2 Implement design.md §6:
  - in `apps/server/src/ai/meal.ts`:
    - `MealModelSchema` / `MEAL_JSON_SCHEMA` with dishes and region, `dish_kind` and `fluid_kind`;
    - the `MEAL_SYSTEM` additions;
    - `toMealReading(model, seg)` and `toMealDraft` with dishes;
    - `normaliseMealEvidence` for older rows;
  - in `apps/server/src/routes/evidence.ts`, next to `PhotoEvidence`: `MealReadingSchema` (moved from `ai/meal.ts`) and `MealEvidenceSchema`, with the bounds of [capture/meal-reading] Tray read fits a saved meal, over the shared `Box` and `MaskBits` validators. `ai/` imports nothing from `routes/`.

  Verify: the 3.1 tests pass, `apps/server/src/ai/ai.test.ts` still passes, and `grep -rn "routes/" apps/server/src/ai` finds no import.

## 4. Media fingerprints (store)

- [x] 4.1 Tests first, in `apps/server/src/media.test.ts`:
  - [charting/media] Media fingerprint: Fingerprint of the served bytes. Upload a JPEG and link it from a photo entry. The upload response's `sha256` is the lowercase-hex SHA-256 of the uploaded bytes, it equals the hash of the bytes `GET /api/media/<id>` returns and the entry's `media.sha256`, and the upstream received no request.
  - [charting/media] Media fingerprint: Media from before fingerprints. Open a store file built with the old `media` schema; the media returns `sha256: null`, and the row is not rewritten.
  - [charting/media] Upload media: Voice recording. Extend the existing test: the 201 body's keys are exactly `id, kind, mime, size, duration_ms, created_at, sha256`, and `sha256` is 64 lowercase hex. The other four Upload media tests stay unchanged.
- [x] 4.2 Implement:
  - new `apps/server/src/hash.ts`: `sha256Hex(bytes)` over `node:crypto`;
  - in `apps/server/src/store/store.ts`: `media.sha256` in `SCHEMA`, `migrateTray` (its media part; after `migrateCare`, and after `migrateBags` when it exists) through `addColumns`, the hash in `insertMedia`, and `sha256` in `toMediaRef` and `MEDIA_JSON` (`store.ts:544`).

  Verify: the 4.1 tests pass, and the existing `Stored photos become media: Older store` test still passes.

## 5. Tray read pipeline and route

- [x] 5.1 The fake upstream in `apps/server/src/testing.ts` records every request body in order (`bodies`, beside `requests`), and passes the body to `sam(prompt, body)`. Add `SAM_EMPTY` (empty output) and `SAM_TEXT_AT(box)` (the fixture payload re-boxed), or, if the parser refuses that, fixtures built from the 2.x masks.
  - Verify: the existing `testing.ts` users still pass.
- [x] 5.2 Update the existing tests in `apps/server/src/meal-reading.test.ts` to the modified [capture/meal-reading] Tray reading. These are spec changes, not weakening:
  - Half-eaten lunch: `requests` = `['sam:dish', 'sam:food', 'spark:object']`; `store: false` in all 3 recorded bodies; the Spark body has `text.format.type: 'json_schema'` with `strict: true`; trace `sam:dish`, `sam:food`, `spark:meal`; `mode: 'sam+spark'`; `image_sha256` equals `createHash('sha256')` of the posted bytes; the draft with `dishes`; no meal or entry saved.
  - Rate-limited tray read: 429 after exactly 3 requests in `sam+spark`, and after exactly 1 with `mode=spark`.
  - Not a meal: unchanged, apart from the request list.
  - Change `tray()` to answer with the new model output.

  See them fail, then go on.
- [x] 5.3 New tests, in `apps/server/src/meal-reading.test.ts`:
  - [capture/meal-reading] Tray segmentation grounding:
    - One plate (both SAM bodies have `metadata.mask_encoding: 'one_bit'` and the prompts `dish` and `food`; the Spark text holds the `Dish 1: …` line);
    - No dishes found (`SAM_EMPTY` for both gives `{ regions: [], loose_food: null }` and `segmentation found no dishes`, 3 requests);
  - [capture/meal-reading] Spark-only tray reading: Spark mode (`mode=spark` → `['spark:object']`, `segmentation: null`) and SAM switched off (`createAi(…, { mealUseSam: false })`: no mode → 1 request, `mode=sam+spark` → 3);
  - [capture/meal-reading] Tray segmentation degrades:
    - SAM overloaded: both SAM requests answer 503 and the model names rice in region 1, all eaten → `segmentation: null`, warning `segmentation unavailable: …`, rice with index 0 and portion 100, exactly 3 requests, Spark text without dish lines;
    - SAM rate-limited upstream: SAM `dish` answers 429 `rate_limit_exceeded` with `Retry-After: 12`, `food` answers normally → 200, `segmentation: null`, warning `segmentation unavailable: …`, exactly 3 requests ending in `spark:object`;
    - Budget spent: a client whose hourly budget has 1 request left → 429 `request_budget_exceeded`, `requests` is exactly `['sam:dish']`, and no `spark:object`;
  - [capture/meal-reading] Tray read fits a saved meal: Long warning (both SAM requests fail with a 400-character message → one warning of 200 characters starting `segmentation unavailable: `);
  - [capture/meal-reading] Tray upload validation: Text file as a tray (unchanged) and Unknown mode (`mode=sam` → 400, 0 requests).
- [x] 5.4 Implement `readMeal` in `apps/server/src/ai/pipeline.ts` as design.md §3:
  - `image_sha256` from `sha256Hex` before any request;
  - SAM `dish` then `food` started in that order under `Promise.allSettled`; rethrow abort and `MetaBudgetError` after both settle; any other failure degrades;
  - one Spark call with the image, the strict schema and `trayContext`;
  - the warnings (bounded), mode and trace steps.

  Then `MealForm` in `routes/ai.ts` (`mode`, 400 before any model call). Add the two SAM steps to the server's trace step names.
  - Verify: 5.2 and 5.3 pass, and `pnpm --filter @meniscus/server test` passes.
- [x] 5.5 Request-count docs: "meal tray photo 3, or 1 in Spark-only mode" in:
  - `apps/server/src/ai/pipeline.ts:11`, the header comment and its diagram (`tray ─► SAM(dish) ┐ SAM(food) ┴► layoutTray() ─► Spark`);
  - `pipeline.ts:190`, `readMeal`'s comment ("One Muse Spark request: no SAM, …"): SAM `dish` and `food`, then one Spark request, 3 requests or 1 in `spark` mode;
  - `apps/server/src/ai/meal.ts:1` ("One request per photo");
  - `apps/web/src/components/meal-form.tsx:75` ("One tray read = 1 model request") and the component comment at `:31` ("1 model request"), plus `readMeal`'s `/** 1 model request. */` at `apps/web/src/lib/api.ts:166`: 3 model requests, or 1 in Spark-only mode, set by the server;
  - `AGENTS.md:52`, the Meal trays row of the README model table (`README.md:82`: SAM dish + food, then Spark; `3 per tray photo (1 in Spark-only mode)`) and the request-count paragraph under it (`README.md:84`).
  - Verify: `grep -rn "meal tray photo 1\|1 per tray photo\|meal = 1\|One tray read = 1\|no SAM, since a tray\|One request per photo" AGENTS.md README.md apps/server/src apps/web/src` finds nothing, and `pnpm format` leaves the files unchanged.

## 6. Saving a tray meal: dishes, evidence, binding and proof

- [x] 6.1 Tests first:
  - in `apps/server/src/meals.test.ts`:
    - [charting/meals] Dishes on a meal: Lunch with two dishes; Invalid dishes (kind `pizza`, portion 40, an empty name, index 13, 21 dishes → each 400 `invalid_request`, nothing saved).
    - [charting/meals] Tray evidence stored with the meal: Tray read kept (a read from 5.3's fixtures, posted with the `media_id` of the same bytes, round-trips unchanged); Malformed tray evidence (a 33 × 10 mask, a mask of 200 base64 characters, 13 regions, 4 trace steps, coverage 1.5, 7 warnings, a 201-character warning → each 400); Body too large (a 50 KB post → 413 `payload_too_large`, nothing saved).
    - [charting/meals] Tray evidence bound to its photo: Read and photo of the same bytes (201; `evidence.image_sha256`, `media.sha256` and `proof.photo.sha256` equal; the save adds no upstream request); Read of another photo (400, nothing saved); Evidence without its photo (400, nothing saved).
    - [charting/meals] Tray proof stored with the meal: Lunch proof (`proof.photo` from the media row: id, `sha256`, `captured_by` Ravi Kumar, `captured_at` 13:09; `confirmed`, `confirmed_by` and `confirmed_at` 13:10 from the post and session); Proof outlives a void (the photo 404s, `media: null`, evidence and proof JSON byte-identical to before, `proof.photo.sha256` kept); Meal by hand (`proof: null`).
    - [charting/meals] Older meals read as dishes: Older store (a store file with an old meal row and old evidence → `dishes: []`, `proof: null`, evidence normalised with `image_sha256: null`; the stored `evidence` text unchanged).
  - in `apps/server/src/meal-reading.test.ts`: [capture/meal-reading] Tray read fits a saved meal: Long read (25 dishes named with 90 characters → 20 dishes and 20 items of 80 characters, draft items of 200 characters; uploading the same bytes and posting the meal with that evidence, its `media_id` and the draft's dishes returns 201).
- [x] 6.2 Test first, in `apps/server/src/meals.test.ts`: [charting/meals] Tray proof stored with the meal: Database refuses changes. Save the Lunch proof meal into a store file under the repo's scratch dir, open the same file with `node:sqlite` `DatabaseSync`, and run `UPDATE meal SET evidence = '{}' WHERE id = ?` and `UPDATE meal SET proof = NULL WHERE id = ?`: each throws, and `GET /api/admissions/<id>/meals` returns the same evidence and proof. Uncited: voiding still works with the trigger installed; opening the store twice leaves exactly one `meal_evidence_fixed` trigger.
- [x] 6.3 Implement:
  - `meal.dishes`, `meal.proof` and the `meal_evidence_fixed` trigger (design.md §8) in `SCHEMA` and `migrateTray`;
  - in `routes/chart.ts`: `MealBody` with `dishes` and `MealEvidenceSchema`, the photo-hash check after `badMedia` (evidence needs `media_id`, and `image_sha256` must equal that media's `sha256`), and the meal post's `bodyLimit` of 48 KB (413);
  - in `store.addMeal`: build the proof from the media row before the INSERT, and insert it with the meal in one statement;
  - `toMeal`: `dishes`, `proof`, and `normaliseMealEvidence` for older rows.

  Verify: 6.1 and 6.2 pass, every existing `charting/meals` and `charting/media` test still passes, and `grep -n "UPDATE meal" apps/server/src` shows no statement naming `evidence` or `proof`.

## 7. Web: overlay, fingerprints and tray proof

- [x] 7.1 Tests first, in new `apps/web/src/lib/tray.test.ts`:
  - [web/ward] Tray overlay: Rice on a 1000 × 800 photo (`maskRects` gives one rect at 10/10/15/50; the label `1 rice · Half` at 10/10); A cup and a region nothing names (`2 tea · 150 mL`, region 3 with no label); Outline off (`trayOverlay(…, false)` gives no rects and no labels).
  - [web/ward] Media fingerprint shown: Photo entry (`fingerprint(…)` gives `3f2a…c9`, and the source line `Photo fingerprint: 3f2a…c9` titled with the full value; in `sources.test.ts`, the source sends only `GET /api/media/<id>`); Older recording (`Fingerprint not recorded`).
  - Uncited: `decodeBits` of `gA==` with 2 × 1 gives `[1, 0]` using the web's own base64 decoding; row runs merge into one rect.
- [x] 7.2 Implement:
  - `apps/web/src/lib/tray.ts` (`decodeBits`, `maskRects`, `trayLabels`, `trayOverlay`, `fingerprint`), importing nothing from `@meniscus/meta` or `@meta-sam/parser`;
  - `DISH_LABEL` and the two SAM steps in `STEP_LABEL` (`lib/labels.ts`);
  - `TrayOverlay` in `components/evidence.tsx`;
  - the `tray` and `sha256` props on `PhotoSource`, and the fingerprint line on `SourceView`, `BeforeAfter` and `VoiceSource` (`components/source-view.tsx`).

  Verify: the 7.1 tests pass, and `pnpm --filter @meniscus/web typecheck` and `lint` pass.
- [x] 7.3 Tests first, in `apps/web/src/lib/tray.test.ts`:
  - [web/ward] Tray proof on the bed review: Lunch proof (`proofView(meal)` gives exactly the lines of the scenario, in order; opening it through `createApi` sends exactly one `GET /api/media/<id>` and no `/api/ai`); Voided lunch (`Photo deleted · fingerprint 3f2a…c9`, and no media request).
  - Uncited: a meal with `proof: null` gives no proof lines.
  - Check that `[web/ward] Meals on the bed review: What the AI read` in `meals.test.ts` still passes unchanged: its lines stay.
- [x] 7.4 Implement `proofView` in `lib/tray.ts`, and lazy `components/tray-proof.tsx` inside "What the AI read" above the existing lines (`components/meals.tsx`). Verify: 7.3 passes, and the web typecheck, lint and build pass.

## 8. Web: meal form (dish rows)

- [x] 8.1 Update the existing test in `apps/web/src/lib/meals.test.ts`. [web/capture] Meal capture: Tray photo now asserts:
  - `body.evidence` equals `{ mode, image_sha256, reading, segmentation, warnings, trace }` of the read;
  - `body.dishes` equals the draft's dishes.

  The request list (3, in order) and the `/api/ai/meal` form (only `image`) are unchanged. Also update the `tray()` fixture.
- [x] 8.2 Tests first, in `apps/web/src/lib/meals.test.ts`: [web/capture] Dishes on the meal form: Rice was finished (editing dish 1 to All sends `dishes` with it, `items: "rice, sambar"`, and the read's `image_sha256` in the evidence); Read with no dishes (no dish rows; the items field is used, and no `dishes` key is sent); Tray photo not kept (the media upload answers 500 → the meal post has the dishes, no `media_id` and no `evidence`, and the result warns the photo was not kept).
- [x] 8.3 Implement:
  - `lib/meals.ts`: `MealForm.dishes`, `formFromRead`, `toMealInput`, and `saveMeal` dropping `evidence` when no `media_id` came back;
  - `components/meal-form.tsx`: dish rows with a native `<select>`, the overlay preview, and care-plan's nil-by-mouth warning kept.

  Verify: 8.1 and 8.2 pass, and the build's attendant bed route stays within its 50 KB budget (`pnpm --filter @meniscus/web build`).

## 9. Demo data

- [x] 9.1 `apps/server/scripts/synthetic-photo.ts`: `trayMasks(portion, seed)` returns `TrayMask`s for the circles `trayPhoto` draws.
  - Uncited test in `apps/server/src/ai/tray.test.ts`: `layoutTray(trayMasks(50, 1))` finds 3 regions (plate, bowl, cup) in index order, with plate coverage within ±0.05 of the drawn share.
- [x] 9.2 `apps/server/scripts/demo-history.ts`, as design.md §11: dish evidence from the real `layoutTray`, dish kinds from the menu, and `image_sha256` = `sha256Hex` of the photo each meal uploads. All of it goes through `addMedia` and `addMeal`, with no model request.
  - Verify: `pnpm --filter @meniscus/server demo` into a scratch store under the repo (not `/tmp`) completes. `GET /api/admissions/<id>/meals` on it shows `dishes`, and `proof.photo.sha256` equal to the meal's `media.sha256`.

## 10. Integration

- [x] 10.1 Browser check at 390 and 1100 px, through the Vite proxy, on the demo store from 9.2. No model request can be sent:
  - Playwright fulfils `/api/ai/meal` with a fixture `MealReadResult` (2 dishes in 2 regions, masks, 3 trace steps) whose `image_sha256` the handler computes from the posted `image` part (`new Response(route.request().postDataBuffer(), { headers: { 'content-type': … } }).formData()`, then SHA-256 of that file), and aborts every other `/api/ai/**` route.
  - Meal form: take a synthetic tray photo. The dish rows and the overlay render from the fixture; set a dish to All and save. The save sends one media upload and one meal post (201).
  - Bed review: open "What the AI read" on that meal and on a demo meal. The photo shows dish outlines labelled `<index> <name> · <portion>`, the outline toggle hides them, the rows show AI vs saved, `Photo fingerprint: …` and `Saved by …` show. The network log shows one `GET /api/media/<id>` per opened meal.
  - Void that meal as a nurse: its proof reads `Photo deleted · fingerprint …` and sends no media request.
  - A photo entry and a voice entry show their fingerprint lines.
  - No console errors. The network log shows no `/api/ai` request other than the fulfilled `/api/ai/meal`.
- [x] 10.2 `pnpm verify` passes: format, lint, `openspec validate --all --strict`, spec:check (every ADDED and MODIFIED requirement above is cited), typecheck and tests.

## 11. Before the demo (the user runs it)

- [ ] 11.1 Live gate: one user-approved live tray read, exactly 3 requests (SAM `dish`, SAM `food`, Spark), on one staged tray photo from the dataset, through the running server (`POST /api/ai/meal`, no mode, `MEAL_USE_SAM=true`). The user sends it; no agent does. It confirms that SAM `dish` returns at least one dish on a real tray, that the `one_bit` payload parses (`segmentation` not null, regions with masks), and that Spark cites the regions. If `dish` or `one_bit` misbehaves, change the constant through a spec delta and run 10.2 again; no second live request without the user's approval.

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply`, and again before `/opsx:archive`.
- Archive with `pnpm exec openspec archive tray-segmentation --yes`, after `care-plan` (and `bag-emptying`, if it goes first) is archived, and before `scale-acuity` and `read-outcomes`' tray follow-up. `dietitian` does not depend on this change: no ordering.
- Post-archive: the user edits the Purpose by hand (protected path). `openspec/specs/capture/meal-reading/spec.md` says "One Muse Spark request per photo"; it becomes "Three requests per photo in `sam+spark` mode (SAM `dish`, SAM `food`, Muse Spark), or one Muse Spark request in Spark-only mode, never retried". A delta cannot change a Purpose.
- After archiving:
  - `image-synthesis`: its "meal tray photo 1" wording (proposal line 30, its `AGENTS.md` task) becomes "meal tray photo 3, or 1 in Spark-only mode".
  - `read-outcomes`' tray follow-up: counts 3 (`sam+spark`) and 1 (`spark`), no 5-request path; it defines `admission_id` on `/api/ai/meal` itself; there is no `meal_event` yet.
  - `scale-acuity` (design.md "Overlaps") closes three gaps on this change's archived text:
    - its "Whole action admitted up front" (and "Tray read mode by acuity") conflicts with "Tray segmentation degrades: Budget spent", where 1 SAM request is sent before the 429;
    - `capture/read-budget` depends on the deferred 5-request served path and on a bed on `/api/ai/meal`, which this MVP does not have;
    - narrowing `MediaRef.sha256` to `string` breaks the `sha256: null` fixtures and "Media fingerprint shown: Older recording".

    So it MODIFIES `capture/meal-reading` "Tray segmentation degrades" and `web/ward` "Media fingerprint shown".
- The deferred items (proposal.md "Deferred") go into a follow-up change on this change's archived text.
