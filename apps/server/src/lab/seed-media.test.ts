import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { createMemoryMediaStore } from '../store/media/memory.ts'
import { openPgStore } from '../store/pg/store.ts'
import { testDb } from '../testing.ts'
import { seedMedia } from './seed-media.ts'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('seed media', () => {
  it('[charting/media] Media kept in an object store: a seeded database has every media row as an object', async () => {
    {
      const h = await testDb()
      const store = await openPgStore(h.db)
      const media = createMemoryMediaStore()
      const seed = seedMedia(store, media)
      const bed = (await store.admissions())[0]!.id
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
      const wav = new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt synthetic')
      await seed.keep(bed, { kind: 'photo', mime: 'image/png', bytes: png }, 4)
      await seed.keep(bed, { kind: 'photo', mime: 'image/png', bytes: png, served_meal: 'lunch' }, 4)
      await seed.keep(bed, { kind: 'voice', mime: 'audio/wav', bytes: wav, duration_ms: 900 }, 4)
      assert.equal(await seed.keep(9999, { kind: 'photo', mime: 'image/png', bytes: png }), undefined)
      assert.equal(await seed.flush(), 2)
      assert.deepEqual(media.calls, ['put', 'put'])
      const rows = (await h.pg.query<{ sha256: string; size: number }>('SELECT sha256, size FROM meniscus.media')).rows
      assert.equal(rows.length, 3)
      for (const r of rows) {
        const o = media.objects.get(r.sha256)
        assert.ok(o, r.sha256)
        assert.equal(sha(o.bytes), r.sha256)
        assert.equal(o.bytes.byteLength, r.size)
      }
    }
  })
})
