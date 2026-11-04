import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import {
  TEAM_ROLES,
  shiftStart,
  type AdmissionSummary,
  type Entry,
  type EntryEvent,
  type EntryList,
  type HospitalSummary,
  type Staff,
  type Meal,
  type MediaRef,
  type WardAccess,
  type PhotoEvidence,
  type StaffRef,
  type WardTeam,
} from '@meniscus/shared'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { reading, testApp, testDb, testStore, upstream, type RequestOptions } from './testing.ts'

/** 2026-11-<d> hh:mm in local time: shifts follow the server's local clock. */
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
/** Synthetic PNG: the signature and an IHDR tag, no image. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])

const RAVI: StaffRef = { id: 1, name: 'Ravi Kumar', role: 'attendant' }
const ANITA: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }
const GRACE: StaffRef = { id: 5, name: 'Grace Lee', role: 'nurse' }
const MEERA: StaffRef = { id: 6, name: 'Meera Pillai', role: 'nurse' }
const DIVYA: StaffRef = { id: 8, name: 'Divya Kapoor', role: 'nurse' }

/** The store opens (and seeds the demo hospital) at `seededAt`; the clock then moves freely. */
async function setup(seededAt: number, store?: Store | ((clock: { t: number }) => Promise<Store>)) {
  const clock = { t: seededAt }
  const s = typeof store === 'function' ? await store(clock) : (store ?? (await testStore(() => clock.t)))
  const u = upstream()
  const { request } = await testApp({ ai: u.ai, store: s })
  /** A synthetic PNG uploaded as photo media of the bed, signed in as `staff`. */
  const upload = async (admissionId: number, staff: number) => {
    const form = new FormData()
    form.set('file', new File([PNG], 'p.png', { type: 'image/png' }))
    form.set('kind', 'photo')
    const res = await request(`/api/admissions/${admissionId}/media`, { method: 'POST', body: form }, { staff })
    return { status: res.status, body: (await res.json()) as MediaRef }
  }
  const json = async <T>(path: string, init: { method?: string; body?: unknown } & RequestOptions = {}) => {
    const { method = init.body === undefined ? 'GET' : 'POST', body, ...opts } = init
    const res = await request(
      path,
      { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) },
      opts,
    )
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const get = async <T>(path: string) => (await json<T>(path)).body
  const wards = async () => (await get<HospitalSummary>('/api/wards')).wards
  const wardId = async (code: string) => (await wards()).find((w) => w.code === code)!.id
  const beds = async (code: string) => (await get<AdmissionSummary[]>('/api/admissions')).filter((a) => a.ward_code === code)
  const inCharge = async (code: string) => (await wards()).find((w) => w.code === code)!.in_charge
  const team = async (code: string) => json<WardTeam>(`/api/wards/${await wardId(code)}/team`)
  /** PUT as staff `staff` (signed in, with `X-Staff-Id`), or with no session when `staff` is null. */
  const put = async <T = WardTeam>(path: string, body: unknown, staff: number | null) =>
    json<T>(path, { method: 'PUT', body, ...(staff === null ? { cookie: null } : { staff }) })
  /** POST as staff `staff`, signed in with `X-Staff-Id`. */
  const post = <T>(path: string, body: unknown, staff: number) => json<T>(path, { body, staff })
  const addEntry = (admissionId: number, staff: number, e: object = {}) =>
    post<Entry>(
      `/api/admissions/${admissionId}/entries`,
      { direction: 'in', category: 'water', volume_ml: 200, source: 'manual', ...e },
      staff,
    )
  const raw = (path: string) => request(path)
  return { clock, store: s, u, json, get, post, raw, wards, wardId, beds, inCharge, team, put, upload, addEntry }
}

