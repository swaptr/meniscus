import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCKED_KEY } from './session.ts'
import { ANITA, fakeServer, LAKSHMI, memory, RAVI, SANA } from './staff-fixtures.ts'
import { initials, LANDING, landingPath, LOGIN, signedOutRoute, staffLabel, SWITCH_USER } from './staff.ts'

describe('staff on shift', () => {
  it('[web/staff] Staff on shift: Nurse on shift', async () => {
    const f = fakeServer({ live: ANITA, routes: { 'POST /api/entries/7/(review|amend)': () => Response.json({ id: 7 }) } })
    await f.session.check()
    const { status, staff } = f.session.get()
    assert.equal(status, 'signed_in')
    // The header: who, and the way out.
    assert.equal(staffLabel(staff), 'Anita Thomas · Nurse')
    assert.equal(SWITCH_USER, 'Switch user')
    assert.equal(initials(ANITA.name), 'AT')
    await f.api.review(7, { action: 'approve' })
    await f.api.amend(7, { volume_ml: 380, reason: 're-measured' })
    assert.deepEqual(
      f.seen.map((s) => [s.req, s.staff]),
      [
        ['GET /api/session', null],
        ['POST /api/entries/7/review', '4'],
        ['POST /api/entries/7/amend', '4'],
      ],
    )
  })

  it('[web/staff] Staff on shift: Nobody chosen', async () => {
    // Opened at /a/bed/<token>; the cookie is gone.
    const f = fakeServer()
    await f.session.check()
    assert.equal(f.session.get().status, 'signed_out')
    assert.equal(f.session.get().staff, null)
    assert.equal(f.session.staffId(), null)
    assert.deepEqual(f.reqs(), ['GET /api/session'])
    // Signed out, the bed link redirects to sign-in, keeping the URL as `next`.
    assert.deepEqual(signedOutRoute('/a/bed/tok_3A_1', '/a/bed/tok_3A_1'), { redirect: { to: LOGIN, next: '/a/bed/tok_3A_1' } })
    // Ravi signs in: the bed asked for opens, not his landing page.
    assert.deepEqual(await f.session.signIn('ravi', 'ravi'), { ok: true })
    assert.equal(landingPath(LOGIN, f.session.get().staff!, '/a/bed/tok_3A_1'), '/a/bed/tok_3A_1')
    assert.equal(landingPath('/a/bed/tok_3A_1', f.session.get().staff!), '/a/bed/tok_3A_1')
    assert.equal(landingPath('/', f.session.get().staff!), '/a')
  })

  it('[web/staff] Staff on shift: Stale choice', async () => {
    // The device was locked as Anita; her session ended meanwhile.
    const lock = JSON.stringify({ username: 'anita', name: 'Anita Thomas', role: 'nurse' })
    const storage = memory({ [LOCKED_KEY]: lock })
    const f = fakeServer({ storage })
    await f.session.check()
    assert.equal(f.session.get().status, 'signed_out')
    assert.equal(f.session.get().locked, null)
    assert.equal(storage.m.has(LOCKED_KEY), false)
    assert.deepEqual(f.reqs(), ['GET /api/session'])
    // Signed out at /n: the app redirects to the sign-in screen, not the ward list.
    assert.deepEqual(signedOutRoute('/n', '/n'), { redirect: { to: LOGIN, next: '/n' } })
    assert.deepEqual(signedOutRoute(LOGIN, LOGIN), { show: 'sign_in' })
    // Contrast: with a live session the same device stays locked.
    const live = fakeServer({ live: ANITA, storage: memory({ [LOCKED_KEY]: lock }) })
    await live.session.check()
    assert.equal(live.session.get().status, 'locked')
  })

  it('[web/staff] Staff on shift: Reads carry no staff id', async () => {
    const f = fakeServer({
      live: ANITA,
      routes: {
        'GET /api/wards': () => Response.json({ hospital: 'Meniscus Demo Hospital', wards: [] }),
        'GET /api/admissions/1/entries': () => Response.json({}),
        'GET /api/entries/7/events': () => Response.json([]),
      },
    })
    await f.session.check()
    await f.api.wards()
    await f.api.entries(1)
    await f.api.events(7)
    assert.deepEqual(
      f.seen.map((s) => s.staff),
      [null, null, null, null],
    )
  })

  it('[web/staff] Staff on shift: Landing by role', () => {
    // Signed in at /login with no next.
    assert.equal(LOGIN, '/login')
    assert.equal(landingPath(LOGIN, RAVI), '/a')
    assert.equal(landingPath(LOGIN, ANITA), '/n')
    assert.equal(landingPath(LOGIN, LAKSHMI), '/n')
    assert.equal(landingPath(LOGIN, SANA, null), '/d')
    assert.equal(landingPath('/', RAVI), '/a')
    assert.equal(landingPath('/', ANITA), '/n')
    assert.equal(landingPath('/', LAKSHMI), '/n')
    assert.equal(landingPath('/', SANA), '/d')
    assert.deepEqual(LANDING, { attendant: '/a', nurse: '/n', matron: '/n', dietitian: '/d' })
    assert.equal(staffLabel(SANA), 'Sana Mirza · Dietitian')
    // A deep link is kept for every role.
    assert.equal(landingPath('/n/w/3', RAVI), '/n/w/3')
  })
})
