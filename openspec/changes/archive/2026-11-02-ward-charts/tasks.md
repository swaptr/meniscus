# Tasks

## 1. Shared types and server

- [x] 1.1 Add `HourlySeries` (`in_ml`, `out_ml`, `in_logged`) and `AdmissionSummary.hourly` to `packages/shared`. Verify: typecheck errors appear only at the call sites below.
- [x] 1.2 Add the hourly bucket query in `store.admissions()` for [charting/entries] Hourly series. Tests in `chart.test.ts`: "Three entries" and "Bucket edge", asserting 0 upstream requests.

## 2. Web: chart maths

- [x] 2.1 `lib/charts.ts` with these tests in `charts.test.ts`:
  - [web/ward] Fluid balance chart: "Day so far".
  - [web/ward] Urine output rate against the threshold: "Low rate now", "No weight", "Recent admission".
  - [web/ward] Intake and output breakdown: "Mixed day".
  - [web/ward] Photo strip: "Three photos", "Many photos".
  - [web/ward] Ward activity strip: "Gap since morning".
  - [web/ward] Printable daily chart: "Two busy hours".

## 3. Web: screens

- [x] 3.0 Intake and output log as a data table (`lib/history.ts`, `components/entry-log.tsx`): shift groups, filters, column sort, 25 rows a page; phone shows time, type and volume with item, source and status folded in. Tests in `history.test.ts` cite [web/ward] Intake and output log by shift and [web/ward] Filter and sort the log. Verify: browser at 390 and 1100 px.

- [x] 3.1 `components/charts.tsx` (SVG) for [web/ward] Fluid balance chart, Urine output rate against the threshold ("No weight" text via `rateMessage`, tested; "Just under the line"), Intake and output breakdown and Ward activity strip. Read the `dataviz` skill first. Verify: typecheck and lint pass.
- [x] 3.2 Wire the bed review charts and the photo strip ([web/ward] Photo strip: "Three photos", "Many photos") into `/n/$id`, and the activity strip ([web/ward] Ward activity strip: "Gap since morning") into the ward dashboard. Verify: the browser shows them on the demo hospital, and the console has no errors.
- [x] 3.3 Add the `/n/$id/print` route (`n/$id_.print.tsx`) for [web/ward] Printable daily chart ("Two busy hours", rows from `printRows`), `data-app-chrome` on the shell, and print CSS. Verify: print preview shows only the sheet.
- [x] 3.4 Recorder level and the mic button for [web/capture] Recording feedback. Test "Seven seconds in" on `formatElapsed` and on recording state with no `/api/ai` call. Verify in the browser with the microphone.

## 4. Docs and verification

- [x] 4.1 README screens table: add charts and the print sheet. Verify by reading the diff.
- [x] 4.2 Check the bundle with `vite build`: each route stays under 100 KB gzipped.
- [x] 4.3 `pnpm verify` passes.

## Workflow follow-up

- Apply after `hospital-wards` and `entry-evidence` are archived. Run the `spec-reviewer` before apply and before archive.
