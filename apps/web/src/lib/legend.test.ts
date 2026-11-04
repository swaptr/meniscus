import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ALERT_KINDS } from '@meniscus/shared'
import { ALERT_LABEL } from './labels.ts'
import { wardLegend } from './legend.ts'

describe('ward legend', () => {
  it('[web/interface] Fits a phone screen: Ward dashboard at 390 px', () => {
    const rows = wardLegend()
    // Rows, one per status tone, each listing every prompt kind of that tone (bag prompts included).
    assert.deepEqual(
      rows.map((r) => [r.tone, r.label]),
      [
        ['danger', 'Review now'],
        ['warn', 'Review'],
        ['info', 'Check'],
        ['pending', 'Pending'],
        ['ok', 'On track'],
      ],
    )
    const listed = rows.flatMap((r) => r.kinds)
    for (const k of ALERT_KINDS) assert.ok(listed.includes(ALERT_LABEL[k]), `${k} is in the legend`)
    assert.ok(rows[0]!.kinds.includes('Bag reading overdue'))
    assert.ok(rows[1]!.kinds.includes('Bag nearly full'))
    assert.deepEqual(rows[3]!.kinds, ['Entries waiting for approval'])
  })
})
