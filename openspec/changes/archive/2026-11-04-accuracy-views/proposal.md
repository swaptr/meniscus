# Proposal

## Why

read-outcomes measures container photos and notes against what staff kept, but it stopped short of trays and of a view a judge or matron can read at a glance. It deferred:
- tray reads in the log, with meal links and `not_a_meal` negatives;
- dish and portion scoring;
- the per-container table, top corrections and the "positive drafts not kept" count;
- the outcome chart, the Chart | Table toggle, the class-table picker and the hospital view;
- tray scoring in the lab that matches the ward's (tray-comparison adds the tray eval itself).

Meniscus's selling point is that it classifies every capture as something to chart or nothing to chart, logs both the positive and the negative calls, and checks them against real-world photos. This change finishes that, for every read kind, at no extra model cost in the ward.

## What Changes

- **Tray reads in the read log** (`capture/meal-reading`, `charting/model-accuracy`).
  - MODIFIED "Tray reading": tray-comparison's text word for word (3, 5 with a served photo compared, 1 in `spark` mode, and acuity-budget's downgrade or refusal), except that "It saves nothing." becomes "It saves only its read." Its "Half-eaten lunch" says no meal or entry is saved.
  - ADDED "Tray reads are logged": every `POST /api/ai/meal` that answers 200 stores one read of kind `tray` and returns its id as `read_id`. A read that fails, or that the budget refuses, stores none.
  - The row holds closed-list values and numbers only: the mode, model ids, staff, the bed (tray-comparison's `admission_id`), confidence, issue codes, `needs_review`, and whether a served photo was found. It also holds per dish the region index, `dish_kind`, portion and basis, per fluid the index, `fluid_kind` and mL, and the draft's portion, fluid mL and dish kinds and portions.
  - It never holds a dish or fluid name, notes, items text, a mask, a box, `image_sha256` or any hash.
  - A tray read has 1 draft when its draft has a dish or a fluid volume, else 0. One shared rule (`trayDrafts`) decides it for the server and the web.
- **Meal links.** `POST /api/admissions/:id/meals` accepts `read_id` and stores it in `read_link.meal_id` (kept by read-outcomes for this), in the meal's transaction. read-outcomes' link checks apply: same staff, the read's own bed, under `READ_ABANDON_HOURS`, a `tray` read with a draft for a `photo` meal, and not linked already.
  - The meal form sends `read_id`, except after a read with no draft (`not_a_meal` or `tray_empty_unclear` with nothing read): that meal is saved unlinked (201), since the link would be refused.
  - A retried meal post answered `already linked` shows as saved, as the round does.
- **Meal outcomes**, derived at query time, the first that applies:
  - `rejected` when the meal is voided;
  - `pending` while its fluid entry is unreviewed;
  - `corrected_by_nurse` when a nurse amended the meal's dish kinds or portions through tray-comparison's `meal_event` (a rename alone, of items or a dish, stays `accepted`), or rejected, re-volumed or amended its fluid entry (fluid is amended as an entry, never through `meal_event`). A rejected fluid entry on a meal that stands counts as corrected by a nurse, not as a rejected meal: the meal is still charted and the nurse removed its fluid;
  - `edited_at_capture` when saved with another portion, fluid or set of dish kinds and portions;
  - `accepted` otherwise.
- **Negatives.** `NEGATIVE_ISSUES` gains `not_a_meal` (MODIFIED "Negative reads"). A `not_a_meal` read with no draft is confirmed at once. A charted one is overridden, counted as `meal`, until the meal is voided.
- **Retaken tray reads** (ADDED "Retaken tray reads", MODIFIED "Unsaved drafts"). After "Retake tray photo", the first read is never saved, and without this rule it would count as `abandoned` 12 h later, though staff only took the photo again.
  - An unlinked `tray` read with a draft is `retaken` once the same staff member makes a later `tray` read for the same `admission_id` within `READ_RETAKE_MINUTES` (10). The read log already stores both, so no request gains a field.
  - There is no meal condition: tray-comparison's "Retaken for another meal" is a retake with a different meal.
  - Precedence: `retaken` applies at once, then `open` under 12 h, then `abandoned` or `negative_confirmed`. A `retaken` draft counts as no decided draft, in no rate, in neither kept nor not kept, and in no negative count. A read with no bed is never `retaken`.
  - Derived on request, like every outcome, with 0 model requests.
- **Dish and portion tables.**
  - Drafted and final dishes are paired by `dish_kind` first, then in order. Names are never compared.
  - The `dish_kind` table counts kept kinds and what staff changed them to, with `none` for a dish staff removed or added.
  - Portion agreement is in quarters, for each meal and each dish pair: exact, within one quarter, and the count 0 to 4 quarters apart.
  - Fluid with a meal: the drafted fluid mL against its fluid entry's final volume, within `VOLUME_TOLERANCE_ML`, plus counts of fluids staff added or removed.
- **Container rows, top corrections, positives.**
  - One row per container the photo reads named: reads, decided drafts, accepted, corrected and rejected rates, and volume error. These are what staff did with each container the model read, not container truth.
  - The `TOP_CORRECTIONS` (5) most frequent changes across the type, urine colour and dish kind tables.
  - "Positive drafts not kept": drafts of non-negative reads, kept (`accepted`, `edited_at_capture`, `corrected_by_nurse`) against not kept (`rejected`, `abandoned`), with the `retaken` count beside them, in neither.
  - With read-outcomes' negatives (confirmed against overridden), the view shows both sides of every classification.
- **Web, ward Data quality view** (MODIFIED "Model accuracy view").
  - **Outcome bars.** One thin horizontal bar per read kind, split into the four decided outcomes, built with the dataviz method and `apps/web/DESIGN.md` §4.15:
    - 12 px marks with a 2 px (`space.xs`) surface gap and `radius.sm` ends;
    - a legend above, in segment order, and the accepted rate printed beside each bar with its count;
    - each kind's row is a 44 px Base UI Popover trigger (a 12 px segment is too small to tap): a tap or click opens a popup listing all four outcomes, and `openOnHover` opens it for the mouse. Base UI 1.9.0's Tooltip opens only on mouse hover and keyboard focus, so a tap would open nothing;
    - each row button's accessible name is the bar's sentence (a button hides a `role="img"` child), and the kinds table is the chart's table view;
    - no direct labels on the segments, an exception to DESIGN.md §4.15.5 ("direct labels for up to 4"): the legend, the printed accepted rate, the popup and the table carry the values instead;
    - four categorical slots in fixed order, checked with the dataviz `validate_palette.js` (light mode, surface `#ffffff`), kept once in `lib/hues.ts` beside `CATEGORY_HUE`. Status colours (`ok`, `warn`, `danger`, `pending`) are reserved and never used. Text stays in text tokens.
  - A kind with fewer than `MIN_N` decided drafts, and at least one draft, draws no bar and reads `Too few to chart · <n> decided`. A kind with no drafts is not listed.
  - **`Chart | Table`.** Chart first. Table is the kinds table, the chart's table view. Its `Corrected` column splits into `Edited at capture` and `Corrected by a nurse`, so it holds every value the chart draws. `KindRow` carries those two rates from the server's `rate()`, and the web never recomputes a rate.
  - **Class-table picker.** A `Table` select (DESIGN.md's 48 px form control): `Drink and fluid`, `Urine colour`, `Container`, `Dish`, `Dish portion`, `Meal portion`. An empty table keeps its header row over one sentence naming what is missing and the window. A tray table with tray reads but no reviewed meal says so (`No reviewed tray meals in the last 7 days`).
  - Stat lines for meal fluid, positives kept or not (with `, <t> retaken` in the brackets when above 0), and top corrections.
  - **DESIGN.md.** Every element uses its recipes. Its §7.3 sketches a one-hue bar for this change; this change draws the four-outcome split instead and updates §4.15 (the outcome-bar recipe, and its exceptions to §4.15.5, §4.15.6 and §4.15.7) and §7.3 in the same change (design.md §7, step 1).
- **Hospital view** at `/n?view=model`.
  - It is a search param on the existing `/n` route, because a new route would change the generated `routeTree.gen.ts`.
  - A `Wards | Model accuracy` toggle under the census header. Model accuracy **replaces the ward cards** with the same section for the whole hospital, subtitled `All wards · Last 7 days`, from one `GET /api/quality/model?days=7`. The header stays.
  - `/n` without the param shows the cards, as today.
- **Tray eval report** (MODIFIED, tray-comparison's; `scripts/eval.ts`, `src/chart/tray-lab.ts`).
  - tray-comparison adds the tray eval: `--tray-labels <manifest.jsonl>` (`expected_items`, `expected_fluids`, `meal_portion_eaten`, `expected_outcome`), verified `generation/` sidecars (`labels.truth`, `pair_id`, `pair_role`) and before/after pairs through the served path at 5 requests. Its "Tray eval report" already pairs by kind, scores portions in quarters and fluid within `VOLUME_TOLERANCE_ML`, and withholds small rates.
  - This change copies that requirement with its four scenarios word for word, and rewords its statement, keeping every rule, so that two more fit in 500 characters:
    - unknown kinds are `other`: a true dish kind outside `DISH_KINDS`, or fluid kind outside `MEAL_FLUID_KINDS` (other than `none`, which is no fluid), counts as `other` and still pairs (a `pizza` dish is scored as `other`, not dropped);
    - a portion outside `PORTIONS` is unscored, as tray-comparison's design §15 already does (its "a null portion" is one case; a `30` is another).
  - A refactor, no requirement of its own: `tray-lab.ts` scores through the ward's `scoring.ts` (`pairDishes`, `portionAgreement`, `volumeError`, `tallyClasses`, `rate()`) and refuses through the shared `NEGATIVE_ISSUES`. Names are never read.
  - Its requests, flags and plan are tray-comparison's and unchanged: 3 / 1 per tray, 5 per pair, and a dry run without approval.
- **Bundle.**
  - The shell stays ≤ 120 KB gzipped, and each route's own chunks ≤ 50 KB.
  - The bars are part of read-outcomes' lazy `model-accuracy` chunk. They are its default view, so a chunk of their own would only add a third round trip. `/n` imports the section lazily, only for `?view=model`.
  - The build is measured in tasks.
- **Demo** (`scripts/demo-history.ts`, fictional): its photo meals get tray reads and links, with a reduced mix. That is mostly accepted, plus 1 edited at capture, 1 corrected by a nurse (a meal amend), 1 corrected by a fluid rejection, the existing 3A-4 voided duplicate as rejected, and 1 `not_a_meal` confirmed. It also has one open tray read for the browser check, and one retake: a photo meal more than 12 h old whose bed was read twice by the same staff 4 minutes apart, the first read never saved. A guard checks the mix, `retaken` = 1 with `abandoned` still 1. read-outcomes' guard expects 1 `negative_confirmed`; the same task changes it to 2 (photo 1, tray 1), checked per kind.

### Upstream model requests per user action (before → after)

| Action | Before | After |
|---|---|---|
| Tray read, `sam+spark` | 3 (5 with a served photo, tray-comparison) | 3 (5 with a served photo); the read is stored, which adds none |
| Tray read, `spark` (or downgraded by the budget) | 1 | 1 |
| Tray read refused by the budget, or answering 4xx before upstream | 0 | 0; no read stored |
| Photo read (3 / 1), text note (1), voice note (2) | unchanged | unchanged |
| Saving a linked meal; `GET /api/quality/model`; the views, toggle, picker and hospital view | 0 | 0 |
| Lab tray eval (tray-comparison's), per labelled photo with approval (`sam+spark` / `spark`) | 3 / 1 | 3 / 1 |
| Lab tray eval, per before/after pair with approval (`sam+spark` only) | 5 | 5 |
| Lab eval, a skipped photo or any run without approval | 0 | 0 |

### Config (named constants in `packages/shared`; code, no env or UI)

| Constant | Default | Used by |
|---|---|---|
| `TOP_CORRECTIONS` | `5` | the length of `top_corrections` |
| `READ_RETAKE_MINUTES` | `10` | a later `tray` read by the same staff for the same `admission_id` this soon makes an unlinked earlier one `retaken` |

Unchanged and reused: `READ_ABANDON_HOURS` (12), `VOLUME_TOLERANCE_ML` (25), `QUALITY_MAX_DAYS` (30), `MIN_N` (5), `QUALITY_DAYS` (7).

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `READ_KINDS` gains `tray`, and `CLASS_TABLES` gains `dish_kind`. Exhaustive maps (`KIND_LABEL`, `Record<ClassTable, …>`) must add them.
  - **BREAKING**: read-outcomes' `READ_OUTCOMES` gains `retaken`, after `abandoned`. `KindRow.outcomes` (a `Record<ReadOutcome, number>`) therefore gains `retaken`, and every `Record<ReadOutcome, …>` and `outcomes` fixture must add it.
  - **BREAKING**: `ModelQuality.kinds` holds six rows, not four (`tray` `sam+spark` and `tray` `spark` last). `ModelQuality` gains `containers`, `dish_portion`, `meal_portion`, `meal_fluid`, `positives` and `top_corrections`.
  - **BREAKING**: `KindRow` gains `edited_at_capture: Rate` and `corrected_by_nurse: Rate`, so every web `KindRow` fixture adds them. `KindRow.mode`'s comment becomes "Photo and tray reads only" (the tray rows carry `sam+spark` or `spark`).
  - `ModelQuality.negatives.overridden_as[].to` may be `'meal'` (a negative tray read charted as a meal).
  - `NEGATIVE_ISSUES` becomes `['no_container', 'not_a_meal']`, typed `readonly (ReadingIssue | MealIssue)[]`.
  - New: `TOP_CORRECTIONS`, `READ_RETAKE_MINUTES`, `trayDrafts`, `ContainerRow`, `PortionAgreement`, `MealFluidScore`, `Positives` (with `retaken`) and `TopCorrection`.
  - `MealInput` gains optional `read_id`.
- HTTP:
  - **BREAKING**: `POST /api/ai/meal` responses gain `read_id`. This is additive, but the web's typed result and fixtures now require it (`Logged<MealReadResult>`).
  - `POST /api/admissions/:id/meals` accepts `read_id`. A bad link gets 400 `invalid_request` at `read_id`.
  - **BREAKING**: the `GET /api/quality/model` body gains the fields above and two tray kind rows.

### Out of scope

- **Container or fluid-kind truth in the ward.** Container rows group by what the model read; the lab eval holds container truth (read-outcomes).
- **Dish-name scoring.** Names are free text and never stored in the log. Pairing uses `dish_kind`. A per-dish identity on the meal post is not added (design.md §4).
- **Per-fluid kinds in the ward.** A meal keeps one fluid total, so the ward scores that total. Fluid kinds are scored in the lab only.
- **Per-staff and per-ward comparison tables, trend lines, accuracy alerts and any automatic threshold change.** The hospital view is one hospital-wide summary.
- **Dark mode.** The app has one light theme. The palette is validated for light mode only, and a dark theme would re-run the validator on its own surface.
- **Augmented variants** in the tray eval (`augmented/variants.jsonl`). The dataset's `tools/score_classification.py` covers them.
- **Generating or verifying sidecars.** image-synthesis writes them, and a person verifies them.
- **A second tray eval, or new eval flags.** tray-comparison owns the tray eval; this change adds only its unknown-kind rule and moves its scoring onto `scoring.ts`.
- **Queued reads.** read-queue (being written, applied after this change) queues photo and note reads only, never tray reads, and saves and links what a queued read found on the server. It MODIFIES "Reads are logged" and "Outcome of a saved level", not this change's requirements (design.md, "Queued reads").
- **Retaken photo reads.** Photo reads stay as read-outcomes defines them: a second photo read by the same staff on the same bed within 10 minutes may be a different container (a urinal, then the water jug), so it is not a retake, and an unsaved first read still becomes `abandoned`.
- **The ward round.** It reads no trays, so `web/ward-round` is unchanged.

## Capabilities

### New Capabilities

None. Everything extends read-outcomes' `charting/model-accuracy` and the existing web capabilities.

### Modified Capabilities

- `capture/meal-reading`: MODIFIED **Tray reading** (`read_id`; the read is stored).
- `charting/model-accuracy`:
  - MODIFIED **Read log holds no text** (tray vocabularies; no names, masks, boxes or hashes), **Negative reads** (`not_a_meal`), **Unsaved drafts** (a `retaken` draft excepted), **Model accuracy summary** (six kinds, the per-outcome rates and the new parts) and tray-comparison's **Tray eval report** (unknown kinds count as `other`, portions outside `PORTIONS` unscored).
  - ADDED **Tray reads are logged**, **Link a meal to its read**, **Outcome of a saved meal**, **Retaken tray reads**, **Dish scoring**, **Portion agreement**, **Fluid with a meal**, **Outcomes per container**, **Top corrections** and **Positive drafts not kept**.
- `web/capture`: ADDED **Meal saves carry their read** (no `read_id` after an empty read; `already linked` on a retry shows as saved).
- `web/ward`:
  - MODIFIED **Model accuracy view** and **Hospital ward list** (cards in the Wards view only).
  - ADDED **Chart or table**, **Outcome bars**, **Outcome colours**, **Class table picker**, **Kept drafts, meal fluid and top corrections** and **Hospital model accuracy view**.

Seven of these modify requirements that in-flight changes add: "Read log holds no text", "Negative reads", "Unsaved drafts", "Model accuracy summary" and web "Model accuracy view" (read-outcomes), and "Tray reading" and "Tray eval report" (tray-comparison). `openspec validate` reports them as INFO until those changes archive.

## Impact

- `packages/shared/src/index.ts`: the types and constant above.
- `apps/server`:
  - `src/ai/read-log.ts`: the `tray` arm of `ReadOutput` and `readRow('tray', …)`, counting drafts with `trayDrafts`.
  - `src/chart/scoring.ts`: `pairDishes`, `portionAgreement` and `topCorrections`.
  - `src/chart/model-accuracy.ts`: the `tray` → meal row of `linkProblem`, meal outcomes, the `retaken` row, the per-outcome kind rates, container rows, positives, the dish and portion tables, and meal fluid.
  - `src/chart/tray-lab.ts` (tray-comparison's): scoring through `scoring.ts` and `NEGATIVE_ISSUES`, and unknown kinds as `other`.
  - `src/routes/ai.ts`: `/meal` records its read.
  - `src/routes/chart.ts`: `read_id` on `MealBody` and the link check before `addMeal`.
  - `src/store/store.ts`: the meal link in `addMeal`, and meal rows and each tray read's `retaken` flag in `readOutcomeRows`.
  - `scripts/eval.ts` and `scripts/demo-history.ts`.
- `apps/web`:
  - `lib/model-accuracy.ts`: tray labels, the seven-column kinds rows, the new rows and lines, picker options, empty texts and `hospitalView`.
  - New `lib/outcome-bars.ts` (geometry, legend, popup and label text); `lib/hues.ts` gains `SLOT` and `OUTCOME_HUE`, with `CATEGORY_HUE` over the same slots.
  - New `components/outcome-bars.tsx`, inside the `model-accuracy` chunk, and new `components/popover.tsx` beside `tooltip.tsx`, wrapping Base UI's Popover (already a dependency) in the tooltip's style.
  - `components/model-accuracy.tsx`: the toggle and picker; `components/form-fields.tsx`: `SelectField`, if the polish change has not added it.
  - `lib/meals.ts` and `components/meal-form.tsx`: `read_id` on the meal post (none after an empty read), the read stamp, and `already linked` on a retry shown as saved.
  - `lib/api.ts`: `readMeal` typed `Logged<…>`, and `modelQuality(ward | null, days)`.
  - `routes/n/index.tsx`: `validateSearch` and the toggle.
- Docs: README "Accuracy in the ward" (trays, charts, hospital view and the `retaken` outcome), a `docs/accuracy.md` "Trays" section, and `apps/web/DESIGN.md` §4.15 and §7.3 (the outcome-bar recipe and its exceptions).
- No new dependencies and no env vars. The palette validator is the dataviz skill's script, run during apply. Its report is recorded in design.md §7.
- **Order.** The apply order is tray-segmentation → read-outcomes → dietitian → acuity-budget → tray-comparison → bag-alerts → **accuracy-views** → dietitian-care → scale-store → postgres-store → read-queue. This change rebases on the archived text of read-outcomes, tray-segmentation, acuity-budget and tray-comparison (tasks.md group 0). The files it shares with them are listed in design.md, "Order and overlaps".
