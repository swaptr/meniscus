import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ContainerReading, Entry, MediaRef, PhotoEvidence } from '@meniscus/shared'
import { ANITA, RAVI, entry } from './audit-fixtures.ts'
import { bedInPeek, entryPeek, peekPhotoBox, readScale, stripThumbs } from './entry-peek.ts'

const media = (id: number, kind: MediaRef['kind']): MediaRef => ({
  id,
  kind,
  mime: kind === 'photo' ? 'image/jpeg' : 'audio/webm',
  size: 1000,
  duration_ms: null,
  created_at: '2026-11-04T10:00:00.000Z',
  sha256: null,
  served_meal: null,
})
const local = (h: number, m: number) => new Date(2026, 10, 4, h, m).toISOString()

const reading = (over: Partial<ContainerReading> = {}): ContainerReading => ({
  container: 'urine_bag',
  fluid: 'urine',
  volume_ml: 450,
  capacity_ml: 2000,
  marks_visible: true,
  reading_basis: 'liquid surface level with the 450 mL mark',
  appearance: null,
  confidence: 0.88,
  issues: [],
  ...over,
})

const photo = (mode: PhotoEvidence['mode'], r: Partial<ContainerReading> = {}): PhotoEvidence => ({
  kind: 'photo',
  mode,
  reading: reading(r),
  segmentation:
    mode === 'spark'
      ? null
      : {
          container: { left: 280, top: 140, right: 720, bottom: 1180 },
          fluid: { left: 296, top: 700, right: 704, bottom: 1168 },
          fill_fraction: 0.46,
          fluid_volume_ml: 930,
        },
  review_reasons: [],
  trace: [],
  colour: null,
})

/** The spec's corrected urine bag: read 450 at 0.88, saved 430 by Ravi at 10:42, approved 375 by Anita at 11:05. */
const corrected: Entry = entry({
  id: 7,
  direction: 'out',
  category: 'urine',
  source: 'photo',
  confidence: 0.88,
  status: 'approved',
  volume_ml: 375,
  recorded_ml: 430,
  approved_ml: 375,
  created_at: local(10, 42),
  recorded_at: local(10, 42),
  reviewed_at: local(11, 5),
  created_by: RAVI,
  reviewed_by: ANITA,
  has_photo: true,
  media: media(41, 'photo'),
  evidence: photo('sam+spark'),
})

describe('entry peek', () => {
  it('[web/ward] Entry peek: Corrected photo entry', () => {
    const p = entryPeek(corrected)
    assert.equal(p.head, '10:42 · Urine 375 mL')
    assert.equal(p.source.text, 'Photo · 88%')
    assert.equal(p.mode, 'SAM + Spark')
    assert.equal(p.volumes, 'AI read 450 mL · Saved 430 mL · Approved 375 mL')
    assert.deepEqual(p.trail, ['Recorded 10:42 by Ravi K.', 'Approved 11:05 by Anita T.'])
    assert.equal(p.status.text, 'Approved')
    assert.equal(p.mediaId, 41)
    assert.deepEqual(p.actions, [])
  })

  it('[web/ward] Entry peek: Voice entry', () => {
    const p = entryPeek(
      entry({
        source: 'voice',
        confidence: 0.9,
        drink: 'tea',
        item: 'Tea',
        media: media(52, 'voice'),
        evidence: { kind: 'voice', transcript: 'Drank 200 mL of tea', draft_ml: 200, trace: [] },
      }),
    )
    // The transcript is quoted from the loaded entry; no audio is fetched for the peek (Details plays it).
    assert.equal(p.quote, '“Drank 200 mL of tea”')
    assert.equal(p.mediaId, null)
    assert.ok(p.details)
    // A pending entry's peek also carries the row's actions.
    assert.deepEqual(p.actions, ['Reject…', 'Approve'])
  })

  it('[web/ward] Entry peek: Drink kind in the head', () => {
    const chai = entryPeek(entry({ volume_ml: 150, created_at: local(10, 42), drink: 'tea', item: 'masala chai', source: 'photo' }))
    assert.equal(chai.head, '10:42 · Tea 150 mL')
    assert.equal(chai.drink, 'tea')
    assert.equal(chai.name, 'masala chai')
    const ors = entryPeek(entry({ volume_ml: 200, created_at: local(9, 0), drink: 'ors', item: 'ORS' }))
    assert.equal(ors.head, '09:00 · ORS 200 mL')
    assert.equal(ors.name, null)
  })
})

