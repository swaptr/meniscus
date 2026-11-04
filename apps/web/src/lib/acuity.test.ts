import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AcuityStatus, CareOrder, CareStatus, EntryList, StaffRef } from '@meniscus/shared'
import { CARE_LABEL } from '@meniscus/shared'
import { acuityChips, acuityRequest, acuityView, applyAcuity } from './acuity.ts'
import { createApi } from './api.ts'
import { addableKinds, careBadges, carePlanView } from './care.ts'
import { canDecide } from './staff.ts'
import { bedLoad } from './ward.ts'

const ANITA: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }
const RAVI: StaffRef = { id: 1, name: 'Ravi Kumar', role: 'attendant' }
/** 3 Nov 2026 at hh:mm local, as ISO. */
const iso = (h: number, m = 0) => new Date(2026, 10, 3, h, m).toISOString()
const NOW = Date.parse(iso(11))

const status = (over: Partial<AcuityStatus> = {}): AcuityStatus => ({
  level: 'stable',
  source: 'ward',
  order_id: null,
  suggested: null,
  reasons: [],
  ...over,
})
const SUGGESTED = status({ suggested: 'critical', reasons: ['low_urine_output'] })
const CRITICAL_ORDER = status({ level: 'critical', source: 'order', order_id: 40 })
const acuityOrder = (level: 'critical' | 'watch', over: Partial<CareOrder> = {}): CareOrder =>
  ({
    id: 40,
    admission_id: 12,
    kind: 'acuity',
    value: { level },
    start_at: iso(10),
    end_at: null,
    set_by: ANITA,
    ended_by: null,
    ...over,
  }) as CareOrder
const care = (orders: CareOrder[]): CareStatus => ({ orders, fluid_limit: null, intake_target: null, catheter: null })

/** Fake server: records "METHOD path" and the JSON body, and answers from `routes` (404 otherwise). */
function fake(routes: Record<string, (body: unknown) => Response>) {
  const calls: string[] = []
  const bodies: unknown[] = []
  const api = createApi(
    (url, init) => {
      const key = `${init?.method ?? 'GET'} ${url}`
      calls.push(key)
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null)
      const hit = Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(key))
      return Promise.resolve(hit ? hit[1](bodies.at(-1)) : Response.json({ error: 'not_found' }, { status: 404 }))
    },
    () => ANITA.id,
  )
  return { api, calls, bodies }
}
const chart = (acuity: AcuityStatus) => ({ acuity, care: care([]), care_history: [] }) as unknown as EntryList
const signal = new AbortController().signal

/** The bed review of admission 12 answering with `states` in turn (the opening load, then each reload). */
function review(states: AcuityStatus[], method: 'PUT' | 'DELETE' = 'PUT') {
  let n = 0
  const f = fake({
    'GET /api/admissions/12/entries': () => Response.json(chart(states[Math.min(n++, states.length - 1)]!)),
    'GET /api/admissions/12/meals': () => Response.json([]),
    [`${method} /api/admissions/12/care/acuity`]: () => Response.json(acuityOrder('critical'), { status: method === 'PUT' ? 201 : 200 }),
  })
  return { ...f, load: bedLoad(f.api, 12) }
}

describe('acuity on bed cards', () => {
  it('[web/ward] Acuity on bed cards: Chips', () => {
    const bed4 = acuityChips(status({ suggested: 'critical', reasons: ['low_urine_output'] }))
    assert.deepEqual(bed4.level, { text: 'Stable', tone: 'neutral' })
    assert.deepEqual(bed4.suggestion, { text: 'Suggested critical · Review', reasons: 'Low output' })
    assert.deepEqual(acuityChips(status({ level: 'critical', source: 'order' })), {
      level: { text: 'Critical', tone: 'danger' },
      suggestion: null,
    })
    assert.deepEqual(acuityChips(status({ level: 'watch', source: 'order' })).level, { text: 'Watch', tone: 'warn' })
    for (const s of [status(), status(), status()])
      assert.deepEqual(acuityChips(s), { level: { text: 'Stable', tone: 'neutral' }, suggestion: null })
  })

  it('[web/ward] Care badges on bed cards: Acuity is not a care badge', () => {
    const c = care([acuityOrder('critical'), { ...acuityOrder('critical'), id: 41, kind: 'nil_by_mouth', value: { until: null } }])
    assert.deepEqual(careBadges(c, NOW), ['NBM'])
    assert.equal(acuityChips(CRITICAL_ORDER).level.text, 'Critical')
  })
})

