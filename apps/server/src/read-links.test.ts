import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TestDb } from './db/testing.ts'
import { LUNCH, RAVI, SUNITA, nov, setup } from './read-fixture.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { testDb } from './testing.ts'

describe('link a saved record to its read', () => {
  it('[charting/model-accuracy] Link a saved record to its read: Photo entry', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 450, capacity_ml: 1000 })
    const before = t.requests()
    const r = await t.entry(bed1, { volume_ml: 450, read_id: read })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.ok(await t.store.linked(read, 0))
    assert.deepEqual(
      (await t.links(read)).map((l) => [l.draft, l.entry?.volume_ml]),
      [[0, 450]],
    )
    assert.equal(t.requests(), before)
  })

  it('[charting/model-accuracy] Link a saved record to its read: Two drafts of a voice note', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.voiceRead(bed1, [
      { direction: 'in', category: 'water', volume_ml: 200 },
      { direction: 'out', category: 'urine', volume_ml: 300 },
    ])
    const before = t.requests()
    const tea = await t.entry(bed1, { direction: 'in', category: 'water', volume_ml: 200, source: 'voice', read_id: read, read_draft: 0 })
    const urine = await t.entry(bed1, { volume_ml: 300, source: 'voice', read_id: read, read_draft: 1 })
    assert.deepEqual([tea.status, urine.status], [201, 201])
    assert.deepEqual(
      (await t.links(read)).map((l) => [l.draft, l.entry?.category, l.entry?.volume_ml]),
      [
        [0, 'water', 200],
        [1, 'urine', 300],
      ],
    )
    assert.equal(t.requests(), before)
  })

  it('[charting/model-accuracy] Link a saved record to its read: Jug level', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    assert.equal((await t.level(bed1, { volume_ml: 1000, source: 'manual' })).status, 201)
    const read = await t.photoRead(bed1, { container: 'water_jug', fluid: 'water', volume_ml: 600, capacity_ml: 1500 })
    const before = t.requests()
    const r = await t.level(bed1, { volume_ml: 600, read_id: read })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.entry?.volume_ml, 400)
    assert.deepEqual(await t.links(read), [{ draft: 0, level: { volume_ml: 600, container: 'water_jug', event: null } }])
    assert.equal(t.requests(), before)
  })
})

