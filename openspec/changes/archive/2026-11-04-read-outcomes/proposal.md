# Proposal

## Why

The only accuracy number Meniscus can show today is a lab eval of staged props (`docs/accuracy.md`). A ward wants to know how the models do on its own patients: how often a reading is saved as drafted, what staff change, and whether "nothing here" photos really held nothing. And the lab eval should say, per class, how well the photo read classifies real-world containers, positives and negatives alike.

Staff already decide every draft. They save it, adjust it first, or drop it, and a nurse approves, corrects, amends or rejects it. So Meniscus can measure the models in the ward at no extra model cost:
- record what the model classified on every read;
- link each saved record to the read it came from;
- compare the model's values with what staff finally kept, per class, for positives and negatives.

The lab eval then scores photo reads of containers with the same module, against the real-world dataset's labels.

## What Changes

- **Read log** (new `charting/model-accuracy`).
  - Every successful `POST /api/ai/read`, `/api/ai/note` and `/api/ai/voice-note` stores one `model_read` row and returns its `read_id`.
  - The row holds closed-list values, numbers and ids only:
    - the kind (`photo`, `text`, `voice`), the photo mode, the model ids, the signed-in staff member, the bed when given, the time;
    - confidence, issue codes, `needs_review`, any staff container hint, and the number of drafts;
    - the outputs: for a photo, container kind, fluid kind, volume, capacity, marks visible, urine colour, and the draft's type, volume and colour; for a note, each draft's type, volume and urine colour.
  - It never holds model free text: no transcript, note text, image, reading basis, appearance, draft item or notes, or reply. Nothing about a read is logged.
  - A failed read stores nothing, and Explain is not logged.
