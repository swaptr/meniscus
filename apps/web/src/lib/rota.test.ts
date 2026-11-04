import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { AdmissionSummary, AssignBedsInput, Staff, WardSummary, WardTeam } from '@meniscus/shared'
import { createPoll } from './poll.ts'
import {
  accessGrants,
  assignBed,
  bedNurse,
  canAssign,
  cancelTo,
  canTakeCharge,
  grantAccess,
  inChargeLine,
  inChargeText,
  myBeds,
  needsReason,
  nurseOptions,
  outsideTeam,
  reasonBody,
  splitWards,
  takeCharge,
  visibleBeds,
} from './rota.ts'
import { ANITA, DIVYA, fakeServer, GRACE, LAKSHMI, MEERA, memory, MOHAN, NIKHIL, RAVI, SANA, SUNITA } from './staff-fixtures.ts'
import { canDecide, decisionNotice } from './staff.ts'
import { bedLoad, wardLoads } from './ward.ts'

/** 2 Nov 2026 at hh:mm local time (epoch ms). */
const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m).getTime()
const DAY = new Date(at(8)).toISOString()
const ref = (s: Staff) => ({ id: s.id, name: s.name, role: s.role })
const member = (s: Staff, home: boolean) => ({ ...ref(s), home })

const TEAM_3A: WardTeam = {
  ward_id: 2,
  shift_start: DAY,
  in_charge: ref(ANITA),
  team: [member(ANITA, true), member(GRACE, false), member(MEERA, false), member(RAVI, true), member(SUNITA, true)],
  assignments: [],
}
const TEAM_HDU: WardTeam = {
  ward_id: 4,
  shift_start: DAY,
  in_charge: ref(NIKHIL),
  team: [member(NIKHIL, true), member(DIVYA, true)],
  assignments: [
    { admission_id: 31, staff_id: 7 },
    { admission_id: 32, staff_id: 7 },
    { admission_id: 33, staff_id: 8 },
  ],
}
const bed = (id: number, no: string, prompts: number): AdmissionSummary => ({
  id,
  bed: no,
  patient: `Patient ${no}`,
  weight_kg: 70,
  qr_token: `tok_${id}`,
  admitted_at: new Date(at(6)).toISOString(),
  ward_id: 4,
  ward_code: 'HDU',
  ward_name: 'Renal HDU',
  mrn: `AT-90${id}`,
  totals: { in_ml: 0, out_ml: 0, balance_ml: 0, pending_ml: 0 },
  pending: 0,
  alerts: Array.from({ length: prompts }, () => ({ kind: 'logging_gap' as const, message: 'No intake logged for 3 h.' })),
  hourly: { in_ml: [], out_ml: [], in_logged: [] },
  urine_seen: null,
  care: { orders: [], fluid_limit: null, intake_target: null, catheter: null },
  devices: { urine: 'urinal', urine_from: 'default', urine_measured: true, bags: [] },
  acuity: { level: 'stable', source: 'ward', order_id: null, suggested: null, reasons: [] },
  nutrition: { dietitian_available: true, dietitian: null, referral: null },
})
// Beds 1 and 3 have prompts.
const HDU_BEDS = [bed(31, '1', 1), bed(32, '2', 0), bed(33, '3', 2)]
const beds = (list: AdmissionSummary[] | null) => list?.map((b) => b.bed) ?? null

const wardSummary = (id: number, code: string, name: string, inCharge: Staff | null): WardSummary => ({
  id,
  code,
  name,
  specialty: 'General',
  capacity: 6,
  default_acuity: 'stable',
  occupied: 4,
  pending: 0,
  beds_with_alerts: 0,
  last_entry_at: null,
  in_charge: inCharge && ref(inCharge),
})
const WARDS = [
  wardSummary(1, '2C', 'General Medicine 2C', MEERA),
  wardSummary(2, '3A', 'Surgical Ward 3A', ANITA),
  wardSummary(3, '5B', 'Neurology Ward 5B', GRACE),
  wardSummary(4, 'HDU', 'Renal HDU', null),
]

describe('your wards first', () => {
  it('[web/ward] Your wards first: Grace on shift', () => {
    const { yours, others } = splitWards(WARDS, GRACE)
    assert.deepEqual(
      yours.map((w) => w.code),
      ['5B', '3A'],
    )
    assert.deepEqual(
      others.map((w) => w.code),
      ['2C', 'HDU'],
    )
  })

  it('[web/ward] Your wards first: Outside the team', () => {
    assert.equal(outsideTeam(4, 'Renal HDU', MOHAN), 'You are not on the Renal HDU team. Changes are recorded in your name.')
    assert.equal(outsideTeam(3, 'Neurology Ward 5B', MOHAN), null)
  })

  it("[web/ward] Your wards first: Matron's wards", () => {
    const { yours, others } = splitWards(WARDS, LAKSHMI)
    assert.deepEqual(
      yours.map((w) => w.code),
      ['2C', '3A', '5B', 'HDU'],
    )
    assert.deepEqual(others, [])
    assert.deepEqual(yours.map(inChargeLine), ['In charge: Meera P.', 'In charge: Anita T.', 'In charge: Grace L.', 'No nurse in charge'])
  })
})