describe('demo staffing', () => {
  it('[charting/staffing] Demo staffing: Who works where', async () => {
    const t = await setup(at(2, 9))
    const staff = await t.get<Staff[]>('/api/staff')
    const home = (code: string) =>
      staff
        .filter((s) => TEAM_ROLES.includes(s.role) && s.wards[0]?.code === code)
        .map((s) => `${s.name} (${s.role})`)
        .sort()
    assert.deepEqual(home('2C'), ['Meera Pillai (nurse)', 'Rekha Gupta (attendant)'])
    assert.deepEqual(home('3A'), ['Anita Thomas (nurse)', 'Ravi Kumar (attendant)', 'Sunita Devi (attendant)'])
    assert.deepEqual(home('5B'), ['Grace Lee (nurse)', 'Mohan Das (attendant)'])
    assert.deepEqual(home('HDU'), ['Divya Kapoor (nurse)', 'Nikhil Bose (nurse)'])
    const lakshmi = staff.find((s) => s.name === 'Lakshmi Iyer')!
    assert.equal(lakshmi.role, 'matron')
    assert.deepEqual(
      lakshmi.wards.map((w) => w.code),
      ['2C', '3A', '5B', 'HDU'],
    )
    const sana = staff.find((s) => s.name === 'Sana Mirza')!
    assert.deepEqual([sana.id, sana.role], [11, 'dietitian'])
    assert.deepEqual(
      sana.wards.map((w) => w.code),
      ['2C', '3A', '5B', 'HDU'],
    )

    const inCharge = Object.fromEntries((await t.wards()).map((w) => [w.code, w.in_charge?.name ?? null]))
    assert.deepEqual(inCharge, { '2C': 'Meera Pillai', '3A': 'Anita Thomas', '5B': 'Grace Lee', HDU: 'Nikhil Bose' })
    // Sana Mirza is in no ward's team, in charge of none, and assigned no bed.
    for (const code of ['2C', '3A', '5B', 'HDU']) {
      const team = (await t.team(code)).body
      assert.ok(!team.team.some((m) => m.id === 11), code)
      assert.notEqual(team.in_charge?.id, 11)
      assert.ok(!team.assignments.some((a) => a.staff_id === 11), code)
    }

    const nurseOf = async (code: string) => {
      const team = (await t.team(code)).body
      const byAdmission = new Map(team.assignments.map((a) => [a.admission_id, a.staff_id]))
      return Object.fromEntries((await t.beds(code)).map((b) => [b.bed, byAdmission.get(b.id) ?? null]))
    }
    for (const [code, nurse] of [
      ['2C', 6],
      ['3A', 4],
      ['5B', 5],
    ] as const) {
      const assigned = await nurseOf(code)
      assert.ok(Object.keys(assigned).length > 0)
      assert.ok(
        Object.values(assigned).every((id) => id === nurse),
        code,
      )
    }
    assert.deepEqual(await nurseOf('HDU'), { '1': 7, '2': 7, '3': 8 })
    assert.deepEqual(t.u.requests, [])
  })
})

