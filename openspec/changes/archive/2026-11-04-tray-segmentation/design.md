# Design

## Context

See proposal.md, "Why". MVP for the Nov 4, 9 PM ET deadline; see "Deferred". The current state that shapes the approach:

- **Tray read.** `readMeal` (`apps/server/src/ai/pipeline.ts:191`) makes one Spark `generateObject` call with `MEAL_JSON_SCHEMA`. It returns `{ reading, draft, needs_review, trace, ms }` with no mode, no warnings and no geometry. `routes/ai.ts:67` takes only `image`. The header comment (`pipeline.ts:11`) says `meal = 1`.
- **Container read.** It is the precedent:
  - `segmentFor` (`pipeline.ts:80`) runs SAM(container) and SAM(liquid) with `Promise.all`;
  - `locate()` (`ai/segmentation.ts`) is pure geometry over `toInstance(rec)`;
  - `readingContext()` turns the geometry into Spark grounding text.
  - A SAM failure is caught and becomes `segmentation unavailable: …`. Abort and `MetaBudgetError` rethrow (`pipeline.ts:110`).
  - Mode is per request (`mode`) with a default from `config.READ_USE_SAM`.
- **SAM client.** `sam.segment({ image, prompt, maskEncoding })` (`packages/meta/src/sam.ts:39`) is one `POST /v1/responses` through `responses.create`, which sends `store: false` by default (`responses.ts:177`). It parses with `@meta-sam/parser` and returns `masks` (each with `bounds`, the half-open source box the raster covers, and an H × W `mask`) and `boxes`. `decodeMaskToRaster` is re-exported from `@meniscus/meta`.
- **Budget.** `RequestBudget` fails fast: `maxConcurrent` (default 4) and `perHour` (default 120) throw `MetaBudgetError` instead of queueing. The slot is taken synchronously when a request starts (`packages/meta/src/transport.ts:51`), so two calls started in one tick take slots in call order.
- **Meals.**
  - `MealBody` (`routes/chart.ts:126`) accepts `evidence: { reading: MealReadingSchema, trace ≤ 4 }` under `smallJson()` (16 KB, `routes/common.ts:34`).
  - The `meal` table has `evidence TEXT` and `media_id`. The only UPDATE of `meal` is the void (`store.ts:946`), which sets `media_id = NULL` and touches neither evidence nor anything new.
  - `UNLINKED` (`store.ts:796`) looks at `entry`, `level` (its photo and, since bag-emptying, its `proof_media_id`) and `meal.media_id`. This change does not edit it.
- **Media.** The `media` table has no hash. `toMediaRef` (`store.ts:553`) and `MEDIA_JSON` (`store.ts:544`) build `{ id, kind, mime, size, duration_ms, created_at }`. The uploader's id is stored (`created_by`) but not returned.
- **Web.**
  - The Meal form (`components/meal-form.tsx:75`) shrinks the photo once and passes the same blob to `api.readMeal` and, on save, to the media upload (`setTray(photo)`), so the read and the stored media hash the same bytes.
  - `saveMeal` (`lib/meals.ts:89`) uploads through `linkMedia` (`lib/media.ts:39`). If the upload fails it posts the meal without `media_id` and warns "photo was not kept".
  - The bed review's "What the AI read" (`components/meals.tsx`) lists items, fluids and steps, and lazily shows the tray photo through `PhotoSource` with `evidence: null`.
  - `PhotoOverlay` (`components/evidence.tsx`) draws only a container box, a liquid box and a surface line.

### SAM 3.1 documentation (checked 2026-11-03)

| Question | Answer | Source |
|---|---|---|
| Does a concept prompt return all instances? | Yes: "image requests return every matching instance", with no stated cap (video tracks up to 16 objects per frame). Zero matches is an empty `output_text` and a normal result. | https://dev.meta.ai/docs/sam/segmenting, https://dev.meta.ai/docs/sam/reading-segmentation |
| Prompt rules | One short noun phrase naming one concept: "Name the object; don't instruct the model". Comma, semicolon and plus lists return zero matches. "and", a newline or a second `input_text` segments only one concept. Negation and boolean "or" give inconsistent results. Several concepts need several requests. | https://dev.meta.ai/docs/sam/segmenting, https://dev.meta.ai/docs/sam/overview |
| Mask encoding | `metadata.mask_encoding`: `lossless` (default, `~` marker) or `one_bit` (`!` marker, "the smallest payloads"). Payloads are base85. `data=H,W,…` is a raster "smaller than the frame". The parser maps it onto the record's box (`bounds`, "the half-open source-pixel box the raster covers"). `include_confidence: "true"` adds `c` (0–1). | https://dev.meta.ai/docs/sam/segmenting, https://dev.meta.ai/docs/sam/reading-segmentation, `@meta-sam/parser` 0.1.0 `segmentation.d.ts` |
| Limits | SAM 3.1: 3,000 requests per minute per team, no TPM, $2.50 per 1,000 images. No image size, resolution or instance-count limit is documented. The Responses page mentions a 50 MB inline-media limit without its scope. | https://dev.meta.ai/docs/pricing-rate-limits, https://dev.meta.ai/docs/protocols/responses |
| Retention | The Responses API stores by default, and `store: false` keeps no copy. The SAM pages do not say whether `store` applies to `sam-3.1`. Our client sends `store: false` on every Responses call, SAM included. | https://dev.meta.ai/docs/protocols/responses |

Consequences:
- The suggested prompt `plate or bowl or cup` is not used (boolean "or" is unreliable). Dishes use the one concept `dish` (Decision 2).
- One request returns every dish and every food region, so a tray needs exactly two SAM requests.

## Goals / Non-Goals

