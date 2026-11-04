import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MetaBudgetError, RequestBudget, type Ticket } from '@meniscus/meta'
import type { AcuityStatus } from '@meniscus/shared'
import { useBudget } from '../testing.ts'
import { BUDGET_PRESSURE, budgetClass, plan, withBudget, type ActionKind } from './budget-policy.ts'
import type { AiPorts } from './ports.ts'

const status = (over: Partial<AcuityStatus>): AcuityStatus => ({
  level: 'stable',
  source: 'ward',
  order_id: null,
  suggested: null,
  reasons: [],
  ...over,
})

/** A real budget at the defaults (120 an hour, 30 % reserve, 4 in flight) with `used` requests sent. */
const budgetAt = (used: number) => {
  const b = new RequestBudget({ perHour: 120, maxConcurrent: 4, reservePct: 30 })
  useBudget(b, used)
  return b
}
const portsOf = (budget: Pick<AiPorts['budget'], 'fits' | 'reserve'>) => () => ({ budget }) as unknown as AiPorts

describe('budget policy', () => {
  it('[capture/read-budget] Budget class of a model action: classes', () => {
    assert.equal(budgetClass(null), 'routine')
    assert.equal(budgetClass(status({})), 'routine')
    assert.equal(budgetClass(status({ level: 'watch' })), 'routine')
    assert.equal(budgetClass(status({ level: 'critical', source: 'order' })), 'critical')
    assert.equal(budgetClass(status({ suggested: 'critical' })), 'critical')
    assert.equal(budgetClass(status({ suggested: 'watch' })), 'routine')
  })

  it('[capture/read-budget] Read mode fits the budget: every row of the plan table', () => {
    const room = budgetAt(0)
    const rows: [ActionKind, 'sam+spark' | 'spark' | null, { mode: string | null; requests: number; peak: number }][] = [
      ['read', 'sam+spark', { mode: 'sam+spark', requests: 3, peak: 2 }],
      ['read', 'spark', { mode: 'spark', requests: 1, peak: 1 }],
      ['meal', 'sam+spark', { mode: 'sam+spark', requests: 3, peak: 2 }],
      ['meal', 'spark', { mode: 'spark', requests: 1, peak: 1 }],
      ['voice', null, { mode: null, requests: 2, peak: 1 }],
      ['note', null, { mode: null, requests: 1, peak: 1 }],
      ['explain', null, { mode: null, requests: 1, peak: 1 }],
    ]
    for (const [kind, wanted, want] of rows) {
      for (const cls of ['critical', 'routine'] as const) {
        const p = plan(kind, wanted, cls === 'critical' ? status({ level: 'critical' }) : null, room)
        assert.deepEqual({ mode: p.mode, requests: p.requests, peak: p.peak }, want, `${kind} ${wanted} ${cls}`)
        assert.equal(p.priority, cls === 'critical' ? 'high' : 'normal')
        assert.equal(p.downgraded, false)
      }
    }
  })

  it('[capture/read-budget] Served tray reads fit the budget: every row of the served plan table', () => {
    // A watch bed (routine, out of budget pressure). [requests in use, wanted, served comparable] → mode, requests, peak,
    // compare, uncompared, downgraded (routine ceiling 84)
    const rows: [number, 'sam+spark' | 'spark', boolean, [string, number, number, boolean, boolean, boolean]][] = [
      [79, 'sam+spark', true, ['sam+spark', 5, 2, true, false, false]],
      [80, 'sam+spark', true, ['sam+spark', 3, 2, false, true, false]],
      [81, 'sam+spark', true, ['sam+spark', 3, 2, false, true, false]],
      [82, 'sam+spark', true, ['spark', 1, 1, false, false, true]],
      [83, 'sam+spark', true, ['spark', 1, 1, false, false, true]],
      [84, 'sam+spark', true, ['spark', 1, 1, false, false, false]],
      [79, 'sam+spark', false, ['sam+spark', 3, 2, false, false, false]],
      [80, 'sam+spark', false, ['sam+spark', 3, 2, false, false, false]],
      [0, 'spark', true, ['spark', 1, 1, false, false, false]],
    ]
    for (const [used, wanted, served, want] of rows) {
      const p = plan('meal', wanted, status({ level: 'watch' }), budgetAt(used), { served })
      assert.deepEqual([p.mode, p.requests, p.peak, p.compare, p.uncompared, p.downgraded], want, `${used} ${wanted} ${served}`)
    }
    // A photo read never compares, whatever it is told.
    assert.equal(plan('read', 'sam+spark', null, budgetAt(0), { served: true }).requests, 3)
  })

  it('[capture/read-budget] Read mode fits the budget: edges of each ceiling', async () => {
    const cases: [number, 'critical' | 'routine', 'sam+spark' | 'spark' | 'refused'][] = [
      [81, 'routine', 'sam+spark'],
      [82, 'routine', 'spark'],
      [83, 'routine', 'spark'],
      [84, 'routine', 'refused'],
      [117, 'critical', 'sam+spark'],
      [118, 'critical', 'spark'],
      [119, 'critical', 'spark'],
      [120, 'critical', 'refused'],
    ]
    for (const [used, cls, want] of cases) {
      const b = budgetAt(used)
      const st = status({ level: cls === 'critical' ? 'critical' : 'watch' })
      let ran: { mode: string; left: number } | null = null
      const r = await withBudget('read', { mode: 'sam+spark', status: st }, portsOf(b), (mode, ticket) => {
        ran = { mode, left: ticket.left }
        return Promise.resolve({ warnings: ['x'] })
      }).catch((e: unknown) => e)
      if (want === 'refused') {
        assert.ok(r instanceof MetaBudgetError && r.limit === 'hourly', `${used}`)
        assert.equal(ran, null)
      } else {
        assert.deepEqual(ran, { mode: want, left: want === 'sam+spark' ? 3 : 1 }, `${used}`)
        assert.deepEqual((r as { warnings: string[] }).warnings, want === 'spark' ? [BUDGET_PRESSURE, 'x'] : ['x'])
      }
      assert.equal(b.stats().held, 0)
    }
  })

  it('[capture/read-budget] Read mode fits the budget: one free in-flight slot refuses, not downgrades', async () => {
    const b = budgetAt(10)
    const held = [b.acquire(), b.acquire(), b.acquire()]
    let ran = false
    const err = await withBudget('read', { mode: 'sam+spark', status: status({ level: 'critical' }) }, portsOf(b), () => {
      ran = true
      return Promise.resolve({ warnings: [] })
    }).catch((e: unknown) => e)
    held.forEach((r) => r())
    assert.ok(err instanceof MetaBudgetError)
    assert.deepEqual([err.limit, err.retryAfterMs, err.priority], ['concurrent', 5000, 'high'])
    assert.equal(ran, false)
  })

  it('[capture/read-budget] Whole action admitted up front: the ticket is released once, on success and on error', async () => {
    for (const fail of [false, true]) {
      const releases: number[] = []
      const fake = {
        fits: () => true,
        reserve: (requests: number): Ticket => ({
          priority: 'normal',
          left: requests,
          take: () => () => {},
          release: () => void releases.push(requests),
        }),
      }
      const r = await withBudget('voice', { mode: null, status: null }, portsOf(fake), () =>
        fail ? Promise.reject(new Error('upstream')) : Promise.resolve('ok'),
      ).catch((e: unknown) => e)
      assert.deepEqual(releases, [2])
      if (fail) assert.ok(r instanceof Error)
      else assert.equal(r, 'ok')
    }
  })

  it('[capture/read-budget] Reads under budget pressure: edges of the pressure point', () => {
    // A cap of 120 at the default 50 %: the pressure point is 60.
    const stable = status({})
    const rows: [number, 'read' | 'meal', AcuityStatus | null, boolean, [string, number, boolean]][] = [
      [59, 'read', stable, false, ['sam+spark', 3, false]],
      [60, 'read', stable, false, ['spark', 1, true]],
      [59, 'meal', null, false, ['sam+spark', 3, false]],
      [60, 'meal', null, false, ['spark', 1, true]],
      [60, 'meal', stable, false, ['spark', 1, true]],
      [59, 'meal', stable, true, ['sam+spark', 5, false]],
      [60, 'meal', stable, true, ['spark', 1, true]],
      [60, 'read', status({ level: 'watch' }), false, ['sam+spark', 3, false]],
      [60, 'meal', status({ level: 'critical', source: 'order' }), true, ['sam+spark', 5, false]],
      [60, 'read', status({ suggested: 'watch' }), false, ['sam+spark', 3, false]],
      [60, 'read', status({ suggested: 'critical' }), false, ['sam+spark', 3, false]],
    ]
    for (const [used, kind, st, served, want] of rows) {
      const p = plan(kind, 'sam+spark', st, budgetAt(used), { served })
      assert.deepEqual([p.mode, p.requests, p.downgraded], want, `${used} ${kind} ${JSON.stringify(st)} ${served}`)
    }
    // A requested `spark` read is never "downgraded", and the point follows the configured percent.
    assert.equal(plan('read', 'spark', stable, budgetAt(60)).downgraded, false)
    assert.equal(plan('read', 'sam+spark', stable, budgetAt(60), { pressurePct: 51 }).requests, 3)
    assert.equal(plan('read', 'sam+spark', stable, budgetAt(61), { pressurePct: 51 }).requests, 1)
  })
})
