import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  BITE_AT_MS,
  BITES,
  coverageText,
  draftText,
  emptiedText,
  LANDING_COPY,
  LANDING_READS,
  measureText,
  mlAt,
  nextRead,
  pickColour,
  trayDraft,
} from './landing.ts'
import { ANITA, fakeServer, RAVI } from './staff-fixtures.ts'
import { landingPath, LOGIN, safeNext, signedOutRoute } from './staff.ts'

const read = (f: string) => readFileSync(new URL(`../components/${f}`, import.meta.url), 'utf8')
/** The views without comments, so documentation may name what the code must not do. */
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(read('landing.tsx'))
const hero = strip(read('landing-hero.tsx'))

describe('landing page', () => {
  it('[web/staff] Landing page: Opened signed out', async () => {
    const f = fakeServer()
    await f.session.check()
    assert.equal(f.session.get().status, 'signed_out')
    assert.deepEqual(signedOutRoute('/', '/'), { show: 'landing' })
    assert.equal(LANDING_COPY.product, 'Meniscus')
    for (const w of ['photo', 'voice note', 'bed', 'nurse approves', 'Muse Spark', 'SAM 3.1', 'speech-to-text'])
      assert.ok(LANDING_COPY.pitch.includes(w), `pitch names ${w}`)
    // The hero plays the urine bag, the IV bag, the water glass and the meal tray in turn, each with its draft chip.
    assert.deepEqual(
      LANDING_COPY.reads.map((r) => r.name),
      ['Urine bag', 'IV bag', 'Water glass', 'Meal tray'],
    )
    const [bag, iv, cup] = LANDING_READS
    // Every number is the drawn level × the container's capacity.
    assert.deepEqual(
      [bag, iv, cup].map((r) => measureText(r)),
      ['450 mL · fill 45%', '250 mL left · 50%', '60 mL left · 20%'],
    )
    assert.equal(draftText(bag, 'dark'), '450 mL urine · dark amber')
    assert.equal(draftText(bag, 'pale'), '450 mL urine · pale straw')
    assert.equal(emptiedText(bag), 'Emptied 420 mL')
    assert.equal(mlAt(bag, bag.to) - mlAt(bag, bag.rest), 420)
    assert.deepEqual(
      [iv, cup].map((r) => draftText(r, 'yellow')),
      ['IV 250 mL', 'Water 180 mL'],
    )
    for (const r of [iv, cup]) assert.ok(draftText(r, 'yellow').includes(`${Math.round(r.capacity * (r.from - r.to))} mL`), r.name)
    // The plate is eaten a quarter at a time; the coverage label and the chip follow what is left.
    assert.deepEqual([0, 1, 2, 3].map(trayDraft), ['Lunch served', 'Lunch ¼ eaten', 'Lunch ½ eaten', 'Lunch ¾ eaten'])
    assert.deepEqual([0, 1, 2, 3].map(coverageText), ['coverage 100%', 'coverage 75%', 'coverage 50%', 'coverage 25%'])
    assert.equal(BITES, BITE_AT_MS.length)
    assert.equal(LANDING_READS[3].to, 1 - BITES / 4)
    // The urine colour comes from the app's scale, a new one each time the bag comes round.
    assert.deepEqual([0, 0.15, 0.3, 0.999].map(pickColour), ['pale', 'yellow', 'dark', 'brown'])
    assert.deepEqual([0, 1, 2, 3].map(nextRead), [1, 2, 3, 0])
    for (const r of LANDING_READS) assert.match(r.detect, /^SAM 3\.1 · .+ 0\.\d\d$/)
    assert.deepEqual(
      LANDING_COPY.steps.map((s) => s.title),
      ['Capture at the bed', 'AI drafts the entry', 'Nurse approves'],
    )
    assert.equal(LANDING_COPY.note, 'Not a diagnostic device; nurses approve every entry')
    assert.equal(LANDING_COPY.signIn, 'Sign in')
    // The page draws the copy and links "Sign in" to /login; it loads nothing from another site.
    for (const k of ['LANDING_COPY.pitch', 'LANDING_COPY.steps', 'LANDING_COPY.note', 'LANDING_COPY.signIn', '<LandingHero />'])
      assert.ok(code.includes(k), `landing.tsx draws ${k}`)
    // The hero draws the level at the read's share and writes the labels from the same read.
    for (const k of [
      'levelY(g, read.to)',
      'read.detect',
      'read.region',
      'measureText(read)',
      'draftText(read, colour)',
      'emptiedText(read)',
      'coverageText(eaten)',
      'trayDraft(eaten)',
      'k < eaten',
    ])
      assert.ok(hero.includes(k), `landing-hero.tsx draws ${k}`)
    assert.match(code, /<Link to=\{LOGIN\}/)
    // (`url(#…)` is the SVG's own clip path, not a fetch.)
    for (const v of [code, hero]) assert.doesNotMatch(v, /https?:\/\/|<img\b|url\((?!#)/)
    // Nothing beyond the session check, and no model request.
    assert.deepEqual(f.reqs(), ['GET /api/session'])
  })

  it('[web/staff] Landing page: Reduced motion', () => {
    const both = code + hero
    // Every animation is `none` under reduced motion, and the hero does not cycle.
    const names = [...both.matchAll(/animationName:\s*([^\n]+)/g)].map((m) => m[1]!)
    assert.ok(names.length >= 10, 'level, waves, drip, bites, scan, outlines, labels, chips and steps animate')
    for (const n of names) assert.match(n, /\[REDUCE\]:\s*'none'/)
    for (const v of [code, hero]) assert.match(v, /const REDUCE = '@media \(prefers-reduced-motion: reduce\)'/)
    assert.match(hero, /if \(reducedMotion\(\)\) return/)
    // Keyframes move only opacity, transform and stroke-dashoffset.
    const frames = [...both.matchAll(/stylex\.keyframes\(\{([\s\S]*?)\}\)\n/g)].map((m) => m[1]!)
    assert.ok(frames.length > 0)
    for (const k of frames)
      for (const p of k.matchAll(/(\w+):\s*(?!\{)/g)) {
        if (/^(from|to)$/.test(p[1]!)) continue
        assert.ok(['opacity', 'transform', 'strokeDashoffset'].includes(p[1]!), `keyframe property ${p[1]}`)
      }
  })

  it('[web/staff] Landing page: Opened signed in', () => {
    assert.equal(landingPath('/', ANITA), '/n')
  })
})

describe('sign-in page', () => {
  it('[web/staff] Sign-in page: Deep link', () => {
    assert.deepEqual(signedOutRoute('/n/w/3', '/n/w/3'), { redirect: { to: LOGIN, next: '/n/w/3' } })
    assert.equal(landingPath(LOGIN, ANITA, '/n/w/3'), '/n/w/3')
    // The query of the deep link is kept.
    assert.deepEqual(signedOutRoute('/n/w/2', '/n/w/2?view=qr'), { redirect: { to: LOGIN, next: '/n/w/2?view=qr' } })
  })

  it('[web/staff] Sign-in page: Next to another site', () => {
    for (const next of ['//evil.example/x', 'https://evil.example', '/\\evil.example', '', '/login', '/login?next=/n'])
      assert.equal(landingPath(LOGIN, ANITA, next), '/n', next)
    assert.equal(safeNext(undefined), null)
    assert.equal(safeNext('/a/round?ward=2'), '/a/round?ward=2')
  })

  it('[web/staff] Sign-in page: Already signed in', () => {
    assert.equal(landingPath(LOGIN, RAVI), '/a')
  })
})
