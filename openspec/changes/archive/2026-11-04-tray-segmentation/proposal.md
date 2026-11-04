# Proposal

## Why

A tray read today is one Muse Spark guess at the whole tray: no geometry, nothing a nurse or dietitian can check against the photo, and nothing kept that proves which photo the read came from. Container reads already ground Spark with SAM 3.1. Trays should follow the same architecture: segment every dish and the food in it, give Spark the measured food coverage per dish, and keep the result as proof in the database: the dish outlines, the model read, the values staff confirmed, and the SHA-256 fingerprint of the photo it was read from. Per-dish results must be well defined and auditable.

This is the MVP for the Nov 4, 9 PM ET deadline. Served/collected comparison, meal amendments and the tray eval are deferred (see "Deferred").

## What Changes

- **Tray reads are grounded by SAM** (`capture/meal-reading`). `POST /api/ai/meal` runs SAM `dish` and SAM `food` on the tray photo, pairs every food pixel with the innermost dish it lies in, and computes each dish's food coverage (food area / dish area) and position. Spark then gets the photo plus a compact list of dish regions (index, pixel box, position, coverage) and names each food with its region, a `dish_kind` and the portion eaten, and each fluid with its region and `fluid_kind`.
  - SAM's docs require one short noun phrase per request, and say "or" and lists give inconsistent results, so the suggested `plate or bowl or cup` prompt is replaced by the single concept `dish` (design.md §2).
  - New config `MEAL_USE_SAM` (default true) and an optional per-request `mode` (`spark` | `sam+spark`), as photo reads have.
  - If a SAM request fails upstream (any HTTP error, 429 included), the read degrades to Spark only with the warning `segmentation unavailable: …`, as photo reads do. Never retried. A refusal by the local request budget fails the read and sends no Spark request.
  - The read returns `image_sha256`, the SHA-256 of the uploaded bytes, so the saved evidence names the photo it came from.
