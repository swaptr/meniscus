# Tasks

## 1. Shared types

- [x] 1.1 Add `PhotoEvidence`, `NoteEvidence` and `EntryEvidence` to `packages/shared`, plus `EntryInput.evidence?`, `LevelInput.evidence?`, `Entry.evidence`, `Entry.recorded_ml` and `READ_AGREEMENT_TOLERANCE`. Use the constant in the server's `needsReview`. Update the `Entry` fixtures in `apps/web/src/lib/lib.test.ts` and `apps/server/src/chart/alerts.test.ts`. Verify: `pnpm typecheck`.

## 2. Server

- [x] 2.1 Store and validation for [charting/photo-evidence] Read evidence stored with the entry:
  - `entry.evidence` and `entry.recorded_ml`, with the migration.
  - The zod `Evidence` schema with the bounds from design.md and the kind/source refine, on `POST /entries` and `POST /levels`.
  - Tests in `apps/server/src/evidence.test.ts`: "Photo evidence round trip", "Level drop keeps evidence", "Malformed evidence", with 0 upstream requests asserted.
- [x] 2.2 Reject clears evidence, for [charting/photo-evidence] Rejected entries drop their photo. Extend the "Reject" test in `evidence.test.ts` to assert `evidence: null`.
- [x] 2.3 `recorded_ml` for [charting/entries] Recorded volume kept. Test: "Corrected on approval" in `apps/server/src/chart.test.ts`.

## 3. Web: capture

- [x] 3.1 Add `lib/evidence.ts` with `meanColour`, `toEvidence`, `noteEvidence` and `readSummary`. Tests in `apps/web/src/lib/evidence.test.ts`:
  - [web/capture] Liquid colour sampled from the photo: "Uniform liquid", "No liquid found".
  - [web/capture] Read summary on the check screen: "Three calls".
  - [web/capture] Read result kept as evidence: "Long model text".
- [x] 3.2 Add `evidence` to `saveEntry`, `saveLevel` and `Round.save` (with the optional `sampleColour`). Build it on the capture page and in the round. Tests in `evidence.test.ts` for [web/capture] Read result kept as evidence: "Adjusted photo draft", "Voice draft". The existing capture and round tests stay green.
- [x] 3.3 Capture check screen: the overlay and read summary line, with colour sampling in the browser. Verify in the browser using a saved read result from the fake server; no model calls.

## 4. Web: bed review

- [x] 4.1 Add `overlayBoxes`, `agreement` and `markAmounts` in `lib/evidence.ts`. Tests in `evidence.test.ts`:
  - [web/ward] Segmentation overlay: "Boxes on a 1000 × 1000 photo".
  - [web/ward] Reading versus segmentation: "Agree", "Disagree".
  - [web/ward] Transcript amounts highlighted: "Coconut water".
- [x] 4.2 `components/evidence.tsx` (`PhotoOverlay`, `EvidencePanel`), wired into `/n/$id` for pending and history entries. Verify: typecheck and lint pass, and the browser shows the panel for a demo entry (an entry with evidence posted through the API by hand, no model calls).

## 5. Docs and verification

- [x] 5.1 README: describe the evidence in "What it does" and "Privacy" (client-reported, deleted on reject). Verify by reading the diff.
- [x] 5.2 `pnpm verify` passes.

## Workflow follow-up

- Archive after `pnpm verify` passes.
- Later, as tooling: demo history can reuse an approved eval run's staged photos and read results as evidence (volumes taken from the read).
