import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { IDLE_LOCK_MS } from '@meniscus/shared'
import { ApiError } from './api.ts'
import { createIdleTimer } from './idle.ts'
import { createPoll } from './poll.ts'
import { emptySignInForm, LOCKED_KEY, lockLine, personLabel, RECENT_KEY, signInForm, switchQuestion } from './session.ts'
import { ANITA, DEMO_ACCOUNTS, fakeServer, GRACE, RAVI } from './staff-fixtures.ts'
import { bedScreenLoad } from './care.ts'
import { DEMO_HINT, demoGroups, landingPath, staffLabel } from './staff.ts'

/** 2 Nov 2026 at hh:mm:ss local time (epoch ms). */
const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 2, h, m, s).getTime()

describe('sign in', () => {
  it('[web/staff] Sign in with a username and password: Anita signs in', async () => {
    const f = fakeServer()
    await f.session.check()
    assert.equal(f.session.get().hospital, 'Meniscus Demo Hospital')
    assert.deepEqual(await f.session.signIn('anita', 'anita'), { ok: true })
    assert.deepEqual(f.reqs(), ['GET /api/session', 'POST /api/session'])
    assert.deepEqual(f.seen[1]!.body, { username: 'anita', password: 'anita' })
    assert.equal(f.seen[1]!.staff, null)
    assert.equal(f.session.get().status, 'signed_in')
    assert.equal(staffLabel(f.session.get().staff), 'Anita Thomas · Nurse')
  })

  it('[web/staff] Sign in with a username and password: Wrong password', async () => {
    const f = fakeServer()
    await f.session.check()
    let form = signInForm(signInForm(emptySignInForm, { type: 'username', value: 'anita' }), { type: 'password', value: 'wrong' })
    const r = await f.session.signIn(form.username, form.password)
    assert.deepEqual(r, { ok: false, error: 'Wrong username or password' })
    form = signInForm(form, { type: 'failed', error: r.ok ? '' : r.error })
    assert.equal(form.error, 'Wrong username or password')
    assert.equal(form.username, 'anita')
    assert.equal(form.password, '')
    assert.equal(f.session.get().status, 'signed_out')
    assert.deepEqual(f.reqs(), ['GET /api/session', 'POST /api/session'])
  })

  it('[web/staff] Sign in with a username and password: Recent on this device', async () => {
    const f = fakeServer()
    await f.session.check()
    for (const name of ['ravi', 'anita', 'grace', 'meera', 'lakshmi']) {
      assert.deepEqual(await f.session.signIn(name, name), { ok: true })
      await f.session.switchUser()
    }
    const recent = f.session.recent()
    assert.deepEqual(recent.map(personLabel), [
      'Lakshmi Iyer · Matron',
      'Meera Pillai · Nurse',
      'Grace Lee · Nurse',
      'Anita Thomas · Nurse',
    ])
    // Tapping Grace Lee fills her username and moves to the password.
    const form = signInForm(emptySignInForm, { type: 'pick', username: recent[2]!.username })
    assert.equal(form.username, 'grace')
    assert.equal(form.focus, 'password')
    // Only username, name and role are kept: no password, no session token.
    const stored = JSON.parse(f.storage.m.get(RECENT_KEY)!) as Record<string, unknown>[]
    assert.ok(stored.every((p) => Object.keys(p).sort().join() === 'name,role,username'))
    assert.deepEqual([...f.storage.m.keys()], [RECENT_KEY])
    assert.doesNotMatch([...f.storage.m.values()].join(), /password|token|cookie|session/i)
  })
})

