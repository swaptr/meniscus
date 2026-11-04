# Design

## Context

Motivation is in proposal.md, under "Why". This change applies after care-plan, bag-emptying and tray-segmentation are archived ("Order and overlaps"), so the state below is theirs where they change it. The current state that shapes the approach:

- **AI routes** (`apps/server/src/routes/ai.ts`):
  - `/read` (`:63`), `/note` (`:72`) and `/voice-note` (`:86`) call the pipelines and return their result as is, saving nothing. `/meal` (`:67`) is left alone here (Deferred).
  - They know no bed: a read carries an image or text and an optional container `hint`.
  - They are POSTs, so the app-level `session` (`routes/common.ts`) has already set `c.get('staff')`.
  - `aiRoutes` is a plain `new Hono()`, not typed with `Env`.
- **Pipelines** (`src/ai/pipeline.ts`) return `CaptureReadResult` and `NoteResult`.
  - A photo's draft is `toDraft(reading)` (`src/ai/draft.ts`): null when neither the fluid nor the container maps to a type, so container `other` with fluid `other` has no draft, and container `none` with fluid `water` has one.
  - Notes carry no issue codes. A note with no `log_entry` call has `entries: []` and a `reply`.
  - The eval script (`scripts/eval.ts`) calls `createAi(livePorts).readCapture` directly, with no store and no HTTP. It passes the file's container as `hint` (`eval.ts:106`) and scores at a private `TOLERANCE_ML = 25` with `<=` (`:26`).
- **What staff can change.** A draft becomes a record, and staff change it at two points:
  - **Before saving.** The check screen (`routes/a/bed.$token.tsx`) changes an entry's type, volume and urine colour, not its `item` or container, and a jug level's or a bag reading's level (with the bag's event).
  - **After saving.** A nurse changes entries only: approving at another volume (`approved_ml ≠ recorded_ml`, `chart/quality.ts` `isCorrected`), rejecting, or amending the type within its direction, the volume or the urine colour. Levels and bag readings are never reviewed or edited; a bag reading's rise entry is reviewed like any entry.
- **History already holds the facts.**
  - `entry.recorded_ml` is the volume at save. The `recorded` event's `to_category` is the type at save.
  - Each `amended` event records `from_ml`/`to_ml` and `from_category`/`to_category` always, and `from_colour`/`to_colour` (and, with care-plan, `from_iddsi`/`to_iddsi`) only when that field changed (`store.ts` `amend`).
- **Evidence is not enough.** Photo and note evidence (`routes/evidence.ts`) already carries the model's reading on the saved entry. But it is client-reported, it is deleted on rejection ("Rejected entries drop their photo"), and it does not exist for reads never saved. A server-side log is needed.
- **Store.** One SQLite file with STRICT tables and epoch-ms columns.
  - `openStore` (`store.ts:855`) runs `rebuildStaff → migrate → SCHEMA → migrateMedia → migrateCare → migrateBags → migrateTray → seeds → backfill`.
  - `addEntry` and `addLevel` each run in `tx()`.
- **Bag readings (bag-emptying).**
  - A photo, or a level typed by hand, of a `urine_bag`, `stoma_bag` or `drain_bag` is saved through `POST /api/admissions/:id/bag-readings` (`routes/bags.ts`) as a `level` row with a non-null `event` (`check`, `emptied`, `bag_changed`), not as an entry. The body is `BagReadingInput`: `container`, `event`, `volume_ml`, `source` (`photo` | `manual`), and for a photo `media_id`, plus `confidence` and `evidence` when it came from a read; also `notes`, `urine_colour`, `urine_rgb` and `charted_at`.
  - Three sources reach it: a read photo (`photo`, `media_id`, evidence); a photo with the level typed (`photo`, `media_id`, no evidence), which has no read; and a level by hand (`manual`, no media), which includes the "Emptied it now?" emptying posted after a check.
  - The route checks the body (400), the admission (404), `charted_at` and the media. `store.addBagReading` then runs one transaction: load the reading before and after the charted time, the fall guard (an attendant's `emptied` or `bag_changed` inside a fall's gap throws `Forbidden`, 403, nothing stored), `charge`, insert the level, then the `out` entry of `BAG_CATEGORY[container]` for Δ when it is above 0.
  - Bag-emptying's MVP has no duplicate check: a reading posted twice is stored twice (a check charts nothing more, an emptying charts again), and the nurse rejects the extra entry as `duplicate`.
  - A stored reading is never edited: its `volume_ml` (the level), `event` and `source` stay as saved. Its entry, if any, holds Δ (the rise, or less for a late reading), not the level, and is reviewed like any entry. `rise_ml`, `fell` and `fell_from_ml` are recomputed on read; a residual comes later through the after-emptying route. The level row has no urine colour: the colour goes on the entry, and is lost with no entry.
  - The web saves a bag draft with a volume through `lib/bags.ts` (media upload, then `api.addBagReading`), from the check screen and the round. A urinal still saves as an entry.
- **Trays (tray-segmentation).** `/api/ai/meal` makes 3 requests (1 in `spark` mode), returns `image_sha256`, and takes no `admission_id`. Meals carry `dishes` and `proof`. There is no served-photo path and no `meal_event`.
- **Web.**
  - `api.read(photo, hint, signal, mode)`, `note(text, signal)` and `voiceNote(audio, signal)` (`lib/api.ts`) are called from `routes/a/bed.$token.tsx:191/229/279` and `lib/round.ts:307/319`.
  - Drafts live in `Pending` (`lib/capture.ts`).
  - `Round.#saveVoice` (`lib/round.ts:370-385`) posts one entry per draft in a loop and marks the reading saved only after the last. A failure midway throws, the reading stays `ready`, and the card says "not saved. Try again." A retry posts every draft again, so the drafts that landed are posted twice. `uploadOnce` (`lib/media.ts`) caches the upload per blob, so a retry does not upload again.
  - `ApiError` (`lib/api.ts:49`) keeps status, code and message, not the 400's `issues`.
  - The ward's Data quality view is a lazy chunk (`routes/n/w.$ward.tsx:48`) inside `AccessGate` (`:55`).
- **Dataset** (`/home/swapnil/repo/hackathons/attend-realworld-dataset/`). It is being rebuilt, so counts move. On 2026-11-03 its `manifest.jsonl` has 179 records, all `record_type: original`. The fields this change uses:
  - `id`, and `eval_files` copies named `<container>-<ml>-<id>.jpg`;
  - `expected_container` (our `CONTAINER_KINDS`, or null), `expected_fluid` (our `FLUID_KINDS`);
  - `liquid_colour` (our `URINE_COLOURS`, or `clear` / `n/a`), `expected_ml` (null when unknown), `ml_tolerance`;
  - `expected_outcome`: `positive` (97), `degraded` (38) or `negative` (44);
  - `synthetic`: `false` on every record; no record has `label_status` or `verified_by` yet.

  The dataset's own `tools/score_classification.py` reads the same manifest fields.
