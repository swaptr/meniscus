import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  Entry,
  EntryEvent,
  EntryInput,
  EntryList,
  HospitalSummary,
  LevelResult,
  Staff,
  StaffRef,
  WardQuality,
} from '@meniscus/shared'
import type { Store } from './store/port.ts'
import { signIn, testApp, testStore, upstream, type RequestOptions } from './testing.ts'

const HOUR = 3_600_000
const MIN = 60_000
/** 2 Nov 2026, hh:mm UTC. */
const nov2 = (h: number, m = 0) => Date.UTC(2026, 10, 2, h, m)
const isoAt = (ms: number) => new Date(ms).toISOString()

/** The store opens (and admits every demo patient) at `admittedAt`; the clock then moves freely. */
async function setup(admittedAt = nov2(0), store?: Store) {
  const clock = { t: admittedAt }
  const s = store ?? (await testStore(() => clock.t))
  const u = upstream()
  const { request } = await testApp({ ai: u.ai, store: s })
  const json = async <T>(path: string, init: { body?: unknown; staff?: number | string; cookie?: string | null } = {}) => {
    const headers: Record<string, string> = {}
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.staff !== undefined) headers['x-staff-id'] = String(init.staff)
    const opts: RequestOptions = init.cookie !== undefined ? { cookie: init.cookie } : {}
    const res = await request(
      path,
      {
        method: init.body === undefined ? 'GET' : 'POST',
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      },
      opts,
    )
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const bed = async (n: string, ward = '5B') =>
    (await json<AdmissionSummary[]>('/api/admissions')).body.find((a) => a.bed === n && a.ward_code === ward)!.id
  const add = (admissionId: number, e: Partial<EntryInput> = {}, staff?: number | string, cookie?: string | null) =>
    json<Entry>(`/api/admissions/${admissionId}/entries`, {
      body: { direction: 'in', category: 'water', volume_ml: 200, source: 'manual', ...e },
      ...(staff !== undefined ? { staff } : {}),
      ...(cookie !== undefined ? { cookie } : {}),
    })
  const review = (entryId: number, body: object, staff?: number) =>
    json<Entry>(`/api/entries/${entryId}/review`, { body, ...(staff !== undefined ? { staff } : {}) })
  const amend = (entryId: number, body: object, staff?: number) =>
    json<Entry>(`/api/entries/${entryId}/amend`, { body, ...(staff !== undefined ? { staff } : {}) })
  const events = (entryId: number) => json<EntryEvent[]>(`/api/entries/${entryId}/events`)
  const list = async (admissionId: number) => (await json<EntryList>(`/api/admissions/${admissionId}/entries`)).body
  return { clock, store: s, u, json, bed, add, review, amend, events, list }
}

const RAVI: StaffRef = { id: 1, name: 'Ravi Kumar', role: 'attendant' }
const SUNITA: StaffRef = { id: 2, name: 'Sunita Devi', role: 'attendant' }
const ANITA: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }

describe('staff and attribution', () => {
  it('[charting/audit] Staff roster: Demo roster', async () => {
    const t = await setup()
    const res = await t.json<Staff[]>('/api/staff')
    assert.equal(res.status, 200)
    assert.equal(res.body.length, 11)
    assert.equal(res.body.filter((s) => s.role === 'attendant').length, 4)
    assert.equal(res.body.filter((s) => s.role === 'nurse').length, 5)
    assert.equal(res.body.filter((s) => s.role === 'matron').length, 1)
    assert.equal(res.body.filter((s) => s.role === 'dietitian').length, 1)
    const { wards, ...ravi } = res.body[0]!
    assert.deepEqual(ravi, RAVI)
    assert.deepEqual(
      wards.map((w) => w.code),
      ['3A', '2C'],
    )
    for (const s of res.body) {
      assert.ok(!('username' in s) && !('password_hash' in s), `credentials of ${s.id} returned`)
    }
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Chart changes are attributed: Recorded and reviewed', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id, {}, 1)
    assert.equal(e.status, 201)
    assert.deepEqual(e.body.created_by, RAVI)
    assert.equal(e.body.reviewed_by, null)
    const r = await t.review(e.body.id, { action: 'approve' }, 4)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.created_by, r.body.reviewed_by], [RAVI, ANITA])
    const listed = (await t.list(id)).entries[0]!
    assert.deepEqual([listed.created_by, listed.reviewed_by], [RAVI, ANITA])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Chart changes are attributed: Unknown staff', async () => {
    const t = await setup()
    const id = await t.bed('1')
    for (const staff of [999, 'abc', '0', '01', '1.5']) {
      const res = await t.add(id, {}, staff)
      assert.equal(res.status, 400, String(staff))
      assert.equal(res.body.error, 'invalid_request')
    }
    assert.equal((await t.list(id)).entries.length, 0)
    const ok = await t.add(id)
    const r = await t.review(ok.body.id, { action: 'approve' }, 999)
    assert.equal(r.status, 400)
    assert.equal((await t.list(id)).entries[0]!.status, 'pending')
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Chart changes are attributed: No staff sent', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id, {}, undefined, await signIn(t.store, 1))
    assert.equal(e.status, 201)
    assert.deepEqual(e.body.created_by, RAVI)
    const anonymous = await t.add(id, {}, undefined, null)
    assert.equal(anonymous.status, 401)
    assert.equal(anonymous.body.error, 'sign_in_required')
    assert.deepEqual(
      (await t.list(id)).entries.map((x) => x.id),
      [e.body.id],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Chart changes are attributed: Level attributed', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const level = (volume_ml: number) =>
      t.json<LevelResult>(`/api/admissions/${id}/levels`, { body: { container: 'water_jug', volume_ml, source: 'photo' }, staff: 2 })
    await level(1000)
    t.clock.t += HOUR
    const res = await level(600)
    assert.equal(res.status, 201)
    assert.equal(res.body.entry?.volume_ml, 400)
    assert.deepEqual(res.body.entry?.created_by, SUNITA)
    assert.deepEqual(t.u.requests, [])
  })
})

describe('entry history', () => {
  it('[charting/audit] Entry event history: Corrected then amended', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id, { direction: 'out', category: 'urine', volume_ml: 450, source: 'photo' }, 1)
    t.clock.t += 10 * MIN
    await t.review(e.body.id, { action: 'approve', volume_ml: 400 }, 4)
    t.clock.t += 10 * MIN
    await t.amend(e.body.id, { volume_ml: 380, reason: 're-measured with jug' }, 4)
    const res = await t.events(e.body.id)
    assert.equal(res.status, 200)
    assert.deepEqual(
      res.body.map((v) => [v.kind, v.from_ml, v.to_ml, v.by?.id ?? null, v.reason]),
      [
        ['recorded', null, 450, 1, null],
        ['corrected', 450, 400, 4, null],
        ['amended', 400, 380, 4, 're-measured with jug'],
      ],
    )
    assert.deepEqual(
      res.body.map((v) => v.at),
      [isoAt(nov2(0)), isoAt(nov2(0, 10)), isoAt(nov2(0, 20))],
    )
    assert.deepEqual(res.body[0]!.by, RAVI)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Entry event history: Unknown entry', async () => {
    const t = await setup()
    for (const path of ['/api/entries/999/events', '/api/entries/abc/events']) {
      const res = await t.json(path)
      assert.equal(res.status, 404)
      assert.equal(res.body.error, 'not_found')
    }
  })
})