**Goals:**
- Tray reads mirror photo reads: fixed request counts per path, pure geometry between SAM and Spark, and degradation to Spark-only without retries.
- One read shape that every consumer (form, bed review, read log) uses unchanged, with `items` and `fluids` kept for older consumers.
- A meal's proof holds what was photographed (the hash), what the model said (evidence, bound to that hash), and what staff confirmed and who. Once saved, the database itself refuses to change the evidence or the proof.
- Geometry is pure and unit-testable without HTTP. Request counts are asserted with the real client over a fake `fetch`.

**Non-Goals:**
- Volume or nutrient estimation from masks.
- Server-trusted reads (a read id). See "Overlaps", read-outcomes.
- Correcting a saved meal (deferred with "Amend a meal").

## Types (`packages/shared`)

`@meniscus/meta` does not change: `segment()` already takes `maskEncoding: 'one_bit'`, and `decodeMaskToRaster` is exported.

```ts
// ---------- tray reading ----------

/** What a dish on a tray is charted as. Matches the external tray dataset's `expected_items[].dish_kind`. */
export const DISH_KINDS = [
  'rice', 'bread', 'dal_lentils', 'curry_vegetables', 'meat_fish_egg', 'soup_broth', 'porridge_cereal',
  'salad_raw', 'fruit', 'dairy', 'dessert_sweet', 'snack', 'other',
] as const
export type DishKind = (typeof DISH_KINDS)[number]

/** Fluids served with a meal: the drinkable subset of FLUID_KINDS (the dataset's `expected_fluids[].fluid_kind`). */
export const MEAL_FLUID_KINDS = ['water', 'tea', 'juice', 'milk', 'soup', 'other'] as const satisfies readonly FluidKind[]
export type MealFluidKind = (typeof MEAL_FLUID_KINDS)[number]

/** Where a dish's portion came from. `model`: Spark's estimate. The deferred served comparison adds `measured`. */
export const PORTION_BASES = ['model'] as const
export type PortionBasis = (typeof PORTION_BASES)[number]

/** Dish regions kept per tray photo (the largest). */
export const MAX_TRAY_REGIONS = 12
/** Mask cells on the longer side, at most: 32 × 32 bits = 128 bytes = 172 base64 characters. */
export const MASK_GRID = 32
/** Warnings a read returns and a meal keeps, at most, and their length. */
export const MAX_READ_WARNINGS = 6
export const MAX_WARNING_CHARS = 200

/** One-bit mask on a `width` × `height` grid over a box: row-major, most significant bit first, zero-padded to a byte, base64. */
export interface MaskBits {
  width: number
  height: number
  bits: string
}

/** One dish SAM found on a tray photo. The box is in source pixels, half-open. */
export interface TrayRegion {
  /** 1-based: by box centre left to right, then top to bottom, then larger first. */
  index: number
  box: SegmentBox
  /** Food on the dish's own pixels / the dish's own pixels, 0..1, 3 decimals. */
  coverage: number
  /** The dish's own mask, and the food on it, on the same grid. */
  mask: MaskBits
  food: MaskBits
}

export interface TraySegmentation {
  regions: TrayRegion[]
  /** Food pixels outside every dish / all food pixels, 3 decimals; null when SAM found no food. */
  loose_food: number | null
}

/** A dish as saved and charted. `index` 0: not in a segmented region. */
export interface DishValue {
  index: number
  name: string
  dish_kind: DishKind
  portion: Portion
}

/** A dish as read: the value, plus where it came from. */
export interface MealDish extends DishValue {
  basis: PortionBasis
  /** The region's box and coverage; null for index 0. */
  box: SegmentBox | null
  coverage: number | null
}

export interface MealFluid {
  index: number
  name: string
  fluid_kind: MealFluidKind
  volume_ml: number
}

/** CHANGED: + dishes; fluids gain index and fluid_kind. */
export interface MealReading {
  /** The dishes' names and portions, for consumers written before dishes. */
  items: { name: string; portion: Portion }[]
  dishes: MealDish[]
  portion: Portion
  fluids: MealFluid[]
  confidence: number
  issues: MealIssue[]
  notes: string | null
}

/** CHANGED: + dishes. */
export interface MealDraft {
  portion: Portion
  items: string
  fluid_ml: number | null
  dishes: DishValue[]
}

/** CHANGED. `POST /api/ai/meal`: exactly 3 requests in `sam+spark` mode, exactly 1 in `spark` mode. */
export interface MealReadResult {
  mode: ReadMode
  /** SHA-256 of the uploaded image bytes, lowercase hex. A saved meal's evidence must match its photo's `sha256`. */
  image_sha256: string
  reading: MealReading
  /** Null in `spark` mode or when SAM failed (see `warnings`). */
  segmentation: TraySegmentation | null
  draft: MealDraft
  needs_review: boolean
  /** At most MAX_READ_WARNINGS, each at most MAX_WARNING_CHARS. */
  warnings: string[]
  trace: CallTrace[]
  ms: number
}

/** CHANGED. Kept with a photo meal as the read returned it: client-reported, bounded, bound to its photo, never changed. */
export interface MealEvidence {
  mode: ReadMode
  /** Null only in meals saved before this change (normalised on read). */
  image_sha256: string | null
  reading: MealReading
  segmentation: TraySegmentation | null
  warnings: string[]
  trace: CallTrace[]
}

/** NEW: evidence as a meal post carries it, always bound to its photo. */
export type MealEvidenceInput = MealEvidence & { image_sha256: string }

/** CHANGED: + dishes; evidence is `MealEvidenceInput`. */
export interface MealInput {
  // …existing fields…
  evidence?: MealEvidenceInput | null
  dishes?: DishValue[]
}

/** The tray photo as the server found it when the meal was saved. */
export interface TrayPhotoProof {
  media_id: number
  sha256: string
  captured_by: StaffRef | null
  captured_at: string
}

/** Built by the server when a photo meal with evidence is saved; never changed. */
export interface MealProof {
  photo: TrayPhotoProof
  confirmed: { portion: Portion; items: string | null; fluid_ml: number | null; dishes: DishValue[] }
  confirmed_by: StaffRef | null
  confirmed_at: string
}

/** CHANGED: + dishes, proof. */
export interface Meal {
  // …existing fields…
  /** As saved. [] when none. */
  dishes: DishValue[]
  /** Null for a meal without evidence, and for meals saved before proofs were kept. */
  proof: MealProof | null
}

/** CHANGED: + sha256. */
export interface MediaRef {
  // …existing fields…
  /** SHA-256 of the stored bytes, lowercase hex; null for media kept before fingerprints. */
  sha256: string | null
}
```

