# Design: labeled-photo-copy

## Context

See proposal.md for the motivation. ui-polish (applied first) puts `container_mask`, `fluid_mask` and `fluid_volume_ml` on `Segmentation`. It also draws the photo and tray overlays as SVG over the raw photo: contours from the masks, a dimmed surround, the surface line and labels. Tray reads already return `image_sha256`, and meals bind their evidence to their photo with it ("Tray evidence bound to its photo"). Photo reads do neither. Media is one table, and a record links it by column: `entry.media_id`, `level.media_id` / `proof_media_id`, and `meal.media_id` / `served_media_id`. The unlinked sweep is the `UNLINKED` SQL in `apps/server/src/store/store.ts`, which checks those columns. The server's runtime dependencies are `hono`, `@hono/node-server`, `@hono/zod-validator` and `zod`. No image library is installed.

## Goals / Non-Goals

**Goals:** keep a labeled copy beside every segmented raw photo, with the same lifecycle as the raw; bind photo evidence to its raw bytes; show `Labeled | Raw`; print labeled copies; 0 model requests and 1 extra upload per segmented save.

**Non-Goals:** a server-side renderer; new dependencies; copies for queued reads or photos with no read; putting the copy in a meal's proof; re-rendering after corrections. See proposal.md, "Out of scope".

## Changed types first

```ts
// packages/shared
export interface CaptureReadResult {
  // …existing fields
  /** SHA-256 of the image bytes read, lowercase hex. Never logged. */
  image_sha256: string
}

export interface PhotoEvidence {
  // …existing fields
  /** The read's image_sha256; must equal the raw media's sha256 when a media_id is posted. Absent on evidence stored before this change. */
  image_sha256?: string
}

// Inputs: each gains
labeled_media_id?: number          // EntryInput, LevelInput, BagReadingInput, MealInput

// Responses: each gains
labeled_media: MediaRef | null     // Entry, Level (and LevelSnapshot in entry.levels.before/after), BagReading, Meal
```

The labels are not a shared type: the canvas copy reuses the web's SVG overlay code, `overlayView` and `liquidLabel` (`apps/web/src/lib/overlay.ts`) and `trayRegionLines` (`apps/web/src/lib/tray.ts`).

`packages/meta` is unchanged.

## Decisions

### D1. Render on the device, with canvas

- The web already has the decoded, shrunk JPEG and the evidence, and it draws the overlay as SVG. ui-polish's contour tracing (marching squares in `apps/web/src/lib/`) yields polygons in source pixels.
- `apps/web/src/lib/labeled-copy.ts` (new) draws onto an `OffscreenCanvas`, or an `HTMLCanvasElement` where that is missing, the size of the uploaded bitmap:
  1. the raw bitmap;
  2. a 40% ink veil outside the container contour, or outside every dish for a tray;
  3. 3 px tinted contours with a 1 px light halo;
  4. the surface line;
  5. label chips (text from `overlayView`, which uses `liquidLabel` and `trayRegionLines`).
- The copy is then encoded with `convertToBlob({ type: 'image/jpeg', quality: 0.85 })` (or `toBlob`).
- Text uses the app's system font stack at 3.6% of the shorter side, at least 14 px, so it stays readable when printed.
- Contours are smoothed (`smoothPoly`, over one mask cell) only in the copy; the live SVG overlay draws them unsmoothed.
- The output is deterministic for a given bitmap and evidence. The test (node, no DOM) checks the drawing plan, which lists the polygons, label texts and positions, against fixtures. The browser check confirms the pixels.

Alternatives:
- **Server-side (sharp, @napi-rs/canvas).** Rejected: it adds a native dependency that needs approval, and it decodes patient pixels on the server.
- **Muse Image edits.** Rejected: it costs a model request, the output is not deterministic, and it would send the photo upstream again.
- **SVG stored next to the raw.** Rejected: it is not an image that prints or exports on its own.

### D2. One extra upload, plain photo media

- The copy is a normal `POST /api/admissions/:id/media` with `kind: photo`, so it gets the same type sniffing, size limit, `sha256` and `no-store` serving. The upload route does not change.
- The save order is: raw upload, then the copy's upload, then the record post with `media_id` and `labeled_media_id`.
  - If the raw upload fails, no copy is drawn and the record is saved as before.
  - If drawing or uploading the copy fails, the record is still posted without it, and the save result carries the warning `Labeled copy not kept`. That upload is never resent, under the project's no-loops rule.
- Retries of a failed record post reuse both ids, as the existing retry path reuses `media_id`.
- Saves that do not change:
  - Bag levels typed by hand with a photo, after-emptying proof and served-tray photos have no read, so they get no copy.
  - Spark-only reads have `segmentation: null`, so they get no copy.

### D3. `labeled_media_id` is a column, not an evidence field

