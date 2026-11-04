# Tasks: labeled-photo-copy

Write each citing test first, see it fail, then implement it and tick the task. Tests are titled `[<domain>/<capability>] <Requirement>: <scenario>`.

No task sends a model request, reads `.env` or installs a package. Server tests use a fake `fetch` with `createMetaClient` and assert 0 upstream requests for every save, upload, link and view.

## 1. Baseline

- [x] 1.1 Re-copy every MODIFIED block at apply time from its source.
  - Use the live spec where that change is archived. Otherwise use the change's delta: ui-polish for "Region quantities on the labeled photo", "Entry peek fetches its photo on open", "Segments revealed on first open", "Read drawn on the peek photo", "Photo strip" and "Tray overlay" (ui-polish's text verbatim, then only this change's edits: the copy, and `Raw` replacing the outline toggle).
  - Re-apply only this change's edits.
  - Re-diff drink-types' and ui-polish's final deltas against this change's requirement names. Any new overlap becomes a MODIFIED block.
  - Verify: `openspec validate labeled-photo-copy --strict` passes, and every requirement body is ≤ 500 chars with exactly one SHALL/MUST.
- [x] 1.2 Confirm that ui-polish's masks, `fluid_volume_ml` and contour tracing are in the tree, at `packages/shared` `Segmentation` and the web's contour lib. Verify: path:line recorded in the PR description.

## 2. Shared types and labels

- [x] 2.1 Add the shared fields to `packages/shared/src/index.ts`:
  - `CaptureReadResult.image_sha256`;
  - `PhotoEvidence.image_sha256?`;
  - `labeled_media_id?` on `EntryInput`, `LevelInput`, `BagReadingInput` and `MealInput`;
  - `labeled_media: MediaRef | null` on `Entry`, `Level`, `LevelSnapshot`, `BagReading` and `Meal`.

  Verify: `pnpm typecheck` shows only the expected call-site errors.
- [x] 2.2 Reuse the web's `overlayView`, `liquidLabel` and `trayRegionLines` (pure, `apps/web/src/lib`) for the copy's labels, test first. Cite [web/ward] Region quantities on the labeled photo: Urine bag with a volume, No capacity, Spark-only read, and [web/capture] Labeled copy drawn at the bed: Tray copy. The SVG overlay already uses them. Verify: the web tests and the existing overlay tests pass.

## 3. Server: read result and evidence binding

- [x] 3.1 Add `image_sha256` to the photo read result in `apps/server/src/ai/reading.ts` / `pipeline.ts`. Cite [capture/photo-reading] Photo read names its image: Urine bag read, Spark mode, Not in the log. The test asserts exactly 3 and 1 upstream requests, and that no captured log line contains the hash. Verify: `pnpm --filter @meniscus/server test`.
- [x] 3.2 In `src/routes/evidence.ts`, accept the optional `image_sha256` and check it against the media's `sha256` for entries, levels and bag readings. Cite [charting/photo-evidence] Photo evidence bound to its photo: Read and photo of the same bytes, Read of another photo, Malformed fingerprint, Evidence without a fingerprint. Verify: the server tests pass.

## 4. Server: link, lifecycle, sweep

- [x] 4.1 In `src/store/store.ts`:
  - add `labeled_media_id` columns and indexes on `entry`, `level` and `meal`;
  - add `labeled_media` refs in the entry, level, level-snapshot, bag-reading and meal selects;
  - bump `STORE_SCHEMA_VERSION` from 8 to 9 (fresh schema; stop if the live value is not 8).

  Verify: the [charting/entries] Store schema version tests pass at version 9, the store opens fresh, and the tests from before still pass.
- [x] 4.2 Validate and link `labeled_media_id` in `src/routes/chart.ts` for entries, levels and bag readings. Cite [charting/photo-evidence] Labeled copy linked with the photo: Urine bag entry with its copy, Jug level with its copy, Refused links, Without a copy. Verify: the server tests pass with 0 upstream requests.
- [x] 4.3 Do the same for meals. Cite [charting/meals] Labeled tray copy kept: Lunch with its labeled tray, Voided lunch, Refused copies. Verify: the server tests pass, and the evidence and proof triggers still refuse UPDATE.
- [x] 4.4 Make rejecting an entry and voiding a meal unlink and delete the copy, and add the three clauses to `UNLINKED`. Cite:
  - [charting/photo-evidence] Rejected entries drop their photo: Reject, Reject with a labeled copy;
  - [charting/media] Media goes with its record: Rejected entry with its labeled copy, Level keeps its labeled copy;
  - [charting/media] Unlinked media expires: Labeled copy in use, Labeled copy never saved (fake clock);
  - [charting/media] Media SHA-256 fingerprint: Labeled copy fingerprint.

  Verify: the server tests pass.

## 5. Web: render and save

- [x] 5.1 Write `apps/web/src/lib/labeled-copy.ts` (design.md D1).
  - Test first: a pure `drawPlan(bitmapSize, evidence, drink | tray)` that returns the veil, polygons, surface line and label chips. Cite [web/capture] Labeled copy drawn at the bed: Urine bag copy, Tray copy.
  - Then write `renderLabeledCopy(bitmap, plan)` on canvas. It returns a JPEG `Blob` at quality 0.85, the same size as the bitmap.

  Verify: `pnpm --filter @meniscus/web test`.