- **Synthetic images (image-synthesis).** A dev script writes `synth-<id>.<ext>` and, beside it, the sidecar `synth-<id>.json`: `id` (the file name without extension), `synthetic: true`, `label_status: "draft"`, `verified_by: null`, provenance (model, prompt, hashes, `source_ids`), and `labels` with the manifest's field names (`expected_container`, `expected_fluid`, `liquid_colour`, `expected_ml`, `ml_tolerance`, `expected_outcome`) plus an opaque `truth` object. A person verifies an image by setting `label_status: "verified"` and `verified_by`; `verified` with `verified_by: null` counts as draft. The dataset's tooling copies verified sidecars into the manifest, with the record `id` equal to the sidecar `id`. image-synthesis has no eval requirement: the rule for synthetic photos in the eval is this change's.
- **Demo seed.** `scripts/demo-history.ts` builds every photo urine entry's synthetic read as a `urine_bag` (`:365`), including the fixed 3A-1 (450 → 400 mL at approval) and 2C-3 (duplicate, rejected) records. Bag-emptying turns the routine urine rows of its bag beds (HDU-1, 3A-3, 2C-5, 2C-6) into readings through `store.addBagReading`, and leaves the others as entries.

## Goals / Non-Goals

**Goals:**
- Zero extra model requests and zero extra HTTP requests on any capture or save path.
- Outcomes derived from facts the store already keeps, plus one read row and one link per draft. Nothing is copied that can drift.
- One scoring module for the ward summary and the lab eval.
- Honest denominators: every percentage carries its count, small counts are withheld, and open, pending, abandoned, negative and nothing-drafted items are kept out of acceptance rates.

**Non-Goals:**
- Tray reads, meal links, and dish or portion scoring (Deferred, below).
- Ground truth for containers or fluid kinds in the ward (proposal, Out of scope).
- Per-staff statistics, trend lines, or alerting on accuracy.
- Changing what drafts contain, or any prompt.

## Types (`packages/shared`)

```ts
// ---------- model accuracy: the read log and its summary (no model requests) ----------

export const READ_KINDS = ['photo', 'text', 'voice'] as const
export type ReadKind = (typeof READ_KINDS)[number]

/** One per draft, or one per read that has none. Display order. */
export const READ_OUTCOMES = [
  'accepted', 'edited_at_capture', 'corrected_by_nurse', 'rejected', 'pending', 'open', 'abandoned',
  'negative_confirmed', 'negative_overridden', 'nothing_drafted',
] as const
export type ReadOutcome = (typeof READ_OUTCOMES)[number]

/** Issue codes that make a read negative ("nothing to chart here"), even with a draft. The tray follow-up adds `not_a_meal`. */
export const NEGATIVE_ISSUES = ['no_container'] as const satisfies readonly ReadingIssue[]

// Config (code constants; see proposal.md "Config")
/** A draft unsaved this long after its read is abandoned; links to a read this old are refused. */
export const READ_ABANDON_HOURS = 12
/** A volume this close to the final value counts as right (inclusive), in the ward and in the lab eval. */
export const VOLUME_TOLERANCE_ML = 25
/** Largest `days` GET /api/quality/model accepts. The default is QUALITY_DAYS. */
export const QUALITY_MAX_DAYS = 30
/** Stability rule: a percentage over fewer items is withheld (null); the count is always shown. */
export const MIN_N = 5

/** On every photo, text and voice read response (`read_id` of the stored read). */
export interface ReadRef {
  read_id: number
}
export type Logged<T> = T & ReadRef

export interface EntryInput {
  // …existing fields (care-plan's iddsi_level included)…
  /** The read this entry was drafted from, and which of its drafts (a note's index; default 0). Needs `read_id`. */
  read_id?: number
  read_draft?: number
}
export interface LevelInput {
  // …
  read_id?: number
}
/** bag-emptying's body for POST /api/admissions/:id/bag-readings. */
export interface BagReadingInput {
  // …existing fields (container, event, volume_ml, source, media_id, confidence, evidence, notes, urine_colour, urine_rgb, charted_at)…
  /** The photo read this reading was drafted from (`source: 'photo'` with its evidence). A typed-level photo has no read and sends none. */
  read_id?: number
}

/** A share with its count. `pct` is `floor(100 n / of)`, null when `of` < MIN_N. */
export interface Rate {
  n: number
  of: number
  pct: number | null
}
/** Model volume against the final volume, over settled drafts with both. */
export interface VolumeError {
  of: number
  /** Mean absolute error in mL, rounded to the nearest mL; null when `of` < MIN_N. */
  mae_ml: number | null
  /** |error| ≤ VOLUME_TOLERANCE_ML. */
  within: Rate
  /** Settled drafts where the model read no volume and staff entered one. */
  no_volume: number
}

export const CLASS_TABLES = ['type', 'urine_colour'] as const
export type ClassTable = (typeof CLASS_TABLES)[number]

export interface ClassRow {
  /** The model's class as stored: an EntryCategory, or a UrineColour or 'none'. */
  model: string
  /** Decided drafts with this class. */
  n: number
  /** Settled drafts whose final value equals the model's. */
  kept: Rate
  /** What staff changed it to, most first. */
  corrections: { to: string; n: number }[]
}

export interface KindRow {
  kind: ReadKind
  /** Photo reads only. */
  mode: ReadMode | null
  /** Drafts, plus reads with none. */
  drafts: number
  outcomes: Record<ReadOutcome, number>
  /** Over decided drafts (accepted + edited_at_capture + corrected_by_nurse + rejected). */
  accepted: Rate
  /** edited_at_capture + corrected_by_nurse. */
  corrected: Rate
  rejected: Rate
  volume: VolumeError
}

/** Response of GET /api/quality/model. No patient, bed, MRN or staff name anywhere. */
export interface ModelQuality {
  /** Null for the whole hospital. */
  ward: Ward | null
  since: string
  days: number
  min_n: number
  tolerance_ml: number
  /** Always four rows: photo sam+spark, photo spark, text, voice. */
  kinds: KindRow[]
  /** Rows sorted by n descending, then by class. */
  classes: Record<ClassTable, ClassRow[]>
  volume: VolumeError
  negatives: {
    /** Over confirmed + overridden. */
    confirmed: Rate
    overridden: Rate
    /** What staff saved instead: an EntryCategory (a jug level counts as `water`, a bag reading as BAG_CATEGORY of its bag). */
    overridden_as: { to: string; n: number }[]
    /** Reads with no draft and no negative issue. Not a negative. */
    nothing_drafted: number
  }
}
```

`CaptureReadResult` and `NoteResult` are **not** changed. The pipelines keep returning them, so the eval and every pipeline test need no store. The routes return `Logged<…>`, and the web's `api.read`, `note` and `voiceNote` are typed `Logged<…>`. `Entry`, `Level` and `EntryEvent` are not changed either: records do not return their `read_id`, so no record fixture changes.

## Decisions

### 1. Data model: a read table and a link table

```sql
CREATE TABLE IF NOT EXISTS model_read (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- never reused: a stale client must not link a newer read
  kind TEXT NOT NULL,                            -- photo | text | voice
  mode TEXT,                                     -- photo: sam+spark | spark
  models TEXT NOT NULL CHECK (json_valid(models)),   -- distinct trace models, in call order
  hint TEXT,                                     -- photo: the staff container hint (a ContainerKind)
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  admission_id INTEGER REFERENCES admission(id),
  created_at INTEGER NOT NULL,
  confidence REAL,                               -- null for notes
  issues TEXT NOT NULL CHECK (json_valid(issues)),   -- issue codes only
  needs_review INTEGER NOT NULL,
  drafts INTEGER NOT NULL CHECK (drafts >= 0),
  output TEXT NOT NULL CHECK (json_valid(output))    -- ReadOutput: closed-list values and numbers only
) STRICT;
CREATE INDEX IF NOT EXISTS model_read_created ON model_read (created_at);
CREATE TABLE IF NOT EXISTS read_link (
  read_id INTEGER NOT NULL REFERENCES model_read(id),
  draft INTEGER NOT NULL,
  entry_id INTEGER UNIQUE REFERENCES entry(id),
  level_id INTEGER UNIQUE REFERENCES level(id),
  meal_id INTEGER UNIQUE REFERENCES meal(id),     -- unused until the tray follow-up; here so it needs no table rebuild
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (read_id, draft),
  CHECK ((entry_id IS NOT NULL) + (level_id IS NOT NULL) + (meal_id IS NOT NULL) = 1)
) STRICT;
```

