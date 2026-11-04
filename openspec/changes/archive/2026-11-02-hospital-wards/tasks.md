# Tasks

## 0. Tooling

- [x] 0.1 Make `scripts/spec-check.ts` stop requiring citations for live requirements that an active change REMOVES or RENAMES FROM. Their tests move with the change. Verify: `pnpm spec:check` passes after the "Demo ward" tests are re-cited to "Demo hospital".

## 1. Shared types

- [x] 1.1 Add `Ward`, `WardSummary` and `HospitalSummary`, and add `ward_id`, `ward_code`, `ward_name` and `mrn` to `Admission` in `packages/shared/src/index.ts`. Also update the `Admission` fixtures in `apps/server/src/chart/alerts.test.ts` and `apps/web/src/lib/lib.test.ts`. Verify: `pnpm typecheck` shows only the expected errors at the call sites updated in groups 2–4.

## 2. Store and API (apps/server)

- [x] 2.1 Store schema, demo seed and queries for [charting/wards] Demo hospital:
  - Add the `ward` table and the new `admission` columns.
  - Move the seed into `store/demo-hospital.ts` (4 wards, 21 fictional admissions, fixed `AT-` MRNs).
  - Add `admissions(wardId?)`, `wards()` and `ward(id)`.
  - Move the old "Demo ward" tests in `chart.test.ts` to cite "Demo hospital" (Fresh store, Seeding happens once). Write them first and watch them fail.
- [x] 2.2 Pre-ward migration in `migrate()` for [charting/wards] Pre-ward stores. Test: build a file with the old `admission`/`entry` DDL, open it with `openStore`, and assert ward `W1` 6/6, unchanged tokens and the kept entry.
- [x] 2.3 Add `GET /api/wards` to `routes/chart.ts` for [charting/wards] Ward summary. Tests: "Pending entry on 5B" and "Bed with a prompt", each asserting the upstream received no request.
- [x] 2.4 Add `GET /api/admissions?ward=` for [charting/wards] Admissions by ward. Tests: "One ward", "Whole hospital" and "Unknown ward" (`999` and `abc`).
- [x] 2.5 Ward fields on every admission response for [charting/wards] Admissions carry their ward. Test: "Bed lookup" for 5B bed 4. The "Fresh store" key-pinning test gains `mrn`, `ward_code`, `ward_id` and `ward_name`.
- [x] 2.6 Update the existing server tests that look beds up by label only (`bed('4')`) to use ward and bed. The Explain de-identification test asserts against that admission's own `patient` and `mrn`, not a hard-coded name. Verify: `pnpm --filter @meniscus/server test` passes.
- [x] 2.7 Demo history:
  - Key the rows by ward code and bed, with the story beds on 5B.
  - Generate a routine day for every other occupied bed, plus HDU bed 2 overload and 3A bed 5 with two pending entries.
  - Verify: run `pnpm --filter @meniscus/server demo` with a temporary `DATA_DIR`, then call `GET /api/wards`. Expect prompts only on 5B (4 beds: 2, 3, 4, 5), HDU (1) and none elsewhere, and 3A pending 2. No model requests.

## 3. Web: nurse screens (apps/web)

- [x] 3.1 Add `api.wards()` and `api.admissions(ward?)` for [web/ward] Ward dashboard per ward. Test in `lib.test.ts`: "Open ward 5B" asserts exactly one request, `GET /api/admissions?ward=3`.
- [x] 3.2 Add `ago()` and `wardCard()` in `lib/ward.ts` for [web/ward] Hospital ward list. Tests: "Busy ward" and "Quiet ward".
- [x] 3.3 Routes:
  - `/n/` becomes the ward list (cards with a link to each ward, plus QR cards per ward).
  - New `/n/w/$ward` holds the per-ward bed table.
  - `/n/$id` gets the breadcrumb and MRN.
  - The sidebar link becomes "Wards".
  - Run `pnpm --filter @meniscus/web build` to regenerate `routeTree.gen.ts`.
  - Per-ward resources are keyed by ward id (`ward:${id}`).
  - The ward header comes from `ward_name` on the admissions response; no second `/api/wards` call.
  - Verify: `pnpm --filter @meniscus/web typecheck` and lint pass, and the browser shows ward list → ward → bed.
- [x] 3.4 QR cards per ward for [web/bed-qr] Bed card link:
  - `bedCard` takes `ward_code`/`ward_name`; the label is `5B · Bed 4` with the ward name as a sub-label.
  - `/n/qr?ward=<id>`.
  - Update the "Bed 4 card" test first.

## 4. Web: attendant screens

- [x] 4.1 Group `/a` beds by ward, with a "Start ward round" link per ward to `/a/round?ward=<id>`. `/a/round` gets `validateSearch` for `ward`. These presentation-only changes have no requirement and are covered by the browser smoke test in 5.2, as are the bed review breadcrumb/MRN and `/n/qr?ward=`. Verify in the browser.
- [x] 4.2 Round ward progress for [web/ward-round] Ward progress:
  - `RoundBed` gains `ward_id`/`ward_code`.
  - Add `setWard`, `visited`, and the `other_ward` outcome.
  - Round route: a bed grid with visited ticks and an "on Ward 3A" notice.
  - Tests: "Two beds visited" and "Card from another ward". The existing round tests stay green.

## 5. Docs and verification

- [x] 5.1 README: update the screens table (`/n` ward list, `/n/w/<id>`, ward rounds per ward) and the run section (fresh `DATA_DIR` for the demo hospital). Verify by reading the README diff.
- [x] 5.2 Browser smoke test with no model calls: ward list → 5B → bed 4 review; `/a` → 5B round grid; `/n/qr?ward=` print preview. Verify: screenshots look right and the console shows no errors.
- [x] 5.3 `pnpm verify` passes (format, lint, typecheck, tests, specs, traces).

## Workflow follow-up

- Run the `spec-reviewer` agent before `/opsx:apply` and before `/opsx:archive`.
- `openspec archive hospital-wards --yes` after `pnpm verify` passes.
