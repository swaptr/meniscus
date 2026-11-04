import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MaskBits } from '@meniscus/shared'
import { contours, loopArea, smooth, toPath, unpack, type Grid } from './contour.ts'

/** The server's `packMask` (apps/server/src/ai/tray.ts), mirrored as a fixture producer: cell centres, MSB first. */
function pack(width: number, height: number, bit: (i: number, j: number) => boolean): MaskBits {
  const bytes = new Uint8Array(Math.ceil((width * height) / 8))
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      if (!bit(i, j)) continue
      const k = j * width + i
      bytes[k >> 3]! |= 0x80 >> (k & 7)
    }
  return { width, height, bits: btoa(String.fromCharCode(...bytes)) }
}
const grid = (rows: string[]): Grid => unpack(pack(rows[0]!.length, rows.length, (i, j) => rows[j]![i] === '#'))
const numbers = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))

describe('mask contours (lib/contour.ts)', () => {
  it('unpacks what packMask packs', () => {
    const rows = ['#..#', '.##.', '#...']
    const g = grid(rows)
    assert.equal(g.width, 4)
    assert.equal(g.height, 3)
    assert.equal([...g.cells].join(''), rows.join('').replaceAll('#', '1').replaceAll('.', '0'))
  })

  it('traces a 1-cell mask as one 4-corner loop, and an empty mask as none', () => {
    const loops = contours(grid(['#']))
    assert.equal(loops.length, 1)
    assert.deepEqual(loops[0]!.map(([x, y]) => `${x},${y}`).toSorted(), ['0,0', '0,1', '1,0', '1,1'])
    assert.deepEqual(contours(grid(['...', '...'])), [])
  })

  it('traces a 3 × 3 ring as an outer loop and a hole of opposite orientation', () => {
    const loops = contours(grid(['###', '#.#', '###']))
    assert.equal(loops.length, 2)
    const areas = loops.map(loopArea).toSorted((a, b) => Math.abs(b) - Math.abs(a))
    assert.equal(Math.abs(areas[0]!), 9)
    assert.equal(Math.abs(areas[1]!), 1)
    assert.ok(Math.sign(areas[0]!) !== Math.sign(areas[1]!), 'the hole runs the other way (even-odd fill)')
  })

  it('traces two separate blobs (and diagonal neighbours) as separate closed loops', () => {
    assert.equal(contours(grid(['##..', '##..', '...#'])).length, 2)
    const diag = contours(grid(['#.', '.#']))
    assert.equal(diag.length, 2)
    for (const l of diag) assert.equal(Math.abs(loopArea(l)), 1)
  })

  it('orients every outer loop the same way', () => {
    const signs = contours(grid(['#...#', '.....', '..##.'])).map((l) => Math.sign(loopArea(l)))
    assert.ok(signs.every((s) => s === signs[0]))
  })

  it('smooths with two Chaikin passes, every point staying inside the cell bounds', () => {
    const [loop] = contours(grid(['.##', '###']))
    const out = smooth(loop!)
    assert.ok(out.length > loop!.length)
    for (const [x, y] of out) assert.ok(x >= 0 && x <= 3 && y >= 0 && y <= 2, `${x},${y} inside 3 × 2`)
  })

  it('[web/ward] Segmentation overlay: Contour from a mask', () => {
    // 2 × 2 `gA==` (only the top-left cell) over the container box 100,80–400,900 on a 1000 × 1000 photo.
    const g = unpack({ width: 2, height: 2, bits: 'gA==' })
    const d = toPath(
      contours(g).map((l) => smooth(l)),
      { left: 100, top: 80, right: 400, bottom: 900 },
      { width: 1000, height: 1000 },
      g,
    )
    assert.equal((d.match(/M/g) ?? []).length, 1, 'one closed contour')
    assert.ok(d.endsWith('Z'))
    const n = numbers(d)
    const xs = n.filter((_, i) => i % 2 === 0)
    const ys = n.filter((_, i) => i % 2 === 1)
    assert.ok(Math.min(...xs) >= 10 && Math.max(...xs) <= 25, 'inside left 10–25%')
    assert.ok(Math.min(...ys) >= 8 && Math.max(...ys) <= 49, 'inside top 8–49%')
  })
})
