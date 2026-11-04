# Tasks

Work test first throughout: write the citing test, see it fail, implement, then tick. Every test title is `[<domain>/<capability>] <Requirement name>: <scenario>`. Tests use the fake `fetch` with `createMetaClient` and assert request counts. No live model request is sent anywhere in this change.

## 1. Order, shared types and contracts

- [x] 1.1 Check the order before starting. `openspec list` must show patient-devices (and every earlier change) archived and ui-polish not archived. `STORE_SCHEMA_VERSION` must be 6, and `CONTAINER_KINDS` must hold `bedpan` and `commode_pan`. Stop otherwise. Verify: `pnpm exec openspec list` and `grep -n STORE_SCHEMA_VERSION apps/server/src/store/store.ts`.
- [x] 1.2 In `packages/shared/src/index.ts`, add the design §1 types:
  - `DRINK_KINDS`, `DrinkKind`, `DRINK_LABEL`, `DRINK_NAME_MAX` and `isDrinkKind`;
  - the five new `FLUID_KINDS`, in design order;
  - `MEAL_FLUID_KINDS = DRINK_KINDS`;
  - `drink_name` on `ContainerReading`, and `drink` on `DraftEntry`, `EntryInput`, `Entry`, the amend body and the entry event (`from_drink`, `to_drink`);
  - `drink_kind` on `ModelQuality`.

  Verify: `pnpm typecheck` fails only at exhaustive maps (`FLUID_CATEGORY`, web fluid labels, fixtures). List those places for groups 2–5.

## 2. Server: reads

- [x] 2.1 Write tests for [capture/photo-reading] Drink identified in the reading: `Filter coffee, grounded` asserts the Spark request's `fluid` enum, the required `drink_name`, the instructions naming the drinks, and exactly 2 SAM + 1 Spark requests. `ORS, Spark only` asserts exactly 1 request. Then extend `READING_JSON_SCHEMA`, `ReadingSchema` and `READING_SYSTEM` step 1 (design §3), keeping patient-devices' container prose. Verify: the tests pass, and every request count in `apps/server/src/ai/ai.test.ts` is unchanged.
- [x] 2.2 Write unit tests for [capture/photo-reading] Drink name bounds (`Cleaned`, `Too long` asserting the exact 40-character result, `Not a drink` covering `urinal`/`urine`, `stoma_bag`/`other` and `water`/` N/A `). Then add `drinkName` in `src/ai/text.ts` and call it from `ReadingSchema`'s transform with the fluid and container (design §2). Verify: the tests pass.
- [x] 2.3a Write route tests for [charting/photo-evidence] Read evidence stored with the entry (`Masala chai photo`, `Evidence without a drink name`, `Drink name too long`) in `apps/server/src/evidence.test.ts`, with 0 upstream requests, and see `Masala chai photo` fail with 400. Then add `drink_name: z.string().max(DRINK_NAME_MAX).nullable().optional()` to the photo evidence `Reading` in `routes/evidence.ts` (design §5a). Verify: the tests pass, and the existing `Photo evidence round trip` and `Malformed evidence` tests pass unchanged.
- [x] 2.3 Update the [capture/photo-reading] Draft entry from reading tests: `Urine bag` with `drink: null`, `Tea in a cup`, `Unknown liquid in a stoma bag`, `Nothing chartable`. Add `Masala chai`, `Soup in a cup` and `Unnamed liquid in a cup`. Then implement design §4 in `src/ai/draft.ts`. Verify: these tests and patient-devices' [capture/photo-reading] Bedpan and commode reads tests pass unchanged (`item: "commode pan"`, `"bedpan"`).
- [x] 2.4 Write tests for [capture/notes] Drink kind from a note:
  - `Coconut water typed`: the tool's parameters list `drink`, and exactly 1 Spark request is made;
  - `Tea and urine spoken`: exactly 1 ASR request and 1 Spark request;
  - `Drink not named`.

  Then add `drink` to `LOG_ENTRY_TOOL` and the post-call rule, and update `NOTE_SYSTEM` (design §3–4). Verify: the tests pass, and the existing [capture/notes] tests pass unchanged.
