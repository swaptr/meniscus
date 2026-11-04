/**
 * Area `dashboards` on Postgres, checked against the SQLite store's recorded answers (recorded.ts): the bed list (24 h
 * totals, hourly series, urine seen), a ward's quality rows and the read outcome rows. The activity was written once
 * through the SQLite store (entries, reviews, amends, levels, bag readings, meals, reads and their links); its recorded
 * rows are inserted into Postgres as they were, and Postgres must answer as SQLite did. In-process PGlite only.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { getTableColumns, type Table } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../../db/testing.ts'
import { entry, entry_event, level, meal, meal_event, media, model_read, read_link } from '../../db/schema.ts'
import type { ReadRow } from '../../ai/read-log.ts'
import { expected, type RecordedStore as SqliteStore } from './recorded.ts'
import type { Store } from '../port.ts'
import { openPgStore } from './store.ts'

/** What the SQLite store answered to these calls (see recorded.ts). */
const old = expected('dashboards')
const T0 = Date.UTC(2026, 10, 4, 10, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const handles: TestDb[] = []
after(async () => {
  for (const h of handles) await h.close()
})

/** As `pair()` in store.test.ts, with `value()` replaying the SQLite rows the activity left. */
async function pair() {
  let t = T0
  const clock = { now: () => t, set: (ms: number) => (t = ms) }
  const h = await createTestDb()
  handles.push(h)
  const pg = await openPgStore(h.db, { now: clock.now })
  const { store: lite, value } = old.session()
  return { pg, lite, clock, h, value }
}

/** Activity tables, parents first. The seed (wards, staff, admissions) is the same in both stores. */
const COPIED: [string, Table][] = [
  ['media', media],
  ['level', level],
  ['entry', entry],
  ['entry_event', entry_event],
  ['meal', meal],
  ['meal_event', meal_event],
  ['model_read', model_read],
  ['read_link', read_link],
]

/** Inserts the recorded SQLite activity rows into Postgres, value for value (epoch ms to timestamptz, JSON text to jsonb, 0/1 to boolean). */
async function copy(h: TestDb, value: <T>() => T) {
  for (const [, table] of COPIED) {
    const cols = getTableColumns(table)
    const rows = value<Record<string, unknown>[]>()
    if (!rows.length) continue
    const values = rows.map((r) =>
      Object.fromEntries(
        Object.entries(cols).map(([key, col]) => {
          const v = r[col.name] ?? null
          if (v === null) return [key, null]
          if (col.columnType === 'PgTimestamp') return [key, new Date(Number(v))]
          if (col.columnType === 'PgJsonb') return [key, JSON.parse(v as string)]
          if (col.columnType === 'PgBoolean') return [key, v === 1]
          return [key, v]
        }),
      ),
    )
    await h.db.insert(table).values(values)
  }
}

const sha = (n: number) => n.toString(16).padStart(64, '0')
const read = (over: Partial<ReadRow>): ReadRow =>
  ({
    kind: 'photo',
    mode: 'spark',
    models: ['muse-spark'],
    hint: null,
    staff_id: 4,
    admission_id: 1,
    confidence: 0.8,
    issues: [],
    needs_review: false,
    drafts: 1,
    output: { kind: 'photo', note: 'fixture' },
    ...over,
  }) as ReadRow

/** A day of fictional activity across two wards, at moving clock times. Returns the beds used. */
function activity(lite: SqliteStore, clock: { set: (ms: number) => number }) {
  const [a1, a2] = lite.admissions(1)
  const other = lite.admissions().find((a) => a.ward_id !== 1)!
  const bed1 = a1!.id
  const bed2 = a2!.id
  const at = (ms: number) => clock.set(ms)
  const iso = (ms: number) => new Date(ms).toISOString()

  // Older than 24 h: out of every window but the widest.
  at(T0 - 30 * HOUR)
  lite.addEntry(bed1, { direction: 'in', category: 'water', volume_ml: 999, source: 'manual' }, 4)

  // Exactly 24 h before the read time: the window's first instant, bucket 0.
  at(T0 - 24 * HOUR)
  const edge = lite.addEntry(bed1, { direction: 'in', category: 'water', volume_ml: 110, source: 'manual' }, 4)!
  lite.review(edge.id, 'approve', { staffId: 4 })

  // A photo read drafting a water entry, approved with a correction, then amended twice.
  at(T0 - 20 * HOUR)
  const photo = lite.addMedia(bed1, { kind: 'photo', mime: 'image/jpeg', sha256: sha(1), size: 1234 }, 4)!
  const r1 = lite.recordRead(read({ admission_id: bed1 }))
  const water = lite.addEntry(
    bed1,
    { direction: 'in', category: 'water', volume_ml: 200, source: 'photo', media_id: photo.id, read_id: r1, drink: 'tea', iddsi_level: 0 },
    4,
  )!
  at(T0 - 19 * HOUR)
  lite.review(water.id, 'approve', { staffId: 5, volumeMl: 180 })
  at(T0 - 18 * HOUR)
  lite.amend(water.id, { volume_ml: 160, reason: 'spilt' }, 5)
  lite.amend(water.id, { category: 'food', reason: 'was soup' }, 5)

  // A voice read with two drafts: urine (coloured, amended colour) and a rejected vomit.
  at(T0 - 6 * HOUR - 30 * MIN)
  const r2 = lite.recordRead(read({ kind: 'voice', mode: null, admission_id: bed1, drafts: 2, models: ['stt', 'muse-spark'] }))
  const urine = lite.addEntry(
    bed1,
    {
      direction: 'out',
      category: 'urine',
      volume_ml: 300,
      source: 'voice',
      read_id: r2,
      read_draft: 0,
      urine_colour: 'dark',
      urine_rgb: '#aa8800',
    },
    4,
  )!
  const vomit = lite.addEntry(bed1, { direction: 'out', category: 'vomit', volume_ml: 50, source: 'voice', read_id: r2, read_draft: 1 }, 4)!
  at(T0 - 6 * HOUR)
  lite.review(urine.id, 'approve', { staffId: 5 })
  lite.review(vomit.id, 'reject', { staffId: 5, reason: 'duplicate', note: 'twice' })
  lite.amend(urine.id, { urine_colour: 'yellow', reason: 'light' }, 5)

  // A rejected urine with a newer time: never the urine seen. A pending urine an hour later is.
  at(T0 - 3 * HOUR)
  const rej = lite.addEntry(bed1, { direction: 'out', category: 'urine', volume_ml: 90, source: 'manual', urine_colour: 'red' }, 4)!
  lite.review(rej.id, 'reject', { staffId: 5, reason: 'wrong_bed' })
  at(T0 - 2 * HOUR)
  lite.addEntry(bed1, { direction: 'out', category: 'urine', volume_ml: 120, source: 'manual', urine_colour: 'pale' }, 4)

  // A late entry (charted 3 h ago, recorded now) and one charted 30 s ahead of the clock.
  at(T0 - 10 * MIN)
  lite.addEntry(bed2, { direction: 'in', category: 'iv', volume_ml: 500, source: 'manual', charted_at: iso(T0 - 3 * HOUR - 10 * MIN) }, 4)
  const ahead = lite.addEntry(
    bed2,
    { direction: 'in', category: 'water', volume_ml: 70, source: 'manual', charted_at: iso(T0 - 10 * MIN + 30_000) },
    4,
  )!
  lite.review(ahead.id, 'approve', { staffId: 5 })

  // Jug levels: the first reading and a drop (a pending intake entry with after and before levels), from a photo read.
  at(T0 - 5 * HOUR)
  const jug1 = lite.addMedia(bed2, { kind: 'photo', mime: 'image/jpeg', sha256: sha(2), size: 2000 }, 4)!
  lite.addLevel(bed2, { container: 'water_jug', volume_ml: 900, source: 'photo', media_id: jug1.id }, 4)
  at(T0 - 4 * HOUR)
  const jug2 = lite.addMedia(bed2, { kind: 'photo', mime: 'image/jpeg', sha256: sha(3), size: 2100 }, 4)!
  const r3 = lite.recordRead(read({ admission_id: bed2, hint: 'water_jug' }))
  lite.addLevel(bed2, { container: 'water_jug', volume_ml: 600, source: 'photo', media_id: jug2.id, read_id: r3 }, 4)

  // A bag reading from a photo read.
  at(T0 - 90 * MIN)
  const bag = lite.addMedia(bed2, { kind: 'photo', mime: 'image/jpeg', sha256: sha(4), size: 3000 }, 4)!
  const r4 = lite.recordRead(read({ admission_id: bed2, hint: 'urine_bag' }))
  lite.addBagReading(bed2, { container: 'urine_bag', event: 'check', volume_ml: 400, source: 'photo', media_id: bag.id, read_id: r4 }, 4)

  // Tray reads: a photo meal with a proof, amended; retaken within the window; then a voided manual meal's read.
  at(T0 - 80 * MIN)
  const tray = lite.addMedia(bed2, { kind: 'photo', mime: 'image/jpeg', sha256: sha(5), size: 4000 }, 4)!
  // The first tray read, retaken five minutes later by the same staff member.
  lite.recordRead(read({ kind: 'tray', admission_id: bed2, drafts: 1 }))
  at(T0 - 75 * MIN)
  const r6 = lite.recordRead(read({ kind: 'tray', admission_id: bed2, drafts: 1 }))
  const dishes = [
    { index: 1, name: 'Rice', dish_kind: 'rice', portion: 75 },
    { index: 2, name: 'Dal', dish_kind: 'dal_lentils', portion: 50 },
  ] as const
  const m1 = lite.addMeal(
    bed2,
    {
      meal: 'lunch',
      portion: 75,
      fluid_ml: 150,
      source: 'photo',
      media_id: tray.id,
      dishes: dishes.map((d) => ({ ...d })),
      evidence: { kind: 'tray', note: 'fixture' } as never,
      read_id: r6,
    },
    4,
  )!
  at(T0 - 70 * MIN)
  lite.amendMeal(m1.id, { portion: 50, dishes: [{ ...dishes[0], portion: 25 }, { ...dishes[1] }], reason: 'left rice' }, 5)
  lite.review(m1.entry_id!, 'approve', { staffId: 5 })
  lite.amend(m1.entry_id!, { volume_ml: 100, reason: 'half' }, 5)
  at(T0 - 60 * MIN)
  const r7 = lite.recordRead(read({ kind: 'tray', admission_id: bed1, staff_id: 5 }))
  const m2 = lite.addMeal(bed1, { meal: 'snack', portion: 100, items: 'biscuits', source: 'manual', read_id: r7 }, 5)!
  lite.voidMeal(m2.id, 'wrong bed', 5)

  // A bedless read, and a read on another ward with an entry there.
  at(T0 - 30 * MIN)
  lite.recordRead(read({ admission_id: null, kind: 'text', mode: null }))
  const r9 = lite.recordRead(read({ admission_id: other.id, kind: 'text', mode: null }))
  lite.addEntry(other.id, { direction: 'in', category: 'water', volume_ml: 250, source: 'text', read_id: r9 }, 4)

  at(T0)
  return { bed1, bed2, other }
}

async function seeded() {
  const p = await pair()
  const beds = activity(p.lite, p.clock)
  await copy(p.h, p.value)
  return { ...p, ...beds }
}

const noToken = <T extends { qr_token: string }>(rows: T[]) => rows.map((a) => ({ ...a, qr_token: '-' }))

async function sameAdmissions(pg: Store, lite: SqliteStore, wardId?: number) {
  const got = await pg.admissions(wardId)
  assert.deepEqual(noToken(got), noToken(lite.admissions(wardId)))
  return got
}

describe('postgres store: dashboards', () => {
  it('admissions match before any activity, hospital-wide and per ward', async () => {
    const { pg, lite } = await pair()
    const all = await sameAdmissions(pg, lite)
    assert.ok(all.length > 4)
    for (const w of [1, 2, 3, 4, 999]) await sameAdmissions(pg, lite, w)
  })

  it('admissions match: 24 h totals, hourly series at the window edges and the urine seen', async () => {
    const { pg, lite, clock, bed1, bed2 } = await seeded()
    for (const t of [T0, T0 + 30 * MIN, T0 + 59 * MIN + 59_999, T0 + 4 * HOUR, T0 + 23 * HOUR, T0 + 30 * HOUR]) {
      clock.set(t)
      const all = await sameAdmissions(pg, lite)
      for (const w of [1, 2, 3, 4]) await sameAdmissions(pg, lite, w)
      if (t === T0) {
        const b1 = all.find((a) => a.id === bed1)!
        const b2 = all.find((a) => a.id === bed2)!
        // The fixture reaches what it means to: totals, pending, a full series and a pending urine seen.
        assert.equal(b1.totals.in_ml, 110 + 160)
        assert.ok(b1.pending >= 1)
        assert.equal(b1.urine_seen?.colour, 'pale')
        assert.equal(b1.urine_seen?.status, 'pending')
        assert.equal(b1.hourly.in_ml[0], 110)
        assert.ok(b2.hourly.in_ml[23]! > 0)
        assert.equal(
          b2.hourly.in_ml.reduce((s, v) => s + v, 0),
          b2.totals.in_ml,
        )
      }
    }
  })

  it('ward entries match, newest charted first, with media, levels and late flags', async () => {
    const { pg, lite, clock, other } = await seeded()
    for (const w of [1, 2, 3, 4, 999])
      for (const since of [T0 - 48 * HOUR, T0 - 24 * HOUR, T0 - 5 * HOUR, T0 + HOUR]) {
        assert.deepEqual(await pg.wardEntries(w, since), lite.wardEntries(w, since))
      }
    const rows = await pg.wardEntries(1, T0 - 48 * HOUR)
    assert.ok(rows.some((r) => r.entry.levels?.before && r.entry.levels.after.media))
    assert.ok(rows.some((r) => r.entry.late))
    assert.ok(rows.some((r) => r.entry.media?.kind === 'photo' && r.entry.has_photo))
    assert.ok((await pg.wardEntries(other.ward_id, T0 - 48 * HOUR)).length > 0)
    clock.set(T0 + HOUR)
    assert.deepEqual(await pg.wardEntries(1, T0 - 24 * HOUR), lite.wardEntries(1, T0 - 24 * HOUR))
  })

  it('read outcome rows match: links to entries, levels and meals, amends, retakes and bedless reads', async () => {
    const { pg, lite } = await seeded()
    for (const since of [T0 - 48 * HOUR, T0 - 6 * HOUR, T0 - 70 * MIN, T0 + HOUR])
      for (const w of [undefined, 1, 2, 3, 4, 999]) {
        // structuredClone: the SQLite store passes some node:sqlite rows through as they are, with a null prototype.
        assert.deepEqual(await pg.readOutcomeRows(since, w), structuredClone(lite.readOutcomeRows(since, w)))
      }
    const rows = await pg.readOutcomeRows(T0 - 48 * HOUR)
    assert.ok(rows.some((r) => r.ward_id === null))
    assert.ok(rows.some((r) => r.retaken === true) && rows.some((r) => r.retaken === false))
    assert.ok(rows.some((r) => r.links.some((k) => k.meal?.confirmed && k.meal.amends.length && k.meal.entry?.amends.length)))
    assert.ok(rows.some((r) => r.links.some((k) => k.meal?.voided)))
    assert.ok(rows.some((r) => r.links.some((k) => k.level?.event === 'check')))
    assert.ok(rows.some((r) => r.links.some((k) => k.entry?.amends.length === 2)))
    assert.ok(rows.some((r) => r.links.length === 2))
  })
})
