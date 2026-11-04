import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at, entry, RAVI } from './audit-fixtures.ts'
import { entryRow, pendingActions } from './rows.ts'

describe('dense entry rows', () => {
  it('[web/ward] Dense entry rows: One line', () => {
    const r = entryRow(
      entry({
        category: 'water',
        drink: 'water',
        item: 'Water',
        volume_ml: 200,
        source: 'manual',
        confidence: null,
        status: 'approved',
        created_by: RAVI,
        created_at: at(14, 5),
      }),
    )
    assert.deepEqual([r.time, r.head, r.source.text, r.status.text, r.who], ['14:05', '▲ Water 200 mL', 'By hand', 'Approved', 'Ravi K.'])
    assert.equal(r.status.tone, 'ok')
    assert.equal(r.struck, false)
    assert.equal(r.photo, false, 'no thumbnail on the row')
  })

  it('[web/ward] Dense entry rows: Rejected', () => {
    const r = entryRow(entry({ category: 'water', drink: 'tea', item: 'Tea', volume_ml: 100, status: 'rejected' }))
    assert.equal(r.head, '▲ Tea 100 mL')
    assert.equal(r.struck, true)
    assert.equal(r.status.text, 'Rejected')
  })

  it('[web/ward] Dense entry rows: Drink kind', () => {
    const tea = entryRow(entry({ category: 'water', drink: 'tea', item: 'masala chai', volume_ml: 150, status: 'pending' }))
    assert.equal(tea.head, '▲ Tea 150 mL')
    assert.equal(tea.drink, 'tea')
    assert.equal(tea.name, 'masala chai')
    const plain = entryRow(entry({ category: 'water', drink: null, item: null, volume_ml: 200, status: 'approved' }))
    assert.equal(plain.head, '▲ Drink 200 mL')
    assert.equal(plain.drink, null)
    const urine = entryRow(entry({ direction: 'out', category: 'urine', drink: null, volume_ml: 375, source: 'photo', confidence: 0.62 }))
    assert.equal(urine.head, '▼ Urine 375 mL')
    assert.deepEqual(urine.source, { text: 'Photo · 62%', tone: 'warn' })
  })

  it('[web/interface] Targets big enough for gloved hands: Entry log row opens its peek', () => {
    const r = entryRow(entry({ created_at: at(14, 5) }))
    // The whole row is one button naming the entry; no separate `Details ›` text button.
    assert.match(r.label, /^14:05, /)
    assert.equal(r.peekTitle, 'Entry 14:05')
  })

  it('[web/interface] Actions never only in a peek: Pending row', () => {
    assert.deepEqual(pendingActions(entry({ status: 'pending', volume_ml: 200 })), ['Reject…', 'Approve'])
    assert.deepEqual(pendingActions(entry({ status: 'approved' })), [])
  })
})