`output` is a server-internal type, in `src/ai/read-log.ts` (domain):

```ts
interface DraftFacts { category: EntryCategory; volume_ml: number | null; urine_colour: UrineColour | null }
type ReadOutput =
  | { kind: 'photo'; container: ContainerKind; fluid: FluidKind; volume_ml: number | null; capacity_ml: number | null
      marks_visible: boolean; urine_colour: UrineColour | null; draft: DraftFacts | null }
  | { kind: 'text' | 'voice'; drafts: DraftFacts[] }
```

- **Why a link table** and not `read_id` columns on `entry` and `level`:
  - `PRIMARY KEY (read_id, draft)` makes "linked twice" a constraint across record tables, which per-table columns cannot enforce.
  - It is purely additive. It touches neither the `entry` DDL nor care-plan's `migrateCare`.
  - Every outcome query starts from the read, so the join is one-way.
- **Why JSON for `output`.** The shapes differ, the log is written once and read only by the summary, and `json_valid` guards it, as `care_order.value` does in care-plan. No query filters on a class; the summary folds in memory.
- **`AUTOINCREMENT`** for the same reason as `media`: ids are never reused.
- **Retention.** Rows stay with the chart. A row is a few hundred bytes, about one per capture.

### 2. Recording a read (`src/routes/ai.ts`, HTTP; `src/ai/read-log.ts`, domain)

- `aiRoutes` becomes `Hono<Env>`. `ReadForm` and `AudioForm` gain `admission_id: FormId.optional()`, where `FormId` is `/^[1-9]\d{0,15}$/` transformed to a number; `NoteBody` gains `admission_id: z.number().int().positive().optional()`. `MealForm` is unchanged.
- A `bedFound` middleware answers 404 `not_found` for an unknown `admission_id`. It runs after zod and before any pipeline call, so a 404 makes no model request.
- After the pipeline returns, the handler calls `store.recordRead(readRow(kind, result, { staffId, admissionId, hint }))` and answers `{ ...result, read_id }`. A thrown pipeline error skips this, so a failed read stores nothing. Explain and `/meal` are untouched.
- **`readRow` is the privacy boundary.** It is pure and in the AI domain layer, because it knows the pipeline result shapes. It copies only enumerated fields:
  - photo: container, fluid, volume, capacity, marks visible and urine colour, plus the draft's category, volume and colour; never `reading_basis`, `appearance`, `urine_rgb`, `item` or `notes`;
  - notes: each draft's category, volume and colour; never the transcript, `reply`, turns, `item` or `notes`.

  It then parses the row with `ReadOutputSchema`, a zod schema of `z.enum` vocabularies, numbers and booleans only, so a free-text field added later fails in tests rather than reaching the table. Issues are parsed with `z.enum(READING_ISSUES)`.
- `models` is the distinct `trace[].model` in call order. `drafts` is `draft ? 1 : 0` for a photo and `entries.length` for a note. A note's `confidence` is null and its `needs_review` false.
- `admission_id` is read from the request and passed to `readRow` only, never into the pipeline input, so it cannot reach a prompt.
- Request counts are untouched: recording is one synchronous SQLite insert after the model calls.

### 3. Links and their checks (`src/routes/chart.ts`, HTTP; `src/chart/model-accuracy.ts`, domain)

- `EntryBody` gains `read_id: z.number().int().positive().optional()` and `read_draft: z.number().int().min(0).max(49).optional()`, with a refinement: `read_draft` without `read_id` is an issue at `read_draft`. `LevelBody` and bag-emptying's bag-reading body (`routes/bags.ts`) gain `read_id`.
- **Order in each handler.** First the existing checks: the body, 404, `charted_at` and media. Then `linkProblem(store.read(read_id), store.linked(read_id, draft), ctx)`, which returns null or `{ path, message }` for a 400 `invalid_request`. Then the insert: `addEntry`, `addLevel`, or `addBagReading`.
- **Bag readings.** The link check runs after the route's checks and before `addBagReading`, so before its fall guard:
  - a re-post of a linked reading (its response lost) answers `already linked` and stores nothing, which the round reads as saved (§8). With no duplicate check in bag-emptying's MVP, this is the only thing that stops a re-posted emptying from charting twice;
  - an attendant's emptying inside a fall's gap passes the link check, then gets the 403 inside the transaction, which rolls back the reading and the link;
  - a reading without `read_id` stores no link: every `manual` reading (the "Emptied it now?" emptying included) and every typed-level photo.

  `addBagReading` takes the optional `readId` and inserts the `read_link` row (draft 0, `level_id` = the reading) after the level, inside its transaction. The link names the reading, never the entry it charts, so a rise of 0 (no entry) still links.
- `linkProblem(read, linked, ctx)` is pure; `linked` is a parameter so the function needs no store. It applies, in order:
  1. the read exists (`read_id`);
  2. it is by the session's staff member (`read_id`);
  3. it names an admission, and that is the record's (`read_id`; a bedless read is refused);
  4. `now − created_at < READ_ABANDON_HOURS h` (`read_id`);
  5. the kind matches the record and source (table below; `read_id`);
  6. `draft < drafts` (`read_draft`);
  7. `!linked`, else `{ path: 'read_id', message: 'already linked' }`. This message is a contract: the round's retry relies on it (§8).

| Read kind | Record | Source |
|---|---|---|
| `photo` | entry | `photo` |
| `photo` | level (jug or bottle) | `photo` |
| `photo` | bag reading (a level with an `event`) | `photo` from a read; a `manual` reading with `read_id` is refused. A typed-level photo has no read and sends none |
| `text` | entry | `text` |
| `voice` | entry | `voice` |

- **The insert.** `store.addEntry`, `addLevel` and `addBagReading` insert the `read_link` row inside their existing transaction, after the record.
  - The check and the insert run in one synchronous handler, with no `await` between them, so the check is atomic in this single-process server. The primary key is the backstop: a conflict throws `ReadLinkTaken` inside the transaction, which rolls back the record, and the route (`chart.ts` or `bags.ts`) maps it to the same `already linked` 400.
  - A level links the level, not its drop entry; a bag reading links the reading, not its rise entry.
- **Same staff and the read's own bed**, not the outline's "same staff session or same admission" (see §12).

### 4. Outcome derivation (`src/chart/model-accuracy.ts`, domain, pure)

`store.readOutcomeRows(since, wardId?)` reads:
- the reads in the window, with the ward from `read.admission_id` (every linkable read names one; a bedless read counts hospital-wide only);
- their links, each with, for an entry, status, current category, volume and colour, `recorded_ml`, `approved_ml` and the `recorded` event's `to_category`; for a level, its volume, `container` and `event` (non-null for a bag reading);
- the `amended` events of the linked entries.

