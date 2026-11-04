# Tasks

**Order.** The global apply order is care-plan → bag-emptying → tray-segmentation → read-outcomes → dietitian, with image-synthesis in parallel and scale-acuity last. No group here starts before group 0. design.md, "Order and overlaps", lists the files shared with those changes.

**Test conventions.**
- Every test runs without the network. Tests are written first and seen to fail.
- Server tests go through `testApp` with the fake upstream. They assert its exact request count: photo 3 (1 in `spark` mode), text 1, voice 2, and 0 for saves and the summary.
- Clocks are local (`new Date(2026, 10, 3, h, m)`).
- Staff are `signIn(store, id)`: Ravi Kumar 1, Sunita Devi 2, Anita Thomas 4.
- Where a scenario needs many reads, they are seeded with `store.recordRead(readRow(…))` and linked through the store (design.md "Test strategy").

**Scenario → test file map.** Each task below lists the scenarios it cites.

| Requirement | Test file |
|---|---|
| [charting/model-accuracy] Reads are logged, Read log holds no text, Reads name their bed | `apps/server/src/read-log.test.ts` (new) |
| [charting/model-accuracy] Link a saved record to its read, Link checks, Link a bag reading to its read | `apps/server/src/read-links.test.ts` (new) |
| [charting/model-accuracy] Outcome of a saved draft, Outcome of a saved level, Unsaved drafts, Negative reads, Field scoring, Model accuracy summary, Small numbers withheld, Older stores keep their records out | `apps/server/src/model-quality.test.ts` (new) |
| (uncited extras) the §4 outcome table row by row, `linkProblem` order, floored rates, `tallyClasses`, correction order | `apps/server/src/chart/model-accuracy.test.ts` and `apps/server/src/chart/scoring.test.ts` (new) |
| [charting/model-accuracy] Lab eval scored like the ward, Lab eval labels from the dataset, Synthetic photos in the lab eval | `apps/server/src/chart/lab.test.ts` (new) |
| [web/capture] Reads and saves carry their read; [web/ward-round] Round reads and saves carry their read, Round saves resume after a failure | `apps/web/src/lib/read-links.test.ts` (new) |
| [web/ward] Model accuracy view, Rates shown with their counts | `apps/web/src/lib/model-accuracy.test.ts` (new) |
| [web/ward] Data quality view | `apps/web/src/lib/quality.test.ts`, unchanged. The new bullet is covered by "Model accuracy view: Two requests" |

## 0. Base

- [x] 0.1 bag-emptying and tray-segmentation archived; rebase.
  - Check: `openspec/changes/archive/` holds care-plan, bag-emptying and tray-segmentation, and `openspec list --specs` shows `charting/bag-periods` and `capture/meal-reading` with "Tray segmentation grounding". If either is not archived, stop: no group below starts.
  - Rebase this change on their archived specs (`openspec/specs/**`) and their code: `POST /api/admissions/:id/bag-readings` and `store.addBagReading` (`apps/server/src/routes/bags.ts`, `store.ts`), `BagReadingInput` and `BAG_CATEGORY` (`packages/shared`), `lib/bags.ts` and the bag saves in `lib/capture.ts` and `lib/round.ts`, and the bag beds in `scripts/demo-history.ts`. Re-check every `file:line` cited in design.md against the rebased code.
  - Verify: `pnpm exec openspec validate read-outcomes --strict` passes, and `pnpm verify` passes on the base before 1.1.

## 1. Shared contracts