describe('nurse in charge', () => {
  it('[charting/staffing] Nurse in charge: Day shift ends', async () => {
    const t = await setup(at(2, 9))
    t.clock.t = at(2, 19, 59)
    assert.deepEqual((await t.wards()).find((w) => w.code === '3A')!.in_charge, ANITA)
    t.clock.t = at(2, 20)
    assert.deepEqual(
      (await t.wards()).map((w) => w.in_charge),
      [null, null, null, null],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Nurse in charge: Night shift crosses midnight', async () => {
    const t = await setup(at(2, 23))
    t.clock.t = at(3, 7, 59)
    assert.deepEqual((await t.wards()).find((w) => w.code === '3A')!.in_charge, ANITA)
    t.clock.t = at(3, 8)
    assert.equal((await t.wards()).find((w) => w.code === '3A')!.in_charge, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Nurse in charge: Three shifts', () => {
    const three = [
      { name: 'early', start: '07:00' },
      { name: 'late', start: '15:00' },
      { name: 'night', start: '23:00' },
    ]
    assert.deepEqual(shiftStart(at(3, 14, 59), three), { start: at(3, 7), end: at(3, 15), name: 'early' })
    assert.deepEqual(shiftStart(at(3, 15), three), { start: at(3, 15), end: at(3, 23), name: 'late' })
    assert.deepEqual(shiftStart(at(3, 6, 59), three), { start: at(2, 23), end: at(3, 7), name: 'night' })
    assert.deepEqual(shiftStart(at(3, 23), three), { start: at(3, 23), end: at(4, 7), name: 'night' })
  })
})

describe('ward team', () => {
  it('[charting/staffing] Ward team: Team of 3A', async () => {
    const t = await setup(at(2, 9))
    const res = await t.team('3A')
    assert.equal(res.status, 200)
    assert.equal(res.body.ward_id, await t.wardId('3A'))
    assert.equal(res.body.shift_start, new Date(at(2, 8)).toISOString())
    assert.deepEqual(res.body.in_charge, ANITA)
    assert.deepEqual(
      res.body.team.map((m) => [m.name, m.role, m.home]),
      [
        ['Anita Thomas', 'nurse', true],
        ['Grace Lee', 'nurse', false],
        ['Meera Pillai', 'nurse', false],
        ['Ravi Kumar', 'attendant', true],
        ['Sunita Devi', 'attendant', true],
      ],
    )
    const beds = await t.beds('3A')
    assert.equal(beds.length, 7)
    assert.deepEqual(
      res.body.assignments,
      beds.map((b) => ({ admission_id: b.id, staff_id: 4 })),
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Ward team: Unknown ward team', async () => {
    const t = await setup(at(2, 9))
    for (const path of ['/api/wards/999/team', '/api/wards/x/team']) {
      const res = await t.json(path)
      assert.equal(res.status, 404)
      assert.equal(res.body.error, 'not_found')
    }
  })
})

describe('name the nurse in charge', () => {
  it('[charting/staffing] Name the nurse in charge: Cover nurse takes charge', async () => {
    const t = await setup(at(2, 9))
    t.clock.t = at(2, 10)
    const res = await t.put(`/api/wards/${await t.wardId('3A')}/in-charge`, { staff_id: 5 }, 5)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.in_charge, GRACE)
    assert.equal(res.body.ward_id, await t.wardId('3A'))
    assert.deepEqual(
      res.body.team.map((m) => m.name),
      ['Anita Thomas', 'Grace Lee', 'Meera Pillai', 'Ravi Kumar', 'Sunita Devi'],
    )
    assert.deepEqual(await t.inCharge('3A'), GRACE)
    assert.equal(await t.inCharge('5B'), null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Name the nurse in charge: Matron names a nurse', async () => {
    const t = await setup(at(2, 9))
    const res = await t.put(`/api/wards/${await t.wardId('HDU')}/in-charge`, { staff_id: 8 }, 10)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.in_charge, DIVYA)
    assert.deepEqual(await t.inCharge('HDU'), DIVYA)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Name the nurse in charge: Not a nurse on the team', async () => {
    const t = await setup(at(2, 9))
    const path = `/api/wards/${await t.wardId('5B')}/in-charge`
    for (const staff_id of [7, 3, 999]) {
      const res = await t.put(path, { staff_id }, 5)
      assert.equal(res.status, 400, String(staff_id))
      assert.equal(res.body.error, 'invalid_request')
    }
    assert.deepEqual(await t.inCharge('5B'), GRACE)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Name the nurse in charge: Attendant or nobody', async () => {
    const t = await setup(at(2, 9))
    const path = `/api/wards/${await t.wardId('3A')}/in-charge`
    const attendant = await t.put(path, { staff_id: 4 }, 1)
    const nobody = await t.put(path, { staff_id: 4 }, null)
    assert.deepEqual([attendant.status, attendant.body.error], [403, 'forbidden'])
    assert.deepEqual([nobody.status, nobody.body.error], [401, 'sign_in_required'])
    // The role is checked before the body.
    assert.equal((await t.put(path, { staff_id: 'x' }, 1)).status, 403)
    assert.deepEqual(await t.inCharge('3A'), ANITA)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Name the nurse in charge: Nurse off the team', async () => {
    const t = await setup(at(2, 9))
    const res = await t.put(`/api/wards/${await t.wardId('3A')}/in-charge`, { staff_id: 6 }, 7)
    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'forbidden')
    assert.deepEqual(await t.inCharge('3A'), ANITA)
    assert.deepEqual(await t.inCharge('2C'), MEERA)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Name the nurse in charge: Unknown ward', async () => {
    const t = await setup(at(2, 9))
    for (const path of ['/api/wards/999/in-charge', '/api/wards/x/in-charge']) {
      const res = await t.put(path, { staff_id: 5 }, 5)
      assert.equal(res.status, 404)
      assert.equal(res.body.error, 'not_found')
    }
  })
})

describe('assign beds', () => {
  /** HDU beds 1 and 2 to `a`, bed 3 to `b`. */
  const split = async (t: Awaited<ReturnType<typeof setup>>, a = 7, b = 8) => {
    const [b1, b2, b3] = await t.beds('HDU')
    return [
      { admission_id: b1!.id, staff_id: a },
      { admission_id: b2!.id, staff_id: b },
      { admission_id: b3!.id, staff_id: b },
    ]
  }
  const hduAssignments = async (t: Awaited<ReturnType<typeof setup>>) => (await t.team('HDU')).body.assignments

  it('[charting/staffing] Assign beds: Nurse in charge splits HDU', async () => {
    const t = await setup(at(2, 9))
    t.clock.t = at(2, 10)
    const beds = await split(t)
    const res = await t.put(`/api/wards/${await t.wardId('HDU')}/assignments`, { beds }, 7)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.assignments, beds)
    assert.deepEqual(await hduAssignments(t), beds)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Assign beds: Matron assigns', async () => {
    const t = await setup(at(2, 9))
    const [first, ...rest] = await t.beds('3A')
    const beds = [{ admission_id: first!.id, staff_id: 5 }, ...rest.map((b) => ({ admission_id: b.id, staff_id: 4 }))]
    const res = await t.put(`/api/wards/${await t.wardId('3A')}/assignments`, { beds }, 10)
    assert.equal(res.status, 200)
    assert.deepEqual(
      res.body.assignments.find((a) => a.admission_id === first!.id),
      { admission_id: first!.id, staff_id: 5 },
    )
    assert.deepEqual(res.body.assignments, beds)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Assign beds: Not in charge', async () => {
    const t = await setup(at(2, 9))
    const before = await hduAssignments(t)
    const path = `/api/wards/${await t.wardId('HDU')}/assignments`
    for (const staff of [8, 1]) {
      const res = await t.put(path, { beds: await split(t) }, staff)
      assert.equal(res.status, 403, String(staff))
      assert.equal(res.body.error, 'forbidden')
    }
    // The caller is checked before the body.
    assert.equal((await t.put(path, { beds: 'x' }, 8)).status, 403)
    assert.deepEqual(await hduAssignments(t), before)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Assign beds: Invalid assignment', async () => {
    const t = await setup(at(2, 9))
    const before = await hduAssignments(t)
    const path = `/api/wards/${await t.wardId('HDU')}/assignments`
    const [b1, b2, b3] = await split(t)
    const other = (await t.beds('3A'))[0]!
    for (const beds of [
      [{ ...b1!, staff_id: 4 }, b2!, b3!],
      [b1!, b2!, b3!, { admission_id: other.id, staff_id: 8 }],
      [b1!, b2!, b3!, { ...b1!, staff_id: 8 }],
    ]) {
      const res = await t.put(path, { beds }, 7)
      assert.equal(res.status, 400, JSON.stringify(beds))
      assert.equal(res.body.error, 'invalid_request')
    }
    assert.deepEqual(await hduAssignments(t), before)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Assign beds: Next shift starts unassigned', async () => {
    const t = await setup(at(2, 9))
    t.clock.t = at(2, 10)
    assert.equal((await t.put(`/api/wards/${await t.wardId('HDU')}/assignments`, { beds: await split(t) }, 7)).status, 200)
    t.clock.t = at(2, 20)
    const res = await t.team('HDU')
    assert.deepEqual(res.body.assignments, [])
    assert.equal(res.body.in_charge, null)
    assert.equal(res.body.shift_start, new Date(at(2, 20)).toISOString())
    assert.deepEqual(t.u.requests, [])
  })
})

