import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { scrollName } from './legend.ts'

describe('table scroll', () => {
  it('[web/interface] Fits a phone screen: Wide table scrolls in place', () => {
    assert.equal(scrollName('Entries by recorder'), 'Entries by recorder, scrolls sideways')
    assert.equal(scrollName('Log, scrolls sideways'), 'Log, scrolls sideways')
  })
})
