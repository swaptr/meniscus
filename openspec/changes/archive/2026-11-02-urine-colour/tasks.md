# Tasks

## 1. Shared types

- [x] 1.1 In `packages/shared`:
  - add `URINE_COLOURS`, `UrineColour`, `URINE_REFERENCE`, `HEX_COLOUR` and `UrineSeen`;
  - add the optional colour fields to `ContainerReading`, `DraftEntry`, `EntryInput` and `AmendInput`;
  - add the required `urine_colour` and `urine_rgb` to `Entry`;
  - add `urine_seen` to `AdmissionSummary` and the entries response.

  Retype the server and web fixtures that build `Entry` objects. Verify: `pnpm typecheck`.

## 2. Server

- [x] 2.1 Reading:
  - in `ai/reading.ts`, the schema and prompt line, with the `'none'` sentinel and `.default('none')`;
  - `normaliseUrine` in `ai/text.ts`, applied in the reading pipeline;
  - `toDraft` carries the colour.

  Tests in `apps/server/src/ai/ai.test.ts`, with the fake fetch:
  - [capture/photo-reading] Urine colour read: "Dark urine in a bag", asserting 2 SAM and 1 Spark request; "Not urine"; "Not a hex colour".
  - The existing photo-reading tests stay green unchanged.
- [x] 2.2 Notes: in `ai/notes.ts`, `urine_colour` in the `log_entry` tool, the prompt line and normalisation by category. Tests in `ai.test.ts`:
  - [capture/notes] Urine colour from a note: "Dark urine noted", asserting exactly 1 Spark request; "Colour on a drink".
- [x] 2.3 Store and routes:
  - the columns, `migrate()`, `addEntry`/`toEntry`, `amend` with colour and the event fields, `urineSeen`;
  - `EntryBody`/`AmendBody` refines;
  - `urine_seen` in `GET /admissions` and `GET /admissions/:id/entries`.

  Tests in `apps/server/src/chart.test.ts` (entries), each asserting 0 upstream requests:
  - [charting/entries] Urine colour on the entry: "Urine with its colour", "Photo evidence with the colour" (evidence `Reading` in `routes/evidence.ts` accepts both fields), "Misplaced colour".
  - [charting/entries] Latest urine colour: "Newest colour wins", "No colour today".

  Tests in `apps/server/src/audit.test.ts`:
  - [charting/audit] Amend an approved entry: "Colour corrected" (new).
  - Update "Invalid amendments" in place (`apps/server/src/audit.test.ts:287`) with the `urine_colour: dark` on a drink case.
  - "Volume amended" and "Not approved" stay green unchanged.

  Also add a migration test: an entry table without the colour columns opens and returns `urine_colour: null`.
- [x] 2.4 Alerts in `chart/alerts.ts`. Tests in `apps/server/src/chart/alerts.test.ts`:
  - [charting/alerts] Appearance notes: update "Dark urine noted" in place (`alerts.test.ts:93`) to the new THEN (no `appearance` with adequate output).
  - Add "Red by colour" (exact message), "Clots noted" and "Dark and low".
- [x] 2.5 Demo history (`scripts/demo-history.ts`): give its urine entries plausible colours, mostly `pale` or `yellow`. Re-story bed 5B-5: today it is "dark, slightly cloudy" with adequate output, which no longer alerts. Make it `pink` with "pink tinge" so it keeps its appearance prompt. The bed already low on output gets `dark` with an rgb. Bed 5B-3 gets `yellow` from a voice note, with no rgb. Verify against a fresh temporary `DATA_DIR` that `GET /api/admissions` returns `urine_seen` for those beds and that nothing is sent upstream.

## 3. Web

- [x] 3.1 `lib/urine.ts` and `toEntryInput` with `colourFields`. Tests in `apps/web/src/lib/urine.test.ts`, with the `createApi` fake fetch for saves:
  - [web/ward] Urine colour beside urine counts: "Bag photographed dark" (entry swatch and seen swatch with ` · pending`), "Named in a note" (reference fill), "No colour".
  - [web/capture] Urine colour on the check screen: "Read colour kept", "Staff change the colour", "Type changed", and "By hand", asserting exactly one request and its body.
- [x] 3.2 Chart data in `lib/charts.ts`: a new `urineRuns()` (`breakdown()` is unchanged) and the `urineRate()` point fill. Tests in `apps/web/src/lib/charts.test.ts`, or wherever the existing `[web/ward] Intake and output breakdown` tests live:
  - [web/ward] Urine drawn in its own colour: "Colour turns dark", "No colour recorded".
  - [web/ward] Intake and output breakdown: "Mixed day" stays green unchanged.
  - The existing rate scenarios stay green unchanged.
- [x] 3.3 `components/urine-swatch.tsx` and `components/urine-colour-picker.tsx`. Wire them into every place listed in design.md under Web. Verify in the browser at 390 and 1100 px against the demo data, with no model requests:
  - the ward bed card;
  - the bed review totals and rate chart header;
  - the Out bar's colour runs and the coloured rate points (pale on white is visible through the outline);
  - log rows and entry details;
  - the by-hand form chips. Save one by-hand urine with a chip, then check the row.

  Check that pale swatches are visible on white. No console errors.

## 4. Docs and verification

- [x] 4.1 README:
  - urine colour: how it is read and shown, how staff correct it, and the reference colours as display only;
  - the appearance alert rule, with the reasons for dropping dark and cloudy as stand-alone triggers;
  - request counts unchanged;
  - the test count.
- [x] 4.2 Bundle check: each route stays under 100 KB gzipped.
- [x] 4.3 `pnpm verify` passes.
