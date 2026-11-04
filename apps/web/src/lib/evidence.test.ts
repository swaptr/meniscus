import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CaptureReadResult, ContainerReading, NoteResult, Segmentation } from '@meniscus/shared'
import { type Pending, toEntryInput } from './capture.ts'
import { agreement, markAmounts, meanColour, noteEvidence, overlayBoxes, readSummary, toEvidence } from './evidence.ts'

const reading = (over: Partial<ContainerReading> = {}): ContainerReading => ({
  container: 'urine_bag',
  fluid: 'urine',
  volume_ml: 450,
  capacity_ml: 2000,
  marks_visible: true,
  reading_basis: 'between 400 and 500',
  appearance: 'pale yellow, clear',
  confidence: 0.9,
  issues: [],
  ...over,
})
const seg: Segmentation = {
  container: { left: 100, top: 80, right: 400, bottom: 900 },
  fluid: { left: 110, top: 520, right: 390, bottom: 890 },
  fill_fraction: 0.463,
}
const read = (over: Partial<CaptureReadResult> = {}): CaptureReadResult => ({
  image_sha256: 'c0ffee'.padEnd(64, '0'),
  mode: 'sam+spark',
  reading: reading(),
  segmentation: seg,
  draft: { direction: 'out', category: 'urine', volume_ml: 450, item: null, notes: null },
  needs_review: false,
  warnings: [],
  trace: [
    { step: 'sam:container', model: 'sam-3.1', ms: 2100 },
    { step: 'sam:liquid', model: 'sam-3.1', ms: 2200 },
    { step: 'spark:read', model: 'muse-spark-1.3', ms: 4500 },
  ],
  ms: 6800,
  ...over,
})

describe('evidence', () => {
  it('[web/capture] Liquid colour sampled from the photo: Uniform liquid', () => {
    const w = 40
    const h = 40
    const rgba = new Uint8ClampedArray(w * h * 4)
    const box = { left: 0, top: 0, right: 40, bottom: 40 }
    // Central half of the box: 10..30 on both axes; everything else stays black.
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) rgba.set([217, 180, 74, 255], (y * w + x) * 4)
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
    assert.equal(meanColour(rgba, w, h, box), '#d9b44a')
  })

  it('[web/capture] Liquid colour sampled from the photo: No liquid found', () => {
    assert.equal(meanColour(new Uint8ClampedArray(16), 2, 2, null), null)
    assert.equal(toEvidence(read({ segmentation: { ...seg, fluid: null } }), null).colour, null)
  })

  it('[web/capture] Read summary on the check screen: Three calls', () => {
    assert.equal(readSummary(read()), '3 model calls · 6.8 s')
    assert.equal(readSummary(read({ trace: [read().trace[2]!], ms: 4500 })), '1 model call · 4.5 s')
  })

  it('[web/capture] Read result kept as evidence: Long model text', () => {
    const ev = toEvidence(read({ reading: reading({ reading_basis: 'x'.repeat(900) }), warnings: ['y'.repeat(400)] }), '#d9b44a')
    assert.ok(ev.reading.reading_basis.length <= 300)
    assert.ok(ev.review_reasons.every((r) => r.length <= 200))
    assert.equal(ev.colour, '#d9b44a')
  })

  it('[web/capture] Read result kept as evidence: Adjusted photo draft', () => {
    // A urinal: a bag read is saved as a bag reading (bags.test.ts, Adjusted bag reading).
    const r = read({ reading: reading({ container: 'urinal', capacity_ml: 1000 }) })
    const pending: Pending = {
      draft: { ...r.draft!, volume_ml: 430 },
      source: 'photo',
      confidence: 0.9,
      evidence: toEvidence(r, '#d9b44a'),
    }
    const body = toEntryInput(pending)
    assert.equal(body.volume_ml, 430)
    const ev = body.evidence
    assert.equal(ev?.kind, 'photo')
    if (ev?.kind !== 'photo') return
    assert.equal(ev.reading.volume_ml, 450)
    assert.equal(ev.image_sha256, r.image_sha256)
    assert.deepEqual(ev.segmentation, seg)
    assert.deepEqual(
      ev.trace.map((t) => t.step),
      ['sam:container', 'sam:liquid', 'spark:read'],
    )
  })

  it('[web/capture] Read result kept as evidence: Voice draft', () => {
    const note: NoteResult = {
      transcript: 'bed 4 had coconut water 200 mL',
      entries: [{ direction: 'in', category: 'water', volume_ml: 200, item: 'coconut water', notes: null }],
      reply: null,
      trace: [
        { step: 'asr', model: 'muse-voice-transcribe-1.0', ms: 900 },
        { step: 'spark:note', model: 'muse-spark-1.3', ms: 2100 },
      ],
    }
    const drafted = note.entries[0]!
    const body = toEntryInput({
      draft: drafted,
      source: 'voice',
      confidence: null,
      evidence: noteEvidence(note, 'voice', note.transcript!, drafted.volume_ml),
    })
    assert.deepEqual(body.evidence, { kind: 'voice', transcript: 'bed 4 had coconut water 200 mL', draft_ml: 200, trace: note.trace })
    assert.deepEqual(
      body.evidence?.trace.map((t) => t.step),
      ['asr', 'spark:note'],
    )
    assert.equal(noteEvidence(note, 'text', 'z'.repeat(3000), null).transcript.length, 2000)
  })

  it('[web/ward] Segmentation overlay: Boxes on a 1000 × 1000 photo', () => {
    assert.deepEqual(overlayBoxes(seg, 1000, 1000), {
      container: { left: 10, top: 8, width: 30, height: 82 },
      liquid: { left: 11, top: 52, width: 28, height: 37 },
      surface: 52,
    })
  })

  it('[web/ward] Reading versus segmentation: Agree', () => {
    assert.deepEqual(agreement(reading(), { ...seg, fill_fraction: 0.25 }), {
      read: 'AI read 450 mL of 2000 mL',
      sam: 'SAM fill 25% ≈ 500 mL',
      agree: true,
    })
  })

  it('[web/ward] Reading versus segmentation: Disagree', () => {
    const a = agreement(reading(), { ...seg, fill_fraction: 0.7 })
    assert.equal(a?.sam, 'SAM fill 70% ≈ 1400 mL')
    assert.equal(a?.agree, false)
    assert.equal(agreement(reading({ capacity_ml: null }), seg), null)
    assert.equal(agreement(reading(), { ...seg, fill_fraction: null }), null)
  })

  it('[web/ward] Transcript amounts highlighted: Coconut water', () => {
    const marked = markAmounts('bed 4 had coconut water, 200 mL and 2 cups of tea')
      .filter((p) => p.mark)
      .map((p) => p.text)
    assert.deepEqual(marked, ['200 mL', '2 cups'])
    assert.deepEqual(
      markAmounts('1.5 L water, a glass, 3 glasses')
        .filter((p) => p.mark)
        .map((p) => p.text),
      ['1.5 L', '3 glasses'],
    )
  })
})
