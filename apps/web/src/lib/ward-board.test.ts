import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WardSummary } from '@meniscus/shared'
import { bedPeek } from './bed-peek.ts'
import { bedTile } from './bed-tile.ts'
import { matches } from './jump.ts'
import { sections } from './nav.ts'
import { nextUp } from './next-up.ts'
import { createSnapshot } from './snapshot.ts'
import { ANITA, fakeServer } from './staff-fixtures.ts'
import { BOARD_HEADERS, bedLayout, bedPromptTone, tileColumns, wardStats } from './ward-board.ts'
import { alert, bedSummary } from './ward-fixtures.ts'
import { wardRow, wardsScale } from './ward-home.ts'
import { tileByRecorder } from './quality-peek.ts'
import { wardLoads, wardOrder } from './ward.ts'

const NOW = new Date(2026, 10, 3, 22, 5).getTime()
const sevenBeds = () => [
  bedSummary(1, { pending: 3 }),
  bedSummary(2, { pending: 1 }),
  bedSummary(3, { alerts: [alert('catheter_review')] }),
  bedSummary(4, { alerts: [alert('low_urine_output')], pending: 2 }),
  bedSummary(5, { pending: 2 }),
  bedSummary(6, { alerts: [alert('poor_meal_intake')] }),
  bedSummary(7),
]
const team = { ward_id: 2, in_charge: null, members: [], assignments: [] }

describe('ward board', () => {
  it('[web/ward] Ward board on wide screens: Board', () => {
    const beds = wardOrder(sevenBeds())
    assert.equal(bedLayout(1280), 'board')
    assert.equal(bedLayout(1100), 'board')
    // One row per bed, in "Beds needing attention first" order, under the named headers.
    const rows = beds.map((b) => bedTile(b, NOW))
    assert.equal(rows.length, 7)
    assert.deepEqual(
      rows.map((r) => r.bed),
      ['3', '4', '6', '1', '2', '5', '7'],
    )
    assert.deepEqual(BOARD_HEADERS, ['Bed', 'Acuity', 'Status', 'Last 24 h', 'Balance', 'Bags', 'Pending', 'Care'])
  })

  it('[web/ward] Ward board on wide screens: Phone', () => {
    assert.equal(bedLayout(390), 'tiles')
    assert.equal(bedLayout(1099), 'tiles')
    // One tile per row at 390 px (the grid never forces a width past the viewport).
    assert.equal(tileColumns(390), 1)
    assert.equal(tileColumns(800), 2)
  })

  it('[web/ward] Metric peeks on stats: Ward pending', async () => {
    const f = fakeServer({
      live: ANITA,
      routes: {
        'GET /api/admissions\\?ward=2': () => Response.json(sevenBeds()),
        'GET /api/wards/2/team': () => Response.json(team),
      },
    })
    await f.session.check()
    const load = wardLoads(f.api, 2)
    const signal = new AbortController().signal
    const [beds] = await Promise.all([load.beds(signal), load.team(signal)])
    const stats = wardStats(wardOrder(beds))
    const pending = stats.find((x) => x.id === 'pending')!
    assert.equal(pending.label, '8 pending')
    assert.deepEqual(pending.lines, [
      { label: 'Bed 1 · Patient 1 · 3 pending', href: '/n/101' },
      { label: 'Bed 4 · Patient 4 · 2 pending', href: '/n/104' },
      { label: 'Bed 5 · Patient 5 · 2 pending', href: '/n/105' },
      { label: 'Bed 2 · Patient 2 · 1 pending', href: '/n/102' },
    ])
    assert.deepEqual(
      stats.map((x) => [x.label, x.value]),
      [
        ['Review now', '1'],
        ['Review', '1'],
        ['8 pending', '4'],
        ['Ward balance', '0'],
      ],
    )
    assert.deepEqual(
      f.reqs().filter((r) => r !== 'GET /api/session'),
      ['GET /api/admissions?ward=2', 'GET /api/wards/2/team'],
      'the peek reads the loaded beds',
    )
  })

  it('peeks, Next up, the sidebar and quick jump send nothing beyond the ward’s two loads', async () => {
    const f = fakeServer({
      live: ANITA,
      routes: {
        'GET /api/admissions\\?ward=2': () => Response.json(sevenBeds()),
        'GET /api/wards/2/team': () => Response.json(team),
      },
    })
    await f.session.check()
    const load = wardLoads(f.api, 2)
    const signal = new AbortController().signal
    const [loaded] = await Promise.all([load.beds(signal), load.team(signal)])
    const beds = wardOrder(loaded)
    const snap = createSnapshot()
    snap.writeWard(2, beds, NOW, bedPromptTone)
    for (const b of beds) {
      bedTile(b, NOW)
      bedPeek(b, NOW)
    }
    wardStats(beds)
    assert.ok(nextUp(beds, NOW, { wide: true }).items.length > 0)
    assert.ok(sections(ANITA, { pathname: '/n/w/2' }, snap.get()).length > 0)
    assert.ok(matches('bed 4', ANITA.wards, snap.get()).length > 0)
    assert.deepEqual(
      f.reqs().filter((r) => r !== 'GET /api/session'),
      ['GET /api/admissions?ward=2', 'GET /api/wards/2/team'],
    )
  })
})

