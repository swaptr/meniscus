import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bagSaveLabel, controlGroups, deviceLine, MAX_CONTROL_GROUPS, pickerColumns, vitalsLine } from './attendant.ts'

describe('attendant screens', () => {
  it('[web/interface] Attendant screens stay simple: Check screen', () => {
    // A 450 mL urine bag read: the outlined photo, then the stepper, the bag event chips and the colour chips.
    assert.deepEqual(controlGroups({ k: 'check', item: { kind: 'bag', urine: true } }), ['level', 'bagEvent', 'colour'])
    assert.equal(bagSaveLabel(450), 'Save 450 mL reading')
    // Every check shape stays within 4 groups before its commit.
    const shapes = [
      { kind: 'bag', urine: false },
      { kind: 'level' },
      { kind: 'item', category: 'water', drink: true, consistency: true },
      { kind: 'item', category: 'water', drink: true, consistency: true, byHand: true },
      { kind: 'item', category: 'urine', byHand: true },
      { kind: 'item', category: 'urine', byHand: true, bagLevel: true },
      { kind: 'item', category: 'urine' },
      { kind: 'item', category: 'food', byHand: true },
    ] as const
    for (const item of shapes) {
      const g = controlGroups({ k: 'check', item })
      assert.ok(g.length <= MAX_CONTROL_GROUPS, `${JSON.stringify(item)} has ${g.length} groups`)
    }
    // A by-hand urine bag level: what (with when), level (with the optional photo), event, colour.
    assert.deepEqual(controlGroups({ k: 'check', item: { kind: 'item', category: 'urine', byHand: true, bagLevel: true } }), [
      'what',
      'level',
      'bagEvent',
      'colour',
    ])
    // A meal: the tray photo, which meal (with when), how much was eaten, and what was on the tray.
    assert.deepEqual(controlGroups({ k: 'meal' }), ['photo', 'meal', 'eaten', 'details'])
    assert.deepEqual(controlGroups({ k: 'check', item: { kind: 'item', category: 'water', drink: true, consistency: true } }), [
      'what',
      'volume',
      'consistency',
    ])
  })

  it('[web/interface] Attendant screens stay simple: Bed picker', () => {
    assert.deepEqual(controlGroups({ k: 'picker' }), ['beds'])
    assert.deepEqual(controlGroups({ k: 'capture' }), ['capture', 'container', 'note'])
    assert.equal(pickerColumns(390), 3)
    assert.equal(pickerColumns(641), 6)
  })

  it('writes the bed strip', () => {
    assert.equal(deviceLine({ urine_measured: true, bags: ['urine_bag', 'stoma_bag'] }), 'Urine bag · stoma bag')
    assert.equal(deviceLine({ urine_measured: false, bags: [] }), 'Urine not measured')
    assert.equal(deviceLine({ urine_measured: true, bags: [] }), null)
    assert.equal(vitalsLine({ in_ml: 1190, out_ml: 1375 }, 2), 'In 1190 mL · Out 1375 mL · 2 pending')
    assert.equal(vitalsLine({ in_ml: 0, out_ml: 0 }, 0), 'In 0 mL · Out 0 mL')
  })
})
