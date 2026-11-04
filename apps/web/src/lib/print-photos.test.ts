import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Meal, MediaRef } from '@meniscus/shared'
import { createApi } from './api.ts'
import { entry } from './audit-fixtures.ts'
import { photoEvidence } from './copy-fixtures.ts'
import { loadPrintPhotos, photosSettled, printPhotos } from './print-photos.ts'

const ref = (id: number): MediaRef => ({
  id,
  kind: 'photo',
  mime: 'image/jpeg',
  size: 10,
  duration_ms: null,
  created_at: '',
  sha256: null,
  served_meal: null,
})
const local = (h: number, m = 0) => new Date(2026, 10, 3, h, m).toISOString()
const now = new Date(2026, 10, 3, 14, 30).getTime()
const lunch = {
  id: 5,
  meal: 'lunch',
  created_at: local(12, 40),
  voided_at: null,
  media: ref(44),
  labeled_media: ref(45),
} as unknown as Meal

function server() {
  const seen: string[] = []
  const api = createApi(
    (url, init) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      return Promise.resolve(new Response(new Blob(['jpeg']), { status: 200 }))
    },
    () => null,
    () => {},
  )
  return { api, seen }
}

describe('photos on the printed chart (lib/print-photos.ts)', () => {
  it('[web/ward] Photos on the printed chart: Two photos', async () => {
    const bag = entry({
      id: 1,
      direction: 'out',
      category: 'urine',
      volume_ml: 380,
      source: 'photo',
      has_photo: true,
      created_at: local(9, 10),
      media: ref(41),
      labeled_media: ref(42),
      evidence: photoEvidence('sam+spark'),
    })
    const photos = printPhotos([bag], [lunch], now)
    assert.deepEqual(
      photos.map((p) => [p.title, p.media_id, p.labeled]),
      [
        ['12:40 · Lunch', 45, true],
        ['09:10 · Urine 380 mL', 42, true],
      ],
    )
    const f = server()
    const settled = new Set<number>()
    assert.equal(photosSettled(photos, settled), false, 'print waits')
    await loadPrintPhotos(f.api.media, photos, (id) => settled.add(id))
    assert.deepEqual(f.seen, ['GET /api/media/45', 'GET /api/media/42'])
    assert.equal(f.seen.filter((s) => s.includes('/api/ai')).length, 0)
    assert.equal(photosSettled(photos, settled), true)
  })

  it('[web/ward] Photos on the printed chart: Spark-only photo', () => {
    const cup = entry({
      id: 2,
      direction: 'in',
      category: 'water',
      volume_ml: 150,
      source: 'photo',
      has_photo: true,
      created_at: local(10),
      media: ref(46),
      labeled_media: null,
      evidence: photoEvidence('spark', 'cup', 'water', 150),
    })
    assert.deepEqual(
      printPhotos([cup], [], now).map((p) => [p.media_id, p.labeled]),
      [[46, false]],
    )
  })

  it('[web/ward] Photos on the printed chart: No photos', async () => {
    const note = entry({ id: 3, source: 'text', created_at: local(11), media: null })
    const photos = printPhotos([note], [], now)
    assert.deepEqual(photos, [])
    const f = server()
    await loadPrintPhotos(f.api.media, photos, () => {})
    assert.deepEqual(f.seen, [])
    assert.equal(photosSettled(photos, new Set()), true)
  })

  it('keeps the 12 newest of the last 24 hours, and skips rejected entries and voided meals', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      entry({ id: 10 + i, source: 'photo', has_photo: true, created_at: local(0, i * 30 + 40), media: ref(100 + i) }),
    )
    const old = entry({ id: 99, source: 'photo', created_at: new Date(2026, 10, 2, 13).toISOString(), media: ref(9) })
    const rejected = entry({ id: 98, source: 'photo', status: 'rejected', created_at: local(13), media: ref(8) })
    const voided = { ...lunch, voided_at: local(13) } as Meal
    const photos = printPhotos([...many, old, rejected], [voided], now)
    assert.equal(photos.length, 12)
    assert.equal(photos[0]!.media_id, 113)
  })
})
