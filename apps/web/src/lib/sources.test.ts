import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LevelSnapshot, MediaRef, PhotoEvidence } from '@meniscus/shared'
import { ANITA, RAVI, entry } from './audit-fixtures.ts'
import { markAmounts } from './evidence.ts'
import { dropLine, formatClock, mealSource, outlineDefault, outlineFor, rejectSourceText, sourceOf, turnAt } from './sources.ts'
import { fingerprintLine, sourceFingerprint } from './tray.ts'

const SHA = '3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9'
/** 2 Nov 2026 at hh:mm local time, as ISO. */
const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m).toISOString()
const media = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 9,
  kind: 'photo',
  mime: 'image/png',
  size: 9000,
  duration_ms: null,
  created_at: at(8),
  sha256: null,
  served_meal: null,
  ...over,
})
const photoEvidence = (segmented = true): PhotoEvidence => ({
  kind: 'photo',
  mode: segmented ? 'sam+spark' : 'spark',
  reading: {
    container: 'urine_bag',
    fluid: 'urine',
    volume_ml: 450,
    capacity_ml: 2000,
    marks_visible: true,
    reading_basis: 'between the 400 and 500 mL marks',
    appearance: null,
    confidence: 0.9,
    issues: [],
  },
  segmentation: segmented
    ? {
        container: { left: 280, top: 140, right: 720, bottom: 1180 },
        fluid: { left: 296, top: 940, right: 704, bottom: 1168 },
        fill_fraction: 0.225,
      }
    : null,
  review_reasons: [],
  trace: [],
  colour: null,
})

describe('source preview', () => {
  it('[web/ward] Source preview: Recording with turns', () => {
    const turns = [
      { start_ms: 0, end_ms: 1800, text: 'bed 4 had a coconut water' },
      { start_ms: 1900, end_ms: 4100, text: '200 mL' },
    ]
    const e = entry({
      source: 'voice',
      media: media({ id: 21, kind: 'voice', mime: 'audio/webm', duration_ms: 4200 }),
      evidence: { kind: 'voice', transcript: 'bed 4 had a coconut water 200 mL', draft_ml: 200, trace: [], duration_ms: 4200, turns },
    })
    const src = sourceOf(e)
    assert.equal(src.kind, 'voice')
    if (src.kind !== 'voice') return
    assert.equal(src.media_id, 21)
    assert.equal(`${formatClock(0)} / ${formatClock(src.duration_ms ?? 0)}`, '0:00 / 0:04')
    assert.deepEqual(
      src.turns.map((t) => `${formatClock(t.start_ms)} ${t.text}`),
      ['0:00 bed 4 had a coconut water', '0:01 200 mL'],
    )
    assert.deepEqual(markAmounts(src.turns[1]!.text), [{ text: '200 mL', mark: true }])
    assert.equal(turnAt(src.turns, 2500), 1)
    assert.equal(turnAt(src.turns, 900), 0)
    // Tapping the second turn seeks to its start.
    assert.equal(src.turns[1]!.start_ms / 1000, 1.9)
  })

  it('[web/ward] Source preview: older voice evidence is one untimed turn', () => {
    const e = entry({
      source: 'voice',
      media: media({ id: 21, kind: 'voice', mime: 'audio/webm', duration_ms: 3000 }),
      evidence: { kind: 'voice', transcript: 'bed 4 had tea 200 mL', draft_ml: 200, trace: [] },
    })
    const src = sourceOf(e)
    assert.ok(src.kind === 'voice' && !src.timed)
    assert.deepEqual(src.turns, [{ start_ms: 0, end_ms: 3000, text: 'bed 4 had tea 200 mL' }])
    assert.equal(turnAt([], 500), null)
  })

  it('[web/ward] Source preview: By hand', () => {
    const src = sourceOf(entry({ source: 'manual', created_by: ANITA }))
    assert.deepEqual(src, { kind: 'manual', label: 'Entered by hand by Anita T.' })
    assert.deepEqual(sourceOf(entry({ source: 'manual' })), { kind: 'manual', label: 'Entered by hand' })
    // Nothing to fetch: no media id anywhere in it.
    assert.equal(JSON.stringify(src).includes('media'), false)
  })

  it('[web/ward] Source preview: typed note', () => {
    const src = sourceOf(entry({ source: 'text', evidence: { kind: 'text', transcript: 'tea 200 ml', draft_ml: 200, trace: [] } }))
    assert.deepEqual(src, { kind: 'text', transcript: 'tea 200 ml' })
  })

  it('[web/ward] Source preview: Photo outline', () => {
    const ev = photoEvidence()
    const src = sourceOf(entry({ source: 'photo', category: 'urine', direction: 'out', media: media(), has_photo: true, evidence: ev }))
    assert.deepEqual(src, { kind: 'photo', media_id: 9, evidence: ev })
    // On by default when segmented: the container and liquid outlines are drawn.
    assert.equal(outlineDefault(ev), true)
    const boxes = outlineFor(ev, outlineDefault(ev), 1000, 1280)
    assert.deepEqual(boxes?.container, { left: 28, top: 10.9, width: 44, height: 81.3 })
    assert.notEqual(boxes?.liquid, null)
    // Turned off: no outline at all.
    assert.equal(outlineFor(ev, false, 1000, 1280), null)
    // Not segmented (Spark only): off by default, nothing to draw.
    assert.equal(outlineDefault(photoEvidence(false)), false)
    assert.equal(outlineFor(photoEvidence(false), true, 1000, 1280), null)
  })

  it('[web/ward] Source preview: Tray photo', () => {
    const lunch = { source: 'photo' as const, media: media({ id: 52 }) }
    assert.deepEqual(mealSource(lunch), { media_id: 52 })
    assert.equal(mealSource({ source: 'manual', media: null }), null)
    assert.equal(mealSource({ source: 'photo', media: null }), null)
  })

  it('[web/ward] Source preview: Reject a photo entry', () => {
    const e = entry({ source: 'photo', category: 'urine', direction: 'out', volume_ml: 450, media: media(), has_photo: true })
    assert.deepEqual(rejectSourceText(e), { before: 'Its photo is deleted.', after: 'Its photo was deleted.' })
  })

  it('[web/ward] Source preview: Reject a recorded entry', () => {
    const e = entry({
      source: 'voice',
      category: 'water',
      item: 'coconut water',
      media: media({ id: 21, kind: 'voice', mime: 'audio/webm' }),
    })
    const text = 'Its recording is deleted once no other entry from it remains.'
    assert.deepEqual(rejectSourceText(e), { before: text, after: text })
  })

  it('[web/ward] Source preview: Reject a level drop', () => {
    const level = (id: number, volume_ml: number, h: number): LevelSnapshot => ({
      labeled_media: null,
      id,
      volume_ml,
      created_at: at(h),
      media: media({ id: 100 + id, created_at: at(h) }),
      evidence: null,
      event: null,
      residual_ml: null,
    })
    const e = entry({
      volume_ml: 400,
      source: 'photo',
      media: media({ id: 102 }),
      has_photo: true,
      levels: { before: level(1, 1000, 8), after: level(2, 600, 12) },
    })
    assert.equal(rejectSourceText(e), null)
  })

  it('[web/ward] Source preview: Reject a typed note', () => {
    const e = entry({ source: 'text', evidence: { kind: 'text', transcript: 'tea 200 ml', draft_ml: 200, trace: [] } })
    assert.equal(rejectSourceText(e), null)
  })

  it('[web/ward] Before and after on the entry: Jug drop', () => {
    const level = (id: number, volume_ml: number, h: number): LevelSnapshot => ({
      labeled_media: null,
      id,
      volume_ml,
      created_at: at(h),
      media: media({ id: 100 + id, created_at: at(h) }),
      evidence: photoEvidence(),
      event: null,
      residual_ml: null,
    })
    const e = entry({
      volume_ml: 400,
      source: 'photo',
      created_by: RAVI,
      media: media({ id: 102 }),
      has_photo: true,
      levels: { before: level(1, 1000, 8), after: level(2, 600, 12) },
    })
    const src = sourceOf(e)
    assert.equal(src.kind, 'levels')
    if (src.kind !== 'levels') return
    assert.deepEqual(
      src.photos.map((p) => [p.label, p.time, p.media_id]),
      [
        ['1000 mL', '08:00', 101],
        ['600 mL', '12:00', 102],
      ],
    )
    assert.equal(src.drop, '1000 mL → 600 mL · −400 mL')
    assert.equal(dropLine(1000, 600), '1000 mL → 600 mL · −400 mL')
  })
})