- [x] 2.5 Write tests for [capture/meal-reading] Tray fluids share the drink kinds: `Chaas with lunch` makes exactly 3 requests, and `Coffee, Spark only` exactly 1. Also assert that a compared read with a fluid still makes exactly 5. Then widen `MealModelSchema` and `MEAL_JSON_SCHEMA` through `MEAL_FLUID_KINDS`, apply `drinkName` in `toMealReading`, and update `MEAL_SYSTEM` step 5 (design §5). Verify: the tests pass, and the existing [capture/meal-reading] tests pass unchanged.

## 3. Server: entries, audit and storage

- [x] 3.1 Schema (design §6): add `entry.drink`, `entry_event.from_drink` and `to_drink` to `SCHEMA`. Bump `STORE_SCHEMA_VERSION` from 6 to 7, stopping if the live value is not 6. Add no upgrade step. Verify: the [charting/entries] Store schema version tests pass with version 7.
- [x] 3.2 Write route tests for [charting/entries] Drink kind on the entry (`Tea posted`, `No kind given`, `Misplaced kind`), with the fake upstream counting 0 requests. Then validate `drink` in `routes/chart.ts`, store it, and return it from entry lists, including after a store reopen. Verify: the tests pass, and [charting/entries] Record an entry and Drink consistency on the entry pass unchanged.
- [x] 3.3 Write tests for [charting/audit] Amend a drink's kind (`Tea was coffee`, `Drink amended to IV`, `Misplaced kind`, `Amend rules apply`). Then extend the amend codec and handler in `routes/common.ts`/`routes/chart.ts` and the store's event columns. Verify: the tests pass, and the [charting/audit] Amend an approved entry and Amend a drink's consistency tests pass unchanged.

## 4. Server: accuracy and eval

- [x] 4.1 Update the [charting/model-accuracy] Read log holds no text tests to the MODIFIED scenarios: `Voice note` with `kokum sherbet`, `Photo read` with `drink_name` `masala chai`, and `Tray read`. Assert the exact request counts in each. Write [charting/model-accuracy] Drink kind in the read log (`Photo of coffee`: exactly 3 requests; `Voice note with two drafts`: exactly 2). Then add `drink` to `DraftFactsSchema` with `.default(null)`, and fill it in `src/ai/read-log.ts`. Verify: the tests pass, and a stored read without `drink` still parses (a fixture row in `read-log.test.ts`).
- [x] 4.2 Write tests for [charting/model-accuracy] Drink kind table (`Tea that was coffee`, `Changed away from a drink`) in `chart/model-accuracy.test.ts`, with 0 upstream requests. Then add the `drink_kind` tally (design §7). Verify: the tests pass, and every existing [charting/model-accuracy] summary test passes unchanged.
- [x] 4.3 Write tests for [charting/model-accuracy] Drink kinds in the lab evals: `Coffee labelled` in `lab.test.ts` and `tray-lab.test.ts`, and `Plan` with 30 requests planned and none sent. Then widen `lab/synth.ts`' `expected_fluid` through `FLUID_KINDS`. Verify: the tests pass, and `pnpm --filter @meniscus/server eval <dir>` without `--yes` prints a plan and sends nothing (dry run only).
- [x] 4.4 Docs: in `docs/accuracy.md`, list the new drink kinds and the `Drink kind` table, and note that any earlier eval output and tray labels made before the new kinds are stale (design §7). Do not run the eval. Verify: `pnpm format` passes.

## 5. Web

