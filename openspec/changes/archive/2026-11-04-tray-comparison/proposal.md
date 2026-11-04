# Proposal

## Why

`tray-segmentation` reads one collected tray: SAM measures how much food is still on each dish, but without the served tray it cannot tell "half eaten" from "half a portion served", so every dish portion stays Spark's guess. It also left no way to correct a saved meal. This change adds everything that change deferred (its proposal and design "Deferred"):
- the served tray photo, taken at the bed when the tray arrives;
- a measured portion per dish, from the served and collected coverage;
- the served photo bound into the meal's proof;
- nurse-only meal amendments, kept as history the database cannot change;
- the tray eval.

It builds on tray-segmentation's archived text and applies after `acuity-budget`.

## What Changes

- **Served tray photo** (`charting/meals`, `charting/media`, `web/capture`).
  - A photo upload takes `served_meal` (`breakfast` | `lunch` | `dinner` | `snack`). Every media reference returns it, and it is null for other media.
  - The bed's capture screen gets "Served tray": one photo upload, 0 model requests.
  - New `GET /api/admissions/:id/served-tray` returns the bed's newest unlinked served photo of any meal in the last 4 h, 0 model requests. Opening Meal at the bed calls it once and preselects that photo's meal, else the meal by time of day as before. A lunch served at 14:30 and collected at 15:10 then reads as lunch, not snack.
- **Tray reads name their bed and meal** (`capture/meal-reading`).
  - `POST /api/ai/meal` takes optional `admission_id` and `meal`. An unknown bed gets 404, and `meal` without a bed gets 400, both before any model request. Neither value is sent upstream.
  - With both, the server finds the bed's newest served photo for that meal, taken in the last `SERVED_TRAY_HOURS` (4 h) and linked by no record. It never looks at another bed's photos.
  - A served photo with the collected photo's own bytes (same SHA-256) is never compared: `comparison: null`, the warning `comparison unavailable: same photo as served`, 3 requests (1 in `spark`). A self-compare would read every dish as portion 0.
- **Comparison** (`capture/meal-reading`). When a comparable served photo (found, other bytes, both sizes readable) is found in `sam+spark` mode and the collected photo has at least one dish region, SAM `dish` and `food` also run on the served photo: 2 more requests.
  - Regions match by place. Box centres are measured in thousandths of each photo's own width and height (from the image header). A match needs a squared centre distance of at most 40 000 (200 thousandths), the smaller box's share of its photo at least half the larger's, and each region the other's strictly nearest such region. Ties match nothing.
  - A dish gets `basis: measured` and portion `25 × q`, with `q = ⌊(8·(S−N) + S) / (2S)⌋` kept to 0–4 over integer thousandths (S served, N collected coverage), only when:
    - exactly one dish cites its region;
    - the region matched;
    - S ≥ 150;
    - 4N ≤ 5S.

    Otherwise the dish keeps Spark's portion (`basis: model`). Spark's own value is always kept as `model_portion`.
  - The Spark prompt gains `served <p>%` on matched dish lines. Spark still sees only the collected photo.
  - Degrades without retries:
    - an upstream failure of the served SAM requests;
    - a served tray with no dishes;
    - an unreadable image size (3 requests, its own warning, never a `budget pressure` one);
    - the same bytes as the collected photo;
    - a budget with room for 3 or 4.
- **Proof binding** (`charting/meals`).
  - A meal post sends `served_media_id` exactly when its evidence has a comparison. The comparison's id and `served_sha256` must equal it and that media's stored `sha256`.
  - The served photo must be this bed's, for this meal (`served_meal == meal`), linked by no other meal, not the tray photo (`media_id ≠ served_media_id`), and not the same bytes (its `sha256` differs from the tray photo's; else 400 `invalid_request` at `served_media_id`).
  - Both hashes are checked against stored media, with 0 model requests.
  - The proof gains `served` (media id, SHA-256, who took it and when). Voiding unlinks and deletes both photos' bytes.
- **Amend a meal** (`charting/meals`, `web/ward`). `POST /api/meals/:id/amend` changes `portion`, `items` or `dishes`, with a 3–200 character reason, for a nurse or matron only.
  - When dishes change, `items` is derived from them.
  - Each amendment is a `meal_event` row holding the values before and after, and SQLite triggers refuse any UPDATE or DELETE of it.
  - Evidence, proof, fluid entry and media are untouched.
  - The bed review gets "Amend…" and shows each amendment.
