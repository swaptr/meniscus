import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bottomItems, sections } from './nav.ts'
import { createSnapshot, EMPTY } from './snapshot.ts'
import { ALERT_TONE } from './labels.ts'
import { wardLoads, wardOrder } from './ward.ts'
import { alert, bedSummary } from './ward-fixtures.ts'
import { ANITA, RAVI, SANA, WARD, fakeServer } from './staff-fixtures.ts'

const tone = (b: { alerts: { kind: keyof typeof ALERT_TONE }[] }) => (b.alerts[0] ? ALERT_TONE[b.alerts[0].kind] : null)

describe('sidebar sections', () => {
  it('[web/interface] Sidebar sections and links: Nurse on 3A', () => {
    const s = sections(ANITA, { pathname: '/n/w/2' }, EMPTY)
    assert.deepEqual(
      s.map((x) => x.title),
      ['Capture', 'Wards', 'This ward', 'Insights'],
    )
    assert.deepEqual(
      s[1]!.links.map((l) => l.label),
      ['3A', '5B', 'All wards'],
    )
    assert.equal(s[1]!.links[0]!.current, true)
    assert.ok(!s.some((x) => x.title === 'Nutrition'))
    // A dietitian gets Nutrition and no ward tools.
    const d = sections(SANA, { pathname: '/d' }, EMPTY)
    assert.deepEqual(
      d.map((x) => x.id),
      ['capture', 'wards', 'nutrition'],
    )
    assert.equal(d.at(-1)!.links[0]!.current, true)
  })

  it("[web/interface] Sidebar sections and links: Counts from the page's own load", async () => {
    const beds = [
      bedSummary(1, { pending: 3 }),
      bedSummary(2, { alerts: [alert('overload')], pending: 2 }),
      bedSummary(3, { alerts: [alert('low_urine_output')], pending: 3 }),
      bedSummary(4),
      bedSummary(5, { alerts: [alert('logging_gap')] }),
    ]
    const f = fakeServer({
      live: ANITA,
      routes: {
        'GET /api/admissions\\?ward=2': () => Response.json(beds),
        'GET /api/wards/2/team': () => Response.json({ ward_id: 2, in_charge: null, members: [], assignments: [] }),
      },
    })
    await f.session.check()
    const load = wardLoads(f.api, 2)
    const signal = new AbortController().signal
    const [loaded] = await Promise.all([load.beds(signal), load.team(signal)])
    const snap = createSnapshot()
    snap.writeWard(2, wardOrder(loaded), Date.now(), tone)
    const s = sections(ANITA, { pathname: '/n/w/2' }, snap.get())
    const thisWard = s.find((x) => x.id === 'this-ward')!
    assert.deepEqual(
      thisWard.links.map((l) => l.label),
      ['Bed 2', 'Bed 3', 'Bed 5', 'Data quality', 'QR cards'],
    )
    assert.deepEqual(s.find((x) => x.id === 'wards')!.links[0]!.pips, { pending: 8, review: 3, tone: 'danger' })
    assert.match(s.find((x) => x.id === 'wards')!.title, /^Wards · as of \d\d:\d\d$/)
    assert.deepEqual(
      f.reqs().filter((r) => r !== 'GET /api/session'),
      ['GET /api/admissions?ward=2', 'GET /api/wards/2/team'],
    )
  })

  it('[web/interface] Sidebar sections and links: Not yet loaded', () => {
    const s = sections(ANITA, { pathname: '/a' }, EMPTY)
    const wards = s.find((x) => x.id === 'wards')!
    assert.equal(wards.title, 'Wards')
    assert.ok(wards.links.every((l) => l.pips === undefined))
    assert.equal(s[0]!.links[0]!.current, true)
    assert.equal(s[0]!.links[1]!.href, `/a/round?ward=${WARD['3A'].id}`)
  })
})

describe('bottom bar', () => {
  it('[web/interface] Navigation on phones: More drawer', () => {
    assert.deepEqual(
      bottomItems(ANITA).map((i) => i.label),
      ['Capture', 'Wards', 'More'],
    )
    assert.deepEqual(
      bottomItems(SANA).map((i) => i.label),
      ['Capture', 'Wards', 'Nutrition', 'More'],
    )
    // The drawer shows the sidebar's sections; Data quality on a bed review goes to its ward's view.
    const snap = createSnapshot()
    snap.writeBedWard(2)
    const quality = sections(ANITA, { pathname: '/n/10' }, snap.get())
      .find((x) => x.id === 'this-ward')!
      .links.find((l) => l.label === 'Data quality')!
    assert.equal(quality.href, '/n/w/2?view=quality')
  })

  it('[web/interface] Navigation on phones: Attendant', () => {
    assert.deepEqual(bottomItems(RAVI), [])
  })
})