describe('read scale on the peek photo', () => {
  it('[web/ward] Read drawn on the peek photo: Corrected bag', () => {
    const sc = readScale(corrected)!
    assert.equal(sc.capacity, 2000)
    assert.deepEqual(sc.ticks, [0, 500, 1000, 1500, 2000])
    assert.deepEqual(
      sc.marks.map((m) => [m.label, m.at]),
      [
        ['AI read 450', 450 / 2000],
        ['Saved 430', 430 / 2000],
        ['Approved 375', 375 / 2000],
      ],
    )
  })

  it('[web/ward] Read drawn on the peek photo: Spark only', () => {
    const spark = { ...corrected, status: 'pending' as const, approved_ml: null, evidence: photo('spark') }
    assert.equal(spark.evidence.segmentation, null)
    const sc = readScale(spark)!
    // No overlay to draw (no segmentation), but the scale still marks the AI's volume.
    assert.deepEqual(
      sc.marks.map((m) => m.label),
      ['AI read 450', 'Saved 430'],
    )
    assert.equal(readScale({ ...corrected, evidence: photo('spark', { capacity_ml: null }) }), null)
    assert.equal(readScale(entry()), null)
  })
})

describe('metric peeks', () => {
  it('[web/ward] Metric peeks on stats: Bed intake', () => {
    const ok = { status: 'approved' as const }
    const list = [
      entry({ ...ok, id: 1, category: 'water', drink: 'tea', volume_ml: 200 }),
      entry({ ...ok, id: 2, category: 'water', drink: 'tea', volume_ml: 150 }),
      entry({ ...ok, id: 3, category: 'water', drink: 'water', volume_ml: 400 }),
      entry({ ...ok, id: 4, category: 'water', drink: null, volume_ml: 100 }),
      entry({ ...ok, id: 5, category: 'iv', volume_ml: 400 }),
      entry({ id: 6, category: 'water', drink: 'tea', volume_ml: 999, status: 'pending' }),
    ]
    const p = bedInPeek(list)
    assert.equal(p.total, 1250)
    assert.deepEqual(
      p.rows.map((r) => `${r.label} ${r.ml} mL`),
      ['Water 400 mL', 'Tea 350 mL', 'Drink 100 mL', 'IV 400 mL'],
    )
    assert.deepEqual(
      p.rows.map((r) => r.drink),
      ['water', 'tea', 'other', null],
    )
    assert.equal(p.rows[0]!.share, 400 / 1250)
  })
})

describe('photo boxes and the strip', () => {
  it('[web/ward] Photo strip: Closed sends nothing', () => {
    const now = Date.parse(local(12, 0))
    const photos = [1, 2, 3].map((id) => entry({ id, has_photo: true, media: media(40 + id, 'photo'), created_at: local(9 + id, 0) }))
    // Admission 10's bed review with 3 photo entries: closed, the strip asks for no media at all.
    // The strip renders these thumbnails (components/bed-charts.tsx), each fetching its media id once opened.
    assert.deepEqual(stripThumbs(photos, now, false), [])
    assert.deepEqual(
      stripThumbs(photos, now, true).map((t) => [t.entry.id, t.mediaId]),
      [
        [3, 43],
        [2, 42],
        [1, 41],
      ],
    )
  })

  it('[web/interface] No blank media boxes: Peek photo loading', () => {
    assert.deepEqual(peekPhotoBox({ status: 'loading' }), { show: 'no-photo', label: 'Loading photo' })
    assert.deepEqual(peekPhotoBox({ status: 'failed' }), { show: 'no-photo', label: 'Photo not available' })
    assert.deepEqual(peekPhotoBox({ status: 'ready', url: 'blob:x' }), { show: 'photo', url: 'blob:x' })
  })

  it('[web/interface] No blank media boxes: Photo strip loading', () => {
    // The strip's thumbnails use the same box: the no-photo icon until the photo paints.
    assert.equal(peekPhotoBox({ status: 'loading' }).show, 'no-photo')
    assert.equal(peekPhotoBox({ status: 'none' }).show, 'no-photo')
  })
})