describe('decisions need a nurse', () => {
  const urine = { direction: 'out', category: 'urine', volume_ml: 300 }

  it('[charting/staffing] Decisions need a nurse: Attendant approves', async () => {
    const t = await setup(at(2, 9))
    const bed = (await t.beds('3A'))[0]!.id
    const e = await t.addEntry(bed, 1, urine)
    assert.equal(e.status, 201)
    const res = await t.post<Entry>(`/api/entries/${e.body.id}/review`, { action: 'approve' }, 2)
    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'forbidden')
    assert.equal((await t.get<EntryList>(`/api/admissions/${bed}/entries`)).entries[0]!.status, 'pending')
    assert.deepEqual(
      (await t.get<EntryEvent[]>(`/api/entries/${e.body.id}/events`)).map((v) => v.kind),
      ['recorded'],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Decisions need a nurse: Role checked first', async () => {
    const t = await setup(at(2, 9))
    const bed = (await t.beds('3A'))[0]!.id
    const e = await t.addEntry(bed, 4)
    assert.equal((await t.post(`/api/entries/${e.body.id}/review`, { action: 'approve' }, 4)).status, 200)
    for (const res of [
      await t.post('/api/entries/999/review', { action: 'approve' }, 2),
      await t.post(`/api/entries/${e.body.id}/amend`, { volume_ml: -5 }, 2),
      await t.post('/api/meals/999/void', { reason: '' }, 2),
    ]) {
      assert.equal(res.status, 403)
      assert.equal(res.body.error, 'forbidden')
    }
  })

  it('[charting/staffing] Decisions need a nurse: Attendant amends or voids', async () => {
    const t = await setup(at(2, 9))
    const bed = (await t.beds('3A'))[0]!.id
    const e = await t.addEntry(bed, 1, { volume_ml: 400 })
    await t.post(`/api/entries/${e.body.id}/review`, { action: 'approve' }, 4)
    const meal = await t.post<Meal>(`/api/admissions/${bed}/meals`, { meal: 'lunch', portion: 50, source: 'manual' }, 1)
    const amend = await t.post(`/api/entries/${e.body.id}/amend`, { volume_ml: 350, reason: 're-measured with jug' }, 3)
    const voided = await t.post(`/api/meals/${meal.body.id}/void`, { reason: 'wrong bed' }, 1)
    assert.deepEqual([amend.status, amend.body.error, voided.status, voided.body.error], [403, 'forbidden', 403, 'forbidden'])
    const entry = (await t.get<EntryList>(`/api/admissions/${bed}/entries`)).entries[0]!
    assert.deepEqual([entry.volume_ml, entry.amended_at], [400, null])
    assert.equal((await t.get<Meal[]>(`/api/admissions/${bed}/meals`))[0]!.voided_at, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Decisions need a nurse: Refused reject or void keeps media', async () => {
    const t = await setup(at(2, 9))
    const bed = (await t.beds('3A'))[0]!.id
    const photo = (await t.upload(bed, 1)).body
    const e = await t.addEntry(bed, 1, { ...urine, source: 'photo', media_id: photo.id })
    assert.equal(e.status, 201)
    const tray = (await t.upload(bed, 1)).body
    const meal = await t.post<Meal>(`/api/admissions/${bed}/meals`, { meal: 'lunch', portion: 50, source: 'photo', media_id: tray.id }, 1)
    assert.equal(meal.status, 201)
    const reject = await t.post(`/api/entries/${e.body.id}/review`, { action: 'reject', reason: 'duplicate' }, 1)
    const voided = await t.post(`/api/meals/${meal.body.id}/void`, { reason: 'wrong bed' }, 1)
    assert.deepEqual([reject.status, reject.body.error, voided.status, voided.body.error], [403, 'forbidden', 403, 'forbidden'])
    for (const m of [photo, tray]) assert.equal((await t.raw(`/api/media/${m.id}`)).status, 200)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Decisions need a nurse: Matron approves', async () => {
    const t = await setup(at(2, 9))
    const e = await t.addEntry((await t.beds('3A'))[0]!.id, 1)
    const res = await t.post<Entry>(`/api/entries/${e.body.id}/review`, { action: 'approve' }, 10)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.reviewed_by, { id: 10, name: 'Lakshmi Iyer', role: 'matron' })
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Decisions need a nurse: Attendant records', async () => {
    const t = await setup(at(2, 9))
    const bed = (await t.beds('3A'))[0]!.id
    const photo = await t.upload(bed, 9)
    const e = await t.addEntry(bed, 9, { source: 'photo', media_id: photo.body.id })
    assert.deepEqual([photo.status, e.status], [201, 201])
    assert.deepEqual(e.body.created_by, { id: 9, name: 'Rekha Gupta', role: 'attendant' })
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Decisions need a nurse: Attendant saves an adjusted draft', async () => {
    const t = await setup(at(2, 9))
    const bed = (await t.beds('3A'))[0]!.id
    // The model read 450 mL; the attendant changed it to 400 mL on the check screen.
    const evidence: PhotoEvidence = {
      kind: 'photo',
      mode: 'spark',
      reading: reading({ volume_ml: 450 }),
      segmentation: null,
      review_reasons: [],
      trace: [],
      colour: null,
    }
    const e = await t.addEntry(bed, 1, { ...urine, volume_ml: 400, source: 'photo', evidence })
    assert.equal(e.status, 201)
    assert.deepEqual([e.body.status, e.body.volume_ml, e.body.created_by], ['pending', 400, RAVI])
    const approve = await t.post(`/api/entries/${e.body.id}/review`, { action: 'approve' }, 1)
    assert.equal(approve.status, 403)
    assert.equal(approve.body.error, 'forbidden')
    assert.deepEqual(t.u.requests, [])
  })
})

