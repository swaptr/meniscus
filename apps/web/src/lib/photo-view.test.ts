import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MediaRef } from '@meniscus/shared'
import { createApi } from './api.ts'
import { entry } from './audit-fixtures.ts'
import { photoEvidence } from './copy-fixtures.ts'
import { stripThumbs } from './entry-peek.ts'
import { createMediaCache, photoLabeled, photoMediaId } from './media-cache.ts'
import { overlayView } from './overlay.ts'
import { COPY_DRAWN_LINE, NO_COPY_LINE, photoShown, revealKey, type PhotoMode } from './photo-view.ts'
import { outlineDefault } from './sources.ts'

const ref = (id: number, sha256: string | null = null): MediaRef => ({
  id,
  kind: 'photo',
  mime: 'image/jpeg',
  size: 10,
  duration_ms: null,
  created_at: '2026-11-03T09:10:00.000Z',
  sha256,
  served_meal: null,
})
const COPY_SHA = '7c1e'.padEnd(62, '0') + 'd4'

/** A media cache over a fake server that records every request and answers at once. */
function viewer() {
  const seen: string[] = []
  const api = createApi(
    (url, init) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      return Promise.resolve(new Response(new Blob(['jpeg']), { status: 200 }))
    },
    () => null,
    () => {},
  )
  let n = 0
  const cache = createMediaCache({ fetchMedia: api.media, toUrl: () => Promise.resolve(`blob:${++n}`), revoke: () => {} })
  /** Shows a photo in `mode` as PhotoView does: one acquire of the shown media id. */
  const show = async (o: Parameters<typeof photoShown>[0]) => {
    const shown = photoShown(o)
    const h = cache.acquire(shown.media_id)
    await h.url
    h.release()
    return shown
  }
  return { seen, show }
}

const copyEntry = () =>
  entry({
    source: 'photo',
    has_photo: true,
    media: ref(41),
    labeled_media: ref(42, COPY_SHA),
    evidence: photoEvidence('sam+spark'),
  })