describe('nurse in charge on the ward', () => {
  it('[web/ward] Nurse in charge on the ward: In charge on 3A', () => {
    assert.equal(inChargeText(TEAM_3A, at(10)), 'In charge: Anita T. · day shift')
  })

  it('[web/ward] Nurse in charge on the ward: Take charge', async () => {
    const f = fakeServer({
      live: GRACE,
      routes: { 'PUT /api/wards/2/in-charge': () => Response.json({ ...TEAM_3A, in_charge: ref(GRACE) }) },
    })
    await f.session.check()
    const before = f.seen.length
    const team = await takeCharge(f.api, 2, GRACE.id)
    assert.deepEqual(
      f.seen.slice(before).map((s) => [s.req, s.staff, s.body]),
      [['PUT /api/wards/2/in-charge', '5', { staff_id: 5 }]],
    )
    assert.equal(inChargeText(team, at(10)), 'In charge: Grace L. · day shift')
  })

  it('[web/ward] Nurse in charge on the ward: Who sees Take charge', () => {
    const sees = [RAVI, NIKHIL, ANITA, MEERA].filter((s) => canTakeCharge(TEAM_3A, s, at(10)))
    assert.deepEqual(sees, [MEERA])
  })

  it('[web/ward] Nurse in charge on the ward: Shift changes while open', () => {
    // Loaded at 19:50; still open at 20:01.
    assert.equal(inChargeText(TEAM_3A, at(19, 50)), 'In charge: Anita T. · day shift')
    assert.equal(canTakeCharge(TEAM_3A, ANITA, at(19, 50)), false)
    assert.equal(inChargeText(TEAM_3A, at(20, 1)), 'No nurse in charge this shift')
    assert.equal(canTakeCharge(TEAM_3A, ANITA, at(20, 1)), true)
  })

  it('[web/ward] Nurse in charge on the ward: Nobody in charge', () => {
    assert.equal(inChargeText({ ...TEAM_3A, in_charge: null }, at(10)), 'No nurse in charge this shift')
  })
})

describe('my beds', () => {
  it("[web/ward] My beds: Divya's beds", () => {
    const mine = myBeds(HDU_BEDS, TEAM_HDU, DIVYA, at(10))
    assert.deepEqual(beds(mine), ['3'])
    // On by default; off lists all three.
    assert.deepEqual(beds(visibleBeds(HDU_BEDS, mine, true)), ['3'])
    assert.deepEqual(beds(visibleBeds(HDU_BEDS, mine, false)), ['1', '2', '3'])
    assert.equal(bedNurse(TEAM_HDU, 33, at(10)), 'Nurse: Divya K.')
  })

  it('[web/ward] My beds: In charge keeps prompts', () => {
    // Beds 1 and 2 are his; bed 3 is Divya's but has prompts.
    assert.deepEqual(beds(myBeds(HDU_BEDS, TEAM_HDU, NIKHIL, at(10))), ['1', '2', '3'])
  })

  it('[web/ward] My beds: No beds, no filter', () => {
    assert.equal(myBeds(HDU_BEDS, TEAM_HDU, LAKSHMI, at(10)), null)
    assert.equal(myBeds(HDU_BEDS, TEAM_HDU, RAVI, at(10)), null)
    assert.deepEqual(beds(visibleBeds(HDU_BEDS, null, true)), ['1', '2', '3'])
    assert.deepEqual(
      HDU_BEDS.map((b) => bedNurse(TEAM_HDU, b.id, at(10))),
      ['Nurse: Nikhil B.', 'Nurse: Nikhil B.', 'Nurse: Divya K.'],
    )
  })

  it('[web/ward] My beds: Shift ends while open', () => {
    // Loaded at 19:50; still open at 20:01.
    assert.deepEqual(beds(myBeds(HDU_BEDS, TEAM_HDU, DIVYA, at(19, 50))), ['3'])
    assert.deepEqual(
      HDU_BEDS.map((b) => bedNurse(TEAM_HDU, b.id, at(20, 1))),
      ['Unassigned', 'Unassigned', 'Unassigned'],
    )
    assert.equal(myBeds(HDU_BEDS, TEAM_HDU, DIVYA, at(20, 1)), null)
    assert.equal(myBeds(HDU_BEDS, TEAM_HDU, NIKHIL, at(20, 1)), null)
  })
})