- [x] 5.1 Add `apps/web/src/lib/drinks.ts` (design §8) and tests for `drinkTitle` and `drinkTotals`. Add the new fluid kinds to every exhaustive web map that typecheck listed in 1.2. Verify: `pnpm --filter @meniscus/web test` and `pnpm typecheck` pass.
- [x] 5.2 Write tests for [web/capture] Drink on the check screen: `Masala chai photo` makes exactly two save requests and no `/api/ai` request; `Kind changed`; `Coconut water by hand` makes only the entries post; `Output draft`. Then add `DrinkPicker` to the capture check screen and the by-hand form, and send `drink`/`item` in `toEntryInput`. Verify: the tests pass, and the existing [web/capture] Drink consistency on the check screen tests pass unchanged.
- [x] 5.3 Write tests for [web/ward] Drinks named on the bed review (`Masala chai in the log`, `Older drink`), [web/ward] Intake and output breakdown (`Mixed day`, `Drinks by kind`) and [web/ward] Meal fluids with their kind (`Lunch with chaas and soup`). Then wire `DrinkLabel` into `entry-log.tsx`, the pending list and `timeline.tsx`, `drinkTotals` into `bed-charts.tsx`, and the fluid rule into `meals.tsx`. Verify: the tests pass, and [web/ward] Meals on the bed review: `What the AI read` still reads `soup · 150 mL`.
- [x] 5.4 Write tests for [web/ward] Correct a drink's kind (`Tea to coffee`: exactly one amend request; `Not a drink`). Then add the picker to `entry-details.tsx` Amend and `drink <From> → <To>` to `lib/history.ts`. Verify: the tests pass, and the [web/ward] Correct a drink's consistency tests pass unchanged.
- [x] 5.5 Write tests for [web/ward] Class table picker: `Drink kind table`, with the existing scenarios unchanged. Then add `Drink kind` to the `Table` select in `lib/model-view.ts` / `components/model-accuracy.tsx`. Verify: the tests pass, and the view still sends exactly the two requests of [web/ward] Model accuracy view: `Two requests`.

## 6. Later changes' version lines

- [x] 6.1 Check the later changes' schema version lines, already renumbered when this change was proposed (design §6):
  - at archive, the later changes were renumbered after it: s3-media 7 → 8, labeled-photo-copy 8 → 9, scale-store 9 → 10, postgres-store's importer accepts 10, read-queue's SQLite version stays 10;

  If another change bumped the version in the meantime, renumber these lines again and change nothing else. Verify: `grep -rn "6 to 7\|6 → 7\|is not 6\|: 7)\|, 7 (\|stays 7" openspec/changes/{scale-store,postgres-store,read-queue}` finds nothing, `grep -c "7 → 8\|7 to 8" openspec/changes/scale-store/{proposal,design,tasks}.md` reports exactly one line in each file (the three lines above, no duplicate bump), and `pnpm exec openspec validate --all --strict` passes.

## 7. Demo seed, browser check, verify

- [x] 7.1 Demo seed (design §10): vary the drinks and set `drink` on every `water` row. Update `drinkOf` and the photo evidence `fluid`/`drink_name`. Add the three drink guard rows. Keep every existing guard row and its expected values. Verify: `scripts/demo-history.ts` runs on an empty temp `DATA_DIR`, and every guard passes, including the read mix, the prompts per bed and poor intake.
- [x] 7.2 Browser check against `scripts/fake-server.ts` (fake upstream; 0 real model requests), with the read mode set to `sam+spark` (3 requests per photo read: 2 SAM, 1 Spark). Check each of these:
  - a photo read of a cup returns `Tea · 150 mL` with `masala chai` on the check screen, and saves;
  - the bed review log shows `Tea 150 mL · masala chai`, and the intake bar splits by kind;
  - Amend changes it to Coffee;
  - Data quality's `Table` select offers `Drink kind`.

  Verify: screenshots at 390 px and 1280 px, the fake upstream's request counter matching 3 for the `sam+spark` read, and no request to the real API. Note: the desktop screenshots were taken at 1100 px instead of 1280 px.
- [x] 7.4 Pre-archive review fixes, each test first: the drink kind table counts entries only (a saved jug level is left out), and a kind-only amend keeps the draft's outcome; an amend to a new kind sets `item` to its label and records `from_item`/`to_item` (new `entry_event` columns in SCHEMA, version stays 7); `drinkTotals` counts `water` entries only; a jug drop entry has `drink: water`, and the demo guard no longer skips it; `DrinkPicker` uses `SelectField`. Verify: server and web tests, typecheck, lint and spec:check pass.
- [x] 7.3 `pnpm verify` passes: format, lint, `openspec validate --all --strict`, spec:check (every ADDED and MODIFIED requirement cited), typecheck and tests.

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply` and before `/opsx:archive`.
- Before ui-polish is applied, fold in the follow-ups in design §9: the entry peek, dense rows, timeline hover, metric peeks, overlays, text equivalents and DESIGN.md.
- Re-running the eval for a new baseline needs the user's approval for its request count.
