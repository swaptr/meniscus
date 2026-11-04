import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BagLevel, NutritionWorklist, WardSummary, WorklistPatient } from '@meniscus/shared'
import { clock } from './format.ts'
import { dietitianNextUp, nextUp, wardsNextUp } from './next-up.ts'
import { alert, bedSummary } from './ward-fixtures.ts'
import { fakeServer, SANA } from './staff-fixtures.ts'

const NOW = new Date(2026, 10, 3, 22, 5).getTime()
const iso = (minFromNow: number) => new Date(NOW + minFromNow * 60_000).toISOString()
const urineBag = (dueIn: number, read = -240): BagLevel => ({
  container: 'urine_bag',
  level_ml: 1200,
  capacity_ml: 2000,
  read_at: iso(read),
  due_at: iso(dueIn),
})

describe('next up on the ward dashboard', () => {
  it('[web/ward] Next up on the ward dashboard: Ranked', () => {
    const beds = [
      bedSummary(1, { pending: 3 }),
      bedSummary(2, { bag_levels: [urineBag(12)] }),
      bedSummary(3),
      bedSummary(4, { alerts: [alert('low_urine_output')] }),
      bedSummary(6, { alerts: [alert('bag_reading_overdue')], bag_levels: [urineBag(-25)] }),
    ]
    const n = nextUp(beds, NOW, { wide: true })
    assert.deepEqual(
      n.items.map((i) => [i.bed, i.action]),
      [
        ['6', 'Bag reading'],
        ['4', 'Low output'],
        ['2', 'Bag reading'],
        ['1', 'Approve 3 entries'],
      ],
    )
    assert.deepEqual(
      n.items.map((i) => i.chip),
      ['Overdue', 'Review now', 'Due', '◷ 3'],
    )
    assert.equal(n.items[2]!.when, `due ${clock(NOW + 12 * 60_000)} · in 12 min`)
    assert.equal(n.items[0]!.href, '/n/106')
    assert.equal(n.items[3]!.href, '/n/101#waiting')
    assert.equal(n.head, '2 bag readings · 1 review now · 3 to approve')
    assert.equal(n.more, null)
  })

  it('[web/ward] Next up on the ward dashboard: Nothing due', () => {
    const n = nextUp([bedSummary(1), bedSummary(2)], NOW, { wide: true })
    assert.deepEqual(n.items, [])
    assert.equal(n.empty, 'Nothing due. 0 waiting for approval.')
  })

  it('[web/ward] Next up on the ward dashboard: Phone', () => {
    const beds = [1, 2, 3, 4, 5].map((b) => bedSummary(b, { pending: b }))
    const phone = nextUp(beds, NOW, { wide: false })
    assert.equal(phone.items.length, 3)
    assert.equal(phone.more, '2 more next up')
    // Most waiting first.
    assert.deepEqual(
      phone.items.map((i) => i.bed),
      ['5', '4', '3'],
    )
    const wide = nextUp(beds, NOW, { wide: true })
    assert.equal(wide.items.length, 5)
    assert.equal(wide.more, null)
  })

  it('intake target checks due within 60 min and behind are group 3; ties by acuity then bed', () => {
    const target = (ml: number) => ({
      since: iso(-600),
      ml,
      pending_ml: 0,
      of_ml: 1600,
      percent: 0,
      next_check: { at: iso(40), ml: 1200 },
    })
    const beds = [
      bedSummary(3, { care: { orders: [], fluid_limit: null, intake_target: target(900), catheter: null } }),
      bedSummary(5, { care: { orders: [], fluid_limit: null, intake_target: target(1300), catheter: null } }),
      bedSummary(7, { alerts: [alert('logging_gap')] }),
      bedSummary(8, {
        alerts: [alert('logging_gap')],
        acuity: { level: 'critical', source: 'order', order_id: 1, suggested: null, reasons: [] },
      }),
    ]
    const n = nextUp(beds, NOW, { wide: true })
    assert.deepEqual(
      n.items.map((i) => [i.bed, i.group]),
      [
        ['8', 2],
        ['7', 2],
        ['3', 3],
      ],
    )
  })
})

const ward = (id: number, code: string, review: number, pending: number): WardSummary => ({
  id,
  code,
  name: `Ward ${code}`,
  specialty: 'Medicine',
  capacity: 6,
  default_acuity: 'stable',
  occupied: 6,
  pending,
  beds_with_alerts: review,
  last_entry_at: null,
  in_charge: null,
  worst_tone: review ? 'warn' : null,
})

describe('next up on the nurse home', () => {
  it('[web/ward] Next up on the nurse home: Two wards', () => {
    const items = wardsNextUp([ward(1, '2C', 0, 0), ward(3, '5B', 0, 3), ward(2, '3A', 2, 8)])
    assert.deepEqual(
      items.map((i) => [i.label, i.href]),
      [
        ['3A · 2 to review · 8 pending', '/n/w/2'],
        ['5B · 0 to review · 3 pending', '/n/w/3'],
      ],
    )
  })
})

describe('next up on the worklist', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 3, h, m).toISOString()
  const patient = (bed: string, name: string, referredAt: string, status: 'open' | 'acknowledged'): WorklistPatient => ({
    admission: { ...bedSummary(Number(bed)), patient: name },
    nutrition: {
      dietitian_available: true,
      dietitian: null,
      referral: {
        id: Number(bed),
        admission_id: 100 + Number(bed),
        reason: 'poor_intake',
        note: null,
        status,
        created_at: referredAt,
        created_by: null,
        acknowledged_at: status === 'acknowledged' ? referredAt : null,
        acknowledged_by: null,
        closed_at: null,
        closed_by: null,
        outcome: null,
        next_review: null,
      },
    },
    diet: null,
    intake: { meals: 0, poor_meals: 0 },
  })
  const list = (patients: WorklistPatient[]): NutritionWorklist => ({ since: at(0, 0), patients, assigned: [], diets: [] })

  it('[web/dietitian] Next up on the worklist: Two open referrals', async () => {
    const w = list([patient('6', 'Priya Iyer', at(14, 5), 'open'), patient('7', 'Hugo Martin', at(12, 30), 'open')])
    const f = fakeServer({ live: SANA, routes: { 'GET /api/nutrition/worklist': () => Response.json(w) } })
    await f.session.check()
    const loaded = await f.api.worklist()
    const items = dietitianNextUp(loaded, new Date(2026, 10, 3, 15, 0).getTime())
    assert.deepEqual(
      items.map((i) => [i.title, i.detail, i.href]),
      [
        ['3A-7 · Hugo Martin', 'Referred 12:30 · Poor intake · 2 h ago', '/d/107'],
        ['3A-6 · Priya Iyer', 'Referred 14:05 · Poor intake · 55 min ago', '/d/106'],
      ],
    )
    assert.deepEqual(
      f.reqs().filter((r) => r !== 'GET /api/session'),
      ['GET /api/nutrition/worklist'],
    )
  })

  it('[web/dietitian] Next up on the worklist: All acknowledged', () => {
    const w = list([patient('6', 'Priya Iyer', at(14, 5), 'acknowledged')])
    assert.deepEqual(dietitianNextUp(w, Date.now()), [])
  })
})