`outcomes(rows, now)` gives each item (each draft, or a read with none) one outcome. The first matching row wins:

| # | Item | Condition | Outcome |
|---|---|---|---|
| 1 | read with 0 drafts, negative | — | `negative_confirmed` |
| 2 | read with 0 drafts | — | `nothing_drafted` |
| 3 | unlinked draft | `now − created_at < READ_ABANDON_HOURS` | `open` |
| 4 | unlinked draft of a negative read | otherwise | `negative_confirmed` |
| 5 | unlinked draft | otherwise | `abandoned` |
| 6 | linked draft of a negative read | entry rejected (a level or bag reading always stands) | `negative_confirmed` |
| 7 | linked draft of a negative read | otherwise | `negative_overridden`, with what was saved: the entry's category, `water` for a jug level, `BAG_CATEGORY[container]` for a bag reading |
| 8 | entry | status `pending` | `pending` |
| 9 | entry | status `rejected` | `rejected` |
| 10 | entry | `approved_ml ≠ recorded_ml`, or an `amended` event with `from_ml ≠ to_ml`, `from_category ≠ to_category` or `from_colour ≠ to_colour` | `corrected_by_nurse` |
| 11 | entry | `recorded_ml`, the save-time category or the save-time colour differs from the draft | `edited_at_capture` |
| 12 | jug level or bag reading | saved level ≠ draft volume | `edited_at_capture` (settled at save: the nurse reviews a bag reading's rise entry, never the reading) |
| 13 | any | — | `accepted` |

How the conditions are worked out:
- **Negative read**: `issues ∩ NEGATIVE_ISSUES ≠ ∅`. Only photo reads carry issue codes, and a photo read has at most one draft. A note with no drafts, or a photo with no draft and no negative issue (container `other`, fluid `other`), is `nothing_drafted`.
- **Save-time colour**: the `from_colour` of the first `amended` event with `from_colour ≠ to_colour`, else the current colour. Colours are compared as names; `urine_rgb` is ignored.
- **A consistency-only amend** (care-plan's `iddsi_level`) leaves ml, category and colour equal, so rule 10 does not fire.
- **Bag readings** follow bag-emptying's record: the reading is stored once and never edited, and its entry, if any, holds Δ, not the level the model read. So rules 8–11 never apply to it: approving that entry at another volume, amending it or rejecting it leaves the read `accepted` or `edited_at_capture`. Only the saved `volume_ml` is compared with the draft's volume (rule 12). A reading with no entry (rise 0), its recomputed rise, a later fall or missed emptying, and an after-emptying residual change nothing. The bag's category is scored in the type table, not in the outcome; there is no colour score, as the level row holds no colour.
- **Precedence**: pending and rejected first, because they have no final value; then the nurse's change over the attendant's, because the nurse's is the last word.
- **Decided** = accepted + edited_at_capture + corrected_by_nurse + rejected. **Settled** = decided − rejected. `open`, `pending`, `abandoned`, the negatives and `nothing_drafted` count in no kind rate. Negative rates are over confirmed + overridden; open negative drafts count in neither.

### 5. Field scoring (`src/chart/scoring.ts`, domain, pure)

Both consumers live in `apps/server`: the summary (`src/chart/model-accuracy.ts`) and the eval (`scripts/eval.ts`, through `src/chart/lab.ts`). The web only renders the computed summary. So the module lives in the server, not in `packages/shared` (see §12). The constants it uses are in shared.

```ts
/** Floored: 199/200 → 99, 3/7 → 42. Exact for integer n and of (division is correctly rounded). */
export const rate = (n: number, of: number, minN = MIN_N): Rate => ({ n, of, pct: of >= minN ? Math.floor((100 * n) / of) : null })
/** null when either side is null. `within` is inclusive. */
export const volumeError = (model: number | null, final: number | null, tol = VOLUME_TOLERANCE_ML) => …  // { abs_ml, within } | null
export function summariseVolume(pairs: { model: number | null; final: number | null }[], tol?, minN?): VolumeError
/** One row per class: n, kept, corrections. `by: 'model'` in the ward (what happens when the model says X); `by: 'final'` in the lab (recall per true class). */
export function tallyClasses(rows: { model: string; final: string | null; settled: boolean }[], by: 'model' | 'final'): ClassRow[]
```

Each field is scored against the final record:

| Field | Model value | Final value | Where |
|---|---|---|---|
| type | draft category | current entry category; jug level `water`; bag reading `BAG_CATEGORY[container]` (urine, stoma or drain) | `type` table |
| volume | draft volume (entry, level or bag reading) | current entry volume; the saved level | kind rows and `volume` |
| urine colour | draft colour, or `none` | entries only: current colour, or `none`; scored when either is urine | `urine_colour` table |

- **Rounding.** `pct` is floored, so a rate never reads higher than it is (199/200 shows 99%, not 100%). `mae_ml` is `Math.round(sum / of)`, so 161 / 5 gives 32.
- **Stability rule.** `MIN_N = 5`: below five items, one item moves a percentage by 20 points or more, so the percentage is withheld and only `n/of` shows. The mean volume error follows the same rule.
- **Corrections.** `(model, final)` pairs with `model ≠ final`, counted, sorted by count descending, then `to` ascending.
- **Lab parity.** The eval calls the same `rate`, `volumeError`, `summariseVolume` and `tallyClasses`, with the truth label as `final`. So "within ±25 mL" and "— below MIN_N" mean the same thing in both.

### 6. Summary API (`src/routes/quality.ts`, HTTP)

- New `qualityRoutes(store)` with `.get('/quality/model', …)`, mounted in `app.ts` beside `chartRoutes`.
- `validate` (`routes/validate.ts:7`) gains the `'query'` target. The query schema is `{ days: z.coerce.number().int().min(1).max(QUALITY_MAX_DAYS).optional(), ward: z.string().optional() }`.
- `ward` goes through `id()` and `store.ward()`: 404 when missing or malformed, as `GET /admissions?ward=` does.
- `since = now − days × 24 h`, over the reads' `created_at`. Outcomes are computed as of `now`.
- The body is `ModelQuality`. `modelQuality(rows, now, { ward, days })` is pure, and `kinds` always holds the four rows.
- **Access.** It is a GET, so it needs no session ("Signed-in changes: Reads stay open"). The ward screen is behind `AccessGate` in the web, as all ward data is. The body has no names, beds or MRNs, only classes and counts.

### 7. Privacy

- **Stored**: closed-list values (kind, mode, model ids, container kind, fluid kind, entry type, urine colour, issue codes), numbers, booleans, ids (staff, admission) and times. No model free text at all; `ReadOutputSchema` enforces it.
- **Never stored**: the transcript, note text, `reply`, image bytes, `reading_basis`, `appearance`, draft `item` or `notes`, timed turns, segmentation boxes or the sampled colour.
- **Never sent upstream**: `admission_id`. It is not part of any pipeline input, and a test compares the Spark request bodies with and without it.
- **Never logged.** No new log line is added. The existing `[model-api]` lines (path, model, status, timing) and the `[ai]` error line are unchanged.
- **No per-person numbers.** `staff_id` is kept so the link check can work. The summary never groups by it.
- `store: false` and speech-to-text retention are unchanged, since no model request changes.

### 8. Web (`apps/web`)

- **`lib/api.ts`.**
  - `read(photo, { hint?, mode?, admissionId? }, signal?)`, replacing the positional `hint, signal, mode`; `note(text, admissionId?, signal?)` and `voiceNote(audio, admissionId?, signal?)`. Each returns `Logged<…>`. `readMeal` is unchanged.
  - New `modelQuality(ward: number, days: number, signal?)`.
  - `ApiError` gains `issues?: { path: string; message: string }[]`, filled from a 400 body.
- **`lib/capture.ts`.** One helper owns the stale margin, and every save path takes its fields from it:

  ```ts
  /** Device-side margin under READ_ABANDON_HOURS: covers the latency between the server's created_at and `at`. */
  export const READ_LINK_MARGIN_MS = 5 * 60_000
  export interface ReadStamp { id: number; draft: number; at: number; send?: boolean }
  /** Fixes `send` once: kept when already set, else `now − at < READ_ABANDON_HOURS h − READ_LINK_MARGIN_MS`. */
  export function decideRead(read: ReadStamp | undefined, now = Date.now()): ReadStamp | undefined
  /** `{ read_id, read_draft }` when `read.send`, else `{}`. Never reads the clock. */
  export function readFields(read: ReadStamp | undefined): { read_id?: number; read_draft?: number }
  ```

  - `Pending` gains `read?: ReadStamp`, where `at` is the device's `Date.now()` when the read answered.
  - `toEntryInput(p, now = Date.now())` spreads `readFields(decideRead(p.read, now))`. `saveLevel` takes an optional `read: ReadStamp` and spreads `readFields(decideRead(read, now))` (`read_id` only), replacing the bare comparison it would otherwise need (`capture.ts:91-110`). Bag-emptying's bag-reading save (`lib/bags.ts`) does the same, so entry, level and bag-reading posts share one rule and one margin.
  - **Decided once.** Each caller calls `decideRead` at the first save attempt and stores the result before posting: the bed screen in its draft state, `Round` by patching the reading. A retry passes the stored stamp, whose `send` is already fixed, so it sends what the first attempt sent. A link sent at 19:54 is resent at 19:56 (the server still accepts it, and answers `already linked` if the first post landed); a link dropped at 19:55 stays dropped.
  - Drafts get `draft: i` from the model's order when the read answers. Removing a draft keeps the others' indexes (spec "Dropped draft").
  - `alreadyLinked(err)`: an `ApiError` 400 whose issues include `{ path: 'read_id', message: 'already linked' }`.
- **`lib/bags.ts`** (bag-emptying's). Its save plan for a read draft (media upload, then `api.addBagReading`) adds `readFields(…)` to the body. Its other posts carry no read: "Bag level" by hand (`manual`, or `photo` with a typed level and no evidence), the "Emptied it now?" emptying (`manual`), and after-emptying records, whose route has no link field.
- **`routes/a/bed.$token.tsx`.** Passes `admission.id` to the three read calls, stamps `read` on the drafts (bag drafts included), and stores the decided stamp at the first save attempt. There is no other UI change.
- **`lib/round.ts`.**
  - Read requests pass `admissionId: reading.bed.id`. A reading keeps its `read` stamp, and voice drafts keep their index.
  - `save` and `#saveVoice` patch the reading with `decideRead(reading.read, now)` before the first post, so every draft of a recording and every retry share one decision.
  - **Resume after a failure.** `Reading.voice` gains `saved: number[]` (draft indexes) and `entries: Entry[]`. `#saveVoice` skips saved drafts, and after each post that lands it patches the reading with the index and the entry, so a throw on a later draft keeps them. A post that throws `alreadyLinked` marks that draft saved without an entry, because the earlier attempt reached the server. When no unsaved draft is left, the reading becomes `saved` with `entries`. A photo `save` (entry, level or bag reading) treats `alreadyLinked` the same way: the reading becomes `saved` with `entry: null`.
- **`lib/model-accuracy.ts`** (pure; it holds everything the web scenarios test):
  - `KIND_LABEL`: `Photo (SAM + Spark)`, `Photo (Spark only)`, `Typed note`, `Voice note`; types through `CATEGORY_LABEL`;
  - `rateText(rate)`: `92% · 23/25`, or `— · 4/4` when withheld;
  - `kindRows(q)` (headers `Read`, `Decided`, `Accepted`, `Corrected`, `Rejected`, `Abandoned`) and `typeRows(q)` (headers `Model read`, `Decided`, `Kept`, `Changed to`);
  - `volumeText(v, tol)`: `<mae> mL mean error · within ±<tol> mL <rate>`; a null `mae_ml` renders `— mean error` (no `mL`); plus ` · <k> with no volume read` only when `k > 0`;
  - `negativesText(neg)`: `Nothing to chart: <c> confirmed · <o> charted anyway (<Type> <n>, …)`, plus ` · <k> read(s) with nothing drafted` only when `k > 0`;
  - `dataQualityLoad(api, wardId, signal)`: exactly the two GETs, in parallel.
- **`components/model-accuracy.tsx`** (lazy, its own chunk). Presentational, `ModelAccuracy({ q })`: the window (`Last 7 days`), the kinds table, the "Drink and fluid" table, the volume line and the negatives line. HTML `<table>`s with `scope="col"` headers and tabular numbers, each in a horizontally scrolling wrapper so 390 px never overflows the page. Text uses `color.fg` and `color.muted`. No charts, no toggles, no tooltips.
- **`components/ward-quality.tsx`.** Its resource uses `dataQualityLoad`, and it renders `<Suspense><ModelAccuracy q={…} /></Suspense>` after its own sections, through `lazy(() => import('./model-accuracy.tsx'))`.

### 9. Lab eval (`scripts/eval.ts`; `src/chart/lab.ts`, domain, pure)

Slim: photo reads of containers only, through the existing `readCapture`.

- **`lab.ts`** holds:
  - `parseLabels(jsonl)`: a `Map<id, LabLabel>`. Unknown fields are ignored. Values outside our vocabularies become null (`liquid_colour` `clear` and `n/a`; a urine colour is kept only when `expected_fluid` is `urine`). A malformed line is reported and skipped, not fatal.
  - `parseSidecar(json)`: a `LabLabel` from an image-synthesis sidecar (`synthetic`, `label_status`, `verified_by`, and `labels` read with the same vocabulary rules as `parseLabels`), or null when it is not valid JSON. `labels` accepts every key image-synthesis's plan allows: `expected_container`, `expected_fluid`, `liquid_colour`, `expected_ml`, `ml_tolerance` and `expected_outcome` are read; `meal_portion_eaten`, `truth`, `pair_id` and `pair_role` are accepted and ignored, as are the provenance fields, so tray sidecars are never rejected.
  - `samplesFrom(files, labels | null, sidecars)`: `parseName` moved out of `eval.ts`, plus label matching (the basename without its extension equals an `id` or ends with `-<id>`). `sidecars` maps a basename to its parsed sidecar; `eval.ts` reads `<basename>.json` beside each image, with or without `--container-labels`. Per file, in order:
    1. **Synthetic?** Its sidecar or its record says `synthetic: true`, or its basename starts with `synth-`.
    2. **Verified?** A synthetic file is kept only when every source it has (sidecar, record) has `label_status: "verified"` and a `verified_by` that is a non-empty string. Otherwise it is skipped and counted, at no request. A `synth-` file with neither source is skipped.
    3. **Labels.** A synthetic file takes its labels from its record, else its sidecar's `labels`. The name rule is never applied to it, so `urine_bag-450-x.webp` with a sidecar saying 1000 mL has a truth of 1000 mL. Its hint is its label's `expected_container`.
    4. **Real files.** With labels, a matched file is included even without a numeric name, which is how negatives get in; its hint is the name's container, as today, and a file matched only by id has none. Unmatched files fall back to the name rule as today.

    `--no-hint` passes no hint to any file.
  - `planRequests(samples, modes)`: the existing `REQUESTS_PER_PHOTO` sum, moved here with it: 3 per photo in `sam+spark` mode, 1 in `spark` mode. Skipped files are not planned, so they cost nothing.
  - `decision(row)`: `refused` (no draft, or an issue in `NEGATIVE_ISSUES`), `flagged` (a draft with `needs_review`) or `drafted`. A row that errored is excluded and listed as an error, as today.
  - `labReport(rows, { hinted })`, once for real and once for verified synthetic photos:
    - the `VolumeError` over rows with a numeric truth, plus "within the photo's own `ml_tolerance`" when labelled;
    - class tables via `tallyClasses(…, 'final')`: `container` only when unhinted, `fluid`, `urine_colour`;
    - the outcome table, one row per `expected_outcome`: `n | drafted | flagged | refused | right call`. The right call is drafted or flagged for `positive`, and flagged or refused for `degraded` and `negative`, as a `Rate`.
  - `labSections(report)`: the Markdown `eval.ts` writes (`Real photos`, `Synthetic photos (verified labels)` when any, `Container hinted: not scored`, `<k> synthetic photo(s) without verified labels, skipped`), so tests assert the text.

  ```ts
  interface LabLabel {
    id: string
    container: ContainerKind | null            // expected_container
    fluid: FluidKind | null                    // expected_fluid
    urine_colour: UrineColour | null           // liquid_colour, urine only
    expected_ml: number | null
    ml_tolerance: number | null
    outcome: 'positive' | 'degraded' | 'negative' | null   // expected_outcome
    synthetic: boolean                         // synthetic === true
    /** label_status === 'verified' and verified_by is a non-empty string; `verified` with verified_by null counts as draft. */
    verified: boolean
  }
  ```
- **Flags.**
  - `--container-labels <manifest.jsonl>`. Not `--manifest`: tray-segmentation's deferred tray eval plans `--manifest <file> --trays`, so the two never collide.
  - `--no-hint`: no hint is passed. The default stays hinted, as today, so old and new runs compare.
- **Synthetic photos: this change owns the rule.** image-synthesis writes sidecars and has no eval requirement ("Synthetic photos in the lab eval" is here). Each sample carries one `source` (`real` | `synthetic`), and every report section and `.json` field splits on it, so synthetic numbers never mix with real ones. The dataset tooling must carry `verified_by` into the manifest records it makes from verified sidecars, or the records are skipped (Risks).
- **Tolerance and output.** `TOLERANCE_ML` is replaced by `VOLUME_TOLERANCE_ML`. The `.md` keeps its existing tables and gains the sections above. The `.json` gains `real` and `synthetic`, each `{ classes, outcomes, volume }`, and `skipped`.
- **Requests.** The plan and the request count are unchanged, it is still a dry run without the confirmation flag, and requests stay sequential with no retries. The eval never touches the store, so lab reads never enter the ward log.
- **Out of scope.** Augmented variants (`augmented/variants.jsonl`, with `expected_outcome_after`): the dataset's `tools/score_classification.py` scores them from the eval's JSON.

### 10. Migration

- The two tables and the index come from `CREATE TABLE IF NOT EXISTS` in `SCHEMA`, which runs on every open after `migrate()`. There is no ALTER, no backfill and no new migrate step.
- Older files gain empty tables. Their records have no link. Since the summary iterates reads, not records, they count in nothing: they are excluded, not "accepted".
- A second open is a no-op, so `PRAGMA schema_version` stays put.
- **Rollback.** The previous build ignores the tables (every query names its columns). But the old server's `.strict()` bodies would 400 a new web's `read_id`, so web and server deploy together.

### 11. Demo seed (`scripts/demo-history.ts`)

Reads are seeded only where the app, after bag-emptying, would have made them. Each of these gets a read first:
- every voice and typed entry;
- every photo entry whose synthetic read is not a bag (cups, measuring jugs, urinals);
- every jug level;
- every bag reading that bag-emptying seeds through `store.addBagReading` with `source: "photo"` and read evidence (HDU-1, 3A-3, 2C-5, 2C-6). A reading seeded `manual`, or as a photo with no evidence (a typed level), gets none, as the app makes no read for it.

Each read has `clock.t` a minute before the record's `recorded_at`, the same staff member and admission, and a `readRow` built from the record's synthetic evidence. The record is then saved with `read_id` (and `read_draft`); `addBagReading` takes it as `readId`.

**Bag photos go through the bag flow.** `evidenceFor` (`:365`) draws every photo urine entry as a `urine_bag` read. After bag-emptying the app saves such a photo as a bag reading, never as an entry, so a read linked to one of those entries would be a path no client takes. Those entries (the routine urine rows of non-bag beds, and the 5B story rows) get no read, and count in nothing, like records saved before this change. Two fixed records must stay entries for the mix, so they gain a `container: 'urinal'` option in `Opts`: their evidence reads a `urinal` (drawn with `vesselPhoto`), and the header comment says so.
- **3A-1**: a urinal read as 450 mL, approved at 400 mL. It stays `corrected_by_nurse`; a bag reading would be settled at save.
- **2C-3**: the same urinal photographed twice, the second rejected as a duplicate. It stays `rejected`. As two bag readings, both would be saved (bag-emptying has no duplicate check) and both reads settled at save, so the nurse's rejection of the second entry would leave its read `accepted`.

By-hand records, after-emptying photos and meals get none. The reduced mix comes mostly from records the script already makes. Every addition is on a bed outside `storyBeds`, or adds no entry:

| Outcome | Where |
|---|---|
| `accepted` | every other linked record, approved unchanged, and every linked bag reading (saved at the read level), each bed's newest included though its entry is still pending |
| `pending` | the existing pending captures that are not bag photos |
| `corrected_by_nurse` | 3A-1 (urinal, 450 → 400 mL at approval) and 3A-2 (voice 200 → 250 mL amend), both existing |
| `edited_at_capture` | one 3A-6 `urinal` photo entry of 400 mL whose read drafted 300 mL |
| `rejected` | 2C-3's duplicate (existing, now a urinal) |
| `abandoned` | one 3A-6 photo read of a `urinal`, 350 mL urine drafted 14 h ago, never saved |
| `negative_confirmed` | one `no_container` photo read with no draft, 3A-5, 9 h ago |
| `negative_overridden` | one `no_container` photo read (container `none`, fluid `water`) whose draft was saved on 3A-6 as a pending 200 mL drink |

- **The 3A minimum holds without urine-bag entries.** The six routine 3A beds (1, 2, 3, 5, 6, 7) each have 4 photo drinks (`SOURCES` cycles photo, voice, photo, text over 8 drinks), so 24 decided `sam+spark` photo drafts, before 3A-1, 3A-3's bag readings and the jug levels. 3A-3 keeps its drinks: bag-emptying drops only its routine urine rows.
- **No clash with bag-emptying's demo beds** (its design §11: HDU-1, 3A-3, 2C-5, 2C-6). This change adds no entry on them, only reads and links on their seeded readings. Its own additions are on 3A-5 (a read only) and 3A-6, and its fixed records are 3A-1, 3A-2 and 2C-3.
- **Guard.** After seeding, the script builds the hospital summary with the same pure functions and throws unless:
  - `corrected_by_nurse` ≥ 2, `edited_at_capture` ≥ 1, `rejected` ≥ 1, `abandoned` = 1;
  - `negative_confirmed` = 1, `negative_overridden` = 1 and `nothing_drafted` = 0;
  - 3A's `photo` `sam+spark` accepted rate has `pct` not null (n ≥ `MIN_N`);
  - at least one bag reading is linked, and no read with a bag container is linked to an entry;
  - every bed's alerts equal the snapshot taken before these additions, both at `clock.t = now`, since bag-emptying's reading-due prompts move with the clock. Care-plan's and bag-emptying's story guards (`INTENDED`: 3A-3 `[]`, 2C-5 `bag_reading_due`, 2C-6 `bag_level_fell`, HDU-1 `catheter_review`) still run.
- The header comment lists the mix.

### 12. Deviations from the outline, and why

1. **No container correction in the ward.** Entries carry no container, and neither the check screen nor Amend can change one. The ward compares types; container and fluid confusion come from the lab eval. A structured `container` on entries is the follow-up.
2. **Fluid kinds compared as types.** `tea`, `juice`, `milk` and `water` all draft `water`, and the chart keeps only the type. The "Drink and fluid" table is the type table.
3. **Scoring lives in `apps/server/src/chart/scoring.ts`, not `packages/shared`.** Both consumers are in the server, and the web receives computed rates, so the web bundle and shared's runtime surface stay unchanged. The constants are shared.
4. **Link check: same staff member, and the read must name the record's bed**, not "same staff session or same admission". Staff change only by signing in, so the stricter rule rejects nothing real. A bedless read is refused, because a read that names no bed could be linked to any bed by its author, which breaks per-ward numbers. Every web read sends its bed.
5. **`admission_id` on reads** was not in the outline. Without it, abandoned and negative reads, which have no record, would have no ward.
6. **`open` outcome** was added, for negative drafts too. A young unsaved draft is neither abandoned nor pending, and a young negative draft is not yet confirmed.
7. **`nothing_drafted` apart from negatives.** Only a negative issue code says "nothing to chart here". A note with no `log_entry` call, or a photo of an `other` container, is the model not drafting, not a refusal, so it is not counted as a confirmed negative.
8. **Levels and bag readings are settled at save.** Jug levels are never reviewed. A bag reading is never edited, and its reviewed entry is a rise, not the read level (bag-emptying design, "Overlaps").
9. **No MODIFIED capture requirement.** `read_id` and `admission_id` on the three endpoints are additive and stated once, in `charting/model-accuracy`. No live photo or note requirement describes their whole response, so none becomes wrong.
10. **Eval labels use the dataset's existing fields**, including `expected_outcome`, and a flag named apart from tray-segmentation's. `--no-hint` was added, because a hinted container cannot be scored.
11. **The web omits a stale `read_id` 5 minutes early** (`READ_LINK_MARGIN_MS`), so a save at the edge is not refused.
12. **Values chosen:** `READ_ABANDON_HOURS = 12` (one shift; a round saves at its end), `MIN_N = 5` (the stability rule; the demo's 3A photo row clears it), and `QUALITY_MAX_DAYS = 30`.
13. **`read_link.meal_id` exists but is unused**, so the tray follow-up adds meal links without rebuilding the table and its CHECK.

## Deferred to a follow-up change

Cut for the deadline (Nov 4, 9 PM ET). The follow-up builds on tray-segmentation's archived MVP as its design.md "Deferred" leaves it: tray reads of 3 requests in `sam+spark` mode and 1 in `spark` mode, `image_sha256` on the result, `Meal.dishes` and `Meal.proof`, and none of `admission_id` on `/api/ai/meal`, the 5-request served-photo path or `meal_event`. The follow-up:
- logs tray reads (kind `tray`, with its mode) through `/api/ai/meal`, at 3 requests (`sam+spark`) or 1 (`spark`); there is no 5-request path. `readRow` keeps closed-list dish kinds, portions and fluid kinds only: never dish or fluid names, masks, boxes, `image_sha256` or any other hash;
- defines `admission_id` on `/api/ai/meal` itself, with a 404 before any model request, since tray-segmentation's MVP has none;
- MODIFIES "Tray reading" on tray-segmentation's archived text ("saves no meal or entry, only its read");
- adds meal links (`MealInput.read_id`, `read_link.meal_id`, the meal form). A voided meal is `rejected`; otherwise the saved `Meal.dishes` (as `Meal.proof` confirms them) against the draft's dishes give `edited_at_capture` or `accepted`. With no `meal_event`, a meal is never `corrected_by_nurse`;
- adds `not_a_meal` to `NEGATIVE_ISSUES`, and dish-kind and portion tables.

## Order and overlaps

**Order.** The global apply order is care-plan → bag-emptying → tray-segmentation → read-outcomes → dietitian, with image-synthesis in parallel and scale-acuity last. This change starts once bag-emptying and tray-segmentation are archived (tasks.md group 0) and rebases on their archived specs and code, so it applies on `openspec/specs/**`, not on their delta text. It edits no requirement of theirs.

**care-plan** (archived before). Reused: `EntryInput.iddsi_level`, `chartView`, `migrateCare`, the demo's story beds and `INTENDED` guard. Behavioural interplay: a consistency-only amend is not a correction (§4); `iddsi_level` set at capture is not a model field; "Save anyway" past a nil-by-mouth warning is an ordinary linked save; care-plan's story beds keep their prompts (§11).

**bag-emptying** (archived before). This change closes the points its design.md "Overlaps" leaves to it:
- **Route.** `POST …/bag-readings` accepts `read_id` and links the reading ("Link a bag reading to its read"), with the link check after the route's checks and before `addBagReading` (§3). A typed-level photo has no read and carries no `read_id`.
- **Duplicate check deferred.** Bag-emptying's MVP has no 409 `duplicate_reading` or `confirm_duplicate`, so this change specifies neither and drops the "Save anyway" step from web/capture. Its deferred change should check after the link check (proposal, "Deferred").
- **Scoring.** A bag reading's type is `BAG_CATEGORY[container]`, not `water` (§5, "Outcome of a saved level").
- **Corrections.** A bag reading is settled at save; a nurse's action on its rise entry is not `corrected_by_nurse` (§4).
- **Demo.** Urine-bag photos are bag readings, so urine-bag entries get no read, and the fixed 3A-1 and 2C-3 records become urinals (§11).
- **Shared files.** `routes/bags.ts` (body, link check), `store.ts` `addBagReading` (the link insert), `lib/bags.ts` and `lib/capture.ts` (`readFields`), `lib/round.ts` (bag saves and their resume). bag-emptying MODIFIES `web/ward-round` "Save the round"; this change ADDs two other requirements there.

**tray-segmentation** (archived before). No requirement shared: trays are deferred (above). Both touch `packages/shared` and `store.ts` `SCHEMA`; its tray eval (`--manifest … --trays`) is deferred too, so `scripts/eval.ts` has no merge now.

**image-synthesis** (in parallel). It writes sidecars and has no eval requirement; this change owns "Synthetic photos in the lab eval" and reads its sidecar format (Context). No file is shared: it does not edit `scripts/eval.ts` or `docs/accuracy.md`, and its `src/lab/` and this change's `src/chart/lab.ts` are separate modules. Its dataset tooling must carry `verified_by` into manifest records (Risks).

**dietitian** (after). No requirement overlaps; it reads meals only. It rebases on this change's edits to `scripts/demo-history.ts`, `store.ts` `SCHEMA`, `web/ward`'s delta (different requirements) and `packages/shared`.

**scale-acuity** (last). It MODIFIES "Reads name their bed", so that requirement's name and text stay as they are here.

| File | read-outcomes |
|---|---|
| `packages/shared/src/index.ts` | `EntryInput.read_id`/`read_draft`, `LevelInput.read_id`, `BagReadingInput.read_id`, the model-accuracy block and constants. No record type changes |
| `apps/server/src/routes/chart.ts` | link fields on `EntryBody`/`LevelBody`, `linkProblem` before the inserts |
| `apps/server/src/routes/bags.ts` | `read_id` on the bag body, `linkProblem` before `addBagReading` |
| `apps/server/src/routes/ai.ts` | `admission_id`, `bedFound`, `recordRead`, `read_id`, `Hono<Env>`. Explain and `/meal` untouched |
| `apps/server/src/store/store.ts` | two tables in `SCHEMA`, `recordRead`/`read`/`linked`/`readOutcomeRows`, link inserts in `addEntry`/`addLevel`/`addBagReading` |
| `apps/server/src/app.ts` | mounts `qualityRoutes` |
| `apps/server/scripts/demo-history.ts` | reads and links, the urinal option, the outcome mix and its guard |
| `apps/web/src/lib/capture.ts` | `ReadStamp`, `decideRead`, `readFields`, `Pending.read`, `toEntryInput`, `saveLevel`'s `read`, `alreadyLinked` |
| `apps/web/src/lib/bags.ts` | `readFields` in the bag-reading body |
| `apps/web/src/lib/api.ts` | AI call signatures, `modelQuality`, `ApiError.issues` |
| `apps/web/src/routes/a/bed.$token.tsx` | `admission.id` to read calls, `read` stamps, the decided stamp kept for retries |
| `README.md` | "Accuracy in the ward" |

## Risks / Trade-offs

- **[Accepted is agreement, not truth]** A nurse who approves a wrong draft unchanged makes it "accepted" (automation bias). → The README pairs ward numbers with the lab eval's labelled truth. Rejected and corrected rates are the conservative signal.
- **[A client that does not send `read_id`]** An older web, or a save path missed, turns kept drafts into `abandoned` or `negative_confirmed`. → Deploy server and web together. Every save path has a web test asserting `read_id`. Abandoned drafts are not in acceptance rates and show separately.
- **[Retry after a lost response]** → The round marks each draft saved as it lands and reads `already linked` as saved (§8). The bed capture screen saves one draft per tap and shows the error, so a lost response there costs the attendant one refused retry, which the existing error text covers. A linked bag reading re-posted after a lost response answers `already linked`, so it is not stored twice; an unlinked one (by hand, or stale) is stored again, as in bag-emptying's MVP (§3).
- **[Skewed denominators]** → Acceptance and correction rates use decided drafts only. `open` and `pending` are excluded, abandoned drafts, negatives and nothing-drafted reads are reported apart, and every rate shows `n/of`, floored, and is withheld below `MIN_N`.
- **[Re-shoots]** Staff may abandon a poor read and re-photograph. → The first read is `abandoned`, which is what happened.
- **[No-draft photo then charted by hand]** That read stays `negative_confirmed` (out of scope: "Chart it anyway"). → Called out in the README; the overridden count is a lower bound.
- **[Small wards, short windows]** → `MIN_N` and visible counts. The demo is sized so 3A's photo row clears it.
- **[Clock skew]** → The web measures elapsed time on its own clock since the read answered, with a 5-minute margin. The server measures from its own `created_at`.
- **[Read log growth]** → About one row per capture, a few hundred bytes, indexed by time. The summary reads at most `QUALITY_MAX_DAYS`.
- **[The dataset changes while it is being edited]** → `parseLabels` ignores unknown fields and nulls unknown values. The eval still runs on file names alone.
- **[Verified synthetic records without `verified_by`]** image-synthesis's tooling carries `synthetic` and `label_status` into the manifest but does not say it carries `verified_by`. → Such records are skipped and counted, never scored; the eval prints the count. The tooling should carry it (reported to image-synthesis).
- **[A retry after 12 h]** A stamp decided "send" at 11 h 54 min and retried after `READ_ABANDON_HOURS` gets 400 at `read_id`. → The card shows the error. Keeping the decision is what lets a lost response come back as `already linked` instead of a second, unlinked record.
- **[Bag readings are judged by their level only]** A nurse who corrects a bag's rise entry leaves its read `accepted` (§4). → The README says so; bag-emptying keeps the reading, and a misread level surfaces as a fall on the next one.
- **[Hackathon deadline (Nov 4, 9 PM ET)]** → Group 0 waits on bag-emptying and tray-segmentation. Then server groups 1–4 demo on their own through the API; the demo (5) and lab eval (6) follow; the web groups (7–8) close. Each group lands with its tests.

## Test strategy

- **Server HTTP**, through `testApp` with the fake upstream:
  - every test asserts the exact upstream request count: 3 or 1 for a photo, 1 for a note, 2 for a voice note, and 0 for saves and the summary;
  - reads are made through the real AI routes with fake model outputs. Where a scenario needs many reads (volume math, `MIN_N`, 199 of 200), they are seeded through `store.recordRead(readRow(…))` and linked through the store, as care-plan seeds orders;
  - clocks are local (`new Date(2026, 10, 3, h, m)`), moved by the store's `now`;
  - "Read log holds no text" scans every column of every `model_read` row as text, walks the parsed `output` for string leaves, and captures `console.log` and `console.error` during the requests.
- **Pure**:
  - `src/chart/scoring.test.ts`: floored rates, inclusive tolerance, `tallyClasses` by model and by final, correction order, as uncited extras;
  - `src/chart/model-accuracy.test.ts`: every row of the §4 table and `linkProblem`'s order, as uncited extras;
  - `src/chart/lab.test.ts`: the cited lab eval scenarios.
- **Existing suites** pass unchanged: `read_id` is additive, and `/meal` is untouched. Bag-emptying's `bags.test.ts` and `lib/bags.test.ts` pass with no assertion changed.
- **Web lib**: `createApi` with a fake `fetch` and a fake clock, asserting the exact requests, bodies and form fields. `Round` is driven as in `round.test.ts`, with the fake `fetch` failing or answering 400 on chosen posts.
- **Browser** (tasks.md): 390 and 1100 px, with `/api/ai/*` blocked, as anita.

## Migration Plan

1. Deploy server and web together (a new web's `read_id` is refused by an old server).
2. On first open, an older file gains the two tables. A second open changes nothing.
3. The view starts empty and fills as staff capture. Earlier records never count.
4. Rollback: run the previous build on the same file. The tables are ignored and stay for a later upgrade.