## Decisions

### 1. Layers

| Module | Layer | What |
|---|---|---|
| `packages/meta` | transport | unchanged |
| `apps/server/src/hash.ts` (new) | pure | `sha256Hex(bytes)` over `node:crypto`, used by `readMeal` and `insertMedia` so both hash the same way |
| `apps/server/src/ai/tray.ts` (new) | domain, pure | `TRAY_DISH_CONCEPT`, `TRAY_FOOD_CONCEPT`, `toTrayMask(rec)`, `layoutTray(dishes, foods)`, `packMask`, `positionOf`, `coveragePercent`, `trayContext(seg)` |
| `apps/server/src/ai/meal.ts` | domain | Spark contract (`MealModelSchema`, `MEAL_JSON_SCHEMA`, `MEAL_SYSTEM`), `MEAL_BOUNDS`, `toMealReading`, `toMealDraft`, `mealNeedsReview`, `normaliseMealEvidence` (older rows). Imports nothing from `routes/` |
| `apps/server/src/ai/pipeline.ts` | domain orchestration | `readMeal({ image, mime, mode, signal })` |
| `apps/server/src/routes/ai.ts` | HTTP | `MealForm` with `mode` |
| `apps/server/src/routes/chart.ts` | HTTP | `MealBody` (dishes, evidence), the photo-hash check, the 48 KB limit |
| `apps/server/src/routes/evidence.ts` | HTTP | `MealReadingSchema` (moved from `ai/meal.ts`; only the meal route uses it) and `MealEvidenceSchema` (zod bounds for stored evidence), next to `PhotoEvidence`, over the shared `Box` and `MaskBits` validators. Takes the bounds from `ai/meal.ts` (`MEAL_BOUNDS`) and `packages/shared`, so `ai/` never imports `routes/` |
| `apps/server/src/store/store.ts` | data | columns, triggers, `migrateTray`, proof building, fingerprints |
| `apps/web/src/lib/tray.ts` (new) | web, pure | `decodeBits` (own base64, no `@meniscus/meta`), overlay geometry, labels, proof rows, `fingerprint` |
| `apps/web/src/lib/meals.ts` | web | the form with dishes, `toMealInput` |
| `apps/web/src/components/*` | web | overlay, form rows, lazy proof, fingerprint |

### 2. SAM concepts and masks

- **Concepts.**
  - Dishes use `dish`, one noun phrase that covers plates, bowls, cups and katoris. `plate or bowl or cup` is out (see the docs table).
  - Food uses `food`.
  - Both are named constants in `ai/tray.ts`. Prompts are never tried in a loop. A change (for example `bowl`) is a one-line edit plus a spec delta, decided by the user-approved live check (tasks.md group 11) or a later eval.
- **Encoding.** `maskEncoding: 'one_bit'`, the documented smallest payload. A tray returns many instances, and we downsample to 32 × 32 anyway. The container read keeps `lossless`.
- **Confidence.** `includeConfidence` stays true (client default). The box confidence is kept on `TrayRegion.box.confidence`, as for containers. Coverage does not weigh by it.

### 3. Pipeline and request counts

```
tray ─► SAM(dish) ┐   (Promise.allSettled, dish started first)
        SAM(food) ┴► layoutTray() ─► trayContext() ─► Spark(meal read: image + context) ─► toMealReading ─► draft + review gate
```

- **`allSettled`** so both SAM requests finish before Spark. An abort or a `MetaBudgetError` in either is rethrown after both settle, and Spark is not called. Any other error (an upstream `MetaApiError`, 429 included, or a network error) degrades to Spark-only with `segmentation unavailable: <message>`.
- **Upstream 429 vs local budget.** An upstream SAM 429 is an upstream answer: the read degrades and still sends Spark (3 requests). A local budget refusal means no slot is left: the read fails with 429 `request_budget_exceeded` and sends no Spark request.
- **Budget spent.** `dish` is started first, and the budget slot is taken synchronously (`transport.ts:51`). With 1 slot left, `dish` is sent and `food` is refused locally: exactly 1 upstream request, then 429.
- **Spark** gets the image once (one `input_image`, `detail: high`) and a strict JSON schema.
- **`image_sha256`** = `sha256Hex(input.image)`, computed in `readMeal` before any request, over the same bytes the route received.
- **Warnings** are cut to `MAX_WARNING_CHARS` (200) and at most `MAX_READ_WARNINGS` (6) are kept. The MVP produces at most one: `segmentation unavailable: …` or `segmentation found no dishes`.

