import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WardQuality } from '@meniscus/shared'
import { entry } from './audit-fixtures.ts'
import { flaggedRows, QUIET_TEXT, qualityTiles } from './quality.ts'

const ward = { id: 3, code: '5B', name: 'Neurology Ward 5B', specialty: 'Neurology', capacity: 6, default_acuity: 'stable' as const }
const tiles = (t: WardQuality['totals']) => qualityTiles(t).map((x) => `${x.label} ${x.value}`)

describe('data quality view', () => {
  it('[web/ward] Data quality view: Tiles', () => {
    assert.deepEqual(tiles({ entries: 4, corrected: 1, amended: 0, late: 1, rejected: 1, manual: 1 }), [
      'Entries 4',
      'Corrected at approval 25% · 1/4',
      'Amended 0',
      'Late 1',
      'Rejected 1',
      'By hand 1',
    ])
  })

  it('[web/ward] Data quality view: Small share', () => {
    const t = qualityTiles({ entries: 70, corrected: 1, amended: 0, late: 0, rejected: 0, manual: 0 })
    assert.equal(t[1]!.value, '1% · 1/70')
    assert.ok(t.every((x) => !x.value.includes('mL')))
  })

  it('[web/ward] Data quality view: Quiet week', () => {
    assert.equal(tiles({ entries: 0, corrected: 0, amended: 0, late: 0, rejected: 0, manual: 0 })[1], 'Corrected at approval 0')
    assert.equal(QUIET_TEXT, 'Nothing flagged in the last 7 days')
    const q: WardQuality = {
      ward,
      since: '',
      totals: { entries: 0, corrected: 0, amended: 0, late: 0, rejected: 0, manual: 0 },
      rejected_by_reason: {},
      recorders: [],
      reviewers: [],
      flagged: [],
    }
    assert.deepEqual(flaggedRows(q), [])
  })

  it('[web/ward] Data quality view: Flagged entry opens its bed', () => {
    const q = {
      flagged: [
        {
          entry: entry({ id: 9, status: 'rejected', reject_reason: 'duplicate' }),
          admission_id: 16,
          bed: '4',
          patient: 'Tomas Silva',
          flags: ['rejected'],
        },
      ],
    } as Pick<WardQuality, 'flagged'>
    const rows = flaggedRows(q)
    assert.equal(rows[0]!.href, '/n/16')
    assert.deepEqual(
      rows[0]!.badges.map((b) => b.text),
      ['Rejected: Duplicate'],
    )
  })
})
