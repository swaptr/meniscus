import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PHOTO_MAX_BYTES } from '@meniscus/shared'
import { ApiError, createApi } from './api.ts'
import { encodeWithinCap, photoErrorText, photoTooLargeMessage, PhotoTooLargeError } from './photo.ts'

const MESSAGE = 'Photo too large · max 8 MB. Retake closer or in better light.'
const blob = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' })

describe('photo size cap', () => {
  it('[web/capture] Photos are shrunk before upload: the first encode within 8 MB is used', async () => {
    const qualities: number[] = []
    const out = await encodeWithinCap((q) => (qualities.push(q), Promise.resolve(blob(PHOTO_MAX_BYTES))))
    assert.equal(out.size, PHOTO_MAX_BYTES)
    assert.deepEqual(qualities, [0.82])
  })

  it('[web/capture] Photos are shrunk before upload: one re-encode at q 0.6 when the first is over 8 MB', async () => {
    const qualities: number[] = []
    const out = await encodeWithinCap((q) => (qualities.push(q), Promise.resolve(blob(q > 0.7 ? PHOTO_MAX_BYTES + 1 : 1000))))
    assert.equal(out.size, 1000)
    assert.deepEqual(qualities, [0.82, 0.6])
  })

  it('[web/capture] Photos are shrunk before upload: Photo over 8 MB', async () => {
    // The photo flow over a real API client whose fetch counts requests: shrinking refuses before any is sent.
    let requests = 0
    const client = createApi(() => (requests++, Promise.resolve(new Response('{}'))))
    const qualities: number[] = []
    const read = async () => client.readMeal(await encodeWithinCap((q) => (qualities.push(q), Promise.resolve(blob(PHOTO_MAX_BYTES + 1)))))
    const err = await read().then(
      () => null,
      (e: unknown) => e,
    )
    assert.ok(err instanceof PhotoTooLargeError)
    assert.equal(photoErrorText(err), MESSAGE)
    assert.equal(photoTooLargeMessage(), MESSAGE)
    assert.deepEqual(qualities, [0.82, 0.6])
    assert.equal(requests, 0)
  })

  it("[web/capture] Photos are shrunk before upload: Server refuses the photo's size", () => {
    assert.equal(photoErrorText(new ApiError(413, 'payload_too_large', 'Payload Too Large')), MESSAGE)
    assert.equal(photoErrorText(new ApiError(400, 'invalid_request', 'image must be 1 B – 8 MB')), MESSAGE)
    assert.notEqual(photoErrorText(new ApiError(503, 'media_unavailable', 'x')), MESSAGE)
  })
})
