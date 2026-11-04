/**
 * The Postgres store's ported areas, checked for parity with the SQLite store: the same seed, clock and calls give
 * deep-equal results (QR tokens aside: each seed draws its own). Area agents add their methods here the same way, then
 * switch the callers. In-process PGlite only; no network.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createTestDb, type TestDb } from '../../db/testing.ts'
import { expected } from './recorded.ts'
import { openPgStore } from './store.ts'

/** What the SQLite store answered to these calls (see recorded.ts). */
const old = expected('store')
const T0 = Date.UTC(2026, 10, 4, 10, 0, 0)
const handles: TestDb[] = []
after(async () => {
  for (const h of handles) await h.close()
})

async function pair() {
  let t = T0
  const clock = { now: () => t, set: (ms: number) => (t = ms) }
  const h = await createTestDb()
  handles.push(h)
  const pg = await openPgStore(h.db, { now: clock.now })
  const lite = old.session().store
  return { pg, lite, clock, h }
}

const noToken = <T extends { qr_token: string } | undefined>(a: T) => (a ? { ...a, qr_token: '-' } : a)

describe('postgres store: wards and admissions', () => {
  it('wards, ward and acuity defaults match the SQLite store', async () => {
    const { pg, lite } = await pair()
    assert.deepEqual(await pg.wards(), lite.wards())
    assert.equal((await pg.wards()).length, 4)
    assert.deepEqual(await pg.ward(1), lite.ward(1))
    assert.equal(await pg.ward(999), undefined)
    assert.deepEqual(await pg.acuityDefaults(), lite.acuityDefaults())
  })

  it('admission lookups match, by id, by ids and by token', async () => {
    const { pg, lite } = await pair()
    assert.deepEqual(noToken(await pg.admission(3)), noToken(lite.admission(3)))
    assert.equal(await pg.admission(999), undefined)
    const ids = [1, 5, 999]
    const a = await pg.admissionsIn(ids)
    assert.deepEqual([...a.keys()].sort(), [...lite.admissionsIn(ids).keys()].sort())
    for (const [id, v] of lite.admissionsIn(ids)) assert.deepEqual(noToken(a.get(id)), noToken(v))
    assert.deepEqual(await pg.admissionsIn([]), new Map())
    const mine = (await pg.admission(2))!
    assert.equal((await pg.admissionByToken(mine.qr_token))?.id, 2)
    assert.equal(await pg.admissionByToken('nope'), undefined)
  })
})

describe('postgres store: staff, teams and sessions', () => {
  it('roster, members, credentials and usernames match', async () => {
    const { pg, lite } = await pair()
    assert.deepEqual(await pg.staff(), lite.staff())
    assert.deepEqual(await pg.member(4), lite.member(4))
    assert.equal(await pg.member(999), undefined)
    assert.deepEqual(await pg.credentials('anita'), lite.credentials('anita'))
    assert.equal(await pg.credentials('nobody'), undefined)
    assert.equal(await pg.username(4), lite.username(4))
  })

  it('teams, the nurse in charge and bed assignments match, before and after a change', async () => {
    const { pg, lite } = await pair()
    for (const w of [1, 2, 3, 4]) assert.deepEqual(await pg.team(w), lite.team(w))
    assert.equal(await pg.team(999), undefined)
    const ward = (await pg.wards()).find((w) => w.code === '3A')!
    const nurse = (await pg.team(ward.id))!.team.find((m) => m.role === 'nurse')!
    assert.deepEqual(await pg.setInCharge(ward.id, nurse.id, 4), lite.setInCharge(ward.id, nurse.id, 4))
    const beds = (await pg.team(ward.id))!.assignments.slice(0, 2).map((b) => ({ ...b, staff_id: nurse.id }))
    assert.deepEqual(await pg.assignBeds(ward.id, beds, 4), lite.assignBeds(ward.id, beds, 4))
    assert.deepEqual(await pg.assignBeds(ward.id, [], 4), lite.assignBeds(ward.id, [], 4))
    assert.equal(await pg.setInCharge(999, nurse.id, 4), undefined)
    assert.deepEqual(await pg.wards(), lite.wards())
  })

  it('break-the-glass records match', async () => {
    const { pg, lite } = await pair()
    assert.deepEqual(await pg.recordAccess(1, 4, 'covering a break'), lite.recordAccess(1, 4, 'covering a break'))
  })

  it('sessions start, stay alive, idle out and end as in the SQLite store', async () => {
    const { pg, lite, clock } = await pair()
    await pg.createSession('h1', 4)
    lite.createSession('h1', 4)
    assert.deepEqual(await pg.sessionStaff('h1'), lite.sessionStaff('h1'))
    assert.equal((await pg.sessionStaff('h1'))?.id, 4)
    clock.set(T0 + 31 * 60_000)
    assert.equal(await pg.sessionStaff('h1'), null)
    assert.equal(lite.sessionStaff('h1'), null)
    await pg.createSession('h2', 5)
    await pg.endSession('h2')
    assert.equal(await pg.sessionStaff('h2'), null)
    assert.equal(await pg.sessionStaff('unknown'), null)
  })

  it('a second open of one database seeds nothing more', async () => {
    const { pg, h } = await pair()
    const again = await openPgStore(h.db, { now: () => T0 })
    assert.deepEqual(await again.wards(), await pg.wards())
    assert.deepEqual(await again.staff(), await pg.staff())
    assert.deepEqual(await again.team(1), await pg.team(1))
  })
})

describe('postgres store: transactions and the per-hash lock', () => {
  it('tx commits on success and rolls back on a throw', async () => {
    const { pg } = await pair()
    await pg.tx(async (t) => void (await t.createSession('kept', 4)))
    await assert.rejects(
      pg.tx(async (t) => {
        await t.createSession('dropped', 4)
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal((await pg.sessionStaff('kept'))?.id, 4)
    assert.equal(await pg.sessionStaff('dropped'), null)
  })

  it('withShaLock takes a transaction-scoped advisory lock on the hash before fn runs', async () => {
    const sent: string[] = []
    const h = await createTestDb((q, params) => sent.push(`${q} ${JSON.stringify(params)}`))
    handles.push(h)
    const pg = await openPgStore(h.db, { now: () => T0 })
    const sha = 'ab'.repeat(32)
    sent.length = 0
    await pg.withShaLock(sha, (t) => t.createSession('under-lock', 4))
    const lock = sent.findIndex((q) => q.includes('pg_advisory_xact_lock(hashtextextended($1, 0))') && q.includes(sha))
    const insert = sent.findIndex((q) => q.includes('insert into "meniscus"."session"'))
    assert.ok(lock >= 0 && insert > lock, sent.join('\n'))
    assert.equal((await pg.sessionStaff('under-lock'))?.id, 4)
    const held = await h.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'")
    assert.equal(held.rows[0]!.n, 0)
  })
})