describe('link checks', () => {
  it('[charting/model-accuracy] Link checks: Linked twice', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const before = await t.held(bed1)
    const first = await t.entry(bed1, { read_id: read })
    const again = await t.entry(bed1, { read_id: read })
    assert.deepEqual([first.status, again.status, again.body.error], [201, 400, 'invalid_request'])
    assert.deepEqual(again.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.deepEqual(await t.held(bed1), { ...before, entries: before.entries + 1 })
  })

  it('[charting/model-accuracy] Link checks: Linked twice (the link taken between the check and the save)', async () => {
    // A store whose `linked` answers the route's check, then lets another request link the same draft (read_link
    // inserted on the database) before the entry's own transaction runs: the save must still answer 400, never 500.
    let h!: TestDb
    let race: { read: number; entry: number } | undefined
    const open = async (now: () => number): Promise<Store> => {
      h = await testDb()
      const store = await openPgStore(h.db, { now })
      return new Proxy(store, {
        get(target, key, receiver) {
          if (key !== 'linked') return Reflect.get(target, key, receiver) as unknown
          return async (readId: number, draft: number) => {
            const answer = await target.linked(readId, draft)
            if (race?.read === readId) {
              await h.pg.query('INSERT INTO meniscus.read_link (read_id, draft, entry_id, linked_at) VALUES ($1, $2, $3, now())', [
                readId,
                draft,
                race.entry,
              ])
              race = undefined
            }
            return answer
          }
        },
      })
    }
    const t = await setup(nov(3, 8), open)
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const other = await t.entry(bed1, { volume_ml: 300, source: 'manual' })
    assert.equal(other.status, 201)
    const before = await t.held(bed1)
    race = { read, entry: other.body.id }
    const r = await t.entry(bed1, { read_id: read })
    assert.equal(race, undefined, 'the conflicting link was inserted after the check')
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    assert.deepEqual(r.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.deepEqual(await t.held(bed1), before)
  })

  it('[charting/model-accuracy] Link checks: No such draft', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.voiceRead(bed1, [
      { direction: 'in', category: 'water', volume_ml: 200 },
      { direction: 'out', category: 'urine', volume_ml: 300 },
    ])
    const before = await t.held(bed1)
    const r = await t.entry(bed1, { source: 'voice', read_id: read, read_draft: 2 })
    assert.deepEqual([r.status, r.body.error, r.body.issues?.[0]?.path], [400, 'invalid_request', 'read_draft'])
    assert.deepEqual(await t.held(bed1), before)
  })

  it('[charting/model-accuracy] Link checks: Another staff member or bed', async () => {
    const t = await setup()
    const [bed1, bed2] = [await t.bed('3A', '1'), await t.bed('3A', '2')]
    const read = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const before = [await t.held(bed1), await t.held(bed2)]
    const sunita = await t.entry(bed1, { read_id: read }, SUNITA)
    const otherBed = await t.entry(bed2, { read_id: read }, RAVI)
    assert.deepEqual(
      [sunita.status, sunita.body.error, otherBed.status, otherBed.body.error],
      [400, 'invalid_request', 400, 'invalid_request'],
    )
    assert.deepEqual([await t.held(bed1), await t.held(bed2)], before)
    assert.equal(await t.store.linked(read, 0), false)
  })

  it('[charting/model-accuracy] Link checks: Bedless read', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(null, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const before = await t.held(bed1)
    const r = await t.entry(bed1, { read_id: read })
    assert.deepEqual([r.status, r.body.error, r.body.issues?.[0]?.path], [400, 'invalid_request', 'read_id'])
    assert.deepEqual(await t.held(bed1), before)
  })

  it('[charting/model-accuracy] Link checks: Draft index without a read', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const before = await t.held(bed1)
    const r = await t.entry(bed1, { read_draft: 0 })
    assert.deepEqual([r.status, r.body.error, r.body.issues?.map((i) => i.path)], [400, 'invalid_request', ['read_draft']])
    assert.deepEqual(await t.held(bed1), before)
    assert.equal(t.requests(), 0)
  })

  it('[charting/model-accuracy] Link checks: Too old', async () => {
    const t = await setup(nov(3, 8))
    const bed1 = await t.bed('3A', '1')
    const first = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const second = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 300 })
    // Each post signs Ravi Kumar in again on the store's clock: the 08:00 session has gone idle, and a 19:59 one ends at 20:00.
    t.at(nov(3, 19, 59))
    const ok = await t.entry(bed1, { read_id: first })
    t.at(nov(3, 20))
    const old = await t.entry(bed1, { volume_ml: 300, read_id: second })
    assert.deepEqual([ok.status, old.status, old.body.error, old.body.issues?.[0]?.path], [201, 400, 'invalid_request', 'read_id'])
    assert.equal((await t.store.entries(bed1))!.entries.length, 1)
  })

  it('[charting/model-accuracy] Link checks: Wrong kind or unknown read', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const photo = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const text = await t.textRead(bed1, [{ direction: 'in', category: 'water', volume_ml: 200 }])
    const before = [await t.held(bed1), t.requests()]
    const posts = [
      await t.entry(bed1, { source: 'voice', read_id: photo }),
      await t.entry(bed1, { direction: 'in', category: 'water', volume_ml: 200, source: 'manual', read_id: text }),
      await t.level(bed1, { volume_ml: 600, source: 'photo', read_id: text }),
      await t.entry(bed1, { read_id: 9999 }),
    ]
    for (const r of posts) assert.deepEqual([r.status, r.body.error, r.body.issues?.[0]?.path], [400, 'invalid_request', 'read_id'])
    assert.deepEqual([await t.held(bed1), t.requests()], before)
    assert.deepEqual([await t.store.linked(photo, 0), await t.store.linked(text, 0)], [false, false])
  })
})