describe('raw and labeled views (lib/photo-view.ts)', () => {
  it('[web/ward] Raw and labeled views of a kept photo: Copy shown first', async () => {
    const v = viewer()
    const e = copyEntry()
    const shown = await v.show({ media_id: photoMediaId(e)!, labeled: photoLabeled(e), segmented: true, mode: 'labeled' })
    assert.equal(shown.copy, true)
    assert.equal(shown.overlay, false, 'no live overlay over the copy')
    assert.equal(shown.line?.text, 'Labeled copy fingerprint: 7c1e…d4')
    assert.equal(shown.line?.title, COPY_SHA)
    assert.deepEqual(v.seen, ['GET /api/media/42'])
  })

  it('[web/ward] Raw and labeled views of a kept photo: Raw picked', async () => {
    const v = viewer()
    const e = copyEntry()
    const at = (mode: PhotoMode) => v.show({ media_id: 41, labeled: photoLabeled(e), segmented: true, mode })
    await at('labeled')
    const raw = await at('raw')
    await at('labeled')
    assert.deepEqual([raw.media_id, raw.overlay, raw.line], [41, false, null])
    assert.deepEqual(v.seen, ['GET /api/media/42', 'GET /api/media/41'])
  })

  it('[web/ward] Raw and labeled views of a kept photo: Copy not kept', async () => {
    const v = viewer()
    const e = entry({ source: 'photo', media: ref(41), labeled_media: null, evidence: photoEvidence('sam+spark') })
    const shown = await v.show({
      media_id: 41,
      labeled: photoLabeled(e),
      segmented: outlineDefault(photoEvidence('sam+spark')),
      mode: 'labeled',
    })
    assert.deepEqual([shown.media_id, shown.overlay, shown.line?.text], [41, true, COPY_DRAWN_LINE])
    assert.equal(COPY_DRAWN_LINE, 'Labeled copy not kept · drawn from the read')
    assert.deepEqual(v.seen, ['GET /api/media/41'])
  })

  it('[web/ward] Raw and labeled views of a kept photo: Spark-only read', async () => {
    const v = viewer()
    const ev = photoEvidence('spark')
    const shown = await v.show({ media_id: 41, labeled: null, segmented: outlineDefault(ev), mode: 'labeled' })
    assert.deepEqual([shown.media_id, shown.overlay, shown.line?.text], [41, false, NO_COPY_LINE])
    assert.equal(NO_COPY_LINE, 'No labeled copy · Spark-only read, no regions')
    assert.deepEqual(v.seen, ['GET /api/media/41'])
  })

  it('[web/ward] Region quantities on the labeled photo: Spark-only read', async () => {
    // The peek: the raw photo, no region labels, the placeholder line, and only its own media request.
    const v = viewer()
    const ev = photoEvidence('spark')
    const shown = await v.show({ media_id: 41, labeled: null, segmented: outlineDefault(ev), mode: 'labeled' })
    assert.equal(shown.line?.text, NO_COPY_LINE)
    assert.equal(
      overlayView({ seg: ev.segmentation, image: { width: 1000, height: 1000 }, container: 'urine_bag', on: shown.overlay }).labels.length,
      0,
    )
    assert.deepEqual(v.seen, ['GET /api/media/41'])
  })

  it('[web/ward] Source preview: Photo outline', () => {
    // A segmented photo entry: `Raw` shows the photo with no overlay; `Labeled` the copy or the live overlay.
    const raw = photoShown({ media_id: 41, labeled: null, segmented: true, mode: 'raw' })
    assert.equal(raw.overlay, false)
    assert.equal(
      overlayView({ seg: photoEvidence('sam+spark').segmentation, image: { width: 1000, height: 1000 }, on: raw.overlay }).mode,
      'none',
    )
    assert.equal(photoShown({ media_id: 41, labeled: null, segmented: true, mode: 'labeled' }).overlay, true)
  })

  it('[web/ward] Entry peek fetches its photo on open: Labeled copy first', async () => {
    const v = viewer()
    const e = copyEntry()
    await v.show({ media_id: photoMediaId(e)!, labeled: photoLabeled(e), segmented: true, mode: 'labeled' })
    assert.deepEqual(v.seen, ['GET /api/media/42'])
    await v.show({ media_id: photoMediaId(e)!, labeled: photoLabeled(e), segmented: true, mode: 'raw' })
    assert.deepEqual(v.seen, ['GET /api/media/42', 'GET /api/media/41'])
  })

  it('[web/ward] Segments revealed on first open: Peek with a labeled copy', () => {
    const copy = photoShown({ media_id: 41, labeled: ref(42), segmented: true, mode: 'labeled' })
    assert.equal(revealKey(copy), null, 'the copy is shown at once, with no trace')
    assert.equal(revealKey(photoShown({ media_id: 41, labeled: null, segmented: true, mode: 'labeled' })), 'media:41')
    assert.equal(revealKey(photoShown({ media_id: 41, labeled: null, segmented: true, mode: 'raw' })), null)
  })

  it('[web/ward] Photo strip: Thumbnail of a labeled copy', () => {
    const now = Date.parse('2026-11-03T12:00:00.000Z')
    const e = { ...copyEntry(), created_at: '2026-11-03T09:10:00.000Z' }
    assert.deepEqual(
      stripThumbs([e], now, true).map((t) => t.mediaId),
      [42],
    )
  })

  it('[web/ward] Segmentation overlay: Raw hides the overlay', () => {
    const cup = photoEvidence('sam+spark', 'cup', 'water', 120)
    const raw = photoShown({ media_id: 41, labeled: null, segmented: true, mode: 'raw' })
    const v = overlayView({ seg: cup.segmentation, image: { width: 1000, height: 1000 }, container: 'cup', on: raw.overlay })
    assert.deepEqual([v.layers.length, v.surface, v.labels.length], [0, null, 0])
  })

  it('[web/ward] Tray overlay: Kept tray copy', () => {
    const labeled = photoShown({ media_id: 42, labeled: ref(43), segmented: true, mode: 'labeled' })
    assert.deepEqual([labeled.media_id, labeled.overlay], [43, false])
    const raw = photoShown({ media_id: 42, labeled: ref(43), segmented: true, mode: 'raw' })
    assert.deepEqual([raw.media_id, raw.overlay], [42, false])
  })

  it('[web/ward] Read drawn on the peek photo: Corrected bag with its copy', () => {
    // The scale comes from the entry, not the photo: Labeled and Raw show the same marks beside a different image.
    const e = copyEntry()
    const labeled = photoShown({ media_id: 41, labeled: photoLabeled(e), segmented: true, mode: 'labeled' })
    const raw = photoShown({ media_id: 41, labeled: photoLabeled(e), segmented: true, mode: 'raw' })
    assert.deepEqual([labeled.copy, raw.copy, raw.overlay], [true, false, false])
  })

  it('a level drop peeks its later reading’s copy', () => {
    const after = {
      id: 9,
      volume_ml: 300,
      created_at: '',
      media: ref(77),
      labeled_media: ref(78),
      evidence: null,
      event: null,
      residual_ml: null,
    }
    const e = entry({ media: null, levels: { before: null, after } })
    assert.equal(photoMediaId(e), 77)
    assert.equal(photoLabeled(e)?.id, 78)
  })
})