| Case | SAM | Spark | Total upstream | Result |
|---|---|---|---|---|
| `mode: spark`, or no mode and `MEAL_USE_SAM=false` | 0 | 1 | exactly 1 | `segmentation: null` |
| `mode: sam+spark`, or no mode and `MEAL_USE_SAM=true` | 2 | 1 | exactly 3 | the segmentation; `segmentation found no dishes` when none |
| `sam+spark`, a SAM request fails upstream (503, 429, network) | 2 | 1 | exactly 3 | `segmentation: null`, `segmentation unavailable: <msg>` |
| `sam+spark`, Spark answers 429 | 2 | 1 | exactly 3 | 429 `rate_limit_exceeded` with `Retry-After` |
| `spark`, Spark answers 429 | 0 | 1 | exactly 1 | the same |
| `sam+spark`, local budget has 1 slot | 1 (`dish`) | 0 | exactly 1 | 429 `request_budget_exceeded` |
| `sam+spark`, cancelled during SAM | ≤ 2 | 0 | ≤ 2 | the read fails (abort) |

Trace steps: `sam:dish`, `sam:food` and `spark:meal`, each under the 32-character `Trace.step` bound. The web's `STEP_LABEL` gains the two SAM steps. A failed SAM request leaves no trace step: `traceOf` needs a response, as for photo reads. A stored trace therefore has at most 3 steps.

### 4. Config: `MEAL_USE_SAM` rather than reusing `READ_USE_SAM`

`MEAL_USE_SAM: z.stringbool().default(true)` in `config.ts` and `.env.example`, plus a per-request `mode`.
- **Why not reuse `READ_USE_SAM`?**
  - Container SAM is proven: it is the photo read's accuracy aid, with an eval protocol. Tray SAM is new and unmeasured.
  - One flag would force a choice: turning tray SAM off to save credits (3× per tray) would also turn off the container read's grounding.
  - Two flags cost one line of config. The per-request `mode` lets tests and a later eval compare both modes.
- **Tests.** `createAi(ports, opts = { mealUseSam: config.MEAL_USE_SAM })`, so the "SAM switched off" scenario needs no env juggling.

### 5. `layoutTray(dishes, foods)` (pure)

Input: `TrayMask = { bounds: Box; width; height; raster: Uint8Array; confidence? }`, from `toTrayMask(rec)` = `decodeMaskToRaster(rec.mask)` plus `rec.bounds`.

- `inMask(m, x, y)` is true when `x ∈ [l, r)`, `y ∈ [t, b)` and `raster[⌊(y−t)·H/(b−t)⌋·W + ⌊(x−l)·W/(r−l)⌋] = 1`.
- `area(m)` = ones × `(r−l)/W` × `(b−t)/H` px².

Steps:
1. **Candidates.** Dishes with `area ≥ MIN_DISH_PX` (400 px², a 20 × 20 crumb is noise). Keep the `MAX_TRAY_REGIONS` (12) largest.
2. **Sampling grid.** Sample at pixel centres `(x + ½, y + ½)` with step `s = max(1, ⌈√(|U| / 40 000)⌉)` px over U, the bounding box of the kept dishes and all foods. That is about 40,000 samples: s = 1 for small test fixtures, so results are exact; s = 6 for a full 1280 × 960 tray.
3. **Ownership.** `owner(p)` is the kept dish of smallest `area` whose mask contains p, so a bowl on a plate owns its pixels. A tray returned as a "dish" owns only what lies on the tray outside the dishes. `food(p)` is true when any food mask contains p (a union, so overlapping foods count once).
4. **Counts.** `own(d) = #{p : owner(p) = d}`, `fed(d) = #{p : owner(p) = d ∧ food(p)}`, `loose = #{p : food(p) ∧ no owner}`, `foodAll = #{p : food(p)}`.
5. **Coverage.** `coverage(d) = round3(fed / own)`. A dish with `own(d) = 0` (hidden entirely under smaller dishes) is dropped. `loose_food = foodAll ? round3(loose / foodAll) : null`.
6. **Index.** Sort by box centre x ascending, then centre y ascending (top to bottom), then area descending (larger first). Index = position + 1. "Bowl on a plate": the centres tie, so the larger plate is 1. "One above the other": same centre x, so the upper dish is 1.
7. **Masks.** `packMask`: `g = min(1, MASK_GRID / max(bw, bh))`, `gw = max(1, round(bw·g))`, `gh = max(1, round(bh·g))`. Cell (i, j) is sampled at `(l + (i+½)·bw/gw, t + (j+½)·bh/gh)`. `mask` bit = `inMask(d)`, and `food` bit = `owner = d ∧ food`. Bits are row-major, MSB first, padded to a byte, base64 with padding. A 120 × 90 box gives 32 × 24 cells: 96 bytes, 128 characters.
8. **Positions** (Spark text only). Thirds of the bounding box of all region boxes (0.5 when it has no extent): column `left` / `centre` / `right`, row `top` / `middle` / `bottom`. Middle and centre → `centre`; middle → the column; centre → the row; otherwise `<row> <column>` (`top left`). A single region is `centre`.
9. **Percent** (Spark text only). `coveragePercent(c) = ⌊(round(c × 1000) + 5) / 10⌋`, integer arithmetic on the 3-decimal coverage, so halves round up and float error cannot flip them: 0.125 → 13, 0.995 → 100 (where `Math.round(0.995 × 100)` would give 99), 0.004 → 0.

The spec scenarios ("Dish coverage") are exact with s = 1. For example, two foods `0–60 × 0–100` ∪ `40–100 × 0–50` = 6000 + 2000 = 8000 of 10000 → 0.8.

### 6. Spark contract and draft mapping