describe('assign beds from the dashboard', () => {
  it('[web/ward] Assign beds from the dashboard: Nikhil moves bed 2', async () => {
    const f = fakeServer({
      live: NIKHIL,
      routes: {
        'PUT /api/wards/4/assignments': (body) => Response.json({ ...TEAM_HDU, assignments: (body as unknown as AssignBedsInput).beds }),
      },
    })
    await f.session.check()
    const before = f.seen.length
    const team = await assignBed(f.api, TEAM_HDU, 32, DIVYA.id, at(10))
    assert.deepEqual(
      f.seen.slice(before).map((s) => [s.req, s.staff]),
      [['PUT /api/wards/4/assignments', '7']],
    )
    assert.deepEqual(f.seen[before]!.body, {
      beds: [
        { admission_id: 31, staff_id: 7 },
        { admission_id: 32, staff_id: 8 },
        { admission_id: 33, staff_id: 8 },
      ],
    })
    assert.equal(bedNurse(team, 32, at(10)), 'Nurse: Divya K.')
    // Unassigned leaves the bed out.
    await assignBed(f.api, team, 32, null, at(10))
    assert.deepEqual(f.seen.at(-1)!.body, {
      beds: [
        { admission_id: 31, staff_id: 7 },
        { admission_id: 33, staff_id: 8 },
      ],
    })
  })

  it('[web/ward] Assign beds from the dashboard: Who sees the pickers', () => {
    const sees = [NIKHIL, LAKSHMI, DIVYA, RAVI].filter((s) => canAssign(TEAM_HDU, s, at(10)))
    assert.deepEqual(sees, [NIKHIL, LAKSHMI])
    // The picker lists the team's nurses and Unassigned.
    assert.deepEqual(
      nurseOptions(TEAM_HDU).map((o) => o.label),
      ['Unassigned', 'Nikhil Bose', 'Divya Kapoor'],
    )
    // Nobody is in charge once the shift ends; the matron still assigns.
    assert.equal(canAssign(TEAM_HDU, NIKHIL, at(20, 1)), false)
    assert.equal(canAssign(TEAM_HDU, LAKSHMI, at(20, 1)), true)
  })
})

describe('decisions need a nurse', () => {
  it('[web/ward] Decisions need a nurse: Attendant on the bed review', () => {
    assert.equal(canDecide(RAVI), false)
    assert.equal(decisionNotice(RAVI), 'Only a nurse can approve or change entries. Ask the nurse in charge.')
  })

  it('[web/ward] Decisions need a nurse: Nurse or matron', () => {
    for (const s of [ANITA, LAKSHMI]) {
      assert.equal(canDecide(s), true)
      assert.equal(decisionNotice(s), null)
    }
  })

  it('[web/ward] Decisions need a nurse: Dietitian on the bed review', () => {
    assert.equal(canDecide(SANA), false)
    assert.equal(decisionNotice(SANA), 'Only a nurse can approve or change entries. Ask the nurse in charge.')
  })
})

