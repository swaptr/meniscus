# Proposal: labeled-photo-copy

## Why

After ui-polish, SAM's regions, masks, fill and liquid volume are kept in the evidence and drawn live over the raw photo. Only the raw photo is kept as an image, though. There is no stored image of what the read saw: the container and liquid contours with their names and quantities, or a tray's dishes and portions. Such an image is what the printed chart, a handover or an audit needs, and what the submission promises: each uploaded image is processed, and both the raw photo and a labeled copy with SAM regions are kept.

## What Changes

- **Labeled copy kept with the raw photo** (`web/capture`, `web/ward-round`).
  - When a photo whose read has segmentation is saved, the device draws a labeled copy: the raw pixels at the same size, with the overlay ui-polish defines drawn into them. That is the dimmed surround, the contours, the surface line and the labels, such as `Urine bag` and `Liquid · 46% full ≈ 930 mL`, or `1 rice · Half` for a tray region.
  - The copy is a JPEG at quality 0.85, uploaded as a second `POST /api/admissions/:id/media` (`kind: photo`) after the raw upload. The record post then names it as `labeled_media_id`.
  - This adds 1 upload and 0 model requests.
  - Spark-only reads, reads with `segmentation: null` and photos with no read (a typed bag level, after-emptying proof, served tray) get no copy.
  - If the raw upload fails, no copy is attempted. If drawing or uploading the copy fails, the record is still saved with the raw photo, and the screen says `Labeled copy not kept`.
- **Linked and returned** (`charting/photo-evidence`, `charting/meals`).
  - Entry, level, bag-reading and meal posts accept `labeled_media_id` and return `labeled_media`, a `MediaRef` with its `sha256`, or null.
  - It needs the raw `media_id` and must be a different photo of the same admission. It also needs evidence with segmentation.
- **Lifecycle** (`charting/media`).
  - A `labeled_media_id` counts as a link for the unlinked-media sweep.
  - Rejecting an entry or voiding a meal unlinks the copy with the raw, so both are deleted with their last link.
  - The copy is fingerprinted and served by `GET /api/media/:id` with `no-store`, like any media.
- **Evidence bound to its raw photo** (`capture/photo-reading`, `charting/photo-evidence`). The photo read result gains `image_sha256`, as tray reads already have. Photo evidence carries it, and the server checks it against the raw media's `sha256` when both are present. The stored evidence and the raw pixels are then provably the inputs of the labeled copy.
- **Raw and labeled views** (`web/ward`).
  - Every kept photo view has a `Labeled | Raw` toggle, defaulting to Labeled: the entry peek, entry details, a jug's before and after photos, and a meal's tray proof.
  - Labeled shows the stored copy. With segmentation but no copy, it draws ui-polish's live overlay with the caption `Labeled copy not kept · drawn from the read`. Without segmentation, it shows the placeholder `No labeled copy · Spark-only read, no regions`.
  - `/n/<id>/print` gains a photo section showing labeled copies.
  - ui-polish's live overlay and reveal remain on the check screen.

### Pipeline outputs

ui-polish already keeps every SAM output needed to reproduce the copy:
- the container and liquid boxes and masks;
- `fill_fraction` and `fluid_volume_ml`;
- tray regions with dish and food masks and coverage.

The labels are a fixed function of fields that are already stored: `reading.container`, the entry's drink, the fill and the volume, and for trays the meal's dishes and the read's fluids. They are not duplicated as stored text. The pixel size is the raw photo's own. The one missing link was which image the geometry belongs to, which `image_sha256` supplies. Nothing else is added. It is bounded at 64 hex characters, and it is never logged, as with all evidence.

### Renderer choice

The copy is drawn on the device with canvas. The server has no image library (its dependencies are `hono`, `@hono/node-server`, `@hono/zod-validator` and `zod`, and nothing like sharp, canvas or jimp is installed), and adding one needs the user's approval. The web already holds the photo's pixels and the masks, and draws the same overlay as SVG. Drawing on the device keeps the server dependency-free, and patient pixels are never decoded on the server.

### Upstream model requests per user action (before → after)

| Action | Model requests | Our HTTP requests |
|---|---|---|
| Photo read (`sam+spark` / `spark`) | 3 / 1 → 3 / 1 | unchanged |
| Tray read | 3 / 1 (5 with a served photo) → unchanged | unchanged |
| Saving a segmented photo entry, level or bag reading | 0 → 0 | 2 → 3 (+1 upload) |
| Saving a segmented tray meal | 0 → 0 | 2 → 3 (+1 upload) |
| Saving a Spark-only or unsegmented photo record | 0 → 0 | 2 → 2 |
| Ward round "Save all high-confidence" | 0 → 0 | +1 upload per segmented photo reading |
| Viewing Labeled or Raw | 0 → 0 | 1 `GET /api/media/<id>` per view, on first show |

### Changed shapes (`packages/shared`)

- `CaptureReadResult.image_sha256: string` (new; the web consumes it, additive).
- `PhotoEvidence.image_sha256?: string` (optional; absent on evidence stored before this change).
- `EntryInput`, `LevelInput`, `BagReadingInput` and `MealInput` each gain an optional `labeled_media_id?: number`.
- `Entry`, `Level` (and the `levels.before` and `levels.after` refs), `BagReading` and `Meal` each gain `labeled_media: MediaRef | null`.
- All of these are additive. A web build from before this change ignores the new fields, so none is BREAKING.

