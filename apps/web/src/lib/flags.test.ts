import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at, entry } from './audit-fixtures.ts'
import { entryFlags, isFlagged, lateText } from './flags.ts'
import { logView } from './history.ts'

describe('flagged records', () => {
  it('[web/ward] Flagged records highlighted: Badges', () => {
    const e = entry({
      source: 'manual',
      status: 'approved',
      volume_ml: 400,
      recorded_ml: 430,
      approved_ml: 400,
      created_at: at(8),
      recorded_at: at(14, 10),
      late: true,
    })
    assert.deepEqual(
      entryFlags(e).map((f) => f.text),
      ['Corrected 430 → 400 mL', 'Late · 6 h', 'By hand'],
    )
    assert.equal(lateText(entry({ created_at: at(8), recorded_at: at(9, 10) })), '70 min')
    assert.deepEqual(
      entryFlags(entry({ status: 'rejected', reject_reason: 'duplicate', source: 'photo' })).map((f) => f.text),
      ['Rejected: Duplicate'],
    )
    assert.deepEqual(
      entryFlags(entry({ status: 'rejected', source: 'photo' })).map((f) => f.text),
      ['Rejected'],
    )
    assert.deepEqual(
      entryFlags(entry({ status: 'approved', amended_at: at(12), approved_ml: 200, source: 'voice' })).map((f) => f.text),
      ['Amended'],
    )
  })

  it('[web/ward] Flagged records highlighted: Flagged only', () => {
    const corrected = entry({ id: 1, source: 'photo', status: 'approved', volume_ml: 400, recorded_ml: 430, approved_ml: 400 })
    const plain = entry({ id: 2, source: 'photo', status: 'approved', approved_ml: 200 })
    const rejected = entry({ id: 3, source: 'photo', status: 'rejected' })
    const byHand = entry({ id: 4, source: 'manual', status: 'approved', approved_ml: 200 })
    const all = [corrected, plain, rejected, byHand]
    assert.deepEqual(all.map(isFlagged), [true, false, true, false])
    const v = logView(all, { period: 'all', flagged: true }, { key: 'time', desc: true }, Date.parse(at(12)))
    assert.equal(v.count, '2 of 4')
    assert.deepEqual(v.rows.map((e) => e.id).toSorted(), [1, 3])
  })
})