- [x] 1.1 Shared types and config.
  - Write the failing test first, in new `apps/web/src/lib/model-accuracy.test.ts`: [web/ward] Rates shown with their counts: "Withheld below the minimum", calling `rateText`. It fails to compile, because `Rate` and `rateText` do not exist yet.
  - Then add, in `packages/shared/src/index.ts`, everything in design.md "Types" (contracts only; no requirement of their own):
    - `READ_KINDS`, `ReadKind`, `READ_OUTCOMES`, `ReadOutcome` and `NEGATIVE_ISSUES`;
    - `READ_ABANDON_HOURS`, `VOLUME_TOLERANCE_ML`, `QUALITY_MAX_DAYS` and `MIN_N`;
    - `ReadRef` and `Logged<T>`;
    - `EntryInput.read_id`/`read_draft`, `LevelInput.read_id` and `BagReadingInput.read_id`;
    - `Rate`, `VolumeError`, `CLASS_TABLES`, `ClassTable`, `ClassRow`, `KindRow` and `ModelQuality`.
  - Add `rateText` in new `apps/web/src/lib/model-accuracy.ts`.
  - Verify: `pnpm typecheck` passes, the test passes, and every existing server and web test passes unchanged.

## 2. Server: the read log

- [x] 2.1 Store and record reads (design.md §1, §2, §7).
  - Write the failing tests in new `apps/server/src/read-log.test.ts`. The read is inspected through `store.read(id)`:
    - [charting/model-accuracy] Reads are logged: "Photo read", "Spark-only read", "Text note", "Voice note with two drafts", "Failed read or explain";
    - [charting/model-accuracy] Read log holds no text: "Voice note", "Photo read". Scan every column of each `model_read` row as text, walk the parsed `output` for string leaves and check each against the vocabularies, and capture `console.log`/`console.error` for the duration of the requests.
  - Implement:
    - `model_read` and `read_link` (used in 3.1) in the `SCHEMA` DDL, with the index;
    - `store.recordRead(row)` and `store.read(id)`;
    - new `apps/server/src/ai/read-log.ts`: `ReadOutput`, `DraftFacts`, `ReadOutputSchema` and `readRow(kind, result, ctx)`, copying only the enumerated fields;
    - `aiRoutes` as `Hono<Env>`. `/read`, `/note` and `/voice-note` record after the pipeline returns and answer `Logged<…>`. `/meal` and Explain are unchanged.
  - Verify: these tests, `ai/ai.test.ts`, `meal-reading.test.ts`, `chart.test.ts`, `security.test.ts` and `session.test.ts` pass, with no existing assertion changed.
- [x] 2.2 Reads name their bed (design.md §2).
  - Write the failing tests in `apps/server/src/read-log.test.ts`: [charting/model-accuracy] Reads name their bed: "Unknown bed", "Not sent upstream".
  - Implement:
    - `admission_id` on `ReadForm` and `AudioForm` (`FormId`) and on `NoteBody`;
    - the `bedFound` middleware (404 before any pipeline call);
    - `admission_id` passed to `readRow` only.
  - Verify: these tests pass. The upstream body comparison in "Not sent upstream" is byte-for-byte.

## 3. Server: links

- [x] 3.1 Link saved records to their read (design.md §3).
  - Write the failing tests in new `apps/server/src/read-links.test.ts`. Reads come from the real AI routes with fake model outputs:
    - [charting/model-accuracy] Link a saved record to its read: "Photo entry", "Two drafts of a voice note", "Jug level";
    - [charting/model-accuracy] Link checks: "Linked twice" (asserting the issue `{ path: "read_id", message: "already linked" }`), "No such draft", "Another staff member or bed", "Bedless read", "Draft index without a read", "Too old", "Wrong kind or unknown read". Each failing case asserts that the bed's entries and levels are unchanged.
    - In "Too old", the store's `now` is set to 19:59 and then 20:00. A session ends after 30 minutes idle and at the 20:00 shift end, so Ravi Kumar signs in again (`signIn(store, 1)`) after each clock move: at 19:59 the 08:00 session has gone idle, and at 20:00 the 19:59 one has ended with the shift.
  - Write the uncited extras in new `apps/server/src/chart/model-accuracy.test.ts`, which call `linkProblem(read, linked, ctx)` directly: the check order (an unknown read wins over a wrong kind, a wrong staff member over age, a bedless read over a wrong kind), and the `photo` → level pairing.
  - Implement:
    - `read_id`/`read_draft` on `EntryBody` with the `read_draft`-needs-`read_id` refinement, and `read_id` on `LevelBody`;
    - `linkProblem` in new `apps/server/src/chart/model-accuracy.ts`, called after the existing checks and before the insert, with `store.linked(read_id, draft)` passed in;
    - the `read_link` insert inside `addEntry`/`addLevel`'s `tx()`, with a primary-key conflict mapped to the same `already linked` 400.
  - Verify: these tests and the whole server suite pass. `chart.test.ts`, `meals.test.ts`, `media.test.ts` and care-plan's `care.test.ts` are unchanged.
