# Proposal

## Why

The nurse approves AI-drafted entries, but today all they see is a number and an optional plain photo. The work the models did is thrown away once the attendant saves: SAM's container and liquid boxes, the fill check, Spark's reading notes, the transcript and the timings. The nurse can't see why a reading can be trusted. Judges can't see that SAM 3.1 is doing more than decoration. Keeping the evidence and showing it is the proof.

## What Changes

- Entries can carry **evidence**:
  - Photos: read mode, model reading, segmentation boxes and fill, review reasons, model trace, and liquid colour sampled on the phone.
  - Voice and typed notes: transcript or note text, and trace.
  - `POST /entries` and `POST /levels` accept it. Entry responses return it.
- Entries carry **`recorded_ml`**, the volume as saved. A nurse correction no longer erases what was recorded, so the chart keeps AI value → recorded value → approved or corrected value (shown as a timeline by change `entry-audit`).
- **Rejecting an entry deletes its evidence**, as it already deletes the photo.
- **Web capture:**
  - Saving sends the read result as evidence and keeps the model's own volume even when the attendant adjusts it.
  - The check screen shows the segmentation overlay on the photo and a "3 model calls · 6.8 s" trace line.
- **Web bed review:** every entry, pending or reviewed, gets an **Evidence** view with:
  - The photo with the SAM overlay (container outline, liquid area, surface line).
  - "AI read 450 mL of 2000 mL · SAM fill 25% ≈ 500 mL · agree / check photo".
  - Issues, review reasons, Spark's reading notes, and a colour swatch with Spark's description.
  - Model calls with timings.
  - For notes, the transcript with amounts highlighted.
- **Ward round:** saved readings carry their evidence too.

Upstream model requests per user action: **none change** (evidence comes from reads that already happen; no new calls).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `charting/photo-evidence`: adds "Read evidence stored with the entry". "Rejected entries drop their photo" now also drops the evidence.
- `charting/entries`: adds "Recorded volume kept".
- `web/capture`: adds "Read result kept as evidence" and "Liquid colour sampled from the photo".
- `web/ward`: adds "Segmentation overlay", "Reading versus segmentation" and "Transcript amounts highlighted".

## Impact

- **`packages/shared`:** new `EntryEvidence` (`PhotoEvidence | NoteEvidence`).
  - `EntryInput.evidence?` and `LevelInput.evidence?`.
  - `Entry.evidence` and `Entry.recorded_ml`. **BREAKING** per the shared-shape rule (web-consumed `Entry`), though additive: existing clients ignore the new fields.
- **`apps/server`:**
  - `store.ts`: `entry.evidence TEXT` (JSON) and `entry.recorded_ml`, with a migration for existing files. Reject clears evidence.
  - `routes/evidence.ts`: a zod `Evidence` schema with size bounds, used by `routes/chart.ts`.
  - Tests.
- **`apps/web`:**
  - `lib/capture.ts` and `lib/round.ts` (evidence on save).
  - New `lib/evidence.ts`: overlay geometry, agreement, transcript marks, colour. It is pure and tested.
  - New `components/evidence.tsx`.
  - `routes/n/$id.tsx`, `routes/a/bed.$token.tsx` and `routes/a/round.tsx`.
- **Privacy:** the evidence holds no image. Transcripts stay in our own store like other chart text, are never logged, and are deleted on reject.
- **No new dependencies.** The overlay is SVG and the colour comes from a canvas.

## Out of scope

- Server-held read results, i.e. evidence the phone can't alter. The evidence is client-reported, like the entry itself; this is noted in the design.
- Storing audio, or keeping SAM masks beyond their boxes.
- Charts and the ward-level visualisations (a separate change).