- **Model output.** It is strict JSON. String enums use sentinels, with no nullable enum and no `pattern`, as `reading.ts` and `meal.ts` do. `notes` stays the existing nullable string.

  ```jsonc
  {
    "dishes": [{ "region": 0, "name": "rice", "dish_kind": "rice", "eaten": "half" }],   // region: integer ≥ 0, 0 = in no listed region
    "eaten": "half",                                                                   // none | quarter | half | three_quarters | all
    "fluids": [{ "region": 2, "name": "tea", "fluid_kind": "tea", "volume_ml": 150 }],  // fluid_kind: MEAL_FLUID_KINDS, sentinel "other"
    "confidence": 0.82, "issues": [], "notes": null
  }
  ```

  `dish_kind` uses `DISH_KINDS`, with sentinel `other`. `region` uses `{ type: 'integer', minimum: 0 }`, the same keyword `volume_ml` already uses.
- **System prompt.** `MEAL_SYSTEM` keeps its method and its neutrality line, and adds:
  - name each food once, with its dish number;
  - pick the nearest `dish_kind`;
  - a cup or glass holding a drink goes under `fluids` with its number, not under `dishes`;
  - soup or dal eaten from a bowl is a dish (`soup_broth`, `dal_lentils`); list it also under fluids only if it was drunk as a liquid;
  - coverage is the share of the dish still covered by food: near 0 means mostly eaten or never served, and coverage cannot tell which.
- **Context** (`trayContext`; `MEAL_PROMPT` alone in `spark` mode, or when segmentation is null or has no regions):

  ```
  Read this meal tray.
  Segmentation found these dishes (pixels; place on the tray; share of the dish still covered by food):
  Dish 1: x 211–271, y 228–255, centre, food covers 0%.
  Food outside the dishes: 12% of the food seen.
  Use dish numbers from this list, or 0 for food in none of them.
  ```

- **Mapping** (`toMealReading(model, seg)`, pure):
  - A region outside `1..regions.length`, or any region when `seg` is null, becomes 0.
  - Dishes: the first 20, names trimmed and cut to 80 characters, empty names dropped. Each gets the region's box and coverage (null for 0), `portion = PERCENT[eaten]` and `basis: 'model'`.
  - Fluids: the first 10, `volume_ml ≤ 5000`.
  - `items` = the dishes' `{ name, portion }`.
  - A region cited only by fluids never becomes a dish, because dishes come only from `model.dishes`.
- **Draft.** `{ portion: PERCENT[eaten], items: names joined ", " cut to 200, fluid_ml: sum or null, dishes: DishValue[] }`.
- **Review gate.** `mealNeedsReview` is unchanged: confidence < 0.75 or any issue. Segmentation warnings are shown, but do not force review, as for photo reads.

### 7. Dish vocabulary

`DISH_KINDS` copies the dataset's 13 labels verbatim, so a later eval compares strings. The web's `DISH_LABEL`:

| Kind | Label |
|---|---|
| `rice` | Rice |
| `bread` | Bread |
| `dal_lentils` | Dal / lentils |
| `curry_vegetables` | Curry / vegetables |
| `meat_fish_egg` | Meat, fish, egg |
| `soup_broth` | Soup / broth |
| `porridge_cereal` | Porridge / cereal |
| `salad_raw` | Salad |
| `fruit` | Fruit |
| `dairy` | Dairy |
| `dessert_sweet` | Dessert / sweet |
| `snack` | Snack |
| `other` | Other |

`MEAL_FLUID_KINDS` is a `satisfies readonly FluidKind[]` subset. A meal fluid can never be urine or drain fluid.

### 8. Proof, fingerprints and the store

- **Schema.** New files get it in the `SCHEMA` DDL. Older files get it from `migrateTray(db)`, idempotent through `addColumns`, run after `migrateCare` (and after `migrateBags` if bag-emptying lands first):
  - `media`: `sha256 TEXT`;
  - `meal`: `dishes TEXT` (JSON `DishValue[]`, NULL reads as `[]`), `proof TEXT` (JSON with the staff ids and epoch ms);
  - the triggers below, `CREATE TRIGGER IF NOT EXISTS`.
- **Fingerprint.** `insertMedia` stores `sha256Hex(bytes)` of the stored bytes, the same bytes `GET /api/media/:id` serves. `toMediaRef` and `MEDIA_JSON` return it.
- **No backfill: older media return null.**
  - A hash computed when the store opens would claim an integrity check that never happened at upload. It would attest to the bytes as they are now, possibly after a migration (the old `photo` table move) or a restore.
  - Null is honest, and the web says "Fingerprint not recorded".
  - Hashing every blob at open would also slow startup on a large store.
  - The demo store is rebuilt by `scripts/demo-history.ts` through `addMedia`, so every demo photo has a fingerprint.
- **Binding evidence to its photo** (charting/meals "Tray evidence bound to its photo"; 0 model requests). In the meal route, after the existing media check (`badMedia`): when `evidence` is sent, `media_id` must be sent too, and `evidence.image_sha256` must equal that media's `sha256`. Otherwise 400 `invalid_request` at `evidence.image_sha256`. Media stored before fingerprints (`sha256: null`) never matches, so it cannot carry new evidence; it can still be linked without evidence. The web posts the same blob it read (`meal-form.tsx:75`), so the hashes match in normal use.
- **Saving a photo meal with evidence** (one transaction):
  1. read the media row and build the proof: `photo = { media_id, sha256, captured_by: media.created_by, captured_at: media.created_at }`, `confirmed` = the posted portion, items, fluid mL and dishes, `confirmed_by` = the session staff, `confirmed_at` = `recorded_at`;
  2. insert the meal with `dishes`, `evidence` and `proof` in the one INSERT;
  3. insert the fluid entry as today.

  The proof is built from server rows and the request's own values. The client cannot set it. A meal without evidence (by hand, or a photo meal whose upload failed) stores `proof` NULL.
