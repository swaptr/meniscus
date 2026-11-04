# Design

## Context

Motivation is in proposal.md, "Why". This change applies after bag-emptying, tray-segmentation, read-outcomes, dietitian and acuity-budget are archived (§14). The state it builds on, as those changes leave it:

- **Tray read** (tray-segmentation, acuity-budget). `POST /api/ai/meal` runs `readMeal({ image, mime, mode, signal })` in `src/ai/pipeline.ts`:
  - SAM `dish` and SAM `food` on the photo with `Promise.allSettled`, then `layoutTray` → `TraySegmentation` (regions indexed by centre, each with `box`, `coverage` 0..1 in 3 decimals, `mask`, `food`);
  - `trayContext(seg)` adds one line per region to the Spark prompt (`Dish 1: x 211–271, y 228–255, centre, food covers 0%.`);
  - Spark returns dishes citing region indices (0 = none). `toMealReading` gives each dish `basis: 'model'` and its region's `box` and `coverage`.
  - The trace has at most 3 steps (`sam:dish`, `sam:food`, `spark:meal`). Warnings are at most 6 of at most 200 characters.
  - acuity-budget admits the whole action up front through `plan()` in `src/ai/budget-policy.ts` and a `Ticket`. A tray read has no bed and is always `routine` ("Classes at the routine ceiling").
