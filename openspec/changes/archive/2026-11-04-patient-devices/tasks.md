# Tasks

Test first throughout: write the citing test, see it fail, implement, tick. Every test title is `[<domain>/<capability>] <Requirement name>: <scenario>`. Tests use the fake `fetch` with `createMetaClient` and assert request counts. No live model requests anywhere in this change.

## 1. Shared types and contracts

- [x] 1.1 Check the order: the live `CARE_KINDS` ends `catheter`, `diet` (dietitian-care archived), `STORE_SCHEMA_VERSION` is 6, and `openspec list` shows accuracy-views, dietitian-care, model-api-guards and meta-wire-types-refresh archived. Stop otherwise. Verify: `pnpm exec openspec list` and `grep -n STORE_SCHEMA_VERSION apps/server/src/store/store.ts`.
- [x] 1.2 In `packages/shared/src/index.ts`, add the design §1 types: the three kinds in `CARE_KINDS` before `diet`, `STOMA_TYPES`, `DRAIN_SITES`, `VOIDING_METHODS`, `UNMEASURED_VOIDING`, `VOIDING_CONTAINER`, `BAG_ORDER`, `CareValues` entries, `bedpan` and `commode_pan` in `CONTAINER_KINDS` after `drain_bag`, `bag_without_device` in `ALERT_KINDS` after `bag_nearly_full`, `OutputDevices`, and `devices` on the list item and the entries response. Verify: `pnpm typecheck` fails only where exhaustive maps need the new members (server codecs, `SAM_CONCEPT`, `CONTAINER_CATEGORY`, web labels and tones). List those places for groups 2–5.
- [x] 1.3 Write tests for `outputDevices` in `packages/shared` citing [charting/care-plan] Output devices on chart reads (`Fresh store`, `Catheter over the voiding order`, `Stoma and drain`, `Toilet`, as pure inputs). Then implement it. Verify: the tests pass.

## 2. Server: device orders and `devices`

- [x] 2.1 Write route tests for [charting/care-plan] Output device orders (`Ileostomy`, `Listed after the catheter`, `Changed and ended`, `Not by an attendant`, `No prompt`, the last with the fake upstream counting exactly one Explain request) and [charting/care-plan] Output device order values (`Every value`, `Invalid values`). Then add the three codecs in `src/chart/care.ts` and their validation in `src/routes/care.ts`. Verify: the tests pass, and the existing care-plan tests pass unchanged.
- [x] 2.2 Write tests for [charting/care-plan] Output devices on chart reads over HTTP (`GET /api/admissions` and `GET /api/admissions/:id/entries`, all four scenarios). Then wire `outputDevices` into `src/chart/view.ts` for both reads, and keep `devices` out of `GET /api/wards`. Verify: the tests pass, with `care` on a fresh store still exactly `{ orders: [], fluid_limit: null, intake_target: null, catheter: null }`.
- [x] 2.3 Write the test for [charting/care-plan] Care status on chart reads: `Device kinds before the diet`. Then make the `care.orders` sort follow `CARE_KINDS`. Verify: it and the existing `Fresh store` and `Display order` tests pass.

## 3. Server: prompts and reads

- [x] 3.1 Write tests for [charting/bag-periods] Bag reading without the device: `Urine bag on a bed with no catheter`, `Catheter added`, `Readings while the catheter was in`, `Stoma and drain`, `A day later`, and `Explained` (exactly one upstream request, no patient name in its input). Then implement design §4 in `src/chart/bags.ts`. Verify: the tests pass.
- [x] 3.2 Update existing server tests that post bag readings on a bed with no matching order and assert exact alert lists (design "Risks": `bags.test.ts`, `bag-alerts.test.ts`, `chart/alerts.test.ts`, `chart/bags.test.ts`). Give the fixture the order the live spec story implies, or assert `bag_without_device` where the scenario is about a bed without one. Drop no assertion. Verify: `pnpm --filter @meniscus/server test` passes.
- [x] 3.3 Write tests for [charting/alerts] Urine not measured (`Toilet, not measured`, pads too, with no `mismatch` or `intake_incomplete`; `Measured again`; `Catheter on a toilet bed`), [charting/alerts] Low urine output: `Commode and bedpan entries count`, and [charting/alerts] Fluid overload: `Toilet bed drinking well`. Then add the `urine_measured` hold to low output and overload in `src/chart/alerts.ts` (design §5). Verify: these and every existing Low urine output and Fluid overload test pass.
- [x] 3.4 Write tests for [capture/photo-reading] Bedpan and commode reads: `Commode pan, grounded` (SAM prompts `commode pan` and `liquid`, then one Spark request, 3 in all), `Bedpan, Spark only` (exactly 1), and `Unknown hint` (400, 0 requests). Then add `SAM_CONCEPT` and `CONTAINER_CATEGORY` entries (design §6). Verify: the tests pass, and `apps/server/src/ai/ai.test.ts` still counts 3 and 1 requests for every other read.
- [x] 3.5 Write a test that the Spark request's `instructions` name bedpans and commode pans and its schema's `container` enum holds `bedpan` and `commode_pan`. Then add "bedpans, commode pans" after "urinals" in `READING_SYSTEM`'s container list (`src/ai/reading.ts:66`, design §6), changing no other wording. The eval baseline is stale for these kinds (design §6); do not run the eval. Verify: the test passes, and the request counts in `ai.test.ts` are unchanged.