- **Immutability by the database.** Code never updates the evidence or the proof, and SQLite enforces it:

  ```sql
  CREATE TRIGGER IF NOT EXISTS meal_evidence_fixed BEFORE UPDATE OF evidence, proof ON meal
  BEGIN SELECT RAISE(ABORT, 'meal evidence and proof cannot change'); END;
  ```

  `UPDATE OF` fires only when a statement's SET names one of the two columns, so the void (`store.ts:946`) is unaffected. No `meal_event` table exists in the MVP (amend is deferred); when it arrives it gets triggers refusing UPDATE and DELETE.
- **Void** (live charting/media "Media goes with its record", unchanged). Voiding sets `media_id = NULL` and deletes the photo if nothing else links it. Only the bytes go: the meal row, its evidence (masks included) and its proof (media id and `sha256`, not bytes) stay. The web shows `Photo deleted · fingerprint 3f2a…c9` from the proof.
- **Older meals.** `toMeal` reads NULL `dishes` as `[]` and NULL `proof` as null. `normaliseMealEvidence` maps `{ reading: { items, fluids, … }, trace }` to the new shape on read:
  - mode `spark`, `image_sha256` null, segmentation null, warnings `[]`;
  - dishes from items, with index 0, kind `other`, basis `model`, no box and no coverage;
  - fluids with index 0 and kind `other`.

  The stored JSON is not rewritten (the trigger would refuse it anyway).
- **Size.** The 64 KB limit was sized for two photos. Re-estimated for one photo, by serialising a worst-case meal post (12 regions with two 172-character masks, 20 dishes and 20 items with 80-character names, 10 fluids, 300-character notes, 6 warnings of 200 characters, 3 trace steps, `image_sha256`, 20 posted dishes, 200-character items):
  - ASCII names: evidence 17.3 KB, body 20.7 KB;
  - names and notes in a 3-byte UTF-8 script (Devanagari): evidence 25.9 KB, body 32.9 KB.

  16 KB is too small and 32 KB is just short, so the meal post's limit becomes **48 KB** (`bodyLimit`, 413 `payload_too_large`, as the media route), about 1.5× the worst case. Other JSON routes keep `smallJson()`.

### 9. HTTP surface

- **`POST /api/ai/meal`.** `MealForm = { image, mode?: READ_MODES }`. An unknown `mode` is 400 before any model call. The response is `MealReadResult` with `image_sha256`.
- **`POST /api/admissions/:id/media`.** The 201 body gains `sha256` (charting/media "Upload media", MODIFIED). The route itself is unchanged; `toMediaRef` adds the field.
- **`POST /api/admissions/:id/meals`.**
  - `dishes` (≤ 20 `DishValue`), on any meal.
  - `evidence: MealEvidenceSchema`. It is strict: `mode`, `image_sha256` (64 lowercase hex), trace ≤ 3, regions ≤ 12, `MaskBits` `width`/`height` 1–32 and `bits` base64 ≤ 172 characters of exactly `⌈w·h/8⌉` bytes, coverage 0–1, warnings ≤ 6 of ≤ 200 characters, `basis` in `PORTION_BASES`.
  - The existing media check (`badMedia`), then the photo-hash check (§8).
  - The body limit is 48 KB.

### 10. Web