describe('demo accounts', () => {
  it('[web/staff] Demo accounts on the sign-in screen: Every role labelled', async () => {
    const f = fakeServer()
    await f.session.check()
    assert.deepEqual(f.reqs(), ['GET /api/session'])
    const groups = demoGroups(f.session.get().demo_accounts)
    assert.deepEqual(
      groups.map((g) => g.title),
      ['2C', '3A', '5B', 'HDU', 'Matron', 'Dietitian'],
    )
    assert.equal(DEMO_ACCOUNTS.length, 11)
    const a3 = groups.find((g) => g.title === '3A')!.accounts.map(personLabel)
    assert.ok(a3.includes('Anita Thomas · Nurse'))
    assert.ok(a3.includes('Ravi Kumar · Attendant'))
    assert.deepEqual(
      groups.slice(-2).flatMap((g) => g.accounts.map(personLabel)),
      ['Lakshmi Iyer · Matron', 'Sana Mirza · Dietitian'],
    )
    assert.equal(groups.flatMap((g) => g.accounts).length, DEMO_ACCOUNTS.length)
    assert.equal(DEMO_HINT, 'Demo: the password is the first name in lowercase')
    // Tapping Ravi Kumar fills his username.
    const ravi = groups.flatMap((g) => g.accounts).find((a) => a.name === 'Ravi Kumar')!
    assert.equal(signInForm(emptySignInForm, { type: 'pick', username: ravi.username }).username, 'ravi')
    const sana = groups.flatMap((g) => g.accounts).find((a) => a.name === 'Sana Mirza')!
    assert.equal(signInForm(emptySignInForm, { type: 'pick', username: sana.username }).username, 'sana')
  })

  it('[web/staff] Demo accounts on the sign-in screen: Production shows no demo panel', async () => {
    const f = fakeServer({ demo: false })
    await f.session.check()
    assert.deepEqual(f.session.get().demo_accounts, [])
    // No groups: neither the panel nor the hint is shown.
    assert.deepEqual(demoGroups(f.session.get().demo_accounts), [])
    assert.deepEqual(f.reqs(), ['GET /api/session'])
  })
})

describe('lock when idle', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at(10) }))
  afterEach(() => mock.timers.reset())

  it('[web/staff] Lock when idle: Locked after 5 minutes idle', async () => {
    const f = fakeServer({ live: ANITA, routes: { 'GET /api/admissions\\?ward=2': () => Response.json([]) } })
    await f.session.check()
    // The 3A dashboard's 30-second refresh, paused while locked.
    const stop = createPoll({
      ms: 30_000,
      paused: () => f.session.get().status === 'locked',
      visible: () => true,
      tick: () => void f.api.admissions(2),
    })
    const idle = createIdleTimer({ ms: IDLE_LOCK_MS, now: () => Date.now(), onIdle: () => f.session.lock() })
    idle.touch() // her last input, at 10:00
    mock.timers.tick(at(10, 4, 59) - at(10))
    assert.equal(f.session.get().status, 'signed_in')
    const polled = f.reqs().length
    assert.ok(polled > 1)
    mock.timers.tick(1000) // 10:05
    assert.equal(f.session.get().status, 'locked')
    assert.equal(lockLine(f.session.get().locked!), 'Locked · Anita Thomas · Nurse')
    const before = f.reqs().length
    mock.timers.tick(5 * 60_000)
    assert.equal(f.reqs().length, before)
    stop()
    idle.stop()
  })

  it('[web/staff] Lock when idle: Unlock keeps the draft', async () => {
    const f = fakeServer()
    await f.session.check()
    await f.session.signIn('ravi', 'ravi')
    f.unsaved.hold() // his 450 mL photo draft, at 10:00
    mock.timers.tick(5 * 60_000)
    f.session.lock()
    f.server.live = null // 10:40: his session has ended on the server
    mock.timers.tick(35 * 60_000)
    const before = f.seen.length
    assert.deepEqual(await f.session.unlock('ravi'), { ok: true })
    const after = f.seen.slice(before)
    assert.deepEqual(
      after.map((s) => [s.req, s.staff, s.body]),
      [['POST /api/session', null, { username: 'ravi', password: 'ravi' }]],
    )
    assert.equal(f.session.get().status, 'signed_in')
    assert.equal(f.session.get().staff?.name, 'Ravi Kumar')
    assert.equal(f.unsaved.has(), true)
    assert.ok(f.seen.every((s) => !s.req.includes('/api/ai')))
  })

  it('[web/staff] Lock when idle: Session ends while working', async () => {
    const f = fakeServer({ routes: { 'POST /api/admissions/16/entries': () => Response.json({ id: 9 }, { status: 201 }) } })
    await f.session.check()
    await f.session.signIn('ravi', 'ravi')
    f.unsaved.hold()
    f.server.live = null
    const before = f.seen.length
    const save = () => f.api.addEntry(16, { direction: 'out', category: 'urine', volume_ml: 450, source: 'photo' })
    await assert.rejects(save(), (e: unknown) => e instanceof ApiError && e.code === 'sign_in_required')
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['POST /api/admissions/16/entries'],
    )
    assert.equal(f.session.get().status, 'locked')
    assert.equal(f.session.get().locked?.name, 'Ravi Kumar')
    assert.equal(f.unsaved.has(), true)
    // Unlocking sends only the sign-in; nothing is saved until he saves again.
    await f.session.unlock('ravi')
    assert.deepEqual(
      f.seen.slice(before + 1).map((s) => s.req),
      ['POST /api/session'],
    )
    await save()
    assert.deepEqual(
      f.seen.slice(before + 2).map((s) => [s.req, s.staff]),
      [['POST /api/admissions/16/entries', '1']],
    )
  })
})