describe('link a bag reading to its read', () => {
  const BAG = { container: 'urine_bag', fluid: 'urine', volume_ml: 380, capacity_ml: 2000 } as const

  it('[charting/model-accuracy] Link a bag reading to its read: Emptying linked', async () => {
    const t = await setup()
    const bed3 = await t.bed('3A', '3')
    const read = await t.photoRead(bed3, BAG)
    const photo = await t.upload(bed3)
    const before = t.requests()
    const r = await t.bag(bed3, { volume_ml: 380, media_id: photo.id, evidence: t.evidence(), read_id: read })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.entry?.volume_ml, 380)
    assert.deepEqual(await t.links(read), [{ draft: 0, level: { volume_ml: 380, container: 'urine_bag', event: 'emptied' } }])
    assert.equal(t.requests(), before)
  })

  it('[charting/model-accuracy] Link a bag reading to its read: Nothing charted', async () => {
    const t = await setup(nov(3, 10, 2))
    const bed3 = await t.bed('3A', '3')
    assert.equal((await t.bag(bed3, { event: 'check', volume_ml: 300, source: 'manual' })).status, 201)
    t.at(nov(3, 10, 13))
    const read = await t.photoRead(bed3, { ...BAG, volume_ml: 300 })
    const photo = await t.upload(bed3)
    const before = t.requests()
    const r = await t.bag(bed3, { event: 'check', volume_ml: 300, media_id: photo.id, evidence: t.evidence(), read_id: read })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.deepEqual([r.body.reading.rise_ml, r.body.entry], [0, null])
    assert.equal(await t.store.linked(read, 0), true)
    assert.equal(t.requests(), before)
  })

  it('[charting/model-accuracy] Link a bag reading to its read: Photo, level typed', async () => {
    const t = await setup()
    const bed3 = await t.bed('3A', '3')
    const photo = await t.upload(bed3)
    const r = await t.bag(bed3, { volume_ml: 400, media_id: photo.id })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.deepEqual(await t.store.readOutcomeRows(0), [])
    const q = await t.quality(`?ward=${(await t.store.admission(bed3))!.ward_id}`)
    assert.equal(q.status, 200)
    for (const k of q.body.kinds) assert.ok(Object.values(k.outcomes).every((n) => n === 0))
    assert.equal(t.requests(), 0)
  })

  it('[charting/model-accuracy] Link a bag reading to its read: Refused links', async () => {
    const t = await setup()
    const [bed1, bed3] = [await t.bed('3A', '1'), await t.bed('3A', '3')]
    const other = await t.photoRead(bed1, BAG)
    const text = await t.textRead(bed3, [{ direction: 'out', category: 'urine', volume_ml: 380 }])
    const read = await t.photoRead(bed3, BAG)
    const ev = t.evidence()
    const photo = await t.upload(bed3)
    const sunitaPhoto = await t.upload(bed3, SUNITA)
    const before = [await t.held(bed3), t.requests()]
    const photoBody = { volume_ml: 380, media_id: photo.id, evidence: ev }
    const posts = [
      await t.bag(bed3, { ...photoBody, media_id: sunitaPhoto.id, read_id: read }, SUNITA),
      await t.bag(bed3, { ...photoBody, read_id: other }),
      await t.bag(bed3, { ...photoBody, read_id: text }),
      await t.bag(bed3, { volume_ml: 380, source: 'manual', read_id: read }),
    ]
    t.at(nov(3, 20))
    posts.push(await t.bag(bed3, { ...photoBody, read_id: read }))
    for (const r of posts) assert.deepEqual([r.status, r.body.error, r.body.issues?.[0]?.path], [400, 'invalid_request', 'read_id'])
    assert.deepEqual([await t.held(bed3), t.requests()], before)
    assert.equal(await t.store.linked(read, 0), false)
  })

  it('[charting/model-accuracy] Link a bag reading to its read: Posted again', async () => {
    const t = await setup()
    const bed3 = await t.bed('3A', '3')
    const read = await t.photoRead(bed3, BAG)
    const photo = await t.upload(bed3)
    const body = { volume_ml: 380, media_id: photo.id, evidence: t.evidence(), read_id: read }
    const before = t.requests()
    const first = await t.bag(bed3, body)
    const again = await t.bag(bed3, body)
    assert.deepEqual([first.status, again.status], [201, 400])
    assert.deepEqual(again.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.equal((await t.store.bagReadings(bed3, 0)).length, 1)
    assert.deepEqual(
      (await t.store.entries(bed3))!.entries.filter((e) => e.category === 'urine').map((e) => e.volume_ml),
      [380],
    )
    assert.equal(t.requests(), before)
  })
})