describe('fixing records', () => {
  it('[charting/audit] Rejection reason: Duplicate', async () => {
    const t = await setup()
    const e = await t.add(await t.bed('1'), { source: 'photo' }, 1)
    const r = await t.review(e.body.id, { action: 'reject', reason: 'duplicate', note: 'same bag photographed twice' }, 4)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.status, r.body.reject_reason, r.body.reviewed_by], ['rejected', 'duplicate', ANITA])
    const last = (await t.events(e.body.id)).body.at(-1)!
    assert.deepEqual([last.kind, last.reason, last.note, last.by?.id], ['rejected', 'duplicate', 'same bag photographed twice', 4])
    const plain = await t.add(await t.bed('1'))
    assert.equal((await t.review(plain.body.id, { action: 'reject' })).body.reject_reason, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Rejection reason: Unknown reason', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id)
    for (const body of [
      { action: 'reject', reason: 'tired' },
      { action: 'approve', reason: 'duplicate' },
      { action: 'reject', reason: 'other', note: 'n'.repeat(201) },
    ]) {
      const r = await t.review(e.body.id, body)
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60))
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.equal((await t.list(id)).entries[0]!.status, 'pending')
  })

  it('[charting/audit] Amend an approved entry: Volume amended', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id, { volume_ml: 400 })
    await t.review(e.body.id, { action: 'approve' })
    t.clock.t += HOUR
    const r = await t.amend(e.body.id, { volume_ml: 380, reason: 're-measured with jug' }, 5)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.volume_ml, r.body.approved_ml, r.body.recorded_ml, r.body.amended_at], [380, 400, 400, isoAt(nov2(1))])
    const l = await t.list(id)
    assert.equal(l.totals.in_ml, 380)
    const typed = await t.amend(e.body.id, { category: 'food', reason: 'was soup, not water' })
    assert.equal(typed.status, 200)
    assert.deepEqual([typed.body.category, typed.body.volume_ml], ['food', 380])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Amend an approved entry: Colour corrected', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id, { direction: 'out', category: 'urine', volume_ml: 300, urine_colour: 'yellow', urine_rgb: '#ecd558' })
    await t.review(e.body.id, { action: 'approve' })
    t.clock.t += HOUR
    const r = await t.amend(e.body.id, { urine_colour: 'red', reason: 'rechecked the bag' }, 5)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.urine_colour, r.body.urine_rgb, r.body.amended_at, r.body.volume_ml], ['red', null, isoAt(nov2(1)), 300])
    const last = (await t.events(e.body.id)).body.at(-1)!
    assert.deepEqual([last.kind, last.from_colour, last.to_colour, last.reason], ['amended', 'yellow', 'red', 'rechecked the bag'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Amend an approved entry: Not approved', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id)
    const r = await t.amend(e.body.id, { volume_ml: 380, reason: 're-measured with jug' })
    assert.equal(r.status, 409)
    assert.equal(r.body.error, 'not_approved')
    const after = (await t.list(id)).entries[0]!
    assert.deepEqual([after.status, after.volume_ml, after.amended_at], ['pending', 200, null])
    const rejected = await t.add(id)
    await t.review(rejected.body.id, { action: 'reject' })
    assert.equal((await t.amend(rejected.body.id, { volume_ml: 380, reason: 're-measured' })).status, 409)
    const missing = await t.amend(999, { volume_ml: 380, reason: 're-measured with jug' })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error, 'not_found')
  })

  it('[charting/audit] Amend an approved entry: Invalid amendments', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const e = await t.add(id, { volume_ml: 400 })
    await t.review(e.body.id, { action: 'approve' })
    for (const body of [
      { volume_ml: 380 },
      { volume_ml: 380, reason: 'ok' },
      { category: 'urine', reason: 'was urine' },
      { volume_ml: 400, reason: 'same again' },
      { urine_colour: 'dark', reason: 'looks dark' },
    ]) {
      const r = await t.amend(e.body.id, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.body.error, 'invalid_request')
    }
    const after = (await t.list(id)).entries[0]!
    assert.deepEqual([after.volume_ml, after.category, after.amended_at], [400, 'water', null])
    assert.deepEqual(
      (await t.events(e.body.id)).body.map((v) => v.kind),
      ['recorded', 'approved'],
    )
  })
})