## 4. Web: capture and round

- [x] 4.1 Write tests in `apps/web/src/lib/bags.test.ts` and `lib/capture` tests for [web/capture] Capture choices follow the bed's devices: `Commode bed`, `Catheter and drain`, `Default urinal`, `Urine by hand` and `Toilet`, with the request list from a fake `fetch`. Then implement `hintsFor` and the urine `item` (design §7). Verify: the tests pass.
- [x] 4.2 Update and extend the [web/capture] Bag level by hand tests: `Emptied now` with `devices.bags` `["urine_bag"]` and the switch on at first, `Not a bag` with it turned off, and the new `No bag on record` and `Stoma only`. Then gate `bagOfCategory` on `devices.bags`. Verify: the tests pass.
- [x] 4.3 Write tests for [web/capture] Bag photo on a bed without that bag: `Attendant` (exactly two save requests, one `/api/ai/read`), `Nurse adds the catheter` (one `PUT`, then the entries reload), `Bag on record` and `Drain on a stoma bed`. Then implement the warning and "Add <device>" on `routes/a/bed.$token.tsx` with `components/bag-reading.tsx` and `care-forms.tsx`. Verify: the tests pass.
- [x] 4.4 Write tests for [web/ward-round] Bag readings on beds without the bag: `Default urinal bed` (both saved by "Save all high-confidence", no `/api/ai` request on save) and `Stoma bed`. Then add the warning in `lib/round.ts` and `routes/a/round.tsx` from the ward list's `devices`. Check that alert lists render keyed by index, so two `bag_without_device` do not collide. Verify: the tests pass, and the existing ward-round tests pass unchanged.

## 5. Web: nurse views

- [x] 5.1 Write tests for [web/ward] Output devices on the care plan: `Rows`, `Add a commode order`, `Form defaults`, `End an order` and `Attendant`. Then extend `components/care-plan.tsx`, `care-forms.tsx`, `lib/care.ts` and `lib/labels.ts`. Then update the existing [web/ward] Change care orders from the bed review tests in place: `Acuity not offered here` now expects nil by mouth, thickened fluids, fluid limit, intake target, catheter, stoma, drain, urine collection and diet, in that order, and `Form defaults` also opens the three device forms; drop no assertion. Verify: the tests pass, and the other "Care plan on the bed review" and "Change care orders from the bed review" tests pass unchanged.
- [x] 5.2 Write tests for [web/ward] Device badges on bed cards: `Every device`, `Default urinal` and `No extra request` (exactly two requests). Then extend `components/care-badges.tsx`. Verify: the tests pass.
- [x] 5.3 Write tests for [web/ward] Bag without a device on the bed review: `Colour`, `Add the catheter`, `Drain` and `Attendant`. Then add `bag_without_device` to `ALERT_LABEL` (`Bag not on care plan`) and `ALERT_TONE` (amber), with the action on `routes/n/$id.tsx`. Verify: the tests pass, and `pnpm typecheck` is clean for `apps/web`.
- [x] 5.4 Write tests for [web/ward] Fluid balance chart: `Urine not measured` and [web/ward] Printable daily chart: `Printed with urine not measured`. Then add the labels in `components/bed-charts.tsx` and `routes/n/$id_.print.tsx` from `devices`, and the bed card note (design §5). Verify: these and the existing `Day so far` and `Two busy hours` tests pass.