describe('acuity on the bed review', () => {
  it('[web/ward] Set or confirm acuity on the bed review: Confirm a suggestion', async () => {
    const r = review([SUGGESTED, CRITICAL_ORDER])
    const opened = await r.load(signal)
    const before = acuityView(opened.acuity, canDecide(ANITA))
    assert.equal(before.label, 'Stable · Ward default')
    assert.equal(before.suggestion, 'Suggested critical: Low output. Review')
    assert.equal(before.controls?.confirm, 'critical')
    assert.ok(!r.calls.some((c) => c.startsWith('PUT')))
    const change = acuityRequest(opened.acuity, before.controls.confirm)
    let after = opened
    const done = await applyAcuity(r.api, 12, change!, async () => (after = await r.load(signal)))
    assert.equal(done.ok, true)
    assert.deepEqual(r.calls.slice(2), [
      'PUT /api/admissions/12/care/acuity',
      'GET /api/admissions/12/entries',
      'GET /api/admissions/12/meals',
    ])
    assert.deepEqual(r.bodies[2], { level: 'critical' })
    assert.ok(r.calls.every((c) => !c.includes('/api/ai')))
    assert.equal(acuityView(after.acuity, true).label, 'Critical · Order')
  })

  it('[web/ward] Set or confirm acuity on the bed review: Set Watch', async () => {
    const r = review([status(), status({ level: 'watch', source: 'order', order_id: 41 })])
    const opened = await r.load(signal)
    assert.equal(acuityView(opened.acuity, true).controls?.value, 'ward')
    let after = opened
    await applyAcuity(r.api, 12, acuityRequest(opened.acuity, 'watch')!, async () => (after = await r.load(signal)))
    assert.deepEqual(r.calls.slice(2), [
      'PUT /api/admissions/12/care/acuity',
      'GET /api/admissions/12/entries',
      'GET /api/admissions/12/meals',
    ])
    assert.equal(r.calls.filter((c) => c.startsWith('PUT')).length, 1)
    assert.deepEqual(r.bodies[2], { level: 'watch' })
    assert.ok(r.calls.every((c) => !c.includes('/api/ai')))
    assert.equal(acuityView(after.acuity, true).label, 'Watch · Order')
  })

  it('[web/ward] Set or confirm acuity on the bed review: Back to the ward default', async () => {
    const r = review([CRITICAL_ORDER, status()], 'DELETE')
    const opened = await r.load(signal)
    assert.equal(acuityView(opened.acuity, true).controls?.value, 'critical')
    let after = opened
    await applyAcuity(r.api, 12, acuityRequest(opened.acuity, 'ward')!, async () => (after = await r.load(signal)))
    assert.deepEqual(r.calls.slice(2), [
      'DELETE /api/admissions/12/care/acuity',
      'GET /api/admissions/12/entries',
      'GET /api/admissions/12/meals',
    ])
    assert.equal(acuityView(after.acuity, true).label, 'Stable · Ward default')
    // Picking what is already in force sends nothing.
    assert.equal(acuityRequest(status(), 'ward'), null)
    assert.equal(acuityRequest(CRITICAL_ORDER, 'critical'), null)
  })

  it('[web/ward] Set or confirm acuity on the bed review: Attendant sees it read-only', () => {
    const v = acuityView(SUGGESTED, canDecide(RAVI))
    assert.equal(v.label, 'Stable · Ward default')
    assert.equal(v.suggestion, 'Suggested critical: Low output. Review')
    assert.equal(v.controls, null)
  })

  it('[web/ward] Care plan on the bed review: Acuity in its own row', () => {
    const order = acuityOrder('critical')
    const v = carePlanView(care([order]), [order], NOW)
    assert.equal(v.empty, 'No care orders')
    assert.deepEqual(v.rows, [])
    assert.deepEqual(v.history, ['Acuity critical · 10:00–now · set by Anita T.'])
  })

  it('[web/ward] Change care orders from the bed review: Acuity not offered here', () => {
    assert.deepEqual(addableKinds(care([acuityOrder('watch')]), { role: 'nurse' }), [
      'nil_by_mouth',
      'thickened_fluids',
      'fluid_limit',
      'intake_target',
      'catheter',
      'stoma',
      'drain',
      'voiding',
      'diet',
    ])
    // The add menu names `voiding` "Urine collection".
    assert.deepEqual(
      addableKinds(care([acuityOrder('watch')]), { role: 'nurse' }).map((k) => CARE_LABEL[k]),
      ['Nil by mouth', 'Thickened fluids', 'Fluid limit', 'Intake target', 'Catheter', 'Stoma', 'Drain', 'Urine collection', 'Diet'],
    )
  })
})