describe('drink consistency through amend', () => {
  /** An approved drink on 5B bed 6, at `iddsi_level` when given. */
  const approvedDrink = async (t: Awaited<ReturnType<typeof setup>>, over: Partial<EntryInput> = {}) => {
    const e = await t.add(await t.bed('6'), { volume_ml: 400, ...over })
    await t.review(e.body.id, { action: 'approve' })
    return e.body.id
  }
  const state = async (t: Awaited<ReturnType<typeof setup>>, entryId: number) => {
    const e = (await t.list(await t.bed('6'))).entries.find((x) => x.id === entryId)!
    return { level: e.iddsi_level, category: e.category, amended_at: e.amended_at, events: (await t.events(entryId)).body.length }
  }

  it("[charting/audit] Amend a drink's consistency: Consistency recorded", async () => {
    const t = await setup()
    const entryId = await approvedDrink(t)
    t.clock.t += HOUR
    const r = await t.amend(entryId, { iddsi_level: 2, reason: 'checked the cup' }, 4)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.iddsi_level, r.body.volume_ml, r.body.amended_at], [2, 400, isoAt(nov2(1))])
    const last = (await t.events(entryId)).body.at(-1)!
    assert.deepEqual([last.kind, last.from_iddsi, last.to_iddsi, last.reason, last.by], ['amended', null, 2, 'checked the cup', ANITA])
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/audit] Amend a drink's consistency: Consistency corrected", async () => {
    const t = await setup()
    const entryId = await approvedDrink(t, { iddsi_level: 0 })
    const r = await t.amend(entryId, { iddsi_level: 2, reason: 'thickener was added' }, 4)
    assert.equal(r.status, 200)
    assert.equal(r.body.iddsi_level, 2)
    const last = (await t.events(entryId)).body.at(-1)!
    assert.deepEqual([last.kind, last.from_iddsi, last.to_iddsi], ['amended', 0, 2])
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/audit] Amend a drink's consistency: Misplaced consistency", async () => {
    const t = await setup()
    const urine = await approvedDrink(t, { direction: 'out', category: 'urine', volume_ml: 300 })
    const drink = await approvedDrink(t)
    const level2 = await approvedDrink(t, { iddsi_level: 2 })
    const cases: [number, object][] = [
      [urine, { iddsi_level: 2, reason: 'checked the cup' }],
      [drink, { category: 'food', iddsi_level: 2, reason: 'it was soup' }],
      [drink, { iddsi_level: 5, reason: 'checked the cup' }],
      [level2, { iddsi_level: 2, reason: 'checked the cup' }],
    ]
    for (const [entryId, body] of cases) {
      const before = await state(t, entryId)
      const r = await t.amend(entryId, body, 4)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.body.error, 'invalid_request')
      assert.deepEqual(await state(t, entryId), before, JSON.stringify(body))
    }
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/audit] Amend a drink's consistency: Amend rules apply", async () => {
    const t = await setup()
    const approved = await approvedDrink(t)
    const pending = (await t.add(await t.bed('6'), { volume_ml: 400 })).body.id
    const body = { iddsi_level: 2, reason: 'checked the cup' }
    const a = await t.amend(approved, body, 1)
    assert.equal(a.status, 403)
    assert.equal(a.body.error, 'forbidden')
    const p = await t.amend(pending, body, 4)
    assert.equal(p.status, 409)
    assert.equal(p.body.error, 'not_approved')
    assert.deepEqual(await state(t, approved), { level: null, category: 'water', amended_at: null, events: 2 })
    assert.deepEqual(await state(t, pending), { level: null, category: 'water', amended_at: null, events: 1 })
    assert.deepEqual(t.u.requests, [])
  })
})