- **Reads name their bed.** The three endpoints accept an optional `admission_id`. An unknown one gets 404 before any model request, and it is never sent upstream.
- **Links.** Entry, level and bag-reading posts accept `read_id` (`POST /api/admissions/:id/entries`, `/levels`, and bag-emptying's `/bag-readings`), and entries also `read_draft` (the draft's index in a note, default 0). The link is stored in the same transaction, with no extra HTTP request. The server refuses a link, with 400 and nothing stored, when:
  - the read is unknown;
  - it was made by another staff member, names no bed, or names another bed;
  - it is `READ_ABANDON_HOURS` old or older;
  - it does not match the record's source;
  - it has no such draft, or that draft is already linked (`already linked` at `read_id`);
  - `read_draft` comes without `read_id`.

  On a bag reading these checks run before `addBagReading` (so before its 403 for an attendant's missed emptying). Bag-emptying's MVP has no duplicate check, so a linked reading posted again answers `already linked` and is not stored twice. A reading with no read sends no `read_id`: `source: "manual"`, and a photo whose level was typed (`source: "photo"`, a `media_id`, no evidence).
- **Outcomes, derived at query time** from the read, its links, and the linked records' status and events. Nothing is copied.
  - Each draft gets one outcome:
    - `accepted`;
    - `edited_at_capture`;
    - `corrected_by_nurse`;
    - `rejected`;
    - `pending`;
    - `open` (unsaved, still linkable for 12 h, negative drafts included);
    - `abandoned` (unsaved after `READ_ABANDON_HOURS`).
  - A jug level or bag reading is settled at save, as bag-emptying keeps it: `accepted`, or `edited_at_capture` when the saved level (`volume_ml`) differs from the drafted volume. Nothing later changes that: a nurse's action on the entry it charted, a bag reading that charts no entry (rise 0), its recomputed rise, a later fall or missed emptying, or an after-emptying residual.
  - A read is negative when it carries a negative issue code (`no_container`). It ends `negative_confirmed` or `negative_overridden`. Any other read with no draft is `nothing_drafted`, counted apart.
  - Records saved before this change have no link and are left out of every number.
- **Scoring.** One pure module compares the model's value with the final value, for the type, the volume (absolute error, within `VOLUME_TOLERANCE_ML` inclusive) and the urine colour. A jug level's final type is `water`, and a bag reading's is its bag's category (`BAG_CATEGORY`: urine, stoma or drain); both are scored against their saved level, with no colour.
- **Summary API.** `GET /api/quality/model?ward=<id>&days=<n>` (hospital-wide without `ward`; `days` 1 to `QUALITY_MAX_DAYS`, default 7). It returns:
  - per read kind and photo mode: outcome counts, rates, and the volume mean error with its share within tolerance;
  - the type and urine colour tables;
  - negatives confirmed against overridden, and reads with nothing drafted.

  Every percentage carries its count and denominator, is rounded down, and is null below `MIN_N` (5). It holds no patient, bed or staff name, and like every GET it needs no session.
- **Web.**
  - The ward's Data quality view gains a "Model accuracy" section (MODIFIED `web/ward` "Data quality view"), tables and text only:
    - a table of read kinds;
    - the "Drink and fluid" type table;
    - the volume error line and the negatives line.
  - Every rate reads `<pct>% · <n>/<of>`, or `— · <n>/<of>` when withheld.
  - The bed capture screen and the ward round send `admission_id` with each read and `read_id` with each save of a read's draft: entry, level or bag reading. By-hand saves send none ("Bag level" with a photo included), nor does the "Emptied it now?" emptying (`source: "manual"`). A draft whose read answered `READ_ABANDON_HOURS` less 5 minutes ago or more, by the device's clock, is saved without it, so a save at the edge is not refused. That decision is made once, at the first save attempt, and kept for retries, so a retry sends what the first attempt sent.
  - A round save marks each draft saved as it lands, so a retry posts only the rest, and a retried post answered `already linked` counts as saved.
- **Lab eval** (slim) scores container photos with the same scoring and constants, so lab and ward numbers mean the same thing. It takes:
  - `--container-labels <manifest.jsonl>`: labels from the real-world dataset's existing fields (`expected_container`, `expected_fluid`, `liquid_colour`, `expected_ml`, `ml_tolerance`, `expected_outcome`). The report gains class tables (container, fluid, urine colour) and an outcome table: expected positive, degraded and negative against drafted, flagged and refused;
  - `--no-hint`, so container accuracy is not given away by the hint.

  **Synthetic photos** (the rule moved here from image-synthesis, which now only writes them). The eval reads the provenance sidecar beside each photo (`synth-<id>.json`) as well as the manifest. A photo is synthetic when its sidecar or record says `synthetic: true`, or its name starts `synth-`. It is scored only when each of them has `label_status: "verified"` and a non-empty `verified_by`; others are skipped at no request. Its labels come from its record, else the sidecar's `labels`, never from its file name. Real and synthetic photos are reported in separate sections.

  It is still a dry run unless approved: a skipped photo costs nothing, each labelled one 3 requests (1 in `spark` mode).
- **Demo** (`scripts/demo-history.ts`, fictional): linked reads with a reduced mix.
  - Bag-emptying's demo bag readings saved with read evidence (HDU-1, 3A-3, 2C-5, 2C-6) get a read and a link; its after-emptying photo, and any reading seeded `manual` or as a typed-level photo, get none. Photo urine entries whose synthetic read is a `urine_bag` get none, because the app now saves such a photo as a bag reading. The fixed 3A-1 and 2C-3 records become `urinal` reads so they stay entries.
  - Mostly accepted, plus:
    - 1 edited at capture (a 3A-6 urinal, 300 → 400 mL);
    - 2 corrected by a nurse (the existing 3A-1 and 3A-2 records);
    - 1 rejected (the existing 2C-3 duplicate);
    - 1 abandoned;
    - 1 `no_container` negative confirmed and 1 overridden.
  - A guard checks the mix.

Model requests per user action: unchanged.

| Action | Before | After |
|---|---|---|
| Photo read (`sam+spark` / `spark`) | 3 / 1 | 3 / 1 |
| Text note | 1 | 1 |
| Voice note | 2 | 2 |
| Explain | 1 | 1 |
| Saving a linked entry, level or bag reading; `GET /api/quality/model`; the web view | 0 | 0 |
| Lab eval, per labelled photo with approval (`sam+spark` / `spark`) | 3 / 1 | 3 / 1 (a skipped photo, or a run without approval: 0) |

### Config (named constants in `packages/shared`; code, no env or UI)

| Constant | Default | Used by |
|---|---|---|
| `READ_ABANDON_HOURS` | `12` (one shift) | link refused at or after it; unsaved drafts become `abandoned` or `negative_confirmed` |
| `VOLUME_TOLERANCE_ML` | `25` (as the eval's `TOLERANCE_ML`, which it replaces) | within tolerance, inclusive, live and lab |
| `QUALITY_MAX_DAYS` | `30` | the largest `days` the summary accepts |
| `MIN_N` | `5` | a percentage over fewer items is null |

`QUALITY_DAYS` (7) stays the default window. `NEGATIVE_ISSUES` (`no_container`) is a new vocabulary constant beside `READING_ISSUES`.

### Changed shapes

- `packages/shared`:
  - New:
    - `READ_KINDS`, `ReadKind`, `READ_OUTCOMES`, `ReadOutcome`, `NEGATIVE_ISSUES`;
    - `ReadRef` (`{ read_id }`), `Logged<T>`;
    - `Rate`, `VolumeError`, `CLASS_TABLES`, `ClassTable`, `ClassRow`, `KindRow`, `ModelQuality`;
    - the constants above.
  - `EntryInput` gains optional `read_id` and `read_draft`; `LevelInput` and bag-emptying's `BagReadingInput` gain optional `read_id`.
  - `CaptureReadResult` and `NoteResult` are unchanged: the pipelines still return them. The routes return `Logged<…>`.
- HTTP:
  - **BREAKING**: `POST /api/ai/read`, `/api/ai/note` and `/api/ai/voice-note` responses gain `read_id`. This is additive, but the web's typed results and test fixtures now require it.
  - The same three endpoints take an optional `admission_id` (a form field, or JSON for `/note`). An unknown one gets 404 `not_found`.
  - `POST /api/admissions/:id/entries`, `/levels` and `/bag-readings` accept the link fields (`/bag-readings`: `read_id` only). A bad link gets 400 `invalid_request` with an issue at `read_id` or `read_draft`.
  - New `GET /api/quality/model`.

### Deferred to a follow-up change

On tray-segmentation's archived MVP, which has tray reads of 3 requests (1 in `spark` mode), `image_sha256`, `Meal.dishes` and `Meal.proof`, but no `admission_id` on `/api/ai/meal`, no 5-request served-photo path and no `meal_event`:
- Tray reads in the log: the MODIFIED `capture/meal-reading` "Tray reading", the `tray` kind row, `/api/ai/meal` in the read-log requirements with its own `admission_id`, and `not_a_meal` as a negative issue.
- Dish and portion tables, and their scoring.
- Meal links: `MealInput.read_id`, `read_id` on `POST /api/admissions/:id/meals`, and the meal form sending it. With no meal amendments, a meal can only be accepted, edited at capture or rejected (voided).

Bag-emptying deferred its **duplicate bag photo** check (409 `duplicate_reading`, `confirm_duplicate`, "Save anyway"), so nothing here specifies or tests a 409. When that change lands, it should run its check after the link check, so a re-post still answers `already linked`, a 409 links nothing, and "Save anyway" resends the same `read_id`.

### Out of scope

- **Web extras.** Outcome bars, the Chart | Table toggle, the class-table picker, the hospital view (`/n?view=model`), the per-container table, the overall top-corrections list, and the bundle measurement task.
- **Container and fluid-kind truth in the ward.** Entries carry no container and no fluid kind, and staff cannot correct either. The ward compares types, not containers. Container and fluid confusion come from the lab eval. A structured `container` on entries and in amend is a follow-up.
- **"Chart it anyway"** for a photo read with no draft. Staff who then chart by hand make an unlinked entry, which leaves that read `negative_confirmed` (a known bias; see design.md Risks).
- **Per-staff model statistics.** There is no per-person breakdown, so this cannot become a performance tool.
- **Nurse corrections of a bag reading.** Bag-emptying never changes a stored reading, and the entry it charts holds a rise, not the level the model read. Approving, amending or rejecting that entry therefore counts as nothing here.
- **Writing sidecars or verifying synthetic labels.** image-synthesis writes sidecars, and a person verifies them. The eval only reads them.
- **Augmented variants** (`augmented/variants.jsonl`) in the lab eval; the dataset's own `tools/score_classification.py` covers them.
- **Purging the read log**, backfilling links for older entries, alerts on accuracy, and any automatic threshold change.
- **Explain** is a summary, not a classification, so it is not logged.

## Capabilities

### New Capabilities
- `charting/model-accuracy`: the read log and what it may hold, reads naming their bed, links from saved entries, levels and bag readings to reads and their checks, the outcome of every draft (entries, levels and bag readings; positives, negatives, nothing drafted), field scoring shared with the lab eval, the summary API with its stability rule, older stores, and the lab eval's labels, synthetic photos and per-class report.

### Modified Capabilities
- `web/ward`: **Data quality view** gains the Model accuracy section. Adds **Model accuracy view** and **Rates shown with their counts**.
- `web/capture`: adds **Reads and saves carry their read** (entry, level and bag-reading saves).
- `web/ward-round`: adds **Round reads and saves carry their read** and **Round saves resume after a failure**.

## Impact

- `packages/shared/src/index.ts`: the types and constants above.
- `apps/server`:
  - New `src/ai/read-log.ts`: the pure projection from a pipeline result to a read row, closed-list values and numbers only.
  - New `src/chart/scoring.ts`: field comparison, rates and volume error, shared by the summary and the eval.
  - New `src/chart/model-accuracy.ts`: the pure link checks, the outcome per draft and the summary.
  - New `src/chart/lab.ts`: the eval's dataset labels and per-class lab report, over `scoring.ts`.
  - New `src/routes/quality.ts`: `GET /quality/model`, mounted in `src/app.ts`.
  - `src/routes/ai.ts`: `admission_id`, recording the read, `read_id`.
  - `src/routes/chart.ts`: the link fields on the entry and level bodies, and the link check.
  - `src/routes/bags.ts` (bag-emptying's): `read_id` on the bag-reading body, and the link check before `addBagReading`.
  - `src/store/store.ts`:
    - the `model_read` and `read_link` tables;
    - `recordRead`, `read` and `linked`;
    - links in `addEntry`, `addLevel` and `addBagReading`;
    - `readOutcomeRows(since, wardId?)`.
  - `scripts/eval.ts` and `scripts/demo-history.ts`.
- `apps/web`:
  - New `lib/model-accuracy.ts` and `components/model-accuracy.tsx` (a lazy chunk).
  - Updated: `lib/api.ts`, `lib/capture.ts`, `lib/bags.ts` (bag-emptying's), `lib/round.ts`, `routes/a/bed.$token.tsx`, `components/ward-quality.tsx`.
- `README.md` ("Accuracy in the ward") and `docs/accuracy.md` (a short section on the labels flag, `--no-hint`, negatives and synthetic photos).
- No new dependencies and no env vars.
- **Order.** The global apply order is care-plan → bag-emptying → tray-segmentation → read-outcomes → dietitian, with image-synthesis in parallel and scale-acuity last. This change starts once bag-emptying and tray-segmentation are archived, and rebases on their archived specs and code. It edits no requirement of theirs; the files it shares with them are in design.md, "Order and overlaps".