describe('reason to open another ward', () => {
  const HDU_ROUTES = {
    'POST /api/wards/4/access': (body: Record<string, unknown> | null) =>
      body?.password === 'grace'
        ? Response.json(
            { id: 1, ward_id: 4, created_by: ref(GRACE), reason: body.reason, created_at: new Date(at(10)).toISOString() },
            { status: 201 },
          )
        : Response.json({ error: 'invalid_credentials' }, { status: 401 }),
    'GET /api/admissions\\?ward=4': () => Response.json(HDU_BEDS),
    'GET /api/wards/4/team': () => Response.json(TEAM_HDU),
    'GET /api/admissions/31/entries': () => Response.json({ admission: { id: 31, ward_id: 4 } }),
    'GET /api/admissions/31/meals': () => Response.json([]),
  }

  it('[web/ward] Reason to open another ward: Reason before HDU opens', async () => {
    const f = fakeServer({ live: GRACE, routes: HDU_ROUTES })
    await f.session.check()
    const grants = accessGrants(memory())
    const before = f.seen.length
    assert.equal(needsReason(4, GRACE, at(10), grants), true)
    // "Open ward" stays disabled while either field is blank.
    assert.equal(reasonBody('', 'grace'), null)
    assert.equal(reasonBody('Covering HDU during break', ''), null)
    assert.equal(reasonBody('   ', 'grace'), null)
    assert.equal(reasonBody('x'.repeat(201), 'grace'), null)
    assert.equal(f.seen.length, before)
    const body = reasonBody('  Covering HDU during break ', 'grace')
    assert.deepEqual(body, { reason: 'Covering HDU during break', password: 'grace' })
    assert.deepEqual(await grantAccess(f.api, 4, GRACE.id, body, at(10), grants), { ok: true })
    assert.equal(needsReason(4, GRACE, at(10), grants), false)
    // Then the dashboard's two loads.
    const load = wardLoads(f.api, 4)
    const signal = new AbortController().signal
    await Promise.all([load.beds(signal), load.team(signal)])
    assert.deepEqual(
      f.seen.slice(before).map((s) => [s.req, s.staff]),
      [
        ['POST /api/wards/4/access', '5'],
        ['GET /api/admissions?ward=4', null],
        ['GET /api/wards/4/team', null],
      ],
    )
    assert.deepEqual(f.seen[before]!.body, { reason: 'Covering HDU during break', password: 'grace' })
    assert.equal(outsideTeam(4, 'Renal HDU', GRACE), 'You are not on the Renal HDU team. Changes are recorded in your name.')
  })

  it('[web/ward] Reason to open another ward: Wrong password at the reason', async () => {
    const f = fakeServer({ live: GRACE, routes: HDU_ROUTES })
    await f.session.check()
    const storage = memory()
    const grants = accessGrants(storage)
    const before = f.seen.length
    const r = await grantAccess(f.api, 4, GRACE.id, reasonBody('Covering HDU during break', 'wrong')!, at(10), grants)
    assert.deepEqual(r, { ok: false, error: 'Wrong password' })
    assert.equal(needsReason(4, GRACE, at(10), grants), true)
    assert.deepEqual(grants.list(), [])
    assert.equal(storage.m.size, 0)
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['POST /api/wards/4/access'],
    )
    // A wrong password is not an ended session: still signed in.
    assert.equal(f.session.get().status, 'signed_in')
  })

  describe('with a clock', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setInterval', 'Date'], now: at(10) }))
    afterEach(() => mock.timers.reset())

    it('[web/ward] Reason to open another ward: Bed review by direct link', async () => {
      const f = fakeServer({ live: GRACE, routes: HDU_ROUTES })
      await f.session.check()
      const grants = accessGrants(memory())
      const before = f.seen.length
      // The bed review's own loader: its first load (entries and meals) names ward 4.
      const load = bedLoad(f.api, 31)
      const first = await load(new AbortController().signal)
      assert.equal(first.admission.ward_id, 4)
      assert.equal(needsReason(first.admission.ward_id, GRACE, Date.now(), grants), true)
      const stop = createPoll({
        ms: 30_000,
        paused: () => needsReason(4, GRACE, Date.now(), grants),
        visible: () => true,
        tick: () => void load(new AbortController().signal),
      })
      mock.timers.tick(60_000) // 10:01
      assert.deepEqual(
        f.seen.slice(before).map((s) => s.req),
        ['GET /api/admissions/31/entries', 'GET /api/admissions/31/meals'],
      )
      stop()
    })
  })

  it('[web/ward] Reason to open another ward: Asked once a shift', async () => {
    const f = fakeServer({ live: GRACE, routes: HDU_ROUTES })
    await f.session.check()
    const storage = memory()
    const grants = accessGrants(storage)
    assert.deepEqual(await grantAccess(f.api, 4, GRACE.id, reasonBody('Covering HDU during break', 'grace')!, at(10, 15), grants), {
      ok: true,
    })
    const sent = f.seen.length
    // 14:00: the HDU dashboard, then the bed review of HDU bed 2 (same ward): no dialog, no request.
    assert.equal(needsReason(4, GRACE, at(14), grants), false)
    assert.equal(needsReason(HDU_BEDS[1]!.ward_id, GRACE, at(14), grants), false)
    assert.equal(f.seen.length, sent)
    // Another person on this device is asked for their own reason.
    assert.equal(needsReason(4, MEERA, at(14, 5), grants), true)
    // The night shift asks again; a reload of the device keeps the day's grant.
    assert.equal(needsReason(4, GRACE, at(20, 5), grants), true)
    assert.equal(needsReason(4, GRACE, at(14), accessGrants(storage)), false)
  })

  it('[web/ward] Reason to open another ward: Cancel stays put', () => {
    const f = fakeServer({ live: GRACE, routes: HDU_ROUTES })
    const grants = accessGrants(memory())
    // From the ward list: back one page, to /n. By direct link: to /n.
    assert.equal(cancelTo(true), 'back')
    assert.equal(cancelTo(false), '/n')
    assert.equal(needsReason(4, GRACE, at(10), grants), true)
    assert.deepEqual(f.seen, [])
  })

  it('[web/ward] Reason to open another ward: Own ward or matron', () => {
    const grants = accessGrants(memory())
    assert.equal(needsReason(2, GRACE, at(10), grants), false)
    assert.equal(needsReason(4, LAKSHMI, at(10), grants), false)
  })
})
