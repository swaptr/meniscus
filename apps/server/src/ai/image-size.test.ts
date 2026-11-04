import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { jpeg, png } from '../testing.ts'
import { imageSize } from './image-size.ts'

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))
const le16 = (n: number) => [n & 0xff, n >> 8]
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16]
const be16 = (n: number) => [n >> 8, n & 0xff]
const riff = (chunk: string, body: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body)

describe('image size', () => {
  it('imageSize: PNG', () => {
    assert.deepEqual(imageSize(png(1000, 800), 'image/png'), { width: 1000, height: 800 })
  })

  it('imageSize: GIF', () => {
    assert.deepEqual(imageSize(bytes('GIF89a', le16(640), le16(480), [0, 0, 0]), 'image/gif'), { width: 640, height: 480 })
  })

  it('imageSize: WebP VP8, VP8L and VP8X', () => {
    // VP8: frame tag (3 bytes), start code 9D 01 2A, then 14-bit width and height (bytes 26–29).
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1000 | 0xc000), ...le16(800)])
    assert.deepEqual(imageSize(vp8, 'image/webp'), { width: 1000, height: 800 })
    // VP8L: signature 0x2F, then 14 bits width − 1 and 14 bits height − 1, little-endian.
    const bits = (1000 - 1) | ((800 - 1) << 14)
    const vp8l = riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff])
    assert.deepEqual(imageSize(vp8l, 'image/webp'), { width: 1000, height: 800 })
    // VP8X: flags (4 bytes), then 24-bit width − 1 and height − 1 (bytes 24–29).
    const vp8x = riff('VP8X', [0, 0, 0, 0, ...le24(4000 - 1), ...le24(3000 - 1)])
    assert.deepEqual(imageSize(vp8x, 'image/webp'), { width: 4000, height: 3000 })
  })

  it('imageSize: JPEG with APP0 then SOF0, and with SOF2', () => {
    const app0 = [0xff, 0xe0, ...be16(16), ...bytes('JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0])]
    const sof = (marker: number) => [0xff, marker, ...be16(17), 8, ...be16(800), ...be16(1000), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
    assert.deepEqual(imageSize(bytes([0xff, 0xd8], app0, sof(0xc0), [0xff, 0xd9]), 'image/jpeg'), { width: 1000, height: 800 })
    assert.deepEqual(imageSize(bytes([0xff, 0xd8], app0, sof(0xc2), [0xff, 0xd9]), 'image/jpeg'), { width: 1000, height: 800 })
    // DHT (C4) before the frame is a table, not a frame header: skipped.
    const dht = [0xff, 0xc4, ...be16(5), 0, 0, 0]
    assert.deepEqual(imageSize(bytes([0xff, 0xd8], dht, sof(0xc0)), 'image/jpeg'), { width: 1000, height: 800 })
  })

  it('imageSize: no frame header or truncated → null, never a throw', () => {
    assert.equal(imageSize(jpeg, 'image/jpeg'), null)
    assert.equal(imageSize(png(1000, 800).slice(0, 20), 'image/png'), null)
    assert.equal(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0x40, 0x00, 1, 2]), 'image/jpeg'), null)
    assert.equal(imageSize(new Uint8Array(), 'image/webp'), null)
    assert.equal(imageSize(bytes('GIF89a', [1]), 'image/gif'), null)
  })
})