- **Meal form** (`components/meal-form.tsx`, `lib/meals.ts`):
  - `MealForm` gains `dishes: DishValue[]`. `formFromRead` takes `read.draft.dishes`.
  - With dishes, the items field is replaced by dish rows: number, name input, a native `<select>` of `DISH_LABEL` (light on low-end Android) and portion chips. `toMealInput` sends `dishes`, `items` = names joined and cut to 200, and `evidence = { mode, image_sha256, reading, segmentation, warnings, trace }`.
  - `saveMeal` drops `evidence` (keeping `dishes`) when `linkMedia` returns no `media_id`, so a failed upload still saves the meal with the existing "photo was not kept" warning instead of a 400.
  - The preview becomes `CapturedSource` with the tray overlay (labels from the form's dishes).
  - `api.readMeal` is unchanged: the web sends no `mode`, so the server's `MEAL_USE_SAM` decides.
- **Overlay** (`components/evidence.tsx` `TrayOverlay`, `lib/tray.ts`):
  - `decodeBits(MaskBits)` → `Uint8Array`, with the web's own base64 decoding (`atob`). The web never imports `@meniscus/meta` or `@meta-sam/parser` (import boundary); it only reads the packed masks the server stored.
  - `maskRects(region, w, h)` merges each row's runs of set cells into percent rects (cell width `bw/gw`). It draws `<rect>`s in the existing `viewBox="0 0 100 100"` SVG.
  - Labels are HTML, absolutely placed at the box's top left in percent, one line per dish or fluid in that region.
  - `PhotoSource` gains `tray?: { segmentation, dishes, fluids }` and `sha256?: string | null`. `outlineDefault` is true when there are regions. The full-screen view gets the same overlay.
- **Proof** (`components/tray-proof.tsx`, lazy, inside "What the AI read" above its existing lines; `lib/tray.ts` `proofView(meal)`). The live "Meals on the bed review" lines stay: `aiReadLines` items, fluids and the model steps, now with the SAM steps. For a meal with `proof: null` only those lines and the photo show.
  - the photo card: a `PhotoSource` with the overlay of `evidence.segmentation`, the line `Tray photo · HH:MM · <short name>` and the fingerprint. When `meal.media` is null (voided) it reads `Photo deleted · fingerprint …` and fetches nothing;
  - dish rows: `<index> <name> · <kind> · AI <portion> · saved <portion>`, matching read dishes and confirmed dishes by index, then by order;
  - `Saved by <short name> · HH:MM`.
- **Fingerprint.** `fingerprint(sha256)` gives `3f2a…c9` (first 4 and last 2 hex) or null. `SourceView`, `BeforeAfter`, `VoiceSource` and the proof show `Photo fingerprint: …` or `Recording fingerprint: …`, with `title` set to the full value, or `Fingerprint not recorded`.
- **Budget.** The proof is a lazy chunk. The overlay code joins `source-view`'s lazy chunk. The Meal form gains a few KB in the attendant bed route, so it is checked against the 50 KB route budget in the build.

### 11. Demo (`scripts/demo-history.ts`, `scripts/synthetic-photo.ts`)

- `trayPhoto(portion, seed)` already draws a plate (centre 470,480, r 250), a bowl (930,380, r 150) and a cup (950,700, r 92) with leftovers in proportion.
- A new `trayMasks(portion, seed)` returns `TrayMask`s of the same circles and food blobs. The demo runs the real `layoutTray` on them, so outlines match the drawing.
- Each demo photo meal's evidence gets `image_sha256` = the hash of the photo it uploads, so the binding check passes through the real route rules. Dish kinds come from the menu: idli → `porridge_cereal`, sambar → `dal_lentils`, banana → `fruit`, …
- Demo reads are labelled made up, as today. All of it goes through `store.addMedia` / `addMeal`, so fingerprints and proofs are real. No model request.

### 12. Privacy and logging

- No new log line anywhere. The pipeline logs nothing. `model-api.ts` `onRequest` logs the method, path, model, status and timing only. Masks, coverage, dish names, hashes and photos are DB-only, returned only by the chart routes.
- `store: false` is the client default for every Responses request, SAM included. The fake upstream records every SAM and Spark body, and server tests assert `store: false` on all 3.
- Trays are photographed without faces or tickets (the dataset's rules). Nothing about the tray goes to SAM or Spark beyond the image.

## Risks / Trade-offs

- **[`dish` misses cups or katoris, or returns the tray or food heaps as "dishes"]** → Ownership by the smallest dish makes a tray-as-dish harmless (it owns only the tray surface). Spark may leave a region unnamed, and an unnamed region is drawn without a label. The concept is one constant. The user-approved live check (tasks.md 11.1) is the gate; there is no live prompt search.
- **[`food` may not cover liquids (dal, soup, tea)]** → Coverage then under-reports bowls of soup. Spark still reads the image, and staff confirm every value.
- **[Coverage is area seen from above, not volume]** A deep bowl at half depth can look full. → The nurse sees the overlay, and staff confirm every value.
- **[`one_bit` masks not exercised live yet]** Our fixture is `lossless`. The parser supports both markers. → The live check (11.1) confirms it before the demo; switching back is a one-line change.
- **[Docs silent on `store` for SAM]** → We send `store: false` anyway; the client default is unchanged. Recorded here for the organisation's zero-data-retention review.
- **[Evidence is client-reported]** A client with a session could post an invented reading for a real photo. → The hash binds the evidence to the stored bytes, and the proof's server-built parts (hash, who and when, confirmed values) cannot be forged that way. Server-trusted evidence would follow read-outcomes' read log (see Overlaps).
- **[A photo stored before fingerprints cannot carry evidence]** Only within the 24 h unlinked window across the deploy. → The meal saves without evidence; acceptable for the demo.
- **[Credits]** A tray costs 3× in `sam+spark`. At 120 requests per hour, that is 40 trays per process hour. → `MEAL_USE_SAM=false` turns tray SAM off without a deploy. Counts are in the spec.
- **[Latency]** One SAM round before Spark adds about 1 s. → The two SAM requests run in parallel. The form shows "Reading the tray…" and can be cancelled.
- **[Older cached PWA posts old-shape evidence]** → 400 until the app reloads. Acceptable for the demo, and the error is shown.

## Overlaps with in-flight changes

Order: `care-plan` archived; `bag-emptying` archived first if it is ready (its proposal orders it before this change); then this change; then `scale-acuity` and the tray follow-ups of `read-outcomes`. `dietitian` has no ordering with this change.

- **`care-plan`** (being applied).
  - Shared files: `packages/shared/src/index.ts`, `store.ts` (`migrateCare` precedes `migrateTray`), `components/meal-form.tsx` (its nil-by-mouth warning and `Save anyway` must survive the dish rows), `components/meals.tsx` (its `During NBM` badge stays on the row), and the Meal fixtures in `apps/server/src/chart/care.test.ts` (which gain `dishes: []`, `proof: null`).
  - No requirement is edited by both changes.
- **`bag-emptying`** (proposed; orders itself before this change).
  - Both edit `store.ts`: its `migrateBags` adds `level` columns. Run `migrateTray` after `migrateBags`.
  - It edited `UNLINKED` (`store.ts:796`) for its after-emptying photo (archived). This MVP does not edit `UNLINKED`; the deferred served photo will add a `meal.served_media_id` clause, which must be merged with bag-emptying's clause into one `UNLINKED`.
  - Both edit `scripts/demo-history.ts` (its bag beds, this change's tray masks): a textual merge.
  - It relies on `media.sha256` from this change for its proof photos ("arrives with tray-segmentation and applies to these photos unchanged"). If bag-emptying archives first, its photos get fingerprints once this change lands, with no change on its side; its photos stored before then return `sha256: null`.
  - No requirement is edited by both changes.
- **`image-synthesis`** (proposed).
  - It edits `scripts/eval.ts`. This MVP no longer touches `eval.ts` (the tray eval is deferred), so there is no merge now.
  - Its proposal (line 30) and its `AGENTS.md` task still say "meal tray photo 1". Whichever lands second updates that wording to "meal tray photo 3, or 1 in Spark-only mode"; this change edits `AGENTS.md:52` (tasks.md 5.5).
- **`scale-acuity`** (proposed; applies after this change). It keys media files by `sha256`; the photo-hash check and the proof read `media.sha256` either way. Its text predates this MVP and has three gaps to close when it rebases on this change's archived text:
  - **Budget spent.** Its `capture/read-budget` "Whole action admitted up front" admits or refuses a tray read's every request before the first is sent, and "Tray read mode by acuity" reads in `spark` mode when only 1 fits. Either way this change's "Tray segmentation degrades: Budget spent" (1 slot left: SAM `dish` sent, then 429 `request_budget_exceeded`, `requests` exactly `['sam:dish']`) no longer holds. Its design §8 says the scenario "still holds and gets stronger: 0 SAM spent"; it does not hold, because the request list and the response change.
  - **Deferred path and a bed on `/api/ai/meal`.** `read-budget` counts a tray read as 5, 3 or 1 ("Whole action admitted up front", "Tray read mode by acuity", and "Unsent requests returned", a served-photo read admitted for 5 that sends 3), and "Trays under pressure" posts trays for 3A bed 4 and HDU bed 1. This MVP has neither the 5-request served path (deferred) nor a bed on `/api/ai/meal` (`MealForm` is `{ image, mode? }`, and read-outcomes leaves it unchanged). scale-acuity must count 3 or 1, drop the served-photo scenario, and define the bed on `/api/ai/meal` itself (404 before any model request) or wait for the deferred follow-up. Its tray row ("3 (5 with a served photo) / 1") drops the 5.
  - **`MediaRef.sha256` narrowed to `string`.** Its MODIFIED "Media fingerprint" makes `sha256` never null, which breaks this change's null case: the `sha256: null` fixtures (tasks.md 1.3), the "Media from before fingerprints" scenario (which it already MODIFIES), and web/ward "Media fingerprint shown: Older recording" (`Fingerprint not recorded`).

  So, after this change archives, scale-acuity must MODIFY `capture/meal-reading` "Tray segmentation degrades" (the budget refusal and its Budget spent scenario) and `web/ward` "Media fingerprint shown" (no null branch, no Older recording), and retype the null fixtures.
- **`read-outcomes`** (proposed; trays deferred there too).
  - Its "Deferred to a follow-up after tray-segmentation archives" assumes `admission_id` on `/api/ai/meal`, a 5-request served path and `meal_event`. None are in this MVP: its follow-up must define `admission_id` itself, state counts of 3 (`sam+spark`) and 1 (`spark`), and not rely on meal amendments.
  - A tray read row may take `dish_kind`, `basis`, `fluid_kind` and `mode` from `MealReadResult`. It must not copy masks, boxes or hashes into the read log.
  - If its follow-up keeps reads server-side, a later change can have meals link `read_id` and make the tray evidence server-trusted.
  - It has no tray delta now (it MODIFIES no `capture/meal-reading` requirement), and its eval flag is `--container-labels`, named apart from the deferred tray eval's `--manifest … --trays`.
- **`dietitian`** (proposed). No dependency either way, so no archive order: it shows the bed review's existing meals, with no dish list, no `DISH_LABEL` and no overlay, and it makes no tray-read change. Both edit `packages/shared`, `store.ts` `SCHEMA`, `scripts/demo-history.ts` and `web/ward`'s delta (different requirements): textual merges.

## Migration Plan

1. Deploy server and web together. On open, `migrateTray` adds the columns and the trigger: additive and idempotent, with no data rewritten.
2. Older meals and media read through the normalisers (`Older meals read as dishes`; `sha256: null`).
3. `MEAL_USE_SAM` defaults to true. Set it to false to return tray reads to 1 request without a deploy.
4. Rollback: older code ignores the new columns. The trigger stays and refuses only UPDATEs of `evidence` or `proof`, which older code never issues. New-shape evidence passes through the older `toMeal` unchanged (cast, not validated).
5. No live model request is needed to deploy. The pre-demo live check is one read of 3 requests, run by the user (tasks.md 11.1).

## Deferred

Cut for the deadline. A follow-up change adds them on this change's archived text:

- `capture/meal-reading`: **Served and collected trays**, **Served photo comparison degrades** (served photo lookup, `admission_id` and `meal` on `/api/ai/meal`, `compareTrays`, the 5-request path, `measured` basis).
- `charting/meals`: **Served tray photo**, **Served photo linked to the meal**, **Amend a meal**, **Meal amendments need a nurse** (`media.served_meal`, `meal.served_media_id`, `meal_event` with UPDATE/DELETE-refusing triggers, `POST /api/meals/:id/amend`).
- `charting/media`: MODIFIED **Media goes with its record** for the served photo, with the `UNLINKED` clause (merge with bag-emptying's).
- `web/capture`: **Served tray photo at the bed**.
- `web/ward`: **Amend a meal from the bed review**.
- The tray eval: `scripts/eval.ts --manifest … --trays`, `src/chart/tray-score.ts`, `docs/accuracy.md` "Trays".
- The 64 KB post limit, re-estimated at 48 KB for one photo (§8 "Size"); two photos would need it raised again.

## Open Questions

- Whether `bowl` beats `dish` as the dish concept for Indian thalis, and whether `food` catches dal and soup. The live check (one read, 3 requests) answers the basics; a deferred eval answers the rest. Changing either is a constant plus a one-line spec delta, since the spec names the concepts.