- **Reading output** gains `dishes: [{ index, name, dish_kind, portion, basis, box, coverage }]`, and fluids gain `index` and `fluid_kind`. `items` and `fluids[].name/volume_ml` stay, derived from dishes, so current consumers keep working. New shared `DISH_KINDS` vocabulary (the external dataset's labels) and `MEAL_FLUID_KINDS` (the drinkable subset of `FLUID_KINDS`).
- **Proof stored with the meal** (`charting/meals`, `charting/media`):
  - the evidence: mode, `image_sha256`, the reading, per region the box, coverage and two one-bit masks (dish, food) capped at 32 × 32 cells (128 bytes, 172 base64 characters each), warnings and trace, bounded and validated;
  - a meal with evidence must link its tray photo, and `evidence.image_sha256` must equal that media's `sha256`, or the post gets 400. This costs 0 model requests;
  - a proof the server builds at save: the photo's media id, SHA-256, who took it and when, and the portion, items, fluid mL and dishes staff confirmed, with who saved and when;
  - SQLite triggers refuse any UPDATE of `meal.evidence` and `meal.proof`. Voiding deletes the photo's bytes only;
  - every media file gets a SHA-256 fingerprint at upload (`media.sha256`), returned by the upload and on every media reference. Media stored before this change return `sha256: null` (design.md §9).
- **Web.**
  - The Meal form shows the tray photo with its dish outlines and one editable row per dish (name, kind, portion chips). If the photo upload fails, the meal is saved without evidence, with the existing "photo was not kept" warning.
  - The bed review's "What the AI read" shows the proof: the photo with dish outlines labelled with name and portion, who took it and when, its fingerprint, each dish's AI read beside the saved value, and who saved.
  - Every kept photo or recording shows its fingerprint.
  - None of this adds a model request.
- **Demo.** Synthetic trays get synthetic dish segmentation that matches the drawing, so the overlay and proof can be shown without a model request.
- **Docs.** The request count for a meal tray photo becomes "3, or 1 in Spark-only mode" in `AGENTS.md:52`, `README.md:82,84` and `apps/server/src/ai/pipeline.ts:11`.

### Upstream model requests per user action

| Action | Before | After |
|---|---|---|
| Tray read, `mode: sam+spark`, or no mode while `MEAL_USE_SAM=true` | 1 | exactly 3: SAM `dish`, SAM `food`, Spark |
| Tray read, `mode: spark`, or no mode while `MEAL_USE_SAM=false` | 1 | exactly 1: Spark |
| Tray read, `sam+spark`, a SAM request fails upstream (503, 429, network) | — | exactly 3 (2 SAM + Spark), never retried |
| Tray read, Spark answers 429 | 1 | 3 in `sam+spark`, 1 in `spark` |
| Tray read, `sam+spark`, local budget has 1 request left | — | exactly 1 (SAM `dish`), no Spark; 429 `request_budget_exceeded` |
| Upload, save a meal, view the proof | 0 | 0 |

### Changed shapes

- `packages/shared`:
  - **BREAKING** `MealReading` gains `dishes: MealDish[]`; `fluids` items gain `index` and `fluid_kind`.
  - **BREAKING** `MealReadResult` gains `mode`, `segmentation`, `warnings` and `image_sha256`.
  - **BREAKING** `MealDraft` gains `dishes`.
  - **BREAKING** `MealEvidence` gains `mode`, `image_sha256`, `segmentation` and `warnings`.
  - **BREAKING** `Meal` gains `dishes` and `proof`.
  - **BREAKING** `MediaRef` gains `sha256`.
  - `MealInput` gains optional `dishes`.
  - New: `DISH_KINDS`, `DishKind`, `MEAL_FLUID_KINDS`, `MealFluidKind`, `PORTION_BASES`, `PortionBasis`, `MAX_TRAY_REGIONS`, `MASK_GRID`, `MAX_READ_WARNINGS`, `MAX_WARNING_CHARS`, `MaskBits`, `TrayRegion`, `TraySegmentation`, `DishValue`, `MealDish`, `MealFluid`, `TrayPhotoProof` and `MealProof`.
- HTTP:
  - `POST /api/ai/meal` accepts `mode` and returns the shapes above, including `image_sha256`.
  - `POST /api/admissions/:id/media` returns `sha256`, and every media reference carries it.
  - `POST /api/admissions/:id/meals` accepts `dishes` and the new evidence, refuses evidence whose `image_sha256` is not its photo's, and its body limit rises from 16 KB to 48 KB (design.md §9 "Size").

### Out of scope

- Nutrition: calories, food groups as advice, diet orders. Charting only, never diagnosis.
- Measuring fluid volume from segmentation. Fluid mL stays Spark's estimate, and the Meal form keeps one fluid total.
- Server-kept reads (a read id the meal links). Evidence stays client-reported and server-validated, now bound to its photo by hash. See design.md "Overlaps" for `read-outcomes`.
- Backfilling fingerprints for media stored before this change.
- SAM box or point prompts, video, more than one tray per photo, and reading meal tickets or names.

### Deferred

Cut for the deadline; a follow-up change adds them on top of this one:

- `capture/meal-reading`: **Served and collected trays** and **Served photo comparison degrades** (with them `admission_id` and `meal` on `/api/ai/meal`, the 5-request path, `TrayComparison`, `TrayPair`, `SERVED_TRAY_HOURS` and the `measured` portion basis).
- `charting/meals`: **Served tray photo**, **Served photo linked to the meal**, **Amend a meal** and **Meal amendments need a nurse** (with them `media.served_meal`, `meal.served_media_id`, `meal_event`, `POST /api/meals/:id/amend`, `Meal.served_media`, `amendments`, `amended_at`, `MealValues`, `MealAmendment`, `AmendMealInput`, `TRAY_PHOTO_ROLES`).
- `charting/media`: MODIFIED **Media goes with its record**. Dropped: nothing in the MVP needs it, since only the served photo added a second link, and `UNLINKED` (`apps/server/src/store/store.ts:796`) is not changed.
- `web/capture`: **Served tray photo at the bed**.
- `web/ward`: **Amend a meal from the bed review**.
- The tray eval: `scripts/eval.ts --trays`, `src/chart/tray-score.ts` and the `docs/accuracy.md` "Trays" section.

## Capabilities

### New Capabilities

None. Tray segmentation belongs to `capture/meal-reading`, and meal proof to `charting/meals`.

### Modified Capabilities

- `capture/meal-reading`:
  - MODIFIED **Tray reading** (3 or 1 requests per path, the strict JSON schema, the new result with `image_sha256`), **Tray read fits a saved meal** (dish, region, mask and warning bounds) and **Tray upload validation** (`mode`).
  - ADDED **Tray segmentation grounding**, **Spark-only tray reading**, **Tray segmentation degrades**, **Dish coverage** and **Dishes and fluids in the reading**.
  - The Purpose line ("One Muse Spark request per photo") cannot change through a delta; it is edited by hand after archive (tasks.md "Workflow follow-up").
- `charting/meals`: ADDED **Dishes on a meal**, **Tray evidence stored with the meal**, **Tray evidence bound to its photo**, **Tray proof stored with the meal** and **Older meals read as dishes**.
- `charting/media`: ADDED **Media fingerprint**; MODIFIED **Upload media** (`sha256` in the 201 body).
- `web/capture`: ADDED **Dishes on the meal form**. **Meal capture** is unchanged: "Photo of the tray" still makes one `/api/ai/meal` request.
- `web/ward`: ADDED **Tray overlay**, **Tray proof on the bed review** and **Media fingerprint shown**.

## Impact

- `packages/shared/src/index.ts`: the types and constants above.
- `apps/server`:
  - `src/config.ts` and `.env.example`: `MEAL_USE_SAM`.
  - New `src/hash.ts`: `sha256Hex`, shared by the read and the media store.
  - New `src/ai/tray.ts`: pure `layoutTray`, `packMask`, `positionOf`, `coveragePercent` and `trayContext`.
  - `src/ai/meal.ts`: the new Spark contract, prompt, mapping and `normaliseMealEvidence`.
  - `src/ai/pipeline.ts`: `readMeal` with SAM and degradation, `image_sha256`, and the header comment's counts (`:11`).
  - `src/routes/ai.ts`: `mode` on the meal form.
  - `src/routes/chart.ts`: `MealBody` (dishes, evidence), the photo-hash check and the 48 KB limit.
  - `src/routes/evidence.ts`: `MealReadingSchema` (moved from `src/ai/meal.ts`) and `MealEvidenceSchema`, next to `PhotoEvidence`, with shared box and mask validators.
  - `src/store/store.ts`:
    - `media.sha256`, hashed in `insertMedia`, returned by `toMediaRef`;
    - `meal.dishes` and `meal.proof`, the proof built before the insert;
    - triggers refusing UPDATE of `meal.evidence` and `meal.proof`;
    - `migrateTray`, after `migrateCare` (and after `migrateBags` if bag-emptying lands first);
    - normalising older meal evidence. `UNLINKED` (`:688`) is unchanged.
  - `src/testing.ts`: the fake upstream records every request body (SAM and Spark), so tests can assert `store: false` on all 3 requests and `mask_encoding` on both SAM requests.
  - `scripts/demo-history.ts` and `scripts/synthetic-photo.ts` (synthetic tray masks).
- `apps/web`:
  - `lib/meals.ts`, `lib/labels.ts` (`DISH_LABEL`, the two SAM steps in `STEP_LABEL`), `lib/api.ts` (types only) and new `lib/tray.ts` (`decodeBits`, overlay geometry, proof rows, `fingerprint`);
  - `components/meal-form.tsx`, `components/meals.tsx`, `components/evidence.tsx` (the tray overlay) and `components/source-view.tsx` (the fingerprint);
  - new lazy `components/tray-proof.tsx`.
- Docs: `AGENTS.md:52`, `README.md:82` and `README.md:84` ("meal tray photo 3, or 1 in Spark-only mode").
- No new dependencies. SHA-256 comes from `node:crypto`. The server decodes SAM masks with `decodeMaskToRaster` from `@meniscus/meta`; the web decodes the stored packed masks with its own base64 `decodeBits` and never imports `@meniscus/meta`.
