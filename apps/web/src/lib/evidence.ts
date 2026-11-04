/** Read evidence: build it at capture, and lay it out for review. Pure and DOM-free. */
import {
  READ_AGREEMENT_TOLERANCE,
  type CaptureReadResult,
  type ContainerReading,
  type NoteEvidence,
  type NoteResult,
  type PhotoEvidence,
  type SegmentBox,
  type Segmentation,
} from '@meniscus/shared'

// Server bounds (apps/server/src/routes/evidence.ts); trimming here means a long model sentence never loses the entry.
const MAX_BASIS = 300
const MAX_APPEARANCE = 200
const MAX_REASON = 200
const MAX_REASONS = 8
const MAX_TRACE = 3
const MAX_TRANSCRIPT = 2000
const MAX_TURNS = 200
const MAX_TURN_TEXT = 500
const MAX_AUDIO_MS = 3_600_000

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
const hex = (n: number) => (256 + Math.round(n)).toString(16).slice(1)

/** Mean colour of the box's central half (inset 25% per side), sampling every `step`-th pixel. */
export function meanColour(rgba: Uint8ClampedArray, width: number, height: number, box: SegmentBox | null, step = 4): string | null {
  if (!box) return null
  const insetX = (box.right - box.left) / 4
  const insetY = (box.bottom - box.top) / 4
  const x0 = Math.max(0, Math.ceil(box.left + insetX))
  const x1 = Math.min(width, Math.floor(box.right - insetX))
  const y0 = Math.max(0, Math.ceil(box.top + insetY))
  const y1 = Math.min(height, Math.floor(box.bottom - insetY))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4
      r += rgba[i]!
      g += rgba[i + 1]!
      b += rgba[i + 2]!
      n++
    }
  return n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}` : null
}

/** Photo read → evidence for the entry it becomes. Keeps the model's own volume. */
export function toEvidence(r: CaptureReadResult, colour: string | null): PhotoEvidence {
  return {
    kind: 'photo',
    mode: r.mode,
    // Binds the evidence to the photo it was read from (charting/photo-evidence "Photo evidence bound to its photo").
    ...(r.image_sha256 && { image_sha256: r.image_sha256 }),
    reading: {
      ...r.reading,
      reading_basis: cut(r.reading.reading_basis, MAX_BASIS),
      appearance: r.reading.appearance === null ? null : cut(r.reading.appearance, MAX_APPEARANCE),
      issues: [...new Set(r.reading.issues)],
    },
    segmentation: r.segmentation,
    review_reasons: r.warnings.slice(0, MAX_REASONS).map((w) => cut(w, MAX_REASON)),
    trace: r.trace.slice(0, MAX_TRACE),
    colour: r.segmentation?.fluid ? colour : null,
  }
}

/** Voice or typed note → evidence for one drafted entry, with that draft's own volume, and a voice note's timing. */
export function noteEvidence(note: NoteResult, kind: 'voice' | 'text', text: string, draftMl: number | null): NoteEvidence {
  const ev: NoteEvidence = { kind, transcript: cut(text, MAX_TRANSCRIPT), draft_ml: draftMl, trace: note.trace.slice(0, MAX_TRACE) }
  if (kind !== 'voice') return ev
  if (note.duration_ms != null) ev.duration_ms = Math.min(MAX_AUDIO_MS, note.duration_ms)
  if (note.turns?.length) ev.turns = note.turns.slice(0, MAX_TURNS).map((t) => ({ ...t, text: cut(t.text, MAX_TURN_TEXT) }))
  return ev
}

/** "3 model calls · 6.8 s": wall time, not the trace sum (the SAM calls run in parallel). */
export function readSummary(r: Pick<CaptureReadResult, 'trace' | 'ms'>): string {
  const n = r.trace.length
  return `${n} model call${n === 1 ? '' : 's'} · ${(r.ms / 1000).toFixed(1)} s`
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const pct = (v: number, of: number) => Math.round((1000 * v) / of) / 10
const rect = (b: SegmentBox, w: number, h: number): Rect => ({
  left: pct(b.left, w),
  top: pct(b.top, h),
  width: pct(b.right - b.left, w),
  height: pct(b.bottom - b.top, h),
})

/** Segmentation boxes as percentages of the photo, plus the liquid surface line. */
export function overlayBoxes(seg: Segmentation, width: number, height: number) {
  return {
    container: seg.container ? rect(seg.container, width, height) : null,
    liquid: seg.fluid ? rect(seg.fluid, width, height) : null,
    surface: seg.fluid ? pct(seg.fluid.top, height) : null,
  }
}

/** The AI reading against SAM's fill; null without a read volume, a capacity or a fill. */
export function agreement(r: ContainerReading, seg: Segmentation | null) {
  const fill = seg?.fill_fraction ?? null
  if (r.volume_ml === null || !r.capacity_ml || fill === null) return null
  return {
    read: `AI read ${r.volume_ml} mL of ${r.capacity_ml} mL`,
    sam: `SAM fill ${Math.round(fill * 100)}% ≈ ${Math.round(fill * r.capacity_ml)} mL`,
    agree: Math.abs(r.volume_ml / r.capacity_ml - fill) <= READ_AGREEMENT_TOLERANCE,
  }
}

const AMOUNT = /\b\d+(?:[.,]\d+)?\s?(?:ml|mL|ML|l|L|cups?|glass(?:es)?)\b/g

/** Splits text so every amount with a unit is its own marked segment. */
export function markAmounts(text: string): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = []
  let at = 0
  for (const m of text.matchAll(AMOUNT)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), mark: false })
    out.push({ text: m[0], mark: true })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false })
  return out
}