- **Media lifecycle** (`charting/media`): MODIFIED **Media goes with its record**. A served photo is a meal link, and `UNLINKED` gains `meal.served_media_id` beside bag-emptying's `level.proof_media_id`.
- **Budget** (`capture/read-budget`).
  - A tray read with `admission_id` takes its bed's budget class, critical or routine. A tray read without one stays routine, as acuity-budget specifies.
  - A tray read with a comparable served photo is admitted for 5. If only 3 or 4 fit, it reads with 3 and no comparison. If only 1 or 2 fit, it reads with 1 in `spark` mode. If none fit, it gets 429 with 0. Unsent requests are returned. A served photo that is not comparable plans 3, with only its own `comparison unavailable` warning.
  - This makes the tray counts stale: tray-segmentation's "meal tray photo 3, or 1 in Spark-only mode" (AGENTS.md:52, README.md:84) and "3 per tray photo" (README.md:82), and acuity-budget's design §4.3 table and "every tray read is routine". The new count is **meal tray photo 3, 5 with a served photo, or 1 in Spark-only mode**, and a tray read with `admission_id` takes its bed's class.
- **Evidence size.** The worst-case meal post grows to 30.1 KB ASCII and 42.3 KB in a 3-byte UTF-8 script (design.md §9), so the meal post limit rises from 48 KB to **64 KB**. The trace bound rises from 3 steps to 5.
- **Tray eval** (`charting/model-accuracy`, `scripts/eval.ts`).
  - `--tray-labels <manifest.jsonl>` makes a run a tray eval, named beside read-outcomes' `--container-labels`. With `--container-labels` or `--no-hint` it exits 2 and sends nothing.
  - A real photo is a tray when its `record_type: original` record has `expected_items` (44 `food_tray` records and `hard-041`). The 270 augmented records that also have `expected_items` are skipped, as read-outcomes keeps augmented variants out of scope. It scores dish kinds, per-dish portions by basis, the meal portion, fluid kinds and mL, and outcomes from `expected_items`, `meal_portion_eaten`, `expected_fluids` and `expected_outcome`. A null `volume_ml_estimate` (18 real tray fluids) scores the kind only. Dishes pair by `dish_kind`, then in order, never by name.
  - A verified synthetic photo (read-outcomes' sidecar rule) is a tray when its sidecar's `labels.truth` has `expected_items`. Dishes and fluids come from `labels.truth`, the meal portion and outcome from the top-level `labels.meal_portion_eaten` and `labels.expected_outcome`, each unscored when absent. Real and synthetic trays are reported apart.
  - Verified synthetic `after` photos with their `before` photo are read in `sam+spark` mode as served and collected pairs at 5 requests. The before is found by `pair_id`, else by the first `source_ids` record's `file`. Without a before, or in `spark` mode, the after is read alone.
  - Dry run unless approved.
  - The dataset has 44 real trays plus `hard-041` (not a meal), and no real pairs.
- **Docs.** The tray counts in `AGENTS.md` (the request-count list in "Model API credits are limited", replacing tray-segmentation's "meal tray photo 3, or 1 in Spark-only mode"), `README.md`, `pipeline.ts` and `meal-form.tsx` become "meal tray photo 3, 5 with a served photo, or 1 in Spark-only mode". `docs/accuracy.md` gains "Trays".
- **Demo and fake server.** The demo seed adds served photos, a compared lunch and one amendment on fictional beds other than 2C-2, whose meal fluids bag-alerts' guard depends on. New dev-only `scripts/fake-server.ts` points the Model API base URL at `127.0.0.1:9` before config loads, so `GET /api/ai/status` cannot reach Meta. bag-alerts' browser check may reuse it.

### Upstream model requests per user action (before → after)

| Action | Before (tray-segmentation + acuity-budget) | After |
|---|---|---|
| Tray read, `sam+spark`, no served photo (no `admission_id`/`meal`, none found, too old, another meal, already linked) | 3 | exactly 3 |
| Tray read, `sam+spark`, comparable served photo found, collected photo has ≥ 1 region | — | exactly 5: SAM `dish`, SAM `food` (collected), SAM `dish`, SAM `food` (served), Spark |
| Tray read, `sam+spark`, served photo found, collected photo has 0 regions (none found, or its SAM failed upstream) | — | exactly 3 (served SAM not sent) |
| Tray read, `sam+spark`, served photo found, served SAM fails upstream | — | exactly 5, never retried |
| Tray read, `sam+spark`, served photo found, an image size unreadable | — | exactly 3 |
| Tray read, served photo with the collected photo's own bytes (`sam+spark` / `spark`) | — | exactly 3 / 1, `comparison: null` |
| Tray read, `spark` (requested or `MEAL_USE_SAM=false`), served photo or not | 1 | exactly 1 |
| Tray read, comparable served photo found, 3–4 requests left under the class ceiling | — | exactly 3, no comparison, `budget pressure` warning |
| Tray read, 1–2 left | 1 (`spark`) | exactly 1 (`spark`) |
| Tray read, none left | 0 (429) | 0 (429) |
| Tray read, unknown `admission_id`, or `meal` without one | — | 0 (404 / 400) |
| Served photo upload, served-tray lookup on opening Meal, meal save, amend, proof view | 0 | 0 |
| Tray eval per labelled tray photo, approved (`sam+spark` / `spark`) | — | 3 / 1; a paired `after` photo 5 / 1; skipped 0; without approval 0 |

### Changed shapes

- `packages/shared`:
  - **BREAKING** `MediaRef` gains `served_meal: MealKind | null`.
  - **BREAKING** `MealDish` gains `model_portion` and `measure`. `PORTION_BASES` gains `measured`.
  - **BREAKING** `MealReadResult` and `MealEvidence` gain `comparison: TrayComparison | null`.
  - **BREAKING** `MealProof` gains `served: TrayPhotoProof | null`.
  - **BREAKING** `Meal` gains `served_media`, `amendments` and `amended_at`.
  - `MealInput` gains optional `served_media_id`.
  - New: `SERVED_TRAY_HOURS`, `MATCH_MAX_DISTANCE`, `MIN_SERVED_COVERAGE`, `MAX_TRACE_STEPS`, `ImageSize`, `RegionMatch`, `TrayComparison`, `DishMeasure`, `MealValues`, `MealAmendment`, `AmendMealInput`, `ServedTray`.
- HTTP:
  - **BREAKING** `POST /api/admissions/:id/media` takes `served_meal`, and its 201 body and every media reference gain `served_meal`.
  - **BREAKING** `POST /api/ai/meal` takes `admission_id` and `meal`, and returns `comparison`.
  - **BREAKING** `POST /api/admissions/:id/meals` takes `served_media_id`, enforces the binding rules, accepts traces of up to 5 steps, and its body limit rises from 48 KB to 64 KB. Its responses carry the new `Meal` fields.
  - New `POST /api/meals/:id/amend`.
  - New `GET /api/admissions/:id/served-tray`.

### Out of scope

- Amending a meal's fluid. The fluid lives on the fluid chart as an entry, already amended through `POST /api/entries/:id/amend` with its own history. A meal amendment leaves `fluid_ml` and the entry's item text as recorded.
- Spark reading both photos. Spark gets only the collected photo. The served photo reaches it as coverage numbers.
- Measuring fluid from photos, per-dish overall portion maths (the overall portion stays Spark's), nutrition, and diet orders.
- Served photos in the ward round, more than one served photo per meal, and linking a served photo after the meal is saved.
- Logging tray reads, meal `read_id` links and tray outcomes in the read log. That is `accuracy-views` (read-outcomes' tray follow-up), which applies after this change (design.md §14).
- Upgrading older store files: the new columns and table go into `SCHEMA` with a `STORE_SCHEMA_VERSION` bump, and an older file fails to open (charting/entries "Store schema version").

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `capture/meal-reading`:
  - MODIFIED **Tray reading** (counts with a comparison; `comparison` in the result), **Tray read fits a saved meal** (bounds on both photos, 5 trace steps) and **Tray segmentation degrades** (acuity-budget's text; a SAM failure on the *collected* photo costs 3).
  - ADDED **Tray reads name their bed**, **Served and collected trays**, **Served photo with the same bytes**, **Served photo comparison degrades**, **Photo sizes needed to compare**, **Served dishes matched by place** and **Portion measured from the served tray**.
  - The Purpose line is edited by hand after archive (tasks.md "Workflow follow-up").
- `capture/read-budget` (added by acuity-budget): MODIFIED **Budget class of a model action** (a tray read with a bed takes its class), **Whole action admitted up front** (5 for a tray read with a served photo) and **Read mode fits the budget** (defers to the new rule). ADDED **Served tray reads fit the budget** (5 for a comparable served photo, else 3 without comparison, else 1 in `spark`, else 429).
- `charting/meals`:
  - MODIFIED **Tray evidence stored with the meal** (`comparison`, 5 trace steps, 64 KB) and **Tray proof stored with the meal** (tray-segmentation's text; `proof.served`, voiding deletes both photos' bytes).
  - ADDED **Compared read kept as evidence**, **Served tray photo**, **Served tray of a bed**, **Served photo linked to the meal**, **Comparison bound to its photos**, **Amend a meal**, **Amended dishes set the items**, **Meal amendments need a nurse** and **Meal amendment history**.
- `charting/media`: MODIFIED **Upload media** (`served_meal`) and **Media goes with its record** (served photos).
- `charting/model-accuracy` (added by read-outcomes): ADDED **Tray eval labels from the dataset**, **Tray eval report**, **Synthetic trays in the tray eval** and **Served and collected pairs in the tray eval**.
- `web/capture`: MODIFIED **Meal capture** (meal preselected from the served tray, else by time). ADDED **Meal follows the served tray**, **Served tray photo at the bed** and **Collected tray compared at the bed**.
- `web/ward`: MODIFIED **Tray proof on the bed review** (each photo fetched once, paired with the served tray). ADDED **Served tray in the proof** (before and after pair, eaten-share stat line, measured rows) and **Amend a meal from the bed review**.

## Impact

- `packages/shared/src/index.ts`: the types and constants above.
- `apps/server`:
  - New `src/ai/image-size.ts`: pure header parsing for JPEG, PNG, WebP and GIF.
  - New `src/ai/compare.ts`: pure `servedCheck`, `centreOf`, `matchRegions`, `quarters` and `measureDishes`.
  - `src/ai/tray.ts`: `trayContext` with `served <p>%`.
  - `src/ai/meal.ts`: `toMealReading` with `model_portion` and `measure`.
  - `src/ai/pipeline.ts`: `readMeal({ …, served?, compare })` and the counts in its header comment.
  - `src/ai/budget-policy.ts` (acuity-budget's): a tray read with a served photo plans 5 (peak 2).
  - `src/routes/ai.ts`: `MealForm` with `admission_id` and `meal`, the bed lookup, the served-photo lookup, the class, and merging the comparison's media fields.
  - `src/routes/media.ts`: `served_meal`.
  - `src/routes/chart.ts`: `MealBody.served_media_id`, the served and comparison checks (same bytes included), the 64 KB limit, `GET /admissions/:id/served-tray`, `AmendMealBody` and `POST /meals/:id/amend` (`requireDecider`).
  - `src/routes/evidence.ts`: `MealEvidenceSchema` with `comparison`, `model_portion`, `measure`, 5 trace steps and `measured`.
  - `src/store/store.ts`:
    - `media.served_meal`, `meal.served_media_id`, `meal.amended_at` and the `meal_event` table;
    - the `meal_event_fixed` and `meal_event_kept` triggers;
    - the unique index on `meal.served_media_id` and the `media_served` index, in `SCHEMA`;
    - `UNLINKED`, `servedPhoto`, `addMeal` (served link and `proof.served`), `amendMeal` and `voidMeal` (both photos);
    - all of it in `SCHEMA`, with `STORE_SCHEMA_VERSION` 3 → 4 and no upgrade step.
  - `src/testing.ts`: `png(w, h)` and the SAM fixtures per image.
  - New `src/chart/tray-lab.ts`, beside read-outcomes' `lab.ts`.
  - `scripts/eval.ts` (`--tray-labels`), `scripts/demo-history.ts` (served photos and one amendment, never on 2C-2), and new dev-only `scripts/fake-server.ts` for the browser check (Model API base URL on 127.0.0.1:9 before config loads), with `src/lab/fake-server.test.ts`.
- `apps/web`:
  - `lib/meals.ts` (`mealOnOpen`), `lib/api.ts` (`servedTray`), `lib/labels.ts` (the served SAM steps), `lib/tray.ts` (proof rows with `measured`, the served photo), and new `lib/meal-amend.ts`;
  - `components/meal-form.tsx`, `components/meals.tsx` and `components/tray-proof.tsx`;
  - new lazy `components/served-tray.tsx` and `components/amend-meal-dialog.tsx`;
  - `routes/a/bed.$token.tsx` (the "Served tray" tile).
- Docs: `AGENTS.md`, `README.md`, `docs/accuracy.md`.
- No new dependencies. Image sizes come from the file headers, with no image library.