- The column is `labeled_media_id INTEGER REFERENCES media(id)` on `entry`, `level` and `meal`, with an index on each (`entry_labeled_media`, `level_labeled_media`, `meal_labeled_media`).
- `UNLINKED` gains three `NOT EXISTS` clauses. postgres-store ports them; scale-store (after it, on Postgres) makes the labeled link set `linked_at` too.
- Rejecting an entry nulls `labeled_media_id` alongside `media_id`, and voiding a meal does the same. Each then runs the existing "delete when last link removed" check for both ids.
- The `MEDIA_JSON` select is reused for `labeled_media`.
- Meal evidence and proof are immutable by trigger. The trigger covers only those two columns, so it is unaffected.
- `STORE_SCHEMA_VERSION` goes from 8 to 9 (fresh-schema: one `SCHEMA`, no upgrade path). s3-media (applied before) sets 8. 9 is the last SQLite version: postgres-store, applied next, ports the version-9 schema to Postgres and removes SQLite. If the live value is not 8 at apply time, stop and re-sequence.

Validation lives in `apps/server/src/routes/chart.ts` and `evidence.ts`, beside the `media_id` checks. A request is refused with 400 `invalid_request` unless:
- `labeled_media_id` comes with a `media_id`, and differs from it and from `served_media_id`;
- it names live media of the same admission, of kind `photo`, with `served_meal` null, that no record has ever linked (no `entry`, `level` or `meal` column names it);
- the evidence is present with a non-null `segmentation`.

### D4. `image_sha256` binds photo evidence to the raw photo

- `apps/server/src/ai/reading.ts` computes `sha256Hex(image)` for the photo read result, as `pipeline.ts` already does for trays. This is local work with no request.
- The evidence schema accepts an optional `/^[0-9a-f]{64}$/`.
- When the post has a `media_id`, the value is checked against that media's `sha256`, as in "Tray evidence bound to its photo".
- It stays optional so that evidence stored before this change, and by-hand photos, still round-trip.
- Request logging records paths, models, statuses and timings only, so the value never reaches a log. A test asserts that.

### D5. Labels come from one function

The labels are not stored. They are a function of stored fields: `reading.container` (its display name), the entry's `drink` (else `Liquid`), `fill_fraction`, `fluid_volume_ml`, and the tray's dishes and fluids. `overlayView`, `liquidLabel` and `trayRegionLines` in `apps/web/src/lib` are used by the SVG overlay (ui-polish) and by the canvas copy, so the two never disagree. The copy is a snapshot taken at capture: a later drink correction changes the live overlay and the audit trail, not the stored copy.

### D6. Views

- `lib/photo-view.ts` (new, pure) picks what each mode shows; the entry peek (`components/entry-peek.tsx`) and the source view (`components/source-view.tsx`: entry details, the jug before and after photos, the tray proof and the bag period's before-emptying photo) use it. They show `Labeled | Raw` on ui-polish's `Segmented`.
- Labeled:
  - with `labeled_media`, it shows the copy, with `Labeled copy fingerprint: …`;
  - with segmentation but no copy, it shows the live overlay, captioned `Labeled copy not kept · drawn from the read`;
  - otherwise it shows the raw photo under `No labeled copy · Spark-only read, no regions`.
- Raw is the bare photo.
- Each media id is fetched at most once, through ui-polish's peek photo cache (the 24 most recent).
- The reveal plays only on the live overlay.
- The photo strip thumbnails fetch the copy when there is one.
- `routes/n/$id_.print.tsx` adds `Photos` (at most 12, newest first) and calls `print()` only after every image has loaded or failed.

### D7. Ward round

The round's "Save all high-confidence" uses the same save helper (D2) for each photo reading, so a segmented reading is saved with two uploads and then its post.

## Risks / Trade-offs

- **The extra upload doubles photo storage for segmented saves.** The copy is the same size as the raw (≤ 1280 px, as `shrinkPhoto` in `apps/web/src/lib/photo.ts`, JPEG 0.85, about 150–300 KB). s3-media stores it as ordinary media: its own row, its own hash and object, deleted by the same last-row rule. scale-store sets its `linked_at`, and postgres-store carries the column. Accepted.
- **Save latency grows by one upload.** It runs after the raw upload, because the copy needs the bitmap that was uploaded. The post waits for it. On a slow link a failed copy upload does not block the save (D2).
- **Canvas text rendering differs by browser**, so the copy's pixels are not byte-identical across devices. The drawing plan is deterministic and tested, and the copy's `sha256` fingerprints what was kept.
- **Queued reads (read-queue) have no copy.** The Labeled view falls back to the live overlay, so nothing is lost, only not stored as an image.
- **MODIFIED blocks copied from ui-polish's unarchived deltas** must be re-copied at apply time if ui-polish changes before it archives (tasks 1.1).