describe('a read after the session ended', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at(10) }))
  afterEach(() => mock.timers.reset())

  it('[web/staff] Lock when idle: A refresh after the session ended', async () => {
    const f = fakeServer({ live: ANITA, routes: { 'GET /api/admissions\\?ward=2': () => Response.json([]) } })
    await f.session.check()
    const failed: unknown[] = []
    // The 3A dashboard's 30-second refresh, paused while locked.
    const stop = createPoll({
      ms: 30_000,
      paused: () => f.session.get().status === 'locked',
      visible: () => true,
      tick: () => void f.api.admissions(2).catch((e: unknown) => failed.push(e)),
    })
    f.server.live = null // her session ends on the server
    const before = f.seen.length
    mock.timers.tick(30_000)
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['GET /api/admissions?ward=2'],
    )
    assert.ok(failed.length === 1 && failed[0] instanceof ApiError && failed[0].code === 'sign_in_required')
    assert.equal(f.session.get().status, 'locked')
    assert.equal(lockLine(f.session.get().locked!), 'Locked · Anita Thomas · Nurse')
    mock.timers.tick(10 * 60_000)
    assert.equal(f.seen.length, before + 1)
    stop()
  })
})

describe('bed link needs sign-in', () => {
  it('[web/bed-qr] Bed link needs sign-in: Scanned while signed out', async () => {
    const BED4 = { id: 16, bed: '4', ward_code: '3A', patient: 'Kavya Rao' }
    const f = fakeServer({
      routes: {
        'GET /api/beds/tok_3A_4': () => Response.json(BED4),
        'GET /api/admissions/16/entries': () => Response.json({ admission: BED4, entries: [] }),
      },
    })
    // Opened at /a/bed/tok_3A_4 with no session: the gate shows sign-in, and only the session check is sent.
    await f.session.check()
    assert.equal(f.session.get().status, 'signed_out')
    assert.deepEqual(f.reqs(), ['GET /api/session'])
    assert.ok(!JSON.stringify(f.session.get()).includes(BED4.patient))
    // The token alone is no credential: the server refuses it without a session.
    await assert.rejects(f.api.bed('tok_3A_4'), (e: unknown) => e instanceof ApiError && e.code === 'sign_in_required')
    f.seen.length = 1
    // Ravi signs in: the same URL opens that bed.
    assert.deepEqual(await f.session.signIn('ravi', 'ravi'), { ok: true })
    assert.equal(landingPath('/a/bed/tok_3A_4', f.session.get().staff!), '/a/bed/tok_3A_4')
    const before = f.seen.length
    const screen = await bedScreenLoad(f.api, 'tok_3A_4')(new AbortController().signal)
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['GET /api/beds/tok_3A_4', 'GET /api/admissions/16/entries'],
    )
    assert.equal(screen.admission.id, 16)
  })
})

