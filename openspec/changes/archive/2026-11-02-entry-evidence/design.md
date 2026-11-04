# Design

## Context

`/api/ai/read` already returns `CaptureReadResult`: the mode, the model reading, the segmentation boxes (in pixels of the uploaded image), review warnings and the trace. The phone keeps that image (≤ 1280 px) and attaches the same blob as the entry photo, so the boxes line up with the stored photo pixel for pixel. Notes return `NoteResult` (the transcript and the trace). All of this is discarded on save.

## Types (packages/shared)

```ts
export interface PhotoEvidence {
  kind: 'photo'
  mode: ReadMode
  reading: ContainerReading // volume_ml = the model's own value
  segmentation: Segmentation | null
  review_reasons: string[]
  trace: CallTrace[]
  /** Mean colour of the liquid area, '#rrggbb'; sampled on the phone. */
  colour: string | null
}

export interface NoteEvidence {
  kind: 'voice' | 'text'
  transcript: string
  /** The model's volume for this entry before any edit. */
  draft_ml: number | null
  trace: CallTrace[]
}

export type EntryEvidence = PhotoEvidence | NoteEvidence

// EntryInput.evidence?: EntryEvidence | null
// LevelInput.evidence?: PhotoEvidence | null
// Entry.evidence: EntryEvidence | null
// Entry.recorded_ml: number
```

## Decisions

- **The client reports the evidence.** It travels with the entry, in the same POST.
  - Alternative: the server keeps each read result under a `read_id` and attaches it itself. That way the phone couldn't alter it, but it needs a new table, purging of unsaved reads (with patient text), and changes to every capture flow.
  - With no staff login, a client that can forge evidence can already forge the entry itself, so client-reported evidence adds no new trust gap. Server-held reads are noted as roadmap.
- **Storage.**
  - `entry.evidence TEXT` holds JSON, validated on the way in and parsed on the way out. The shape is nested and read only as a whole, so it gets no columns of its own.
  - `entry.recorded_ml INTEGER` is set on insert and never updated.
  - `migrate()` adds both columns to existing files, setting `recorded_ml = volume_ml` for older rows.
  - Reject sets `evidence = NULL` in the same guarded UPDATE that clears `has_photo`.
- **Validation (routes/chart.ts).** A zod discriminated union on `kind`, matching what the server itself emits:
  - **Trace:** at most 3 items; `step` ≤ 32 characters, `model` ≤ 64; `ms` and token counts are non-negative integers.
  - **Review reasons:** at most 8, each ≤ 200 characters.
  - **Reading text:** `reading_basis` ≤ 300 characters, `appearance` ≤ 200.
  - **`issues`:** unique, from the `READING_ISSUES` enum, at most 7.
  - **Volumes:** volume and capacity are integers from 0 to 10000, or null, as in `ReadingSchema`.
  - **Boxes:** non-negative integer coordinates ≤ 20000, plus an optional `confidence` from 0 to 1.
  - **Fill:** 0..1 or null.
  - **Colour:** matches `/^#[0-9a-f]{6}$/`.
  - **Transcript:** ≤ 2000 characters.
  - **`kind` and source:** `kind` must equal the entry's `source` (`photo`/`voice`/`text`), and `manual` entries carry none. This is a refine on the body.

  Worst case is about 2.5 KB of ASCII in photo evidence and about 6 KB for a 2000-character Devanagari transcript (3 bytes per character). Both fit the existing 16 KB body limit with the entry fields. The client trims to these bounds before sending (`toEvidence`), so a long model sentence never fails a save. Wrong types or kinds still get 400.
- **Levels.** For an entry made from a jug or bottle level, `reading.volume_ml` is the level and not the drop. The entry timeline (change `entry-audit`) shows it as a level and never compares it with the recorded drop.
- **Levels.** `addLevel` passes `evidence` to the intake entry it creates. When no entry is created (first reading or refill), the evidence is dropped: there is no entry to show it on.
- **Web layer (apps/web):**
  - **`lib/evidence.ts`** is pure and DOM-free:
    - `overlayBoxes(seg, w, h)` returns percentages;
    - `agreement(reading, seg)` returns `{ sparkFill, samFill, samMl, agree }`, or null without a read volume, capacity or fill. The 0.3 tolerance moves to `packages/shared` as `READ_AGREEMENT_TOLERANCE`, used by both the server's `needsReview` and the web;
    - `markAmounts(text)` returns segments;
    - `meanColour(rgba, w, h, box)` returns a hex string;
    - `toEvidence(result, colour)` and `noteEvidence(note, draft)` build the payloads, trimming text and arrays to the server bounds;
    - `readSummary(result)` returns `"<n> model calls · <s> s"` from the trace length and `ms`. It reports the wall time, not the sum of the trace, because the two SAM calls run in parallel.
  - **`components/evidence.tsx`:**
    - `<PhotoOverlay>` is an `<img>` under an absolutely positioned `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` that draws percentage boxes. It needs no natural-size lookup once the image dimensions are known from `onLoad`.
    - `<EvidencePanel>` lays out the facts, chips, swatch and trace. The plain-language timeline is `entry-audit`.
  - **Colour sampling** happens at capture time, on the shrunk blob: `createImageBitmap` → canvas `getImageData` over the liquid box → `meanColour`. The central half is the box inset by 25% per side. No extra network. `Round` stays DOM-free: it takes an optional `sampleColour(photo, seg)` function in its options, which the route passes in. Tests omit it, so the colour is null.
  - **Save paths:** `saveEntry` and `saveLevel` take `evidence?`. The capture page and `Round.save` build it from the read result they already hold. For voice and text, each drafted entry gets the note evidence with its own `draft_ml`.
- **Model names in the trace.** `CallTrace.model` is shown as is (`sam-3.1`, `muse-spark-1.3`, `muse-voice-transcribe-1.0`) alongside friendly step labels: "SAM container", "SAM liquid", "Spark reading", "Transcription", "Spark note".

## Risks / Trade-offs

- [Evidence is client-reported] → It is stated in the README and the design. Server-held reads are on the roadmap.
- [A canvas read on a large image costs time on low-end Android] → Sample only the central half of the liquid box, at every 4th pixel.
- [Old entries have no evidence] → The view shows "No AI evidence (entered by hand or before evidence was kept)".
- [Older corrected rows migrate with `recorded_ml` = the corrected volume] → They read as approved unchanged. These are dev data only.
- [The overlay is misaligned if the stored photo differs from the read image] → Both are the same shrunk blob in every flow. The test pins percentage maths only.

## Migration Plan

`migrate()` adds `evidence` and `recorded_ml` on the next start. There is nothing else to migrate.
