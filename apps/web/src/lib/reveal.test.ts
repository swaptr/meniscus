import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasShown, markShown, revealSchedule, REVEAL_TOTAL } from './reveal.ts'

describe('segment reveal (lib/reveal.ts)', () => {
  it('[web/ward] Segments revealed on first open: Peek opened twice', () => {
    // What the overlay does (components/segment-overlay.tsx): animate when not yet shown, mark it shown from an effect.
    const open = (key: string | object) => {
      const animate = !hasShown(key)
      markShown(key)
      return animate
    }
    assert.equal(open('media:41'), true)
    assert.equal(hasShown('media:41'), true)
    assert.equal(open('media:41'), false, 'the second open shows the final state at once')
    assert.equal(open('media:42'), true)
    // A capture's in-memory photo is keyed by its blob, not a string.
    const blob = {}
    assert.equal(open(blob), true)
    assert.equal(open(blob), false)
  })

  it('schedules the container first, then the liquid or dishes 80 ms apart, labels last, within 480 ms', () => {
    const s = revealSchedule(['container', 'liquid'], false)
    assert.deepEqual(
      s.steps.map((x) => [x.kind, x.delay]),
      [
        ['container', 0],
        ['liquid', 80],
      ],
    )
    assert.ok(s.labelsAt > s.steps.at(-1)!.delay)
    assert.ok(s.steps.every((x) => x.delay + x.duration <= REVEAL_TOTAL))
    assert.equal(s.labelsAt + s.labelsFor, REVEAL_TOTAL)
    const tray = revealSchedule(['dish', 'dish', 'dish', 'dish', 'dish', 'dish'], false)
    assert.ok(tray.steps.every((x) => x.delay + x.duration <= tray.labelsAt))
    assert.ok(tray.steps.every((x, i) => i === 0 || x.delay > tray.steps[i - 1]!.delay))
  })

  it('[web/interface] Reduced motion: Contours under reduced motion', () => {
    assert.deepEqual(revealSchedule(['container', 'liquid'], true), { steps: [], labelsAt: 0, labelsFor: 0 })
  })
})
