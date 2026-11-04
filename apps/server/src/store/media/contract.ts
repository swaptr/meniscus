/**
 * The media store contract (test helper): every adapter runs it, the memory store and the S3 store over the fake S3
 * always, and the S3 store against a real endpoint when `S3_TEST_ENDPOINT` is set in the shell.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { describe, it, type TestContext } from 'node:test'
import { MediaStoreError, readAll, type MediaStore } from './port.ts'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
/** Synthetic bytes: a PNG signature plus random filler, so a real bucket never sees the same key twice. */
const synthetic = (n: number) => {
  const b = new Uint8Array(n)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  b.set(randomBytes(n - 8), 8)
  return b
}

/** `make` returns undefined to skip (no endpoint configured). */
export function mediaStoreContract(name: string, make: () => MediaStore | undefined) {
  void describe(`media store contract: ${name}`, () => {
    const each = (title: string, fn: (m: MediaStore, t: TestContext) => Promise<void>) =>
      void it(title, async (t) => {
        const m = make()
        if (!m) return t.skip('S3_TEST_ENDPOINT is not set')
        await fn(m, t)
      })
    const cleanup = (m: MediaStore, t: TestContext, ...hashes: string[]) =>
      t.after(async () => {
        for (const h of hashes) await m.delete(h).catch(() => {})
      })

    each('the bucket check passes', async (m) => {
      await m.check()
    })

    each('put then get returns the same bytes and size', async (m, t) => {
      const bytes = synthetic(48_213)
      const h = sha(bytes)
      cleanup(m, t, h)
      await m.put(h, bytes, 'image/png')
      const obj = await m.get(h)
      assert.equal(obj.size, bytes.byteLength)
      assert.equal(sha(await readAll(obj)), h)
    })

    each('the same key twice is one object', async (m, t) => {
      const bytes = synthetic(1_000)
      const h = sha(bytes)
      cleanup(m, t, h)
      await m.put(h, bytes, 'image/png')
      await m.put(h, bytes, 'image/png')
      let n = 0
      for await (const o of m.list()) if (o.sha256 === h) n++
      assert.equal(n, 1)
    })

    each('get of an absent key throws MediaStoreError', async (m) => {
      await assert.rejects(m.get(sha(synthetic(64))), (err: unknown) => err instanceof MediaStoreError && err.op === 'get')
    })

    each('delete of an absent key resolves; head of an absent key is undefined', async (m) => {
      const h = sha(synthetic(64))
      await m.delete(h)
      assert.equal(await m.head(h), undefined)
    })

    each('delete removes the object', async (m, t) => {
      const bytes = synthetic(500)
      const h = sha(bytes)
      cleanup(m, t, h)
      await m.put(h, bytes, 'image/png')
      await m.delete(h)
      assert.equal(await m.head(h), undefined)
      await assert.rejects(m.get(h), MediaStoreError)
    })

    each('list and head return hashes and dates', async (m, t) => {
      const before = Date.now() - 5 * 60_000
      const a = synthetic(100)
      const b = synthetic(200)
      cleanup(m, t, sha(a), sha(b))
      await m.put(sha(a), a, 'image/png')
      await m.put(sha(b), b, 'image/png')
      const listed = new Map<string, number>()
      for await (const o of m.list()) listed.set(o.sha256, o.lastModified)
      for (const h of [sha(a), sha(b)]) {
        assert.ok(listed.has(h))
        assert.ok(listed.get(h)! >= before && listed.get(h)! <= Date.now() + 5 * 60_000)
        const head = await m.head(h)
        assert.ok(head && Math.abs(head.lastModified - listed.get(h)!) < 2_000)
      }
    })
  })
}
