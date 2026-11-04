import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REJECT_REASONS, URINE_COLOURS } from '@meniscus/shared'
import { BAG_EVENT_CHOICES, choiceItems, rovingIndex, toggleIn } from './choice.ts'
import { REJECT_LABEL } from './labels.ts'
import { URINE_LABEL } from './urine.ts'

const checked = <T extends string>(items: { value: T; checked: boolean; label: unknown }[]) => items.filter((i) => i.checked)

describe('one choice chip', () => {
  it('[web/interface] One choice chip: Reject reason', () => {
    const items = choiceItems(
      REJECT_REASONS.map((r) => [r, REJECT_LABEL[r]] as const),
      'wrong_volume',
    )
    assert.deepEqual(
      checked(items).map((i) => i.label),
      ['Wrong volume'],
    )
    // Selected is the accent fill (`on`), never a status tone: the item carries no tone at all.
    assert.ok(items.every((i) => !('tone' in i)))
  })

  it('[web/interface] One choice chip: Urine colour', () => {
    const items = choiceItems(
      URINE_COLOURS.map((c) => [c, URINE_LABEL[c]] as const),
      'dark',
    )
    assert.deepEqual(
      checked(items).map((i) => i.value),
      ['dark'],
    )
    assert.equal(rovingIndex(items), URINE_COLOURS.indexOf('dark'))
  })

  it('[web/interface] One choice chip: Bag event', () => {
    // One radio group of three: picking one unpicks the other, no switch beside them.
    assert.deepEqual(
      BAG_EVENT_CHOICES.map(([, l]) => l),
      ['Check', 'Emptied after photo', 'Bag changed'],
    )
    const after = choiceItems(BAG_EVENT_CHOICES, 'bag_changed')
    assert.deepEqual(
      checked(after).map((i) => i.value),
      ['bag_changed'],
    )
    assert.equal(rovingIndex(choiceItems(BAG_EVENT_CHOICES, null)), 0)
  })

  it('toggles a pick-several value', () => {
    assert.deepEqual(toggleIn(['a', 'b'], 'a'), ['b'])
    assert.deepEqual(toggleIn(['b'], 'a'), ['b', 'a'])
  })
})