describe('media fingerprint', () => {
  it('[web/ward] Media fingerprint shown: Photo entry', () => {
    const e = entry({
      source: 'photo',
      category: 'urine',
      direction: 'out',
      media: media({ sha256: SHA }),
      has_photo: true,
      evidence: photoEvidence(),
    })
    assert.deepEqual(sourceFingerprint(e), { text: 'Photo fingerprint: 3f2a…c9', title: SHA })
    // Jug photos carry their own, from the level's media reference.
    const level = (id: number, sha256: string | null): LevelSnapshot => ({
      labeled_media: null,
      id,
      volume_ml: 600,
      created_at: at(12),
      media: media({ id: 100 + id, sha256 }),
      evidence: photoEvidence(),
      event: null,
      residual_ml: null,
    })
    const jug = sourceOf(entry({ volume_ml: 400, source: 'photo', levels: { before: level(1, SHA), after: level(2, null) } }))
    assert.ok(jug.kind === 'levels')
    assert.deepEqual(
      jug.photos.map((p) => fingerprintLine('photo', p.sha256).text),
      ['Photo fingerprint: 3f2a…c9', 'Fingerprint not recorded'],
    )
    assert.deepEqual(
      jug.photos.map((p) => p.media_id),
      [101, 102],
    )
    // The line needs no request of its own: the only id the view fetches is the photo's.
    const src = sourceOf(e)
    assert.ok(src.kind === 'photo')
    assert.equal(src.media_id, 9)
  })

  it('[web/ward] Media fingerprint shown: Older recording', () => {
    const e = entry({
      source: 'voice',
      media: media({ id: 21, kind: 'voice', mime: 'audio/webm', duration_ms: 3000 }),
      evidence: { kind: 'voice', transcript: 'bed 4 had tea 200 mL', draft_ml: 200, trace: [] },
    })
    assert.deepEqual(sourceFingerprint(e), { text: 'Fingerprint not recorded', title: undefined })
    assert.deepEqual(
      sourceFingerprint(entry({ media: media({ id: 21, kind: 'voice', sha256: SHA }) }))?.text,
      'Recording fingerprint: 3f2a…c9',
    )
    // Nothing kept, nothing to fingerprint.
    assert.equal(sourceFingerprint(entry({ source: 'manual', media: null })), null)
  })
})
