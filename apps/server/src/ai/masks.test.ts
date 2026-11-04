import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { msg, reading, resp, upstream } from '../testing.ts'

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

type Box = { left: number; top: number; right: number; bottom: number }
/** One SAM record over a half-open box on a 1000 × 1000 frame; `data` is the mask (`rows,cols,payload`). */
const record = (b: Box, data: string) =>
  `<0f>0<|box;x1=${b.left};y1=${b.top};x2=${b.right - 1};y2=${b.bottom - 1};w=1000;h=1000;c=0.9|>` + `<|mask;x=0;y=0;c=0.9;data=${data}|>\n`
/** A 1 × 2 raster with only its left cell set: the left half of the box. */
const leftHalf = (b: Box) => record(b, '1,2,!!!!!&O.lVP')
/** A full 1 × 1 raster: the mask fills its box. */
const full = (b: Box) => record(b, '1,1,!!!!!&O.lVP')

const sparkReading =
  (over: Parameters<typeof reading>[0] = {}) =>
  () =>
    resp('muse-spark-1.3', [msg(JSON.stringify(reading(over)))])

const steps = (r: { trace: { step: string }[] }) => r.trace.map((t) => t.step)

describe('photo read masks', () => {
  it('[capture/photo-reading] Masks kept with the segmentation: Half-filled container mask', async () => {
    const box = { left: 0, top: 0, right: 200, bottom: 400 }
    const u = upstream({
      sam: (prompt) => resp('sam-3.1', [msg(prompt === 'liquid' ? full({ left: 10, top: 200, right: 190, bottom: 400 }) : leftHalf(box))]),
      spark: sparkReading(),
    })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', hint: 'urine_bag', mode: 'sam+spark' })
    const m = r.segmentation?.container_mask
    assert.ok(m)
    assert.deepEqual([m.width, m.height], [16, 32])
    assert.equal(m.bits.length, 88)
    const bytes = Buffer.from(m.bits, 'base64')
    for (let row = 0; row < 32; row++) assert.deepEqual([bytes[row * 2], bytes[row * 2 + 1]], [0xff, 0x00], `row ${row}`)
    assert.ok(r.segmentation?.fluid_mask)
    assert.equal(u.requests.length, 3)
    assert.deepEqual(steps(r), ['sam:container', 'sam:liquid', 'spark:read'])
  })

  it('[capture/photo-reading] Masks kept with the segmentation: No liquid', async () => {
    const u = upstream({
      sam: (prompt) => resp('sam-3.1', [msg(prompt === 'liquid' ? '' : full({ left: 0, top: 0, right: 200, bottom: 400 }))]),
      spark: sparkReading(),
    })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'sam+spark' })
    assert.equal(r.segmentation?.fluid_mask, null)
    assert.ok(r.segmentation?.container_mask)
    assert.equal(u.requests.length, 3)
  })

  it('[capture/photo-reading] Masks kept with the segmentation: Spark mode', async () => {
    const u = upstream()
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'spark' })
    assert.deepEqual(u.requests, ['spark:object'])
    assert.equal(r.segmentation, null)
  })
})

describe('liquid region quantity', () => {
  // Container 0,0–100,1000 and liquid 0,537–100,1000: fill (1000 − 537) / 1000 = 0.463.
  const sam = (prompt: string) =>
    resp('sam-3.1', [
      msg(
        prompt === 'liquid' ? full({ left: 0, top: 537, right: 100, bottom: 1000 }) : full({ left: 0, top: 0, right: 100, bottom: 1000 }),
      ),
    ])

  it('[capture/photo-reading] Liquid region quantity: Urine bag 46% full', async () => {
    const u = upstream({ sam, spark: sparkReading({ capacity_ml: 2000 }) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', hint: 'urine_bag', mode: 'sam+spark' })
    assert.equal(r.segmentation?.fill_fraction, 0.463)
    assert.equal(r.segmentation?.fluid_volume_ml, 930)
    assert.equal(u.requests.length, 3)
  })

  it('[capture/photo-reading] Liquid region quantity: No capacity', async () => {
    const sam40 = (prompt: string) =>
      resp('sam-3.1', [
        msg(
          prompt === 'liquid' ? full({ left: 0, top: 600, right: 100, bottom: 1000 }) : full({ left: 0, top: 0, right: 100, bottom: 1000 }),
        ),
      ])
    const u = upstream({ sam: sam40, spark: sparkReading({ capacity_ml: null }) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'sam+spark' })
    assert.equal(r.segmentation?.fill_fraction, 0.4)
    assert.equal(r.segmentation?.fluid_volume_ml, null)
    assert.equal(u.requests.length, 3)
  })

  it('[capture/photo-reading] Liquid region quantity: No liquid found', async () => {
    const u = upstream({
      sam: (prompt) => resp('sam-3.1', [msg(prompt === 'liquid' ? '' : full({ left: 0, top: 0, right: 100, bottom: 1000 }))]),
      spark: sparkReading({ capacity_ml: 1000 }),
    })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'sam+spark' })
    assert.equal(r.segmentation?.fill_fraction, null)
    assert.equal(r.segmentation?.fluid_volume_ml, null)
  })

  it('[capture/photo-reading] Liquid region quantity: Spark mode has no region quantity', async () => {
    const u = upstream()
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'spark' })
    assert.deepEqual(u.requests, ['spark:object'])
    assert.equal(r.segmentation, null)
  })
})