- **Meal save** (tray-segmentation). `POST /api/admissions/:id/meals` (`src/routes/chart.ts:379`) takes `dishes`, `evidence` (`MealEvidenceSchema`, `src/routes/evidence.ts`) and `media_id`. It checks `evidence.image_sha256 === media.sha256` and builds `proof` (`TrayPhotoProof` + confirmed values). The body limit is 48 KB. The trigger `meal_evidence_fixed` refuses any UPDATE OF `evidence, proof`.
- **Media** (`src/store/store.ts`). `media` rows with `admission_id`, `kind`, `created_at`, `sha256` (tray-segmentation), `created_by`. `UNLINKED` (`store.ts:1008`) is the "no record links it" predicate shared by expiry and `gcMedia`; bag-emptying adds `level.proof_media_id` to it. `voidMeal` (`store.ts:1812`) sets `media_id = NULL` and calls `gcMedia`.
- **SAM gives no frame size.** `@meta-sam/parser` returns boxes and RLE masks in source pixels but not the image's width and height. Comparing two photos needs both, so the server reads them from the file headers.
- **Who can change a meal.** `requireDecider` (`src/routes/common.ts:80`) admits nurse and matron (`DECIDER_ROLES`). dietitian adds the `dietitian` role, outside `DECIDER_ROLES`.
- **Dataset** (`attend-realworld-dataset/manifest.jsonl`, checked 2026-11-04). 987 records: 179 `record_type: original` and 808 `record_type: augmented`. Among originals, 44 `food_tray` records plus `hard-041` (`hard_negative`, `expected_container: food_tray`, `expected_items: []`, `expected_issues: ["not_a_meal"]`) have `expected_items`. 270 augmented records have them too (264 `food_tray`, 6 `hard_negative`), and for 50 of those `expected_outcome_after` differs from `expected_outcome`. As read-outcomes does (its design "Out of scope": augmented variants are scored by the dataset's `tools/score_classification.py`), the tray eval takes labels only from `record_type: original` records and skips augmented ones. Of the 49 fluids on original tray records, 18 have `volume_ml_estimate: null` (kind known, mL unknown). `expected_items` is `[{ name, dish_kind, portion_eaten_pct }]`, with `dish_kind` exactly in `DISH_KINDS` and `portion_eaten_pct` 0 or null on real trays. `expected_fluids` is `[{ name, fluid_kind, volume_ml_estimate }]`, with `fluid_kind` including `none`. `pair` is null everywhere: there is no real served/collected pair. `generation/shortlist.jsonl` plans 15 `tray_pair_after` edits (`pair_id` such as `pair-tray-001`, `pair_role: after`, `source_id`, `intended_truth.expected_items`). image-synthesis writes them as `synth-<id>.<ext>` with a sidecar holding `labels` and `source_ids`. Its `Labels` schema (`apps/server/src/lab/synth.ts:37`) keeps `meal_portion_eaten` and `expected_outcome` at the top level of `labels`, beside the opaque `labels.truth`, `labels.pair_id` and `labels.pair_role`; the dataset's merge never copies `labels.truth` into the manifest (`docs/synthetic-images.md`). So a synthetic tray's dishes and fluids come from `labels.truth`, and its meal portion and outcome from `labels.meal_portion_eaten` and `labels.expected_outcome`, each unscored when absent. `eval/classify-trays-1` holds 23 tray photos (for example `other-0-tray-002.jpg`, `other-0-hard-041.jpg`).

## Goals / Non-Goals

**Goals**
- A served photo taken at the bed turns each matched dish's coverage into a measured portion, with integer maths that cannot drift.
- Every path has an exact request count: 3, 5 or 1, never retried, never looped. The plan and its reservation (5, 3 or 1) are fixed before the first request. A 5-request plan sends the served SAM pair only when the collected pair found at least one region; otherwise it sends 3 and returns the 2 unsent slots (§4).
- The served photo is bound into the meal's proof as the tray photo is, by id and fingerprint, with no model request at save.
- A nurse can amend a saved meal, and every amendment is kept in history the database refuses to change.
- A tray eval that scores trays and served/collected pairs from the dataset, as a dry run unless the user approves.

**Non-Goals**
- Spark seeing two images. It sees the collected photo and the served coverage as numbers (§8).
- Measuring the overall portion. It stays Spark's (`reading.portion`); only dish portions are measured.
- Segmenting the served photo at upload. Upload stays 0 requests (§4, alternatives).
- Caching a served segmentation across reads. Each compared read costs exactly 5 (§4, alternatives).
- Amending a meal's fluid (proposal "Out of scope").

## Decisions

### 1. Types first (`packages/shared/src/index.ts`)

```ts
/** CHANGED: + 'measured'. */
export const PORTION_BASES = ['model', 'measured'] as const
export type PortionBasis = (typeof PORTION_BASES)[number]

/** A served photo is looked for at or after now − SERVED_TRAY_HOURS. */
export const SERVED_TRAY_HOURS = 4
/** Largest squared centre distance that can match, in thousandths² (200 thousandths). */
export const MATCH_MAX_DISTANCE = 40_000
/** Smallest served coverage that can be measured against, in thousandths. */
export const MIN_SERVED_COVERAGE = 150
/** CHANGED from 3: two more SAM steps on the served photo. */
export const MAX_TRACE_STEPS = 5

/** Pixel size read from the file header. */
export interface ImageSize { width: number; height: number }

/** One collected region matched to one served region. */
export interface RegionMatch {
  index: number        // collected region, 1-based
  served_index: number // served region, 1-based
  distance2: number    // squared centre distance, thousandths², 0..MATCH_MAX_DISTANCE
}

/** The served photo a tray read compared with. Present whenever a served photo was found, unless it holds the collected photo's own bytes (§3). */
export interface TrayComparison {
  served_media_id: number
  /** SHA-256 of the served bytes the server read, lowercase hex. Must equal the media's `sha256` at save. */
  served_sha256: string
  served_at: string // the served media's created_at, ISO
  /** Null when not compared: spark mode, budget, no collected regions, unreadable size. */
  size: ImageSize | null
  served_size: ImageSize | null
  /** Null when not compared or the served SAM failed; { regions: [], loose_food: null } when it found nothing. */
  served: TraySegmentation | null
  /** At most MAX_TRAY_REGIONS; [] when not compared. */
  matches: RegionMatch[]
}

export interface DishMeasure {
  served_index: number
  served_coverage: number // 0..1, 3 decimals
}

/** CHANGED: + model_portion, measure. */
export interface MealDish extends DishValue {
  basis: PortionBasis
  box: SegmentBox | null
  coverage: number | null
  /** Spark's portion, always; equals `portion` when basis is 'model'. */
  model_portion: Portion
  /** Non-null exactly when basis is 'measured'. */
  measure: DishMeasure | null
}

/** CHANGED: + comparison. Same in MealEvidence. */
export interface MealReadResult { /* …tray-segmentation's fields… */ comparison: TrayComparison | null }
export interface MealEvidence { /* …tray-segmentation's fields… */ comparison: TrayComparison | null }

/** CHANGED: + served_media_id. */
export interface MealInput { /* … */ served_media_id?: number }

/** CHANGED: + served (same shape as photo). */
export interface MealProof { photo: TrayPhotoProof; served: TrayPhotoProof | null; /* … */ }

/** The values a meal amendment may change. */
export interface MealValues { portion: Portion; items: string | null; dishes: DishValue[] }

export interface MealAmendment {
  id: number
  at: string
  by: StaffRef | null
  reason: string
  before: MealValues
  after: MealValues
}

/** `POST /api/meals/:id/amend`. `items` is refused with `dishes`, and on a meal that has dishes. */
export interface AmendMealInput { portion?: Portion; items?: string; dishes?: DishValue[]; reason: string }

/** CHANGED: + served_media, amendments, amended_at. */
export interface Meal {
  /* … */
  served_media: MediaRef | null
  amendments: MealAmendment[] // oldest first
  amended_at: string | null
}

/** CHANGED: + served_meal. */
export interface MediaRef { /* … */ served_meal: MealKind | null }

/** `GET /api/admissions/:id/served-tray`: the bed's newest unlinked served photo of any meal in the window, or null. */
export interface ServedTray { media: MediaRef | null }
```

`TrayComparison` is the API's word "comparison" for a served photo *found*, compared or not. The web reads `served !== null` as "compared" (§13).

### 2. Layers

| Module | Layer | What |
|---|---|---|
| `src/ai/image-size.ts` (new) | pure | `imageSize(bytes, mime): ImageSize \| null` (§5) |
| `src/ai/compare.ts` (new) | pure | `servedCheck(image, mime, served)` → `'same_bytes' \| 'size_unknown' \| { size, served_size }` (§3, §4), `centreOf(box, size)`, `shareOk(a, sa, b, sb)`, `matchRegions(collected, size, served, servedSize)`, `quarters(S, N)`, `measureDishes(dishes, seg, served, matches)` (§6, §7) |
| `src/ai/tray.ts` | pure | `trayContext(seg, served?)` with `, served <p>%` (§8) |
| `src/ai/meal.ts` | domain | `toMealReading` sets `model_portion` and `measure: null` |
| `src/ai/pipeline.ts` | orchestration | `readMeal({ image, mime, mode, signal, served? })`, where `served` is `{ bytes, mime, check }` (`check` from `servedCheck`) or undefined; returns the comparison without media fields, or null for `same_bytes` |
| `src/ai/budget-policy.ts` | domain | `plan('tray', mode, class, budget, { served })` (§4) |
| `src/routes/ai.ts` | HTTP | `MealForm` + `admission_id`, `meal`; bed lookup (404/400), `store.servedPhoto`, the class, the comparison's `served_media_id` and `served_at` |
| `src/routes/media.ts` | HTTP | `served_meal` on the upload form |
| `src/routes/chart.ts` | HTTP | `MealBody.served_media_id`, binding checks (§10), 64 KB limit, `GET /admissions/:id/served-tray` (§3), `AmendMealBody`, `POST /meals/:id/amend` |
| `src/routes/evidence.ts` | validation | `MealEvidenceSchema` + `comparison`, `model_portion`, `measure`, `measured`, `MAX_TRACE_STEPS` |
| `src/store/store.ts` | storage | columns, `meal_event`, triggers, `UNLINKED`, `servedPhoto(admissionId, meal \| null, now)`, `addMeal`, `amendMeal`, `voidMeal`, `SCHEMA` and `STORE_SCHEMA_VERSION` (§11) |
| `src/chart/tray-lab.ts` (new) | pure | tray eval labels, pairs, scoring and report (§15) |

`@meniscus/meta` is unchanged: no new endpoint, and the budget and ticket are acuity-budget's.

### 3. Finding the served photo

The route, after validating the form and before planning:

1. No `admission_id`: no lookup, `routine` class, `comparison: null`. `meal` without `admission_id` is 400 (zod refine), 0 requests.
2. Unknown `admission_id`: 404 `not_found`, 0 requests.
3. With `meal`: `store.servedPhoto(admissionId, meal, now)` (`meal` null matches any served meal, for `GET /served-tray` below):

   ```sql
   SELECT media.* FROM media
   WHERE media.admission_id = ?1 AND media.kind = 'photo'
     AND (?2 IS NULL AND media.served_meal IS NOT NULL OR media.served_meal = ?2)
     AND media.created_at >= ?3            -- now − SERVED_TRAY_HOURS, inclusive
     AND ${UNLINKED}                        -- no entry, level, level proof, meal or meal served link
   ORDER BY media.created_at DESC, media.id DESC LIMIT 1
   ```

   The index `media_served ON media(admission_id, served_meal, created_at) WHERE served_meal IS NOT NULL` serves it. `admission_id = ?1` is the only way a bed enters the query, so another bed's photo is never found ("Wrong time, meal or bed"). At 13:30 the bound is 09:30: a photo at 09:30 is found and one at 09:29 is not.
4. The found row's bytes are loaded once (`store.mediaBytes`). `servedCheck(image, mime, served)` (pure) compares `sha256(image)` with the row's `sha256` first: equal is `same_bytes` ("Served photo with the same bytes"). Then it reads both header sizes (§5): either null is `size_unknown`. The pipeline gets `served: { bytes, mime, check }`. The route later adds `served_media_id` (the row id) and `served_at` (its `created_at`) to the pipeline's comparison, except for `same_bytes`, where the comparison stays null so the save cannot hit the "same bytes" refusal (§10).

**`GET /api/admissions/:id/served-tray`** ("Served tray of a bed") runs `store.servedPhoto(id, null, now)` and returns `{ media: toMediaRef(row) | null }`, 404 for an unknown admission, 0 model requests. The bed capture screen calls it once when Meal opens, to preselect the served photo's meal (§13). A lunch served at 14:30 and collected at 15:10 would otherwise preselect snack by time of day and send `meal: snack`, so the served lunch would never be found.

`admission_id` and `meal` never reach a port: the pipeline receives bytes only. "Not sent upstream" compares the request bodies of a read without a bed and one with a bed.

### 4. Request counts per path, and the budget

Decided in this order, before any request:

1. Comparison possible (the spec's "comparable") = a served photo was found ∧ `servedCheck` is neither `same_bytes` nor `size_unknown`: other bytes, and `imageSize(collected)` and `imageSize(served)` both non-null (§5).
2. `plan('tray', requestedMode, class, budget, { served: possible })` (acuity-budget's `plan`, extended):

   | Wanted | Fits (hourly, under the class ceiling) | Mode | Reserved (peak) | Warning |
   |---|---|---|---|---|
   | `sam+spark`, comparison possible | 5 | `sam+spark`, compare | 5 (2) | — |
   | `sam+spark`, comparison possible | 3 or 4 | `sam+spark`, no compare | 3 (2) | `budget pressure: read without comparison` |
   | `sam+spark`, either | 1 or 2 | `spark` | 1 (1) | `budget pressure: read without segmentation` |
   | `sam+spark`, comparison not possible | 3+ | `sam+spark` | 3 (2) | `comparison unavailable: photo size unknown` or `… same photo as served` when a served photo was found; never `budget pressure`, since the read was not cut down |
   | `spark` | 1+ | `spark` | 1 (1) | `comparison unavailable: same photo as served` only for `same_bytes`; no size warning in `spark` mode |
   | any | 0 | refused | — | 429 `request_budget_exceeded`, 0 requests |

   With 3 or 4 left and a served photo that is not comparable, the read was planned at 3 anyway, so its warning is its own `comparison unavailable: …` and not `budget pressure: read without comparison` ("Served tray reads fit the budget: Room for four, photo size unknown"). Peak stays 2: the served SAM pair starts only after the collected pair settles. `fits` is hourly only. In-flight slots never change the mode (acuity-budget §3), so a burst gives 429 `concurrent`.
3. `readMeal` runs with the ticket:

   ```
   collected ─► SAM(dish) ┐ allSettled
                SAM(food) ┴► layoutTray ─► regions ≥ 1 and compare?
                                             │ no ─► (ticket.release returns 2 when 5 were reserved)
                                             ▼ yes
                served ─► SAM(dish) ┐ allSettled
                          SAM(food) ┴► layoutTray ─► matchRegions ─► measure
                                                          ▼
                Spark(collected image + context with served %) ─► toMealReading ─► measureDishes ─► draft
   ```

   | Path | Upstream requests |
   |---|---|
   | No `admission_id`, or no `meal`, or no served photo (none, older than 4 h, other meal, already linked) | exactly 3 (`sam+spark`) / 1 (`spark`) |
   | Served photo found, collected has ≥ 1 region, 5 fit | exactly **5**: `sam:dish`, `sam:food` (collected), `sam:served-dish`, `sam:served-food`, `spark:meal` |
   | Served photo found, collected has 0 regions (none found, or either collected SAM failed upstream) | exactly 3; 2 reserved slots returned |
   | Served photo found, served SAM fails upstream (HTTP error incl. 429, network) or finds nothing | exactly 5, never retried, `comparison.served` null / empty, warning |
   | Served photo found, either image size unreadable | exactly 3, `comparison.served: null`, warning `comparison unavailable: photo size unknown` |
   | Served photo found with the collected photo's own bytes | exactly 3 (`sam+spark`) / 1 (`spark`), `comparison: null`, warning `comparison unavailable: same photo as served` |
   | Served photo found, 3–4 fit | exactly 3, `comparison.served: null`, `budget pressure: read without comparison` |
   | 1–2 fit, or `spark` requested, or `MEAL_USE_SAM=false` | exactly 1 |
   | 0 fit | 0 (429) |
   | Unknown `admission_id` / `meal` without one / bad `meal` | 0 (404 / 400) |
   | Cancelled during the served SAM | 4, read fails, no Spark |

   In every path where a served photo was found, except `same_bytes`, the response carries `comparison` with its `served_media_id`, so the meal can still link it ("Served photo not compared" in web/capture). A collected SAM pair that fails upstream gives tray-segmentation's `segmentation unavailable: …` and, with no regions, no served SAM. An abort or `MetaBudgetError` in the served pair is rethrown after both settle, as tray-segmentation does for the collected pair. With the whole action admitted up front, a budget error there cannot happen.

**Budget class.** A tray read with `admission_id` takes the bed's class, `budgetClass(status)` over `chartView` for that admission, as photo reads do (acuity-budget step 1). A tray read without one stays `routine`, so acuity-budget's "Classes at the routine ceiling" still holds. This is the MODIFIED "Budget class of a model action".

**Alternatives rejected.**
- *Served SAM in parallel with the collected SAM* (peak 4): it would spend 2 requests when the collected photo has no regions, and it doubles the peak.
- *Segment the served photo at upload*: the upload would cost 2 even when the tray is never collected or is read in `spark` mode.
- *Cache the served segmentation on the media row*: a retake would cost 3 instead of 5, so the count would depend on history, and stored state would grow. A retake costs 5 again. The budget admits it or refuses it whole.

### 5. Image size from headers (`src/ai/image-size.ts`, pure)

`imageSize(bytes, mime)` reads only the header and returns `{ width, height }` or null:

| Format | Where |
|---|---|
| PNG | `IHDR` at bytes 16–23: big-endian u32 width, height (after the 8-byte signature and the `IHDR` length + type) |
| GIF | bytes 6–9: little-endian u16 width, height |
| WebP `VP8 ` | bytes 26–29: u16 LE & 0x3FFF each |
| WebP `VP8L` | bytes 21–24: 14 bits width − 1, 14 bits height − 1 |
| WebP `VP8X` | bytes 24–29: u24 LE width − 1, height − 1 |
| JPEG | walk the markers from byte 2. At the first SOF0–SOF15 marker except DHT `C4`, JPG `C8` and DAC `CC`, height is u16 BE at offset 5 and width at offset 7. Stop at SOS `DA` or EOI `D9` → null |

Bounds are checked at every step, so a truncated file gives null, never a throw. Sizes are read whenever a served photo is found, before `plan()`; in `spark` mode (requested, by config or by the budget) nothing is compared, so `size_unknown` gives no warning there ("Size unknown in Spark mode"). The test fixture `jpeg` (`FF D8 FF D9`, `src/testing.ts:174`) has no SOF, so it is the "Photo size unknown" case. `png(w, h)` (new in testing.ts) writes a valid signature and IHDR.

**EXIF orientation** is ignored on both photos: SAM boxes and the header size are in the same stored-pixel frame, and both photos come from the same phone held the same way. A served photo taken in portrait and a collected one in landscape mismatch by place and fall back to `basis: model` (Risks).

### 6. Matching by place (`src/ai/compare.ts`, pure, integers only)

**Centre in thousandths of each photo's own size**, rounded half up, for a half-open box `l,t–r,b` on a `W × H` photo:

```
cx = ⌊(1000·(l + r) + W) / (2W)⌋        cy = ⌊(1000·(t + b) + H) / (2H)⌋
```

Worked:
- Served 1000 × 800, box 100,80–400,480: cx = ⌊(500 000 + 1000) / 2000⌋ = ⌊250.5⌋ = 250; cy = ⌊(560 000 + 800) / 1600⌋ = ⌊350.5⌋ = 350.
- Collected 2000 × 1600, box 240,200–840,1000: cx = ⌊(1 080 000 + 2000) / 4000⌋ = ⌊270.5⌋ = 270; cy = ⌊(1 200 000 + 1600) / 3200⌋ = ⌊375.5⌋ = 375.
- d² = (270 − 250)² + (375 − 350)² = 400 + 625 = **1025** ≤ 40 000 → in range ("Same tray, larger photo").
- The `+ W` term is the half-up rounding. Those centres are exact (250, 350, 270, 375), so nothing rounds. A real half: box 100–401 on a 1000-wide photo has the exact centre 250.5, and cx = ⌊(501 000 + 1000) / 2000⌋ = ⌊251⌋ = **251**.

**Distance rule:** d² ≤ `MATCH_MAX_DISTANCE` (40 000 = 200²). At the limit: collected 300,80–600,480 → cx 450, d² = 200² = 40 000, match; 302,80–600,480 → cx = ⌊(902 000 + 1000) / 2000⌋ = 451, d² = 40 401, no match.

**Size rule** (share of its photo within 2×), cross-multiplied in `BigInt` because `w·h·W·H` can reach 65 535⁴ ≈ 1.8 × 10¹⁹ > 2⁵³:

```
a = wS·hS·WC·HC     b = wC·hC·WS·HS     ok ⇔ 2·min(a, b) ≥ max(a, b)
```

Worked ("Different size"): served 300 × 400 on 1000 × 800 (share 0.15), collected 150 × 200 on 1000 × 800 (share 0.0375): a = 300·400·800 000 = 9.6 × 10¹⁰, b = 150·200·800 000 = 2.4 × 10¹⁰; 2b = 4.8 × 10¹⁰ < a → no match.

**Mutual strict nearest.** Candidates are the pairs passing both rules. For each collected region, its nearest is the candidate served region with the smallest d², and none when two share that smallest d². The same goes for each served region. A pair matches iff each is the other's nearest. So a region matches at most once, and the order of the lists never matters.
- "Two bowls equally near": served centres 400,500 and 600,500, collected 500,500. Both d² are 10 000, so the collected bowl has no strict nearest → `[]`.
- "Two collected near one served": collected centres 210,350 (d² 1600) and 270,350 (d² 400), served 250,350. The served region's nearest is collected 2, and collected 2's nearest is the served region → `[{ index: 2, served_index: 1, distance2: 400 }]`. Collected 1's nearest is that served region, but not the other way round → unmatched.

Matches are sorted by collected index and cut to `MAX_TRAY_REGIONS`. Regions are already cut to 12 per photo by tray-segmentation.

### 7. Portion maths (`quarters`, `measureDishes`)

Coverages are already 3-decimal (tray-segmentation), so S = `Math.round(served.coverage × 1000)` and N = `Math.round(collected.coverage × 1000)` are exact integers. Eaten share = (S − N) / S, and quarters eaten rounded half up:

```
q = ⌊(8·(S − N) + S) / (2·S)⌋, clamped to 0..4          portion = 25·q
```

(⌊4·(S − N)/S + ½⌋ multiplied through by 2S.) A dish is **measured** only when all hold:
1. exactly one dish in the reading cites its region (two dishes on one plate cannot be split);
2. that region is in `matches`;
3. S ≥ `MIN_SERVED_COVERAGE` (150): a nearly empty served dish gives a ratio of noise;
4. 4·N ≤ 5·S: more than 25 % more food on the collected tray than served means a different dish or a refill, not a portion.

Otherwise the dish keeps Spark's portion with `basis: 'model'` and `measure: null`. Every dish keeps `model_portion` = Spark's portion. The draft's dishes and `reading.items` use the final `portion`. `reading.portion` (overall) stays Spark's.

| S / N (coverage) | 8(S−N)+S | 2S | q | Portion | Note |
|---|---|---|---|---|---|
| 800 / 400 (0.8 / 0.4) | 4000 | 1600 | ⌊2.5⌋ = 2 | 50 | "Half eaten" |
| 160 / 140 (0.16 / 0.14) | 320 | 320 | 1 | 25 | exactly half a quarter, rounds up |
| 80 / 70 (0.08 / 0.07) | 160 | 160 | 1 | — | `quarters` gives 1, but S < 150 → `basis: model` |
| 800 / 100 (0.8 / 0.1) | 6400 | 1600 | 4 | 100 | |
| 400 / 500 (0.4 / 0.5) | −400 | 800 | ⌊−0.5⌋ = −1 → 0 | 0 | 4N = 2000 ≤ 5S = 2000, measured |
| 400 / 510 (0.4 / 0.51) | — | — | — | — | 4N = 2040 > 2000 → `basis: model` |
| 150 / 150 | 150 | 300 | 0 | 0 | smallest measurable served coverage |

**Why integers.** The float form `Math.round(4 × (1 − n / s))` gives **0 instead of 1** for 0.16/0.14, 0.08/0.07, 0.32/0.28 and 0.64/0.56, because `1 − 0.14/0.16` is 0.12499999999999989, not 0.125. Checked in Node on 2026-11-04. The unit test asserts `quarters(80, 70) === 1`, `quarters(160, 140) === 1`, `quarters(320, 280) === 1` and `quarters(640, 560) === 1`, so the float form cannot come back. The spec scenario "Served tray nearly empty" separately asserts that 0.08/0.07 is not measured, by rule 3.

### 8. Spark prompt and warnings

`trayContext(seg, served)` appends `, served <p>%` to a matched region's line, where p is the served coverage as a whole percent (tray-segmentation's `coveragePercent`). It adds one line after the list:

```
Read this meal tray.
Segmentation found these dishes (pixels; place on the tray; share of the dish still covered by food):
Dish 1: x 100–400, y 80–480, centre, food covers 40%, served 80%.
"served" is the share of the same dish covered by food when the tray was served.
Use dish numbers from this list, or 0 for food in none of them.
```

Spark gets the collected image only, so the Spark request size and its single image are unchanged. Spark's portions still come back as `model_portion`. The prompt line helps Spark's overall portion, which is not measured.

**Warnings.** Each category gives at most one warning:
- budget: `budget pressure: read without comparison` or `… without segmentation`;
- collected SAM: tray-segmentation's `segmentation unavailable: <message>` or `segmentation found no dishes`;
- comparison: `comparison unavailable: <message>`, `comparison unavailable: photo size unknown`, `comparison unavailable: same photo as served` or `comparison found no served dishes`.

Which can occur together:
- `comparison unavailable: <message>` and `comparison found no served dishes` need collected regions (the served SAM pair ran), so they never come with a collected-SAM warning.
- `photo size unknown` and `same photo as served` are decided before any request. Either can come with `segmentation found no dishes` or `segmentation unavailable: …` ("Size unknown and nothing on the collected tray").
- `read without comparison` is only for a comparable photo, so it never comes with `photo size unknown` or `same photo as served`.
- `read without segmentation` is `spark` mode: no collected-SAM warning and no size warning, but `same photo as served` can come with it.

So at most 2 warnings occur together, under the bound of 6. Every warning is cut to 200 characters. Upstream messages are the `MetaApiError` message (status and code), never request content.

### 9. Evidence size and the meal post limit

Measured in Node on 2026-11-04 with every field at its bound:
- 12 + 12 regions with 172-character masks;
- 20 dishes with `model_portion` and `measure`, 20 items, 10 fluids;
- 6 warnings of 200 characters, 5 trace steps, 12 matches;
- 20 posted dishes with 80-character names, items of 200 characters.

| Body | ASCII | 3-byte UTF-8 names (Devanagari) |
|---|---|---|
| One segmentation | 6 443 B | 6 443 B |
| `comparison` (served segmentation + 12 matches + ids) | 7 263 B | 7 263 B |
| Evidence | 26 707 B | 35 307 B |
| Whole meal post | 30 056 B | **45 422 B** (measured by the test) |

48 KB (49 152 B) leaves 1.16× over the worst case, so the limit rises to **64 KB** (65 536 B), 1.44×. "Body too large" moves from 50 KB to 70 KB. Zod bounds stay the real limit. The body limit only stops parsing early. A test (tasks.md 5.4) builds the maximal post from the real schema with 3-byte names and asserts that it parses and that 65 536 B is at least 1.4 × its size (so at most 46 811 B). The headroom under 64 KB is checked rather than assumed, and accuracy-views' `read_id` (a few bytes) still fits without editing the test.

### 10. Proof binding at save (`POST /api/admissions/:id/meals`)

Checks in order, each 400 `invalid_request` with nothing stored unless stated, and 0 model requests throughout:

1. Body (zod, 64 KB): `served_media_id` is a positive int, only with `source: photo` ("By-hand meal with a served photo").
2. Admission 404, `charted_at`, then tray-segmentation's checks: `media_id` is this admission's photo, evidence needs `media_id`, `evidence.image_sha256 === media.sha256`.
3. `media.served_meal` is null: a served photo is never the tray photo.
4. `(served_media_id !== undefined) === (evidence?.comparison != null)`: exactly when.
5. Served media: it exists in this admission, is a photo, has `served_meal === body.meal`, has `id !== media_id`, has `sha256 !== media.sha256` (else `invalid(c, 'served_media_id', 'same photo as the tray')`: the same bytes uploaded twice under two ids would compare a photo with itself, N = S, and read every dish as portion 0), and no other meal has `served_media_id` = it.
6. `evidence.comparison.served_media_id === served_media_id` and `evidence.comparison.served_sha256 === served.sha256` (served photos are always fingerprinted: `served_meal` postdates `sha256`).
7. Insert in one transaction. The partial unique index `meal_served_media ON meal(served_media_id) WHERE served_media_id IS NOT NULL` closes the race between two saves. Its constraint error maps to the same 400.

`proof.served` = `{ media_id, sha256, captured_by, captured_at }` from the stored row, as `proof.photo` is. `comparison.served_at` and sizes are client-reported, kept as evidence, and not trusted: the proof's `captured_at` is the server's. `served_at` is not cross-checked (Risks).

`gcMedia` and expiry see the served link through `UNLINKED` (§11). The served photo is linked at save, so "Served photo in use" holds past 24 h.

### 11. Store

**Schema.** Everything below goes into `SCHEMA`: the three columns in their `CREATE TABLE` statements, and the indexes, `meal_event` and its triggers after them. `STORE_SCHEMA_VERSION` goes from 3 to 4. If the live `STORE_SCHEMA_VERSION` is not 3 at apply time, stop: changes were applied out of order. There is no upgrade step: a store file from before this change fails to open (charting/entries "Store schema version"); delete `DATA_DIR` or re-seed it with `scripts/demo-history.ts`.

```sql
-- media: served_meal TEXT                                  -- zod-checked: MEAL_KINDS, photos only
-- meal:  served_media_id INTEGER REFERENCES media(id), amended_at INTEGER
CREATE INDEX IF NOT EXISTS media_served ON media(admission_id, served_meal, created_at) WHERE served_meal IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meal_served_media ON meal(served_media_id) WHERE served_media_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS meal_event (
  id       INTEGER PRIMARY KEY,
  meal_id  INTEGER NOT NULL REFERENCES meal(id),
  kind     TEXT NOT NULL CHECK (kind IN ('amended')),
  at       INTEGER NOT NULL,
  staff_id INTEGER REFERENCES staff(id),
  reason   TEXT NOT NULL,
  before   TEXT NOT NULL CHECK (json_valid(before)),
  after    TEXT NOT NULL CHECK (json_valid(after))
);
CREATE INDEX IF NOT EXISTS meal_event_meal ON meal_event(meal_id, at, id);
CREATE TRIGGER IF NOT EXISTS meal_event_fixed BEFORE UPDATE ON meal_event
  BEGIN SELECT RAISE(ABORT, 'meal_event rows are kept as written'); END;
CREATE TRIGGER IF NOT EXISTS meal_event_kept BEFORE DELETE ON meal_event
  BEGIN SELECT RAISE(ABORT, 'meal_event rows are kept as written'); END;
```

`served_meal` is validated at the edge, like `care_order.kind`. `kind` leaves room for later event kinds without a table change.

**Evidence.** Every meal in a store at this version was saved by this build, so evidence is read as stored: a read without a comparison carries `comparison: null`, and each dish its `model_portion` and `measure`. No row is rewritten.

**`UNLINKED`** (merged with bag-emptying's line):

```sql
NOT EXISTS (SELECT 1 FROM entry WHERE media_id = media.id)
  AND NOT EXISTS (SELECT 1 FROM level WHERE media_id = media.id)
  AND NOT EXISTS (SELECT 1 FROM level WHERE proof_media_id = media.id)    -- bag-emptying
  AND NOT EXISTS (SELECT 1 FROM meal WHERE media_id = media.id)
  AND NOT EXISTS (SELECT 1 FROM meal WHERE served_media_id = media.id)    -- this change
```

One predicate serves expiry (24 h), `gcMedia` and `servedPhoto`.

**Void.** `voidMeal` sets `media_id = NULL, served_media_id = NULL` in the same UPDATE and calls `gcMedia([media_id, served_media_id])`. Both photos go when nothing else links them. `proof` keeps both fingerprints (`meal_evidence_fixed` already refuses changes to it), and `meal_event` rows stay.

**Reads.** `MEAL_SQL` adds `served_media` (`MEDIA_JSON` of `served_media_id`), `amended_at`, and `amendments` as a `json_group_array` over `meal_event` ordered by `at, id`, joined to staff for `by`. `MEDIA_JSON` and `toMediaRef` add `served_meal`.

### 12. Amend (`POST /api/meals/:id/amend`)

`requireDecider` first, so 403 comes before the body or the meal is looked at ("Role checked first"). Then `AmendMealBody` (zod, `smallJson`) with:
- `reason` 3–200 characters;
- `portion?` in `PORTIONS`;
- `items?` of 1–200 characters;
- `dishes?` under tray-segmentation's `DishSchema` (≤ 20);
- no other keys (`.strict()`, so `fluid_ml` is 400);
- `items` and `dishes` not both.

`store.amendMeal(id, input, staffId)` runs in one transaction:
1. Load the meal: unknown → 404 `not_found`, voided → 409 `voided`.
2. `items` alone on a meal with dishes → 400.
3. `after = { portion: input.portion ?? before.portion, dishes: input.dishes ?? before.dishes, items: input.dishes ? joinItems(input.dishes) : input.items ?? before.items }`, where `joinItems` joins the names in list order with ", " and cuts to 200, as tray-segmentation's draft (`toMealDraft`, `src/ai/meal.ts`) and the web's `toMealInput` already do (moved to shared). It never sorts by `index`: amending "Half-eaten lunch" (rice in region 1, dal in region 0) keeps `rice, dal` ("List order kept").
4. `deepEqual(before, after)` → 400 (must change something).
5. `UPDATE meal SET portion, items, dishes, amended_at`, then `INSERT meal_event`.

`evidence`, `proof`, `media_id`, `served_media_id`, `fluid_ml` and the fluid entry are untouched. The fluid is the fluid chart's, amended through the entry. dietitian's `poor_meal_intake` reads `meal.portion`, so an amended portion counts at once ("Amended portion counts").

### 13. Web

- **Served tray** (`routes/a/bed.$token.tsx`, lazy `components/served-tray.tsx`): a "Served tray" tile in Meal capture. One capture, one `api.uploadMedia(admissionId, file, { kind: 'photo', served_meal })`, then the message `Served <meal> kept at <HH:MM>. Photograph the tray again when it is collected.` No `/api/ai`, no retry. On failure: `Served tray photo not kept. You can still photograph the tray when it is collected.`
- **Meal preselected from the served tray** (`lib/meals.ts` `mealOnOpen(now, servedTray)`, `api.servedTray`): opening Meal on the bed capture screen sends one `GET /api/admissions/<id>/served-tray`. A photo preselects its `served_meal` and shows `Served <meal> tray from <HH:MM> waiting` above the chips; `media: null` or a failed request falls back to `defaultMeal(now)` with no resend. Not on the ward round (proposal, Out of scope).
- **Collected tray** (`components/meal-form.tsx`, `lib/meals.ts`):
  - the read form adds `admission_id` and `meal`;
  - with `comparison.served` set, the form reads `Compared with the served tray from <HH:MM>`; with `comparison` and `served: null`, `Served tray from <HH:MM> kept with the meal`;
  - `measured` dishes get a "measured" mark beside their portion chips;
  - the meal chips are disabled while a read with a comparison is on the form, since the binding needs `served_meal === meal`. DESIGN.md §4.10 asks to say why near a disabled control, so the chips carry `Meal fixed to <meal> by the served tray. Retake to change it.` (`sm`/`muted`, under the chips). "Retake" clears the read and the chips.
  - `mealPost(form, read, mediaId)` (pure) adds `served_media_id` only when `mediaId` is set and `read.comparison` is non-null. If the tray upload fails, it drops `media_id`, `evidence` and `served_media_id` together.
- **Proof** (`lib/tray.ts`, `components/tray-proof.tsx`). DESIGN.md §7.2 "Comparison (before and after tray)": the `source-view.tsx` `BeforeAfter` pair layout, served as the before photo and the tray photo as the after, side by side ≥ 641 px and stacked (before, stat line, after) on phones. The before is `Served tray · <HH:MM> · <who>` with the photo, an overlay of `comparison.served` regions (labels from the dishes matched to them), and the fingerprint. In `BeforeAfter`'s drop slot, the eaten share is one stat line (DESIGN.md §4.6): `<i> <name> · <S>% served · <N>% left · <word> eaten` per measured dish, joined by ` · `, or `No dish measured` when none is. No new chart. A measured row reads `<i> <name> · <Kind> · measured <word> · AI <model word> · saved <word>`. Each photo is fetched once when opened. A voided meal shows `Served tray deleted · fingerprint …` from `proof.served`.
- **Amend** (lazy `components/amend-meal-dialog.tsx`, pure `lib/meal-amend.ts`): Base UI Dialog on the `sheet` recipe (DESIGN.md §4.11) with portion chips, dish rows (name, kind select, portion chips, add, remove) or items, and a reason, then `Saved in the name of <staffLabel>.` above the error notice and the actions, as every dialog that writes has. `amendBody(meal, form)` returns the body with only the changed fields (dishes whole when any dish changed), or null. Save is disabled while it is null or the reason is under 3. It shows only when the signed-in role is in `DECIDER_ROLES` and the meal is not voided. On 409 `voided` it shows the message and does not resend. `components/meals.tsx` shows `Amended <HH:MM> · <who> · <reason>` from the last amendment.
- `lib/labels.ts` `STEP_LABEL` gains `sam:served-dish` and `sam:served-food`.

### 14. Order and overlaps

**Apply order:** care-plan (archived) → bag-emptying → tray-segmentation → read-outcomes → dietitian → acuity-budget → **tray-comparison** → bag-alerts → accuracy-views → dietitian-care → scale-store → postgres-store → read-queue. Each MODIFIED block here copies the then-current text: tray-segmentation's for "Tray read fits a saved meal", "Tray evidence stored with the meal", "Tray proof stored with the meal", "Upload media" and "Tray proof on the bed review"; acuity-budget's for "Tray reading", "Tray segmentation degrades" and the three read-budget blocks (five in all); `openspec/specs/**` for "Media goes with its record" and "Meal capture", which no earlier change modifies. Task 0.4 re-diffs the five acuity-budget blocks against its delta as it stands then, and task 0.2 re-copies every block from `openspec/specs/**` after those archives.

**Spec text notes.**
- "Tray reading" leaves out acuity-budget's "(capture/read-budget)" and ", the image's SHA-256": with "5 with a compared served photo" and "comparison" the statement would be 536 characters, over the 500 limit. The budget link is in "Tray reads name their bed" ("The bed sets the read's budget class (capture/read-budget)"), and `image_sha256` is defined by "Tray evidence bound to its photo" and asserted in "Half-eaten lunch".
- "Read mode fits the budget" adds `unless "Served tray reads fit the budget" applies` to acuity-budget's statement (495 characters, with `MODEL_API_MAX_CONCURRENT` ≥ 2), which would make it 547. To stay under 500 it says "A `sam+spark` read" (only photo and tray reads have that mode), "a `budget pressure` warning", "makes exactly 1, never upgraded" and "else it gets `limit: "concurrent"`". Its meaning and its five scenarios, "In-flight minimum from config" included, are acuity-budget's, unchanged.
- "Whole action admitted up front" adds `(5 with a comparable served photo: found, other bytes, sizes readable)` to acuity-budget's statement (436 characters, with "a status check 1"). To stay under 500 it says "for all requests" and "its unsent requests are returned". The other three acuity-budget blocks keep its wording apart from the edits named in this design.
- Two statements over 500 characters were split: "Compared read kept as evidence" out of "Tray evidence stored with the meal", and "Served tray in the proof" out of "Tray proof on the bed review".
- "Tray segmentation degrades" (acuity-budget's) and "Tray proof stored with the meal" (tray-segmentation's) are MODIFIED here only to say "collected" photo and "both photos", so they no longer read against a served SAM failure (5) or a void deleting both photos.

| Change | Overlap | Resolution |
|---|---|---|
| **bag-emptying** (before) | `UNLINKED` gains `level.proof_media_id` | §11 merges both lines. "Media goes with its record" now says "a level's photos" (photo and after-emptying photo) |
| **tray-segmentation** (before) | everything this builds on, and its tests; MODIFIED here: "Tray proof stored with the meal" (voiding deletes both photos' bytes) | Tests to update: "Tray read fits a saved meal" (5 trace steps), the trace-bound refusal (4 steps is now valid; 6 is refused), `basis` refusal (`measured` is now valid; `guessed` is refused), "Body too large" (70 KB), "Upload media" keys (`served_meal`), "Tray proof" rows. Its Deferred list is closed by this change |
| **read-outcomes** (before) | `charting/model-accuracy` (`--container-labels`, sidecar rule, `Rate`, `MIN_N`, `VOLUME_TOLERANCE_ML`); its tray follow-up | The tray eval reuses its sidecar rule and `rate()`. `--tray-labels` refuses `--container-labels` and `--no-hint`. Tray reads are not logged here |
| **dietitian** (before) | `DECIDER_ROLES`, Sana Mirza (11), `poor_meal_intake` | Amend uses `requireDecider`, so a dietitian gets 403. The alert reads the amended portion |
| **acuity-budget** (before) | `plan()`, tickets, class; five of its requirements are MODIFIED here: "Tray reading", "Tray segmentation degrades", "Budget class of a model action", "Whole action admitted up front", "Read mode fits the budget" | A tray read with a bed takes its class; 5 (peak 2) for a comparison; `budget pressure: read without comparison`. Its texts are the base here and are copied faithfully; "Tray segmentation degrades" now says the collected photo, since a served SAM failure costs 5. Its tray counts go stale with this change: the AGENTS.md and README request counts its tasks.md:64 (7.1) rewrites, which say "meal tray photo 3, or 1 in Spark-only mode" after tray-segmentation's 5.5, its design §4.3 table, and "every tray read is routine" (its proposal.md:15). This change states the new count, "meal tray photo 3, 5 with a served photo, or 1 in Spark-only mode", puts it in AGENTS.md (tasks.md 9.3), and says a tray read with `admission_id` takes the bed's class |
| **bag-alerts** (after) | none in shared requirements; `scripts/demo-history.ts`; the browser check | Shares `store.ts`, `bed.$token.tsx` and the demo seed. Its demo guard depends on 2C-2's meal fluids, so this change's served photos, compared lunch and amendment use other beds and never touch 2C-2 (§16). Its browser check may reuse `scripts/fake-server.ts`, with the `/status` fix (§16) |
| **accuracy-views** (after) | MODIFIED "Tray reading" (`read_id`) | Its "Tray reading" (`accuracy-views/specs/capture/meal-reading/spec.md:6`) paraphrases this change's text: "5 when it compares a served photo" for "5 with a compared served photo", "and never retried", "a strict schema" for "a strict JSON schema", and "Errors map" for "Upstream errors map". It must copy this change's statement word for word, then add only `read_id` and "it saves only its read" |
| **dietitian-care** (after) | "Dishes in the Nutrition section" marks dishes changed, added or removed by a meal amendment | `MealAmendment.before/after` carry whole `DishValue[]` in the order sent, so it can diff by index and name. Its §8.4 pairs dishes by `index` when > 0 and index-0 dishes by their order among index-0 dishes, never through `items`, so joining amended items in list order (§12) leaves its pairing as it is. Amend allows adding and removing dishes |
| **scale-store** (after) | MODIFIED "Read mode fits the budget" from acuity-budget's text; "Reads under budget pressure" assumes tray reads name no bed; "Media files go with their last reference"; `linked_at` | It must rebase on this change. (1) Its MODIFIED "Read mode fits the budget" copies acuity-budget's text, so archived after this change it would drop `unless "Served tray reads fit the budget" applies` and "Requests in flight never change the mode": it must copy this change's text instead. (2) Its "Reads under budget pressure" says nothing about served-tray reads and calls every tray read bedless: a tray read with a bed takes the bed's class, and the rule must say what a tray read with a comparable served photo does under pressure (for a stable bed, 1 in `spark`; for watch and critical, "Served tray reads fit the budget"). `linked_at` must be set when a served photo is linked. "Last reference" counts `meal.served_media_id`, via the merged `UNLINKED` |
| **read-queue** (planned, pg-boss / Postgres) | async reads | Not depended on, but it MODIFIES "Whole action admitted up front" and "Read mode fits the budget" with paraphrased text ("a tray read with a served photo 5", without "comparable", and no "a status check 1"); it must copy this change's text and scale-store's word for word (tasks.md 11.4). If tray reads are queued: resolve the served photo **at enqueue** and carry its media id in the job, so a later upload cannot change what is compared. Reserve the 5-request ticket per job, not per attempt (pg-boss retries must be off for model jobs, or a retry would resend 5). The 4 h window is measured from the request time, not the job's start |
| **postgres-store** (planned, Supabase Postgres) | the schema in §11 | Not depended on. Mirrors the fresh `SCHEMA`; no older SQLite shape to import. `RAISE(ABORT)` triggers become one `BEFORE UPDATE OR DELETE ON meal_event` trigger calling a PL/pgSQL function that raises. Partial indexes port as they are. `json_valid` checks become `jsonb` columns. `served_meal` can gain a real CHECK. "Meals from before comparisons: Opened again" asserts `PRAGMA schema_version`, so postgres-store would MODIFY that scenario to its migration-version check. `created_at >= now − 4 h` compares integers here and `timestamptz` there |

### 15. Tray eval (`scripts/eval.ts`, `src/chart/tray-lab.ts`)

- **Flags.** `--tray-labels <manifest.jsonl>` makes the run a tray eval. With `--container-labels` or `--no-hint` it prints `--tray-labels cannot be combined with --container-labels` (or `--no-hint`) and exits 2 before planning. `--modes`, `--limit` and `--yes` keep their meaning. `--yes` stays user-only (the guard hook blocks it for agents).
- **Labels** (`trayLabels(record)`, pure). A real photo is a tray when its file name ends with the `id` of a `record_type: original` record that has an `expected_items` array. Augmented records (`record_type: augmented`, 270 with `expected_items`) are skipped like unlabelled photos, as read-outcomes keeps augmented variants out of scope; their `expected_outcome_after` is never read. Truth:
  - dishes `{ dish_kind, portion }` with `portion = portion_eaten_pct` when it is in `PORTIONS`, else unscored;
  - the meal portion from `meal_portion_eaten` (null = unscored);
  - fluids from `expected_fluids` minus `fluid_kind: none`, with mL from `volume_ml_estimate`; a null `volume_ml_estimate` (18 real tray fluids) scores the fluid's kind and not its mL;
  - the outcome from `expected_outcome`.

  Names are never read. Other photos are skipped (`N photo(s) without tray labels, skipped`).
- **Synthetic trays** (`synthLabels(sidecar)`, pure). read-outcomes' rule decides which synthetic photos are scored. A scored one is a tray when its sidecar's `labels.truth.expected_items` is an array. Its dishes and fluids come from `labels.truth.expected_items` and `labels.truth.expected_fluids` under the rules above. Its meal portion is `labels.meal_portion_eaten` and its outcome `labels.expected_outcome`, both top-level in `labels` (`synth.ts` `Labels`), each unscored when absent: the shortlist plans neither for its pairs, so a pair scores dishes and fluids only until a person adds them at verification.
- **Synthetic and pairs** (`trayPairs(folder, sidecars, manifest)`, pure). read-outcomes' rule decides which synthetic photos are scored (`label_status: verified` and a non-empty `verified_by` on each of sidecar and record). A scored `after` (`labels.pair_role: after`) gets its before:
  1. the folder photo whose sidecar has the same `labels.pair_id` and `pair_role: before`;
  2. else the manifest record named by `source_ids[0]`, at its `file` resolved beside the manifest (`images/food_tray/tray-001.jpg`).

  With no before, it is read alone (`1 pair without its before, read alone`). It is labelled as a synthetic tray (above).
- **Plan.** Per mode: each tray 3 (`sam+spark`) or 1 (`spark`). Each pair is 5 in `sam+spark`: the before's bytes go in as `served`, `imageSize` is read first, and an unreadable size is planned as 3. In `spark` a pair is 1. A skipped photo is 0. Example "Pair planned": `tray-001` 3 + the pair 5 = 8 (`sam+spark`); 1 + 1 = 2 (`spark`). The plan is checked against `MODEL_API_MAX_REQUESTS_PER_HOUR` as today, and without `--yes` nothing is sent.
- **Run.** It calls `readMeal` in-process with the live ports, one photo at a time as today, never retried. A failed read is a row with its error, never a resend.
- **Report** (`trayReport(rows)`, pure), per mode, real and synthetic in separate sections under the same rules ("Real and synthetic apart"), pairs in their own `Pairs (served and collected)` section:
  - dish kind table by true kind (kept / read as);
  - dish portions by `basis` (`measured`, `model`): exact and within one quarter, as `rate()` strings (`42% · 3/7`, `— · 1/1` below `MIN_N`);
  - meal portion in quarters;
  - fluid kinds and mL within `VOLUME_TOLERANCE_ML`;
  - outcome table `n | drafted | flagged | refused | right call`, where a read with no dish and no fluid, or with `not_a_meal`, is refused.

  Dishes pair by `dish_kind` first (each read dish takes the first unpaired true dish of its kind), then the rest in list order. That is the rule accuracy-views moves into `scoring.ts`.
- `docs/accuracy.md` gains "Trays": how to run it, the request plan, and that the dataset has no real pairs.

### 16. Demo, fake server, privacy

- **`scripts/demo-history.ts`**: for a few fictional beds, a served lunch photo and a compared lunch, plus one amendment by Anita Thomas, built with the `png(w, h)` fixture bytes: staged, no photos of people. No model request (evidence is a fixture, as tray-segmentation's demo does). The beds are never 2C-2: bag-alerts' demo guard depends on 2C-2's meal fluids. Agents and the browser check run it as `cd apps/server && DATA_DIR=<tmp> pnpm exec tsx scripts/demo-history.ts`, never `pnpm demo`, whose script is `tsx --env-file-if-exists=../../.env …` and would load `.env`.
- **`scripts/fake-server.ts`** (new, dev-only, not in the build):
  - `createApp` over `testing.ts`'s `upstream()` fake, whose `sam` now gets the image too, so it answers per photo (collected vs served fixture);
  - a temp `DATA_DIR` that it requires and refuses to default;
  - before anything imports `src/config.ts`, it sets the base URL to `http://127.0.0.1:9/v1` and the key to the literal `fake` in `process.env` (`MODEL_API_BASE_URL`, `MODEL_API_KEY`), overriding whatever the shell has, then loads the app with a dynamic `import()`. `GET /api/ai/status` calls the live `metaClient()` (`src/routes/ai.ts:88`, `models.list`) even when `ai` is injected, so without this the browser check could reach Meta. Port 9 (discard) on loopback refuses the connection, so `/status` answers an upstream error and nothing leaves 127.0.0.1. A test checks this (tasks.md 9.2);
  - run with plain `tsx`, never `--env-file`, so `.env` is never read;
  - it prints only `sam:dish`-style step names and statuses.

  The browser check and accuracy-views use it, and bag-alerts' browser check may reuse it, `/status` fix included.
- **Privacy.** Every Responses API request keeps `store: false` (tested on all 5). `admission_id`, `meal` and patient names never enter a request body ("Not sent upstream"). Logs carry paths, models, statuses and timings: never images, coverages per patient, dish names, reasons or amendment values. `meal_event` holds values a nurse typed, and is not logged. The fixtures are staged props and fictional patients.

## Risks / Trade-offs

- **Matching by place fails when the tray is turned or the photo is rotated** (EXIF orientation, portrait vs landscape). → It fails safe: no match, `basis: model`, and Spark's portion stands. The proof shows both photos so a nurse can see why.
- **Coverage is SAM's food mask over the dish mask, not volume.** A heap and a smear of the same area read the same. → Measured portions are drafts that a person confirms. Quarters only, and S ≥ 150 and 4N ≤ 5S keep out the noisy cases. The eval reports measured and model portions apart, so the gain is visible before the demo claims one.
- **A compared read costs 5 and adds one SAM round trip** (sequential pairs, about 1–2 s). → Peak in-flight stays 2. The budget can choose 3. `spark` mode is unchanged at 1.
- **The served photo is found by time and meal, not chosen.** A wrong photo (an earlier tray, another patient's tray photographed at this bed) would be compared. → Newest unlinked within 4 h, this bed only. The proof shows it. Matching rejects different layouts. A nurse can amend.
- **Client-reported evidence.** `comparison.matches`, sizes and `served_at` are what the client posts. → The ids and both fingerprints are checked against stored media. The bounds are enforced. Evidence is never changed after save. The proof's times come from the server.
- **The 64 KB body** is larger than any other JSON route. → It stays route-local. Zod bounds are the real limit (§9).
- **A retake of a compared read re-spends 5.** → Accepted for a fixed count (§4). The UI's "Retake" is the only way to read again.

## Migration Plan

1. `SCHEMA` and `STORE_SCHEMA_VERSION` 3 → 4 (§11). A store file from before this change fails to open; delete `DATA_DIR` or re-seed it.
2. A web build from before this change ignores the new fields. Old clients that post a tray read without `admission_id` keep exactly 3 requests.
3. Rollback: an older server refuses a file at this version, so roll back with a fresh `DATA_DIR`, and with the web.

## Open Questions

- **Live gate deferred.** tasks.md 11.2 (one served+collected read, exactly 5 model requests) was not run before archive. Agents never run it; the user runs it when credits allow, and its result (match quality, `measured` share) goes into a follow-up change as tuning input.
- None that change scope. Tuning `MATCH_MAX_DISTANCE`, `MIN_SERVED_COVERAGE` and the 4N ≤ 5S rule waits for the tray eval on verified pairs. Each is one constant and one spec delta.
