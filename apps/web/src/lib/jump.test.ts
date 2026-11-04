import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isJumpKey, isTypingTarget, matches } from './jump.ts'
import { createSnapshot } from './snapshot.ts'
import { ALERT_TONE } from './labels.ts'
import { alert, bedSummary } from './ward-fixtures.ts'
import { ANITA, fakeServer } from './staff-fixtures.ts'

describe('quick jump', () => {
  it('[web/interface] Quick jump: Find a bed', async () => {
    const f = fakeServer({ live: ANITA })
    await f.session.check()
    const before = f.reqs().length
    const snap = createSnapshot()
    const beds = [bedSummary(4, { patient: 'Mei Lin' }), bedSummary(5, { id: 57, patient: 'Joseph Mwangi', alerts: [alert('overload')] })]
    snap.writeWard(2, beds, Date.now(), (b) => (b.alerts[0] ? ALERT_TONE[b.alerts[0].kind] : null))
    const hits = matches('mwa', ANITA.wards, snap.get())
    assert.deepEqual(hits, [{ kind: 'bed', label: '3A bed 5 · Joseph Mwangi · Review', href: '/n/57' }])
    assert.deepEqual(
      matches('3a', ANITA.wards, snap.get()).map((h) => h.label),
      ['3A Medical Ward 3A', '3A bed 4 · Mei Lin · On track', '3A bed 5 · Joseph Mwangi · Review'],
    )
    assert.deepEqual(
      matches('bed 4', ANITA.wards, snap.get()).map((h) => h.href),
      ['/n/104'],
    )
    assert.equal(f.reqs().length, before, 'no request while searching')
  })

  it('[web/interface] Quick jump: Typing in a field', () => {
    const key = { key: '/', ctrlKey: false, metaKey: false, altKey: false }
    assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true)
    assert.equal(isJumpKey(key, { tagName: 'TEXTAREA' }), false)
    assert.equal(isJumpKey(key, { tagName: 'INPUT', type: 'text' }), false)
    assert.equal(isJumpKey(key, { tagName: 'BUTTON' }), true)
    assert.equal(isJumpKey(key, { tagName: 'INPUT', type: 'checkbox' }), true)
    assert.equal(isJumpKey({ ...key, key: 'k', ctrlKey: true }, { tagName: 'BODY' }), true)
    assert.equal(isJumpKey({ ...key, key: 'k', metaKey: true }, null), true)
  })
})