describe('dietitians', () => {
  const urine = { direction: 'out', category: 'urine', volume_ml: 300 }

  it('[charting/staffing] Decisions need a nurse: Dietitian approves or voids', async () => {
    const t = await setup(at(2, 9))
    const bed = (await t.beds('3A'))[0]!.id
    const e = await t.addEntry(bed, 1, urine)
    const meal = await t.post<Meal>(`/api/admissions/${bed}/meals`, { meal: 'lunch', portion: 50, source: 'manual' }, 1)
    assert.deepEqual([e.status, meal.status], [201, 201])
    for (const res of [
      await t.post(`/api/entries/${e.body.id}/review`, { action: 'approve' }, 11),
      await t.post('/api/entries/999/review', { action: 'approve' }, 11),
      await t.post(`/api/meals/${meal.body.id}/void`, { reason: 'wrong bed' }, 11),
    ]) {
      assert.deepEqual([res.status, res.body.error], [403, 'forbidden'])
    }
    assert.equal((await t.get<EntryList>(`/api/admissions/${bed}/entries`)).entries[0]!.status, 'pending')
    assert.deepEqual(
      (await t.get<EntryEvent[]>(`/api/entries/${e.body.id}/events`)).map((v) => v.kind),
      ['recorded'],
    )
    assert.equal((await t.get<Meal[]>(`/api/admissions/${bed}/meals`))[0]!.voided_at, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Dietitians cover wards: Not in the ward team', async () => {
    const t = await setup(at(2, 9))
    const res = await t.team('3A')
    assert.equal(res.status, 200)
    assert.deepEqual(
      res.body.team.map((m) => m.name),
      ['Anita Thomas', 'Grace Lee', 'Meera Pillai', 'Ravi Kumar', 'Sunita Devi'],
    )
    const sana = (await t.get<Staff[]>('/api/staff')).find((s) => s.id === 11)!
    assert.deepEqual({ id: sana.id, name: sana.name, role: sana.role }, { id: 11, name: 'Sana Mirza', role: 'dietitian' })
    assert.deepEqual(
      sana.wards.map((w) => w.code),
      ['2C', '3A', '5B', 'HDU'],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/staffing] Dietitians cover wards: Not in charge', async () => {
    const t = await setup(at(2, 9))
    const ward = await t.wardId('3A')
    const before = (await t.team('3A')).body
    const beds = await t.beds('3A')
    const anitaCharge = await t.put(`/api/wards/${ward}/in-charge`, { staff_id: 11 }, 4)
    const anitaBeds = await t.put(`/api/wards/${ward}/assignments`, { beds: [{ admission_id: beds[0]!.id, staff_id: 11 }] }, 4)
    const sanaCharge = await t.put(`/api/wards/${ward}/in-charge`, { staff_id: 4 }, 11)
    const sanaBeds = await t.put(`/api/wards/${ward}/assignments`, { beds: beds.map((b) => ({ admission_id: b.id, staff_id: 4 })) }, 11)
    for (const r of [anitaCharge, anitaBeds]) assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    for (const r of [sanaCharge, sanaBeds]) assert.deepEqual([r.status, r.body.error], [403, 'forbidden'])
    const after = (await t.team('3A')).body
    assert.deepEqual([after.in_charge, after.assignments], [before.in_charge, before.assignments])
    assert.deepEqual(t.u.requests, [])
  })
})

describe('record access to another ward', () => {
  const REASON = 'Covering HDU during break'

  /** A store on a test database on the test's clock, and its `ward_access` rows read straight from the database. */
  async function withFile(seededAt: number) {
    const h = await testDb()
    const t = await setup(seededAt, (clock) => openPgStore(h.db, { now: () => clock.t }))
    const accessRows = async () =>
      (await h.pg.query('SELECT * FROM meniscus.ward_access ORDER BY id')).rows.map((r) => ({ ...(r as object) }))
    const done = () => t.store.close()
    return { ...t, accessRows, done }
  }

  function captureLogs(t: TestContext) {
    const lines: string[] = []
    for (const m of ['log', 'error', 'warn', 'info'] as const) {
      t.mock.method(console, m, (...args: unknown[]) => void lines.push(args.map(String).join(' ')))
    }
    return lines
  }

  it('[charting/staffing] Record access to another ward: Grace opens HDU', async (tc) => {
    const logs = captureLogs(tc)
    const t = await withFile(at(2, 9))
    try {
      t.clock.t = at(2, 10, 15)
      const hdu = await t.wardId('HDU')
      const res = await t.post<WardAccess>(`/api/wards/${hdu}/access`, { reason: `  ${REASON}  `, password: 'grace' }, 5)
      assert.equal(res.status, 201)
      const { id, ...record } = res.body
      assert.ok(Number.isInteger(id))
      assert.deepEqual(record, { ward_id: hdu, created_by: GRACE, reason: REASON, created_at: new Date(at(2, 10, 15)).toISOString() })
      const rows = await t.accessRows()
      assert.deepEqual(rows, [{ id, ward_id: hdu, staff_id: 5, reason: REASON, created_at: new Date(at(2, 10, 15)) }])
      assert.ok(!JSON.stringify(res.body).includes('grace') && !JSON.stringify(rows).includes('grace'), 'password stored or returned')
      for (const line of logs) assert.ok(!line.includes('Covering HDU') && !line.includes('grace'), 'reason or password logged')
      assert.deepEqual(t.u.requests, [])
    } finally {
      await t.done()
    }
  })

  it('[charting/staffing] Record access to another ward: Reason required', async () => {
    const t = await withFile(at(2, 9))
    try {
      const path = `/api/wards/${await t.wardId('HDU')}/access`
      for (const body of [
        { password: 'grace' },
        { reason: '', password: 'grace' },
        { reason: '   ', password: 'grace' },
        { reason: 'x'.repeat(201), password: 'grace' },
        { reason: REASON },
        { reason: REASON, password: '' },
      ]) {
        const res = await t.post(path, body, 5)
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60))
        assert.equal(res.body.error, 'invalid_request')
      }
      assert.deepEqual(await t.accessRows(), [])
    } finally {
      await t.done()
    }
  })

  it('[charting/staffing] Record access to another ward: Wrong password', async (tc) => {
    const logs = captureLogs(tc)
    const t = await withFile(at(2, 9))
    try {
      const res = await t.post(`/api/wards/${await t.wardId('HDU')}/access`, { reason: REASON, password: 'wrong' }, 5)
      assert.equal(res.status, 401)
      assert.equal(res.body.error, 'invalid_credentials')
      assert.deepEqual(await t.accessRows(), [])
      for (const line of logs) assert.ok(!line.includes('wrong'), 'password logged')
    } finally {
      await t.done()
    }
  })

  it('[charting/staffing] Record access to another ward: Unknown ward or no session', async () => {
    const t = await withFile(at(2, 9))
    try {
      const body = { reason: REASON, password: 'grace' }
      const unknown = await t.post('/api/wards/999/access', body, 5)
      const anonymous = await t.json(`/api/wards/${await t.wardId('HDU')}/access`, { body, cookie: null })
      assert.deepEqual([unknown.status, unknown.body.error], [404, 'not_found'])
      assert.deepEqual([anonymous.status, anonymous.body.error], [401, 'sign_in_required'])
      assert.deepEqual(await t.accessRows(), [])
    } finally {
      await t.done()
    }
  })
})