`labeled_media_id` is a column on `entry`, `level` and `meal`, not a field inside the evidence JSON, for three reasons:
- the unlinked sweep (`UNLINKED`), and later scale-store's `linked_at`, work on columns;
- meal evidence is immutable by trigger;
- rejecting an entry nulls its evidence, but the link must be removed explicitly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `capture/photo-reading`: ADDED "Photo read names its image".
- `charting/photo-evidence`:
  - ADDED "Photo evidence bound to its photo" and "Labeled copy linked with the photo";
  - MODIFIED "Rejected entries drop their photo" (and its labeled copy).
- `charting/meals`: ADDED "Labeled tray copy kept".
- `charting/media`: MODIFIED "Media goes with its record", "Unlinked media expires" and "Media SHA-256 fingerprint" (the labeled copy is a link, deleted with its record and fingerprinted).
- `web/capture`:
  - ADDED "Labeled copy drawn at the bed";
  - MODIFIED "Photo saved as evidence", "Jug photos record levels", "Read result kept as evidence", "Bag photos record readings", "Tray photo saved with the meal", "Reads and saves carry their read", "Collected tray compared at the bed" and "Meal saves carry their read". These are the request counts and the evidence's `image_sha256`.
- `charting/bag-periods`: MODIFIED "Bag periods on the chart read" (no rate for a period under 15 minutes; demo-visible `93168 mL/h` over 17 s).
- `web/ward-round`: MODIFIED "Save the round" and "Round reads and saves carry their read".
- `web/ward`:
  - ADDED "Raw and labeled views of a kept photo" and "Photos on the printed chart";
  - MODIFIED "Source preview" (the outline toggle becomes `Labeled | Raw`);
  - MODIFIED "Bag periods on the bed review" (`· — mL/h` when a known start has no rate); the bag reading's photo tile shows a camera icon and its viewer offers `Labeled | Raw`;
  - MODIFIED ui-polish's "Region quantities on the labeled photo", "Entry peek fetches its photo on open", "Segments revealed on first open", "Photo strip", "Tray overlay", "Read drawn on the peek photo" and "Segmentation overlay" (`Raw` hides the overlay). Their text is copied as ui-polish adds it, since ui-polish archives first.

## Order and overlap

- Apply order: drink-types → deploy-ready → s3-media → ui-polish → **labeled-photo-copy** → postgres-store → scale-store → read-queue.
- **ui-polish**: this change depends on its masks, `fluid_volume_ml` and overlay drawing. The labeled copy is its "Segmentation overlay" and "Tray overlay" drawn into pixels; this change only adds that `Raw` hides them.
- **postgres-store** (next):
  - The copy is an ordinary object in Supabase Storage at `<sha256[0:2]>/<sha256>`, needing nothing more.
  - The `labeled_media_id` columns, their indexes and the three `UNLINKED` clauses join the version-9 schema it ports to Postgres; nothing is imported.
- **scale-store** (after postgres-store, on Postgres):
  - MODIFIES "Bag photos record readings" from the current text. When it archives, it must copy this change's version, which has three requests and the copy.
  - Its `media.linked_at` must also be set by a `labeled_media_id` link.
  - Its "Media files go with their last reference" needs no edit: a labeled copy is an ordinary media row, deleted with the record that links it.
- **read-queue**: a queued photo is saved by the server, which cannot draw. Its records keep the raw photo and evidence, with `labeled_media: null`, and the Labeled view draws the live overlay. A server renderer is a follow-up that needs an image library, and so the user's approval.

## Out of scope

- A server-side renderer or any new dependency.
- Muse Image annotations (PLAN.md's optional item). The copy is drawn locally with 0 model requests.
- Changes to the read prompts, SAM request bodies or model request counts.
- Adding the copy to a meal's `proof` (the proof is server-built and immutable; the copy is reproducible from the raw photo and the evidence).
- Re-drawing a copy after a nurse corrects the drink kind. The copy is a snapshot taken at capture, and corrections are in the audit trail.
- Labeled copies for photos without a read, and for queued reads.
- The README. Its architecture and "Meta models used and how" sections must describe this, saying that SAM's regions and quantities are kept as data and as a labeled copy beside the raw photo. That is done in the later README pass.

## Impact

- `packages/shared`: the fields above.
- `apps/server`:
  - `src/ai/reading.ts` / `pipeline.ts` (`image_sha256`);
  - `src/routes/chart.ts` and `evidence.ts` (accept and check `labeled_media_id` and `image_sha256`);
  - `src/store/store.ts` (`labeled_media_id` columns, `UNLINKED`, unlinking on reject and void, refs in the selects). `STORE_SCHEMA_VERSION` 8 → 9 (fresh schema).
- `apps/web`:
  - new `src/lib/labeled-copy.ts` (canvas render), reusing the SVG overlay's `overlayView`, `liquidLabel` and `trayRegionLines` for its labels;
  - the capture, round and meal save paths;
  - the photo views (peek, details, jug photos, tray proof);
  - `routes/n/$id_.print.tsx`.
- Storage: about one more JPEG per segmented photo, at most the size of the shrunk raw.
- No new dependencies.