- [x] 5.2 Put the save helper in the capture lib: raw upload, then the copy's upload (segmented reads only), then the post. The evidence carries `image_sha256`. Request-count tests run against a fake `fetch`. Cite [web/capture]:
  - Labeled copy drawn at the bed: Copy upload fails, No read, no copy;
  - Photo saved as evidence: Save with photo, Save a Spark-only photo, Photo upload fails;
  - Jug photos record levels: Water jug reading;
  - Read result kept as evidence: Adjusted photo draft;
  - Bag photos record readings: Emptied on a general ward, Urinal;
  - Reads and saves carry their read: Photo draft.

  Verify: the web tests pass.
- [x] 5.3 Use the helper for meals. Cite [web/capture]:
  - Tray photo saved with the meal: Lunch from a tray, Spark-only tray;
  - Collected tray compared at the bed: Lunch compared, Tray photo not kept;
  - Meal saves carry their read: Tray lunch, Empty tray read, Retried meal save, Already linked.

  Verify: the web tests pass.
- [x] 5.4 Use the helper in the ward round. Cite [web/ward-round] Save the round: Mixed round, Two wards, and [web/ward-round] Round reads and saves carry their read: Save all high-confidence, Bag reading. Verify: the web tests pass. "Round saves resume after a failure" still passes unchanged.

## 6. Web: views and print

- [x] 6.1 Build `lib/photo-view.ts` (`Labeled | Raw`, the fallbacks and the fingerprint line) and use it, through the peek photo cache, in the entry peek and `components/source-view.tsx` (entry details, the jug photos and the tray proof). Cite:
  - [web/ward] Raw and labeled views of a kept photo: Copy shown first, Raw picked, Copy not kept, Spark-only read, Tray proof;
  - [web/ward] Source preview: Photo outline;
  - [web/ward] Entry peek fetches its photo on open: First and second open, Labeled copy first, Closed early, No photo;
  - [web/ward] Segments revealed on first open: Peek opened twice, Peek with a labeled copy;
  - [web/ward] Photo strip: Thumbnail of a labeled copy;
  - [web/ward] Tray overlay: Outline off, Kept tray copy;
  - [web/ward] Segmentation overlay: Raw hides the overlay;
  - [web/ward] Region quantities on the labeled photo: Urine bag with a volume (the peek AND), Spark-only read (placeholder and request count);
  - [web/ward] Read drawn on the peek photo: Corrected bag with its copy.

  Verify: the web tests pass.
- [x] 6.2 Add the `Photos` section to `routes/n/$id_.print.tsx`, with print gated on the images having loaded. Cite [web/ward] Photos on the printed chart: Two photos, Spark-only photo, No photos. Verify: the web tests pass.

## 7. Check and verify

- [x] 7.1 Browser check against a fake upstream, with 0 real model requests:
  - Start `pnpm --filter @meniscus/server fake` (`apps/server/scripts/fake-server.ts`, the fake Meta upstream), never the live API, and the web dev server.
  - Do these steps:
    1. Capture a `sam+spark` urine bag photo and save it.
    2. Open the entry peek.
    3. Toggle `Raw` and back to `Labeled`.
    4. Capture a `spark` cup photo.
    5. Save a tray meal and open its tray proof.
    6. Read and save a water jug level, and open its before and after photos.
    7. In the ward round, read a segmented bag photo and "Save all high-confidence".
    8. Make the copy's upload fail (block that one upload in the browser) and save a segmented photo.
    9. Reject the bag entry.
    10. Open `/n/<id>/print` and print preview it.
  - Confirm each of the following:
    - the save made 3 requests and the Spark-only save 2;
    - the copy shows `Urine bag` and `Liquid · 46% full ≈ 930 mL` drawn in;
    - Raw is clean;
    - the Spark-only placeholder shows;
    - the tray copy labels each dish (`1 rice · Half`) and fluid;
    - the jug photos show `Labeled | Raw` with their copies;
    - the round's saved reading has a labeled copy;
    - the failed copy shows `Labeled copy not kept` on save and `Labeled copy not kept · drawn from the read` in the peek, with no second upload;
    - after the reject, both media return 404;
    - the print page shows the labeled copies, with labels legible in print preview;
    - the upstream fake received only the read requests.

  Record the screenshots and request counts in the PR description.
- [x] 7.2 `pnpm verify` passes (format, lint, `openspec validate --all --strict`, spec:check, typecheck, tests).

## 8. Pre-archive review fixes

- [x] 8.1 Entry, level, bag-reading and meal posts run the read-link check before the photo-link and labeled-copy checks, so a retried save answers `already linked`. Cite [charting/photo-evidence] Labeled copy linked with the photo: Retried save, [charting/meals] Labeled tray copy kept: Retried save. Verify: the server tests pass.
- [x] 8.2 `rate_ml_h` is null for a period under 15 minutes, and the bed review shows `· — mL/h`. Cite [charting/bag-periods] Bag periods on the chart read: Too short to rate, [web/ward] Bag periods on the bed review: Too short to rate.
- [x] 8.3 The bag reading's `Before emptying` tile shows a camera icon; its viewer offers `Labeled | Raw` on the labeled copy. Cite [web/ward] Raw and labeled views of a kept photo: Bag reading photo.
- [x] 8.4 A jug volume typed over the read keeps the read's copy. Cite [web/capture] Jug photos record levels: Volume typed over the read.
- [x] 8.5 `scripts/demo-history.ts` names each synthetic read's image by the SHA-256 of its synthetic bytes.