describe('someone else at the lock', () => {
  /** Ravi Kumar's session, opened before this device remembered his username; his draft is held, and the app locks. */
  const lockedRavi = async () => {
    const f = fakeServer({ live: RAVI })
    await f.session.check()
    f.unsaved.hold() // his 450 mL draft
    f.session.lock()
    return f
  }

  it("[web/staff] Someone else at the lock: Grace signs in over Ravi's lock", async () => {
    const f = await lockedRavi()
    // The lock does not know his username, so it asks for one.
    assert.equal(f.session.get().locked?.username, '')
    assert.equal(lockLine(f.session.get().locked!), 'Locked · Ravi Kumar · Attendant')
    const before = f.seen.length
    assert.deepEqual(await f.session.signIn('grace', 'grace'), { ok: true })
    assert.deepEqual(
      f.seen.slice(before).map((s) => [s.req, s.staff]),
      [['POST /api/session', null]],
    )
    assert.equal(f.session.get().status, 'signed_in')
    assert.equal(f.session.get().staff?.name, 'Grace Lee')
    // Nothing of Ravi's carries over to her.
    assert.equal(f.unsaved.has(), false)
  })

  it('[web/staff] Someone else at the lock: Ravi himself keeps his draft', async () => {
    const f = await lockedRavi()
    assert.deepEqual(await f.session.signIn('ravi', 'ravi'), { ok: true })
    assert.equal(f.session.get().staff?.name, 'Ravi Kumar')
    assert.equal(f.unsaved.has(), true)
  })
})

describe('switch user', () => {
  it('[web/staff] Switch user: Switch user discards after confirm', async () => {
    const f = fakeServer()
    await f.session.check()
    await f.session.signIn('anita', 'anita')
    f.unsaved.hold() // unsaved round readings
    const before = f.seen.length
    assert.equal(switchQuestion(f.session.get().staff, f.unsaved.has()), "Anita's unsaved draft will be discarded")
    // "Cancel": nothing is sent, the readings stay.
    assert.equal(f.seen.length, before)
    assert.equal(f.unsaved.has(), true)
    // Confirmed.
    await f.session.switchUser()
    assert.deepEqual(
      f.seen.slice(before).map((s) => [s.req, s.staff]),
      [['DELETE /api/session', null]],
    )
    assert.equal(f.session.get().status, 'signed_out')
    assert.equal(f.unsaved.has(), false)
  })

  it('[web/staff] Switch user: Nothing unsaved', async () => {
    const f = fakeServer()
    await f.session.check()
    await f.session.signIn('grace', 'grace')
    assert.equal(staffLabel(f.session.get().staff), staffLabel(GRACE))
    assert.equal(switchQuestion(f.session.get().staff, f.unsaved.has()), null)
    const before = f.seen.length
    await f.session.switchUser()
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['DELETE /api/session'],
    )
    assert.equal(f.session.get().status, 'signed_out')
    assert.equal(f.session.get().staff, null)
    assert.equal(f.storage.m.has(LOCKED_KEY), false)
  })

  it('[web/staff] Switch user: Opened signed in', async () => {
    // The page opened with Grace Lee's session live, so it has not had the sign-in screen's data yet.
    const f = fakeServer({ live: GRACE })
    await f.session.check()
    assert.equal(f.session.get().hospital, null)
    const before = f.seen.length
    await f.session.switchUser()
    assert.deepEqual(
      f.seen.slice(before).map((s) => [s.req, s.staff]),
      [
        ['DELETE /api/session', null],
        ['GET /api/session', null],
      ],
    )
    assert.equal(f.session.get().status, 'signed_out')
    assert.equal(f.session.get().hospital, 'Meniscus Demo Hospital')
    assert.deepEqual(f.session.get().demo_accounts, DEMO_ACCOUNTS)
  })
})