## 6. Demo seed, docs and integration

- [x] 6.1 Before editing the seed, seed an empty temp `DATA_DIR` with `DATA_DIR=$(mktemp -d) MODEL_API_BASE_URL=http://127.0.0.1:9/v1 MODEL_API_KEY=fake pnpm --filter @meniscus/server exec tsx scripts/demo-history.ts` (never `pnpm demo`/`dev`/`start`, which load `.env`), and confirm 2C-3 raises `[]`, as design §8 expects. Stop and revise §8 otherwise. Then seed the design §8 mix in `apps/server/scripts/demo-history.ts`:
  - 2C-6's catheter, ordered at `ADMITTED + HOUR` and reviewed today;
  - 2C-2's drain, ordered 24.5 h ago;
  - 2C-3's ileostomy and stoma readings;
  - commode on 2C-1, 3A-4 and 5B-6, and bedpan on HDU-3, with their urine `item`s;
  - toilet on 3A-7, with its urine rows dropped;
  - each photo's evidence container per §8 "Evidence follows the device": `urinal`, `bedpan` or `commode_pan` vessels for urine entries (with `VESSEL` entries for the two), `urine_bag` only for catheter-bed bag readings, and the 5B-4, 5B-5 and 5B-6 wording.

  Update the file's header comment. Extend the guard:
  - every existing `INTENDED` row unchanged;
  - `'2C-3': []`, the §8 "Expected prompts" list with its stoma readings;
  - each admission's `devices` equal to the §8 table;
  - no bed raising `bag_without_device`;
  - the §8 read-mix additions: no entry's photo evidence names `urine_bag`, every photo urine entry's evidence container is its bed's `VOIDING_CONTAINER[devices.urine]`, and every photo urine entry links a read.

  Verify: the seed runs on an empty temp `DATA_DIR` with no upstream request, every guard passes, and the read-mix guard's existing checks pass unchanged.
- [x] 6.2 README "Emptying bags": add the device orders, the default urinal, `bag_without_device`, unmeasured urine and the two containers. Verify: `pnpm format` leaves it unchanged.
- [x] 6.3 Browser check on the 6.1 store, with the server started by `pnpm --filter @meniscus/server exec tsx src/index.ts` with `MODEL_API_KEY=fake` and the model API base URL on a local fake upstream at `127.0.0.1` (`testing.ts`'s `upstream()` behind the HTTP shim `apps/server/scripts/fake-server.ts`). No `.env`, and 0 real upstream requests:
  - 2C's dashboard shows `Catheter day …`, `Drain`, `Stoma` and `Commode` badges where §8 puts them;
  - 3A-7's care plan reads `Toilet for urine · not measured`;
  - on 3A-5 (default urinal), the hint list has no bag, and a photo read as a urine bag shows the `No catheter` warning;
  - saved as Ravi Kumar, the reading raises `Bag not on care plan` on the dashboard;
  - as Anita Thomas, "Add catheter" clears it.

  Verify: the fake upstream logged only the reads made, 3 per photo in `sam+spark`, and no real request was sent.
- [x] 6.4 `OPENSPEC_TELEMETRY=0 OPENSPEC_NO_UPDATE_CHECK=1 pnpm exec openspec validate patient-devices --strict` and `pnpm spec:check` pass. All 20 requirements are cited: 4 in `charting/care-plan`, 1 in `charting/bag-periods`, 3 in `charting/alerts`, 1 in `capture/photo-reading`, 3 in `web/capture`, 1 in `web/ward-round` and 7 in `web/ward`. Verify: both commands exit 0.
- [x] 6.5 `pnpm verify` passes: format, lint, `openspec validate --all --strict`, spec:check, typecheck and tests (specs and traces included).

## Workflow follow-up

- Run the `spec-reviewer` agent on `patient-devices` before `/opsx:apply`, and again before `/opsx:archive`.
- `openspec archive patient-devices --yes` once 6.5 passes, then `pnpm spec:check`.
- **No schema version change**: this change leaves the SQLite `STORE_SCHEMA_VERSION` unchanged. Later changes (scale-store, postgres-store) keep their own version lines, and neither is edited here.
- **ui-polish**: when applying, keep the device badges alongside its reworked care badges (design §9).
- **scale-store**: its cached status unit includes `devices` (design §9). Its MODIFIED blocks touch no requirement of this change.