describe('drink kind through amend', () => {
  const approvedDrink = async (t: Awaited<ReturnType<typeof setup>>, over: Partial<EntryInput> = {}) => {
    const e = await t.add(await t.bed('6'), { volume_ml: 150, ...over })
    await t.review(e.body.id, { action: 'approve' })
    return e.body.id
  }
  const state = async (t: Awaited<ReturnType<typeof setup>>, entryId: number) => {
    const e = (await t.list(await t.bed('6'))).entries.find((x) => x.id === entryId)!
    return { drink: e.drink, category: e.category, amended_at: e.amended_at, events: (await t.events(entryId)).body.length }
  }

  it("[charting/audit] Amend a drink's kind: Tea was coffee", async () => {
    const t = await setup()
    const entryId = await approvedDrink(t, { drink: 'tea', item: 'masala chai' })
    t.clock.t += HOUR
    const r = await t.amend(entryId, { drink: 'coffee', reason: 'it was coffee' }, 4)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.drink, r.body.item, r.body.volume_ml, r.body.amended_at], ['coffee', 'Coffee', 150, isoAt(nov2(1))])
    const listed = (await t.list(await t.bed('6'))).entries.find((x) => x.id === entryId)!
    assert.deepEqual([listed.drink, listed.item], ['coffee', 'Coffee'])
    const last = (await t.events(entryId)).body.at(-1)!
    assert.deepEqual(
      [last.kind, last.from_drink, last.to_drink, last.from_item, last.to_item, last.reason, last.by],
      ['amended', 'tea', 'coffee', 'masala chai', 'Coffee', 'it was coffee', ANITA],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/audit] Amend a drink's kind: Drink amended to IV", async () => {
    const t = await setup()
    const entryId = await approvedDrink(t, { volume_ml: 100, drink: 'milk' })
    const r = await t.amend(entryId, { category: 'iv', reason: 'it was the IV flush' }, 4)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.category, r.body.drink], ['iv', null])
    const last = (await t.events(entryId)).body.at(-1)!
    assert.deepEqual([last.from_drink, last.to_drink], ['milk', null])
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/audit] Amend a drink's kind: Misplaced kind", async () => {
    const t = await setup()
    const urine = await approvedDrink(t, { direction: 'out', category: 'urine', volume_ml: 300 })
    const drink = await approvedDrink(t)
    const tea = await approvedDrink(t, { drink: 'tea' })
    const cases: [number, object][] = [
      [urine, { drink: 'tea', reason: 'checked the cup' }],
      [drink, { drink: 'lassi', reason: 'checked the cup' }],
      [tea, { drink: 'tea', reason: 'checked the cup' }],
      [drink, { category: 'iv', drink: 'tea', reason: 'checked the cup' }],
    ]
    for (const [entryId, body] of cases) {
      const before = await state(t, entryId)
      const r = await t.amend(entryId, body, 4)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.body.error, 'invalid_request')
      assert.deepEqual(await state(t, entryId), before, JSON.stringify(body))
    }
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/audit] Amend a drink's kind: Amend rules apply", async () => {
    const t = await setup()
    const approved = await approvedDrink(t, { drink: 'tea' })
    const pending = (await t.add(await t.bed('6'), { volume_ml: 150, drink: 'tea' })).body.id
    const body = { drink: 'juice', reason: 'checked the cup' }
    const a = await t.amend(approved, body, 1)
    assert.deepEqual([a.status, a.body.error], [403, 'forbidden'])
    const p = await t.amend(pending, body, 4)
    assert.deepEqual([p.status, p.body.error], [409, 'not_approved'])
    assert.deepEqual(await state(t, approved), { drink: 'tea', category: 'water', amended_at: null, events: 2 })
    assert.deepEqual(await state(t, pending), { drink: 'tea', category: 'water', amended_at: null, events: 1 })
    assert.deepEqual(t.u.requests, [])
  })
})

describe('late entries', () => {
  it('[charting/audit] Late entries: Late drink', async () => {
    const t = await setup()
    t.clock.t = nov2(14, 10)
    const e = await t.add(await t.bed('1'), { charted_at: isoAt(nov2(8)) })
    assert.equal(e.status, 201)
    assert.deepEqual([e.body.created_at, e.body.recorded_at, e.body.late], [isoAt(nov2(8)), isoAt(nov2(14, 10)), true])
    // Offsets other than Z are the same instant.
    const offset = await t.add(await t.bed('1'), { charted_at: '2026-11-02T13:30:00+05:30' })
    assert.equal(offset.body.created_at, isoAt(nov2(8)))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Late entries: On time', async () => {
    const t = await setup()
    t.clock.t = nov2(14, 10)
    const id = await t.bed('1')
    const a = await t.add(id, { charted_at: isoAt(nov2(13, 30)) })
    const b = await t.add(id)
    assert.deepEqual([a.status, a.body.late, b.status, b.body.late], [201, false, 201, false])
    assert.equal(b.body.created_at, b.body.recorded_at)
    // Exactly 60 minutes is not late.
    assert.equal((await t.add(id, { charted_at: isoAt(nov2(13, 10)) })).body.late, false)
    assert.equal((await t.add(id, { charted_at: isoAt(nov2(13, 9)) })).body.late, true)
  })

  it('[charting/audit] Late entries: Out of range', async () => {
    const t = await setup(nov2(0) - 48 * HOUR)
    t.clock.t = nov2(14, 10)
    const id = await t.bed('1')
    for (const charted_at of [isoAt(nov2(14, 30)), isoAt(nov2(14, 10) - 25 * HOUR), '2026-11-02T08:00:00', 'yesterday']) {
      const res = await t.add(id, { charted_at })
      assert.equal(res.status, 400, charted_at)
      assert.equal(res.body.error, 'invalid_request')
    }
    assert.equal((await t.list(id)).entries.length, 0)
    // Clock skew of up to a minute is allowed.
    assert.equal((await t.add(id, { charted_at: isoAt(nov2(14, 10) + 59_000) })).status, 201)
  })

  it('[charting/audit] Late entries: Before admission', async () => {
    const t = await setup(nov2(10))
    t.clock.t = nov2(14, 10)
    const res = await t.add(await t.bed('1'), { charted_at: isoAt(nov2(9)) })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid_request')
    assert.equal((await t.add(await t.bed('1'), { charted_at: isoAt(nov2(10)) })).status, 201)
  })

  it('[charting/entries] 24-hour totals: Late entry counts by its charted time', async () => {
    const t = await setup(nov2(0) - 48 * HOUR)
    const id = await t.bed('1')
    t.clock.t = nov2(9)
    const earlier = await t.add(id, { volume_ml: 100 })
    await t.review(earlier.body.id, { action: 'approve' })
    t.clock.t = nov2(14, 10)
    const late = await t.add(id, { volume_ml: 300, charted_at: isoAt(nov2(14, 10) - 23 * HOUR) })
    await t.review(late.body.id, { action: 'approve' })
    const l = await t.list(id)
    assert.equal(l.totals.in_ml, 400)
    assert.deepEqual(
      l.entries.map((e) => e.id),
      [earlier.body.id, late.body.id],
    )
  })
})

