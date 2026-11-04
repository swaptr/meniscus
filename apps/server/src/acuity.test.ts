import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AcuityStatus, AdmissionSummary, CareOrder, EntryInput, EntryList, HospitalSummary } from '@meniscus/shared'
import { testApp, testStore, upstream } from './testing.ts'

/** Local time on `d` Nov 2026. */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const RAVI = 1
const ANITA = 4

/** The demo store opened at `openedAt`; the clock then moves with `at`. */
async function setup(openedAt = nov(3, 8)) {
  const clock = { t: openedAt }
  const u = upstream()
  const store = await testStore(() => clock.t)
  const { request } = await testApp({ ai: u.ai, store })
  const call = async <T>(method: string, path: string, body?: unknown, staff = ANITA) => {
    const res = await request(
      path,
      { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) },
      { staff },
    )
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const summary = async (id: number) => (await call<AdmissionSummary[]>('GET', '/api/admissions')).body.find((a) => a.id === id)!
  const list = async (id: number) => (await call<EntryList>('GET', `/api/admissions/${id}/entries`)).body
  /** The bed's acuity on both chart reads, asserted equal. */
  const acuity = async (id: number): Promise<AcuityStatus> => {
    const a = (await summary(id)).acuity
    assert.deepEqual((await list(id)).acuity, a)
    return a
  }
  const put = (id: number, body: unknown, staff = ANITA) => call<CareOrder>('PUT', `/api/admissions/${id}/care/acuity`, body, staff)
  const end = (id: number, staff = ANITA) => call<CareOrder>('DELETE', `/api/admissions/${id}/care/acuity`, undefined, staff)
  const approved = async (id: number, e: Partial<EntryInput>) => {
    const r = await call<{ id: number }>('POST', `/api/admissions/${id}/entries`, {
      direction: 'in',
      category: 'water',
      volume_ml: 200,
      source: 'manual',
      ...e,
    })
    assert.equal(r.status, 201)
    assert.equal((await call('POST', `/api/entries/${r.body.id}/review`, { action: 'approve' })).status, 200)
  }
  const at = (ms: number) => void (clock.t = ms)
  return { u, store, call, bed, summary, list, acuity, put, end, approved, at }
}