describe('link a meal to its read', () => {
  it('[charting/model-accuracy] Link a meal to its read: Lunch linked', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.trayRead(bed1, LUNCH)
    const before = t.requests()
    const r = await t.mealFrom(bed1, read)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.fluid_ml, 150)
    assert.ok(await t.store.linked(read.read_id, 0))
    const links = await t.links(read.read_id)
    assert.deepEqual(
      links.map((l) => [l.draft, l.meal?.id, l.entry]),
      [[0, r.body.id, undefined]],
    )
    assert.equal(links[0]!.meal!.entry?.recorded_ml, 150)
    assert.equal(t.requests(), before)
  })

  it('[charting/model-accuracy] Link a meal to its read: Refused meal links', async () => {
    const fresh = async () => {
      const t = await setup()
      const bed1 = await t.bed('3A', '1')
      const read = await t.trayRead(bed1, LUNCH)
      return { t, bed1, read }
    }
    type Post = { status: number; body: { error?: string; issues?: { path: string }[] } }
    const posts: Post[] = []
    /** On a fresh store: `prep` makes any other read first (default: read 61), then `post` is the one refused post. */
    const check = async (
      label: string,
      post: (f: Awaited<ReturnType<typeof fresh>>, readId: number) => Promise<Post>,
      prep?: (f: Awaited<ReturnType<typeof fresh>>) => Promise<number>,
    ) => {
      const f = await fresh()
      const readId = prep ? await prep(f) : f.read.read_id
      const before = await f.t.held(f.bed1)
      const reqs = f.t.requests()
      const r = await post(f, readId)
      assert.deepEqual([r.status, r.body.error, r.body.issues?.[0]?.path], [400, 'invalid_request', 'read_id'], label)
      assert.deepEqual(await f.t.held(f.bed1), before, label)
      assert.equal(f.t.requests(), reqs, label)
      assert.equal(await f.t.store.linked(f.read.read_id, 0), false, label)
      posts.push(r)
    }
    const lunchWith = (f: Awaited<ReturnType<typeof fresh>>, readId: number, staff = RAVI) =>
      f.t.mealFrom(f.bed1, { ...f.read, read_id: readId }, {}, staff)
    await check('Sunita Devi', (f, id) => lunchWith(f, id, SUNITA))
    await check('another bed', lunchWith, async (f) => (await f.t.trayRead(await f.t.bed('3A', '2'), LUNCH)).read_id)
    await check('a photo read', lunchWith, (f) =>
      f.t.photoRead(f.bed1, { container: 'cup', fluid: 'water', volume_ml: 200, capacity_ml: 300 }),
    )
    await check('no draft', lunchWith, async (f) => {
      const empty = await f.t.trayRead(f.bed1, { issues: ['not_a_meal'], confidence: 0.3 })
      assert.equal((await f.t.store.read(empty.read_id))!.drafts, 0)
      return empty.read_id
    })
    await check('manual', (f, id) =>
      f.t.send(`/api/admissions/${f.bed1}/meals`, { meal: 'lunch', portion: 50, items: 'rice, dal', source: 'manual', read_id: id }, RAVI),
    )
    await check('urine entry', (f, id) => f.t.entry(f.bed1, { volume_ml: 300, source: 'photo', read_id: id }))
    await check('12 hours later', (f, id) => {
      f.t.at(nov(3, 20))
      return lunchWith(f, id)
    })
    assert.equal(posts.length, 7)
  })

  it('[charting/model-accuracy] Link a meal to its read: Bedless tray read', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.trayRead(null, LUNCH)
    const before = await t.held(bed1)
    const r = await t.mealFrom(bed1, read)
    assert.deepEqual([r.status, r.body.error, r.body.issues?.[0]?.path], [400, 'invalid_request', 'read_id'])
    assert.deepEqual(await t.held(bed1), before)
  })

  it('[charting/model-accuracy] Link a meal to its read: Empty tray read', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.trayRead(bed1, { issues: ['not_a_meal'], confidence: 0.3 })
    const before = t.requests()
    const r = await t.mealFrom(bed1, read, { portion: 50, items: 'rice, dal', read_id: null })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(await t.store.linked(read.read_id, 0), false)
    assert.deepEqual(await t.links(read.read_id), [])
    const q = await t.quality('?ward=2')
    const tray = q.body.kinds.find((k) => k.kind === 'tray' && k.mode === 'sam+spark')!
    assert.equal(tray.outcomes.negative_confirmed, 1)
    assert.equal(t.requests(), before)
  })

  it('[charting/model-accuracy] Link a meal to its read: Meal posted again', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.trayRead(bed1, LUNCH)
    const photo = await t.upload(bed1)
    const body = {
      meal: 'lunch',
      portion: 50,
      items: read.draft.items,
      fluid_ml: 150,
      source: 'photo',
      media_id: photo.id,
      dishes: read.draft.dishes,
      read_id: read.read_id,
    }
    const first = await t.send(`/api/admissions/${bed1}/meals`, body, RAVI)
    const again = await t.send(`/api/admissions/${bed1}/meals`, body, RAVI)
    assert.deepEqual([first.status, again.status], [201, 400])
    assert.deepEqual(again.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.equal((await t.store.meals(bed1, 0))!.length, 1)
    assert.deepEqual(
      (await t.store.entries(bed1))!.entries.map((e) => e.volume_ml),
      [150],
    )
  })
})

