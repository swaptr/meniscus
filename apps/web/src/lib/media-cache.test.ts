import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApi } from './api.ts'
import { entry } from './audit-fixtures.ts'
import { createMediaCache, photoMediaId } from './media-cache.ts'

const photo = (id: number) => ({
  id,
  kind: 'photo' as const,
  mime: 'image/jpeg',
  size: 10,
  duration_ms: null,
  created_at: '',
  sha256: null,
  served_meal: null,
})

/** A fake server whose media answers wait until `release()`, and that honours aborts. */
function server(status = 200) {
  const seen: string[] = []
  const aborted: string[] = []
  const waiting: (() => void)[] = []
  const api = createApi(
    (url, init) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted.push(url)
          reject(new DOMException('aborted', 'AbortError'))
        })
        waiting.push(() =>
          resolve(status === 200 ? new Response(new Blob(['jpeg']), { status }) : Response.json({ error: 'sign_in_required' }, { status })),
        )
      })
    },
    () => null,
    () => {},
  )
  const release = async () => {
    while (waiting.length) waiting.shift()!()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { api, seen, aborted, release }
}

const urls = () => {
  let n = 0
  const revoked: string[] = []
  return { toUrl: () => Promise.resolve(`blob:${++n}`), revoke: (u: string) => void revoked.push(u), revoked }
}

describe('entry peek media', () => {
  it('[web/ward] Entry peek fetches its photo on open: First and second open', async () => {
    const f = server()
    const u = urls()
    const cache = createMediaCache({ fetchMedia: f.api.media, ...u })
    const first = cache.acquire(41)
    await f.release()
    assert.equal(await first.url, 'blob:1')
    first.release()
    // A second open and the entry details reuse it.
    const again = cache.acquire(41)
    const details = cache.acquire(41)
    assert.equal(await again.url, 'blob:1')
    assert.equal(await details.url, 'blob:1')
    assert.deepEqual(f.seen, ['GET /api/media/41'])
    assert.ok(!f.seen.some((r) => r.includes('/api/ai')))
  })

  it('[web/ward] Entry peek fetches its photo on open: Closed early', async () => {
    const f = server()
    const u = urls()
    const cache = createMediaCache({ fetchMedia: f.api.media, ...u })
    const first = cache.acquire(41)
    first.release() // the peek closed before media 41 arrived
    await assert.rejects(first.url, { name: 'AbortError' })
    assert.deepEqual(f.aborted, ['/api/media/41'])
    const later = cache.acquire(41)
    await f.release()
    assert.equal(await later.url, 'blob:1')
    assert.deepEqual(f.seen, ['GET /api/media/41', 'GET /api/media/41'])
  })

  it('closing and reopening at once keeps the reopened request in flight', async () => {
    const f = server()
    const u = urls()
    const cache = createMediaCache({ fetchMedia: f.api.media, ...u })
    const first = cache.acquire(41)
    first.release() // closed before media 41 arrived
    const reopened = cache.acquire(41) // and opened again at once, before the abort settles
    await assert.rejects(first.url, { name: 'AbortError' })
    // The aborted request settling must not drop the reopened one: the entry details share it.
    const details = cache.acquire(41)
    await f.release()
    assert.equal(await reopened.url, 'blob:1')
    assert.equal(await details.url, 'blob:1')
    assert.deepEqual(f.seen, ['GET /api/media/41', 'GET /api/media/41'])
    assert.equal(cache.get(41), 'blob:1')
  })

  it('[web/ward] Entry peek fetches its photo on open: No photo', () => {
    assert.equal(photoMediaId(entry({ source: 'text', media: null, has_photo: false })), null)
    assert.equal(photoMediaId(entry({ media: photo(41), has_photo: true })), 41)
    // A level drop's photo is its later reading's.
    const after = {
      id: 9,
      volume_ml: 300,
      created_at: '',
      media: photo(77),
      labeled_media: null,
      evidence: null,
      event: null,
      residual_ml: null,
    }
    assert.equal(photoMediaId(entry({ media: null, levels: { before: null, after } })), 77)
    // A voice note's recording is never fetched by a peek.
    assert.equal(photoMediaId(entry({ source: 'voice', media: { ...photo(5), kind: 'voice' } })), null)
  })

  it('a 401 (or any non-2xx) is never cached as a photo', async () => {
    const f = server(401)
    const u = urls()
    const cache = createMediaCache({ fetchMedia: f.api.media, ...u })
    const a = cache.acquire(41)
    const refused = assert.rejects(a.url, { name: 'ApiError', status: 401 })
    await f.release()
    await refused
    assert.equal(cache.has(41), false)
    const b = cache.acquire(41)
    b.release()
    await assert.rejects(b.url, { name: 'AbortError' })
    assert.equal(f.seen.length, 2, 'the next open fetches again')
  })

  it('keeps the 24 most recent and revokes the evicted URL', async () => {
    const f = server()
    const u = urls()
    const cache = createMediaCache({ fetchMedia: f.api.media, ...u })
    for (let id = 1; id <= 25; id++) {
      const h = cache.acquire(id)
      await f.release()
      await h.url
      h.release()
    }
    assert.equal(cache.has(1), false)
    assert.equal(cache.has(25), true)
    assert.deepEqual(u.revoked, ['blob:1'])
    cache.clear()
    assert.equal(u.revoked.length, 25)
  })
})