describe('acuity', () => {
  it('[charting/acuity] Ward default acuity: Demo defaults', async () => {
    const t = await setup()
    const { wards } = (await t.call<HospitalSummary>('GET', '/api/wards')).body
    assert.deepEqual(Object.fromEntries(wards.map((w) => [w.code, w.default_acuity])), {
      '2C': 'stable',
      '3A': 'stable',
      '5B': 'stable',
      HDU: 'critical',
    })
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/acuity] Acuity order: Acuity values', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const hdu3 = await t.bed('HDU', '3')
    const bed4 = await t.bed('3A', '4')
    const ok = await t.put(hdu3, { level: 'critical' })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.kind, 'acuity')
    assert.deepEqual(ok.body.value, { level: 'critical' })
    for (const body of [{ level: 'urgent' }, { level: 'Critical' }, {}]) {
      const r = await t.put(bed4, body)
      assert.equal(r.status, 400)
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.deepEqual(
      (await t.list(bed4)).care_history.filter((o) => o.kind === 'acuity'),
      [],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/acuity] Acuity order: Attendant cannot set it', async () => {
    const t = await setup()
    const bed4 = await t.bed('3A', '4')
    const r = await t.put(bed4, { level: 'critical' }, RAVI)
    assert.equal(r.status, 403)
    assert.equal(r.body.error, 'forbidden')
    assert.equal((await t.acuity(bed4)).source, 'ward')
    assert.deepEqual((await t.list(bed4)).care_history, [])
  })

  it('[charting/acuity] Acuity on chart reads: Ward default', async () => {
    const t = await setup()
    t.at(nov(3, 9))
    const none = { source: 'ward', order_id: null, suggested: null, reasons: [] }
    assert.deepEqual(await t.acuity(await t.bed('HDU', '1')), { level: 'critical', ...none })
    assert.deepEqual(await t.acuity(await t.bed('3A', '4')), { level: 'stable', ...none })
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/acuity] Acuity on chart reads: Order overrides the ward', async () => {
    const t = await setup()
    const bed4 = await t.bed('3A', '4')
    t.at(nov(3, 10))
    const order = await t.put(bed4, { level: 'watch' })
    assert.equal(order.status, 201)
    t.at(nov(3, 11))
    assert.deepEqual(await t.acuity(bed4), { level: 'watch', source: 'order', order_id: order.body.id, suggested: null, reasons: [] })
    t.at(nov(3, 12))
    assert.equal((await t.end(bed4)).status, 200)
    t.at(nov(3, 12, 1))
    const after = await t.acuity(bed4)
    assert.deepEqual([after.level, after.source, after.order_id], ['stable', 'ward', null])
    const ended = (await t.list(bed4)).care_history.find((o) => o.id === order.body.id)
    assert.equal(ended?.end_at, iso(nov(3, 12)))
  })

  it('[charting/acuity] Suggested acuity: Suggested, not applied', async () => {
    const t = await setup(nov(3, 2))
    const bed2 = await t.bed('3A', '2')
    t.at(nov(3, 9))
    await t.approved(bed2, { direction: 'out', category: 'urine', volume_ml: 100, charted_at: iso(nov(3, 5)) })
    await t.approved(bed2, { charted_at: iso(nov(3, 5)) })
    t.at(nov(3, 10))
    const kinds = (await t.summary(bed2)).alerts.map((a) => a.kind)
    assert.ok(kinds.includes('low_urine_output') && kinds.includes('logging_gap'), kinds.join())
    assert.deepEqual(await t.acuity(bed2), {
      level: 'stable',
      source: 'ward',
      order_id: null,
      suggested: 'critical',
      reasons: ['low_urine_output'],
    })
    assert.deepEqual((await t.list(bed2)).care_history, [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/acuity] Suggested acuity: Nurse confirms', async () => {
    const t = await setup(nov(3, 2))
    const bed2 = await t.bed('3A', '2')
    t.at(nov(3, 10))
    assert.equal((await t.acuity(bed2)).suggested, 'critical')
    const r = await t.put(bed2, { level: 'critical' })
    assert.equal(r.status, 201)
    assert.deepEqual(await t.acuity(bed2), { level: 'critical', source: 'order', order_id: r.body.id, suggested: null, reasons: [] })
  })

  it('[charting/acuity] Suggested acuity: Never a step down', async () => {
    const t = await setup(nov(2, 8))
    const hdu2 = await t.bed('HDU', '2')
    // Intake and enough urine charted through the day, so the bed has no prompt.
    for (let h = 9; h <= 31; h += 2) {
      const at = nov(2, h)
      t.at(at)
      await t.approved(hdu2, { volume_ml: 100, charted_at: iso(at) })
      await t.approved(hdu2, { direction: 'out', category: 'urine', volume_ml: 100, charted_at: iso(at) })
    }
    t.at(nov(3, 8))
    assert.deepEqual((await t.summary(hdu2)).alerts, [])
    const a = await t.acuity(hdu2)
    assert.deepEqual([a.level, a.suggested, a.reasons], ['critical', null, []])
  })

  it('[charting/acuity] Suggested acuity: Amber on a stable bed', async () => {
    const t = await setup(nov(3, 2))
    const c1 = await t.bed('2C', '1')
    const b1 = await t.bed('5B', '1')
    t.at(nov(3, 3))
    assert.equal((await t.put(b1, { level: 'watch' })).status, 201)
    // Enough urine in the window, so the only prompt is the logging gap.
    t.at(nov(3, 6))
    for (const id of [c1, b1]) await t.approved(id, { direction: 'out', category: 'urine', volume_ml: 400, charted_at: iso(nov(3, 6)) })
    t.at(nov(3, 9))
    for (const id of [c1, b1])
      assert.deepEqual(
        (await t.summary(id)).alerts.map((a) => a.kind),
        ['logging_gap'],
      )
    const c = await t.acuity(c1)
    assert.deepEqual([c.suggested, c.reasons], ['watch', ['logging_gap']])
    const b = await t.acuity(b1)
    assert.deepEqual([b.level, b.suggested, b.reasons], ['watch', null, []])
  })
})