- [x] 3.2 Link bag readings to their read (design.md §3, "Bag readings").
  - Write the failing tests in `apps/server/src/read-links.test.ts`, reads from the real `/api/ai/read` with a fake `urine_bag` output: [charting/model-accuracy] Link a bag reading to its read: "Emptying linked", "Nothing charted" (`entry: null`, `store.linked(48, 0)` true), "Photo, level typed" (no evidence, no `read_id`: no link, every outcome 0), "Refused links" (one case per bullet, each asserting the bag's readings and entries are unchanged), "Posted again" (400 `already linked`; the bag still holds one reading and one entry). Each asserts 0 upstream requests for the posts. Nothing posts `confirm_duplicate` or expects 409: bag-emptying deferred its duplicate check.
  - Implement:
    - `read_id` on the bag-reading body in `routes/bags.ts`, and `linkProblem` after its existing checks and before `addBagReading`;
    - `addBagReading`'s optional `readId`, inserting the `read_link` row (draft 0, `level_id` = the reading) inside its transaction after the level, so its fall guard's 403 rolls the link back too, with a primary-key conflict mapped to the same `already linked` 400.
  - Verify: these tests pass, and bag-emptying's `apps/server/src/bags.test.ts` and `chart/bags.test.ts` pass with no assertion changed.

## 4. Server: scoring, outcomes and the summary

- [x] 4.1 Pure scoring (design.md §5).
  - Write the failing uncited tests in new `apps/server/src/chart/scoring.test.ts`:
    - `rate`: 4/4 → null, 5/5 → 100, 3/7 → 42, 199/200 → 99;
    - `volumeError` at 25 mL (within) and 26 mL (not), and with a null side;
    - `summariseVolume`: MAE 161/5 → 32, null below `MIN_N`, `no_volume` counted apart;
    - `tallyClasses` by model and by final, and correction order.
  - Implement new `apps/server/src/chart/scoring.ts`.
  - Verify: these tests pass.
- [x] 4.2 Outcomes, negatives and the summary route (design.md §4, §6).
  - Write the failing tests in new `apps/server/src/model-quality.test.ts`, all through `GET /api/quality/model`:
    - [charting/model-accuracy] Outcome of a saved draft: "Accepted", "Edited at capture", "Corrected at approval, rejected and pending", "Consistency only";
    - [charting/model-accuracy] Unsaved drafts: "Never saved", "One draft of two saved";
    - [charting/model-accuracy] Negative reads: "No container, confirmed", "No container, overridden", "Unsaved negative draft", "Nothing drafted";
    - [charting/model-accuracy] Model accuracy summary: "Window and errors", "No session", "Ward and hospital", "Kinds always listed", "No names".
  - Extend the uncited `apps/server/src/chart/model-accuracy.test.ts` with one case per row of the design.md §4 table, built in memory.
  - Implement:
    - `store.readOutcomeRows(since, wardId?)`;
    - `outcomes` and `modelQuality` (kind rows with their volume error, negatives) in `chart/model-accuracy.ts`;
    - the `'query'` target in `routes/validate.ts`;
    - new `apps/server/src/routes/quality.ts`, mounted in `app.ts`.
  - Verify: these tests and the whole server suite pass, with care-plan's `audit.test.ts` unchanged.
- [x] 4.3 Class tables and the stability rule (design.md §5).
  - Write the failing tests in `apps/server/src/model-quality.test.ts`:
    - [charting/model-accuracy] Outcome of a saved draft: "Nurse amend" (it needs the type table);
    - [charting/model-accuracy] Field scoring: "Volume error math", "Against the final value", "No volume read", "Urine colour";
    - [charting/model-accuracy] Outcome of a saved level: "Bag reading" (the entry approved at 300 mL leaves `edited_at_capture`), "No entry, then a fall" (rise 0 and a later manual fall leave `accepted`), "Drain bag" (type `drain` from `BAG_CATEGORY`, no `water` row), "Jug level";
    - [charting/model-accuracy] Small numbers withheld: "Four and five", "Rounded down", "Two kinds".
  - Implement the `type` and `urine_colour` tables through `tallyClasses(…, 'model')`, and the top-level `volume`. A level's final type is `water` for a jug and `BAG_CATEGORY[container]` for a bag reading (`event` not null), and its final volume the level's `volume_ml`, never the entry's; levels skip the colour table (design.md §5).
  - Verify: these tests and the whole server suite pass.
- [x] 4.4 Older stores (design.md §10).
  - Write the failing tests in `apps/server/src/model-quality.test.ts`: [charting/model-accuracy] Older stores keep their records out: "Older store", "Old and new records", "Opened again". The pre-change file is built as the existing pre-media and pre-care tests build theirs: the current DDL without the two tables, plus three approved photo entries.
  - Implement nothing beyond 2.1's `IF NOT EXISTS` DDL, unless a test shows otherwise.
  - Verify: these tests pass.
- [x] 4.5 README API list: `GET /api/quality/model`; `admission_id` and `read_id` on the three AI reads; `read_id`/`read_draft` on saves; the test count. Verify: the documented curl for the summary, run once by hand against a local server, returns 200 with four `kinds`. No model request.

## 5. Demo census

- [x] 5.1 Reads and the reduced mix in `apps/server/scripts/demo-history.ts` (design.md §11).
  - Before each voice and typed entry, each photo entry whose evidence is not a bag, each jug level and each bag reading bag-emptying seeds with `source: "photo"` and evidence (its `addBagReading` calls on HDU-1, 3A-3, 2C-5 and 2C-6; not `manual` or typed-level ones, nor the 3A-3 after-emptying photo), record a read through the store, by the same staff member for the same admission, and save with `read_id` (and `read_draft`; `readId` for a bag reading). Photo entries whose evidence reads a `urine_bag` get none.
  - Add `container: 'urinal'` to `Opts`, and use it for the fixed 3A-1 and 2C-3 records and the 3A-6 additions, so they stay entries (evidence and drawn photo of a urinal).
  - Add the extra outcomes in the §11 table, all outside `storyBeds`.
  - Add the guard (the outcome counts, 3A's `photo` `sam+spark` rate not withheld, a bag reading linked and no bag read linked to an entry, alerts unchanged per bed, snapshot and check both at `clock.t = now`), and list the mix in the header comment, with 3A-1 and 2C-3 as urinals.
  - Verify: one run over a fresh temporary `DATA_DIR` succeeds, with its guard and care-plan's and bag-emptying's (`INTENDED`) passing. On a server over that file:
    - `GET /api/quality/model` shows the §11 counts;
    - `GET /api/quality/model?ward=2` shows a 3A photo accepted rate with a percentage, `corrected_by_nurse` 2 (3A-1 and 3A-2), a `urine` type row that includes 3A-3's bag readings, and negatives `1` confirmed and `1` overridden as `water`.

    No model request: the script makes none.

## 6. Lab eval

- [x] 6.1 Dataset labels and the per-class report (design.md §9).
  - Write the failing tests in new `apps/server/src/chart/lab.test.ts`, with a fake `fetch` that must stay uncalled:
    - [charting/model-accuracy] Lab eval scored like the ward: "Same tolerance", "Hinted container" (through `labSections`), "Plan" (`samplesFrom` plus `planRequests`);
    - [charting/model-accuracy] Lab eval labels from the dataset: "Labels" (`parseLabels` plus `samplesFrom`, with manifest lines copied from the dataset's `ubag-001` and `hard-007` records, and `planRequests` in both modes), "Positives and negatives" (`labReport` plus `labSections`);
    - [charting/model-accuracy] Synthetic photos in the lab eval: "Sidecars" (`parseSidecar` over sidecar JSON shaped as image-synthesis's `SynthSidecar`, plus `samplesFrom`, `planRequests` and `labSections`), "File name is not truth", "Synthetic photos apart".
  - Implement:
    - new `apps/server/src/chart/lab.ts`, with `parseSidecar` and the synthetic rule of design.md §9 in `samplesFrom`;
    - in `scripts/eval.ts`, `TOLERANCE_ML` replaced by `VOLUME_TOLERANCE_ML`, `parseName` and the plan moved to `lab.ts`, reading `<basename>.json` beside each image, the `--container-labels` and `--no-hint` flags, the skipped count in the plan line, and the new `.md` sections and `.json` fields.
  - Verify:
    - these tests pass;
    - a dry run, `pnpm --filter @meniscus/server eval /home/swapnil/repo/hackathons/attend-realworld-dataset/eval/graduated-1 --container-labels /home/swapnil/repo/hackathons/attend-realworld-dataset/manifest.jsonl --no-hint`, prints the plan and `dry run`, reports 0 synthetic photos, and sends nothing;
    - no run with the confirmation flag.
- [x] 6.2 Docs:
  - **`docs/accuracy.md`:** one short section (at most 15 lines): `--container-labels` and the dataset fields it reads, `--no-hint`, drafted / flagged / refused and the right call per expected outcome, the synthetic rule (sidecars and records, `label_status: verified` with `verified_by`, never labels from a file name, separate sections), and the shared tolerance, floored rates and `MIN_N`.
  - **README:** a new "Accuracy in the ward" section, after "Accuracy". It covers lab truth versus ward agreement, the outcome definitions, decided versus abandoned denominators and withheld small counts, negatives versus nothing drafted, no container truth in the ward, overridden negatives as a lower bound, bag readings judged by their saved level only, and zero extra model requests.

  Verify: `pnpm format` leaves both files unchanged, and every command in them is the dry-run form.

## 7. Web library

The web tests use `createApi` with a fake `fetch` and a `staffId`, as `meals.test.ts` and `resolve.test.ts` do, and assert the exact requests, bodies and form fields. `Round` is driven as in `round.test.ts`.

- [x] 7.1 Reads and saves carry their read (design.md §8).
  - Write the failing tests in new `apps/web/src/lib/read-links.test.ts`:
    - [web/capture] Reads and saves carry their read: "Photo draft", "Voice note with two drafts", "Dropped draft", "Typed note and jug", "By hand" (with the "Bag level" photo: `source: "photo"`, no `evidence`, no `read_id`), "Bag photo", "Emptied it now" (the `manual` emptying carries no `read_id`), "Stale read" and "Retried save" (a fake `now`);
    - [web/ward-round] Round reads and saves carry their read: "Two beds", "Save all high-confidence", "Bag reading", "Stale reading" (a fake `now`), "Recording with two drafts", "Dropped draft", "Imported queue".
  - Implement:
    - `api.read(photo, { hint, mode, admissionId }, signal)`;
    - `admissionId` on `note` and `voiceNote`, and the `Logged<…>` return types;
    - in `lib/capture.ts`: `READ_LINK_MARGIN_MS`, `ReadStamp`, `decideRead` and `readFields` (the one place the margin is applied), `Pending.read`, the draft index, `toEntryInput(p, now)` and `saveLevel`'s `read` both taking their fields from `readFields`;
    - in `lib/bags.ts`: `readFields` in the bag-reading body of a read draft only; "Bag level" by hand, the "Emptied it now?" emptying and after-emptying posts send none;
    - `lib/round.ts` passing `admissionId`, keeping read stamps, and patching the decided stamp before the first post;
    - the call sites in `routes/a/bed.$token.tsx`, storing the decided stamp at the first save attempt.
  - Uncited extras in the same file: `decideRead` at `at` + 11 h 54 min 59 s (send) and + 11 h 55 min (no send), and a decided stamp that keeps its `send` at any later `now`.
  - Verify: these tests and the whole web suite pass, with `round.test.ts`, `meals.test.ts`, bag-emptying's `bags.test.ts` and care-plan's `care.test.ts` unchanged apart from the `read` signature at `round.ts`'s call sites.
- [x] 7.2 Round saves resume after a failure (design.md §8).
  - Write the failing tests in `apps/web/src/lib/read-links.test.ts`: [web/ward-round] Round saves resume after a failure: "Second draft fails" (the fake `fetch` rejects the second entry post once), "Already linked" (the fake `fetch` answers the retried post with that 400), "Retry past the margin" (a fake `now` moved from 19:54 to 19:56 between the attempts).
  - Implement `ApiError.issues`, `alreadyLinked`, and `Reading.voice.saved`/`entries` with per-draft patches in `#saveVoice` and the same rule in `save` (entry, level and bag reading).
  - Verify: these tests and `round.test.ts` pass.
- [x] 7.3 The model accuracy view's data.
  - Write the failing tests in `apps/web/src/lib/model-accuracy.test.ts`: [web/ward] Model accuracy view: "Two requests" (`dataQualityLoad`), "Read kinds" (`kindRows`, `KIND_LABEL`), "Type table" (`typeRows`), "Volume and negatives" (`volumeText`, `negativesText`), "Mean error withheld", "No reads".
  - Implement the rest of `apps/web/src/lib/model-accuracy.ts` and `api.modelQuality`.
  - Verify: these tests pass, and `quality.test.ts` is unchanged.

## 8. Web screens

- [x] 8.1 Components, as design.md §8 (StyleX tokens, `color.fg`/`color.muted` for text, tabular numbers):
  - new lazy `components/model-accuracy.tsx`: the window, the kinds table, the "Drink and fluid" table, the volume line and the negatives line, each table in a horizontally scrolling wrapper;
  - `components/ward-quality.tsx` loading through `dataQualityLoad` and rendering the section in `Suspense`.

  Verify: `pnpm typecheck`, `pnpm lint` and the web tests pass.
- [x] 8.2 Browser check at 390 and 1100 px, through the Vite proxy, on the demo store from 5.1. Block `/api/ai/*` in the browser (Playwright `route(…, abort)`), so no model request can be sent; nothing here needs one.
  - **Signed in as `anita` (Anita Thomas, nurse):**
    - 3A → Data quality:
      - the existing tiles first, then "Model accuracy · Last 7 days";
      - the kinds table shows `Photo (SAM + Spark)` with `<pct>% · n/of` rates, and a row under `MIN_N` shows `— · n/of`;
      - the "Drink and fluid" table lists the model's types with kept rates and changes;
      - the volume line reads `… mL mean error · within ±25 mL …`;
      - the negatives line reads `Nothing to chart: 1 confirmed · 1 charted anyway (Drink 1)`;
      - at 390 px the tables scroll inside their wrapper and the page does not scroll sideways;
    - 5B → Data quality: the section renders with its own counts.
  - **In the network panel:** opening Data quality sends exactly the two GETs, and no `/api/ai` request is attempted.

## 9. Verification

- [x] 9.1 `pnpm verify` passes (format, lint, `openspec validate --all --strict`, spec:check, typecheck, tests).

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply`, and again before `/opsx:archive`.
- Clear context between proposing and applying.
- The tray follow-up (design.md, "Deferred to a follow-up change") is a separate change on tray-segmentation's archived text.
- Archive with `openspec archive read-outcomes --yes` once `pnpm verify` passes.