describe('retried save of a segmented photo', () => {
  /** A segmentation as a `sam+spark` read returns it (SAM finds nothing in this fixture, so the test supplies one). */
  const SEGMENTED = {
    container: { left: 100, top: 80, right: 400, bottom: 900, confidence: 0.94 },
    fluid: { left: 110, top: 520, right: 390, bottom: 890, confidence: 0.91 },
    fill_fraction: 0.463,
  }

  it('[charting/photo-evidence] Labeled copy linked with the photo: Retried save', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(bed1, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const evidence = { ...t.evidence(), segmentation: SEGMENTED }
    const photo = await t.upload(bed1)
    const copy = await t.upload(bed1)
    const body = { media_id: photo.id, labeled_media_id: copy.id, evidence, read_id: read }
    const before = t.requests()
    const first = await t.entry(bed1, body)
    const again = await t.entry(bed1, body)
    assert.deepEqual([first.status, again.status], [201, 400], JSON.stringify(again.body))
    assert.deepEqual(again.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.equal((await t.store.entries(bed1))!.entries.length, 1)

    // A bag reading retried the same way.
    const bed3 = await t.bed('3A', '3')
    const bagRead = await t.photoRead(bed3, { container: 'urine_bag', fluid: 'urine', volume_ml: 380, capacity_ml: 2000 })
    const bagEvidence = { ...t.evidence(), segmentation: SEGMENTED }
    const bagPhoto = await t.upload(bed3)
    const bagCopy = await t.upload(bed3)
    const bagBody = { volume_ml: 380, media_id: bagPhoto.id, labeled_media_id: bagCopy.id, evidence: bagEvidence, read_id: bagRead }
    const sent = t.requests()
    const bagFirst = await t.bag(bed3, bagBody)
    const bagAgain = await t.bag(bed3, bagBody)
    assert.deepEqual([bagFirst.status, bagAgain.status], [201, 400], JSON.stringify(bagAgain.body))
    assert.deepEqual(bagAgain.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.equal((await t.store.bagReadings(bed3, 0)).length, 1)
    assert.equal(t.requests(), sent)
    assert.equal(sent - before, 3, 'only the bag read sent upstream requests')
  })

  it('[charting/meals] Labeled tray copy kept: Retried save', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.trayRead(bed1, LUNCH)
    const photo = await t.upload(bed1)
    const copy = await t.upload(bed1)
    const body = {
      meal: 'lunch',
      portion: 50,
      items: read.draft.items,
      fluid_ml: 150,
      source: 'photo',
      media_id: photo.id,
      labeled_media_id: copy.id,
      dishes: read.draft.dishes,
      evidence: {
        mode: read.mode,
        image_sha256: read.image_sha256,
        reading: read.reading,
        segmentation: read.segmentation ?? { regions: [], loose_food: null },
        comparison: read.comparison,
        warnings: read.warnings,
        trace: read.trace,
      },
      read_id: read.read_id,
    }
    const before = t.requests()
    const first = await t.send(`/api/admissions/${bed1}/meals`, body, RAVI)
    const again = await t.send(`/api/admissions/${bed1}/meals`, body, RAVI)
    assert.deepEqual([first.status, again.status], [201, 400], JSON.stringify([first.body, again.body]))
    assert.deepEqual(again.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.equal((await t.store.meals(bed1, 0))!.length, 1)
    assert.equal(t.requests(), before)
  })
})
