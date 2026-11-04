import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shiftBars } from './shifts.ts'

describe('shift bars', () => {
  it('[web/ward] Shift totals drawn in the log: Two shifts', () => {
    const [day, night] = shiftBars([
      { in_ml: 200, out_ml: 300, pending: 0 },
      { in_ml: 0, out_ml: 0, pending: 1 },
    ])
    assert.equal(day!.out, 1)
    assert.equal(day!.in, 2 / 3)
    assert.equal(day!.text, 'In 200 mL · Out 300 mL')
    assert.deepEqual([night!.in, night!.out], [0, 0])
    assert.equal(night!.text, 'In 0 mL · Out 0 mL · 1 pending')
  })

  it('names the bars for assistive tech, and survives an empty log', () => {
    assert.deepEqual(shiftBars([]), [])
    assert.equal(shiftBars([{ in_ml: 0, out_ml: 0, pending: 0 }])[0]!.in, 0)
  })
})