describe('ward data quality', () => {
  it('[charting/audit] Ward data quality: One of each', async () => {
    const t = await setup(Date.UTC(2026, 9, 31, 12))
    const wardId = (await t.json<HospitalSummary>('/api/wards')).body.wards.find((w) => w.code === '5B')!.id
    const bed1 = await t.bed('1')
    const bed2 = await t.bed('2')
    const nov1 = (h: number) => Date.UTC(2026, 10, 1, h)

    t.clock.t = nov1(9)
    const plain = await t.add(bed1, { source: 'photo' }, 1)
    await t.review(plain.body.id, { action: 'approve' }, 4)
    t.clock.t = nov1(14)
    const corrected = await t.add(bed1, { direction: 'out', category: 'urine', volume_ml: 450, source: 'photo' }, 1)
    await t.review(corrected.body.id, { action: 'approve', volume_ml: 400 }, 4)
    t.clock.t = nov2(8)
    const rejected = await t.add(bed2, { source: 'photo' }, 1)
    await t.review(rejected.body.id, { action: 'reject', reason: 'duplicate' }, 4)
    t.clock.t = nov2(11)
    const late = await t.add(bed2, { charted_at: isoAt(nov2(5)) }, 1)
    await t.review(late.body.id, { action: 'approve' }, 5)
    // Another ward's entries do not count.
    await t.add(await t.bed('1', '3A'), {}, 2)
    t.clock.t = nov2(12)

    const res = await t.json<WardQuality>(`/api/wards/${wardId}/quality`)
    assert.equal(res.status, 200)
    const q = res.body
    assert.equal(q.ward.code, '5B')
    assert.equal(q.since, isoAt(nov2(12) - 7 * 24 * HOUR))
    assert.deepEqual(q.totals, { entries: 4, corrected: 1, amended: 0, late: 1, rejected: 1, manual: 1 })
    assert.deepEqual(q.rejected_by_reason, { duplicate: 1 })
    assert.deepEqual(q.recorders, [{ staff: RAVI, recorded: 4, corrected: 1, amended: 0, late: 1, rejected: 1 }])
    assert.deepEqual(
      q.reviewers.map((r) => [r.staff?.id, r.reviewed]),
      [
        [4, 3],
        [5, 1],
      ],
    )
    assert.deepEqual(
      q.flagged.map((f) => [f.entry.id, f.flags, f.bed, f.admission_id]),
      [
        [rejected.body.id, ['rejected'], '2', bed2],
        [late.body.id, ['late'], '2', bed2],
        [corrected.body.id, ['corrected'], '1', bed1],
      ],
    )
    assert.equal(q.flagged[0]!.patient, 'Ravi Menon')
    assert.ok(q.flagged.every((f) => f.entry.evidence === null))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/audit] Ward data quality: Unknown ward', async () => {
    const t = await setup()
    for (const path of ['/api/wards/999/quality', '/api/wards/x/quality']) {
      const res = await t.json(path)
      assert.equal(res.status, 404)
      assert.equal(res.body.error, 'not_found')
    }
  })
})
