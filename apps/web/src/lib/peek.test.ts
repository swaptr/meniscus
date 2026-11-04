import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { createPeekController, opensOn, peekMode, PEEK_DELAY, type Timers } from './peek.ts'

const fake = (): Timers => ({ set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as number) })

describe('peeks', () => {
  it('[web/interface] Peeks open by hover, tap and keyboard: Hover dwell', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const p = createPeekController(fake())
      // A pointer crossing five rows, 100 ms on each, opens none.
      for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
        p.enter(id, 'mouse')
        mock.timers.tick(100)
        p.leave(id)
      }
      mock.timers.tick(1000)
      assert.equal(p.get().open, null)
      // Resting 399 ms opens nothing; 400 ms opens the 14:05 row's peek.
      p.enter('14:05', 'mouse')
      mock.timers.tick(PEEK_DELAY - 1)
      assert.equal(p.get().open, null)
      mock.timers.tick(1)
      assert.deepEqual(p.get(), { open: '14:05', pinned: false })
      // Travelling into the peek keeps it; leaving both closes it 150 ms later.
      p.leave('14:05')
      mock.timers.tick(100)
      p.enterPeek()
      mock.timers.tick(500)
      assert.equal(p.get().open, '14:05')
      p.leavePeek()
      mock.timers.tick(149)
      assert.equal(p.get().open, '14:05')
      mock.timers.tick(1)
      assert.equal(p.get().open, null)
    } finally {
      mock.timers.reset()
    }
  })

  it('[web/interface] Peeks open by hover, tap and keyboard: Tap on a phone', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const p = createPeekController(fake())
      p.enter('14:05', 'touch')
      mock.timers.tick(1000)
      assert.equal(p.get().open, null, 'touch hover never opens')
      p.press('14:05')
      assert.deepEqual(p.get(), { open: '14:05', pinned: true })
      assert.equal(peekMode(390), 'sheet')
      assert.equal(peekMode(640), 'sheet')
      assert.equal(peekMode(641), 'float')
      // A tap outside (or Close) closes it.
      p.close()
      assert.equal(p.get().open, null)
    } finally {
      mock.timers.reset()
    }
  })

  it('[web/interface] Peeks open by hover, tap and keyboard: Keyboard', () => {
    const p = createPeekController(fake())
    // Tabbing past 25 rows opens nothing: focus is not an open reason.
    for (let i = 0; i < 25; i++) p.focus(`r${i}`)
    assert.equal(p.get().open, null)
    assert.equal(opensOn('trigger-focus'), false)
    // Enter on the focused row is a press: pinned open; Escape closes it (focus returns to the trigger, Base UI).
    assert.equal(opensOn('trigger-press'), true)
    p.press('14:05')
    assert.equal(p.get().open, '14:05')
    p.press('14:10')
    assert.equal(p.get().open, '14:10', 'one open at a time')
    p.close()
    assert.equal(p.get().open, null)
  })
})
