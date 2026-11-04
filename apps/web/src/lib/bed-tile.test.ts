import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bedPeek } from './bed-peek.ts'
import { bedTile } from './bed-tile.ts'
import { clock } from './format.ts'
import { wardLoads } from './ward.ts'
import { alert, bedSummary } from './ward-fixtures.ts'
import { fakeServer, GRACE } from './staff-fixtures.ts'

const at = (h: number, m: number) => new Date(2026, 10, 3, h, m).getTime()
const busy = () =>
  bedSummary(4, {
    patient: 'Mei Lin',
    acuity: { level: 'watch', source: 'order', order_id: 3, suggested: null, reasons: [] },
    alerts: [alert('low_urine_output')],
    pending: 2,
    totals: { in_ml: 1400, out_ml: 800, balance_ml: 600, pending_ml: 300 },
    devices: { urine: 'catheter', urine_from: 'catheter', urine_measured: true, bags: ['urine_bag'] },
    bag_levels: [
      {
        container: 'urine_bag',
        level_ml: 1680,
        capacity_ml: 2000,
        read_at: new Date(at(18, 40)).toISOString(),
        due_at: new Date(at(22, 20)).toISOString(),
      },
    ],
  })
const toilet = () =>
  bedSummary(7, {
    totals: { in_ml: 2400, out_ml: 0, balance_ml: 2400, pending_ml: 0 },
    devices: { urine: 'toilet', urine_from: 'voiding', urine_measured: false, bags: [] },
  })

describe('bed tiles', () => {
  it('[web/ward] Bed tile encodings: Busy bed', () => {
    const t = bedTile(busy(), at(22, 5))
    assert.equal(t.tone, 'danger')
    assert.equal(t.status, 'Review now')
    assert.equal(t.acuity.label, 'Watch')
    assert.equal(t.balance.text, '+600 mL')
    assert.deepEqual(
      t.bags.map((b) => [b.name, b.percent, b.due]),
      [['Urine bag', '84%', 'Due']],
    )
    assert.equal(t.pending, '◷ 2')
    assert.equal(t.href, '/n/104')
    assert.equal(t.peekLabel, 'About bed 4')
    assert.equal(bedTile(busy(), at(22, 21)).bags[0]!.due, 'Overdue')
  })

  it('[web/ward] Bed tile encodings: Urine not measured on the tile', () => {
    const t = bedTile(toilet(), at(22, 5))
    assert.equal(t.balance.text, '+2400 mL')
    assert.equal(t.balance.note, 'Urine not measured')
    assert.equal(t.balance.tone, 'neutral')
  })

  it('[web/ward] Bed tile encodings: No extra request', async () => {
    const f = fakeServer({
      live: GRACE,
      routes: {
        'GET /api/admissions\\?ward=3': () => Response.json([busy(), toilet()]),
        'GET /api/wards/3/team': () => Response.json({ ward_id: 3, in_charge: null, members: [], assignments: [] }),
      },
    })
    await f.session.check()
    const load = wardLoads(f.api, 3)
    const signal = new AbortController().signal
    const [beds] = await Promise.all([load.beds(signal), load.team(signal)])
    // Tiles and peeks draw from that one load.
    for (const b of beds) {
      bedTile(b, at(22, 5))
      bedPeek(b, at(22, 5))
    }
    assert.deepEqual(
      f.reqs().filter((r) => r !== 'GET /api/session'),
      ['GET /api/admissions?ward=3', 'GET /api/wards/3/team'],
    )
  })

  it('[web/interface] Actions never only in a peek: Bed tile', () => {
    const t = bedTile(busy(), at(22, 5))
    // The tile is a link to the bed; the peek opens from its own 44 px button, a sibling of that link.
    assert.equal(t.href, '/n/104')
    assert.equal(t.peekLabel, 'About bed 4')
    const p = bedPeek(busy(), at(22, 5))
    assert.deepEqual(
      p.links.map((l) => l.href),
      ['/n/104', '/n/104#waiting'],
    )
  })
})

describe('bed peek', () => {
  it('[web/ward] Bed peek on the ward dashboard: Peek', async () => {
    const f = fakeServer({ live: GRACE })
    await f.session.check()
    const before = f.reqs().length
    const p = bedPeek(busy(), at(22, 5))
    assert.deepEqual(p.prompts, ['Low urine output: review'])
    assert.equal(p.balance, 'In 1400 mL · Out 800 mL · Balance +600 mL')
    assert.deepEqual(p.bags, [`Urine bag 1680/2000 mL · due ${clock(at(22, 20))}`])
    assert.equal(p.pending, '2 waiting for approval')
    assert.equal(f.reqs().length, before, 'no request')
    assert.equal(bedPeek(toilet(), at(22, 5)).balance, 'In 2400 mL · Out 0 mL · Balance +2400 mL · Urine not measured')
  })
})