const ward = (over: Partial<WardSummary>): WardSummary => ({
  id: 2,
  code: '3A',
  name: 'Medical Ward 3A',
  specialty: 'General medicine',
  capacity: 6,
  default_acuity: 'stable',
  occupied: 6,
  pending: 0,
  beds_with_alerts: 0,
  last_entry_at: null,
  in_charge: null,
  ...over,
})

describe('ward rows on the nurse home', () => {
  it('[web/ward] Ward cards drawn: 3A', async () => {
    const hourly = { in_ml: Array<number>(24).fill(0), out_ml: Array<number>(24).fill(0) }
    hourly.in_ml[23] = 200
    hourly.out_ml[22] = 300
    const w3a = ward({ pending: 3, beds_with_alerts: 2, worst_tone: 'warn', hourly })
    const f = fakeServer({ live: ANITA, routes: { 'GET /api/wards': () => Response.json({ hospital: 'Demo', wards: [w3a] }) } })
    await f.session.check()
    const h = await f.api.wards()
    const r = wardRow(h.wards[0]!, NOW)
    assert.equal(r.beds, '6/6 beds')
    assert.equal(r.pending, '3 pending')
    assert.equal(r.review, '2 to review')
    assert.equal(r.hourly.in_ml.length, 24)
    assert.equal(r.hourly.out_ml.length, 24)
    assert.equal(r.barsName, 'Last 24 hours: in 200 mL, out 300 mL')
    assert.equal(wardsScale(h.wards), 300)
    assert.deepEqual(r.tone, { tone: 'warn', label: 'Review' })
    assert.deepEqual(
      f.reqs().filter((x) => x !== 'GET /api/session'),
      ['GET /api/wards'],
    )
  })
})

describe('data quality tile peeks', () => {
  it('a Data quality tile’s peek lists its figure by recorder', () => {
    const recorders = [
      { staff: { id: 1, name: 'Ravi Kumar', role: 'attendant' as const }, recorded: 61, corrected: 1, amended: 0, late: 0, rejected: 1 },
      { staff: { id: 2, name: 'Sunita Devi', role: 'attendant' as const }, recorded: 52, corrected: 0, amended: 1, late: 0, rejected: 0 },
    ]
    assert.deepEqual(tileByRecorder({ recorders }, 'Entries'), ['Ravi Kumar · 61', 'Sunita Devi · 52'])
    assert.deepEqual(tileByRecorder({ recorders }, 'Amended'), ['Sunita Devi · 1'])
    assert.deepEqual(tileByRecorder({ recorders }, 'Late'), [])
    assert.equal(tileByRecorder({ recorders }, 'By hand'), null)
  })
})
