/**
 * Local UI audit (ui-polish design D10). Not run in CI; adds no dependency.
 *
 *   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
 *   node apps/web/scripts/ui-audit.mjs [--base http://127.0.0.1:5173] [--out /tmp/ui-polish-shots]
 *
 * Point `--base` at the web dev server proxying to a fake server (`scripts/fake-server.ts` on a seeded temporary
 * DATA_DIR), never at a server started with `.env`. Every `/api/ai/*` request is aborted in the browser and counted,
 * so nothing can reach a model. For each role and route, at 320, 390 and 1100 px, it checks: no sideways page scroll;
 * targets at least 44 px; inputs at least 16 px text and 48 px tall; text at least 12 px; the keyboard focus ring; and,
 * under reduced motion, 0 s transitions. On pages with peeks, Enter opens one and Escape closes it. It writes
 * `report.json` and a PNG per route and width to `--out`. Exit 0 only with 0 violations and 0 AI requests; 2 without
 * PLAYWRIGHT_CORE.
 */
/* global document, getComputedStyle, NodeFilter */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
// The roles, routes and widths, from the module the web tests check (Node strips the types).
import { AUDIT_ROLES, AUDIT_WIDTHS, auditPath } from '../src/lib/screens.ts'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const BASE = arg('base', 'http://127.0.0.1:5173')
const OUT = arg('out', '/tmp/ui-polish-shots')
const ONLY = arg('only', '')

const core = process.env.PLAYWRIGHT_CORE
if (!core) {
  console.error('ui-audit needs PLAYWRIGHT_CORE (a path to an installed playwright-core); it adds no dependency')
  process.exit(2)
}
const { chromium } = createRequire(import.meta.url)(core)

const ROLES = AUDIT_ROLES
const WIDTHS = AUDIT_WIDTHS

let aiRequests = 0
const report = { base: BASE, pages: [], aiRequests: 0, violations: 0 }

/** Runs in the page: the rule checks. Returns a list of violation strings (capped). */
function inspect() {
  const out = []
  const vw = document.documentElement.clientWidth
  const sw = document.documentElement.scrollWidth
  if (sw > vw) out.push(`scroll width ${sw} > ${vw}`)
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  // The hit area: the element, grown by an absolutely placed hit child (`crumbHit`) or a stretched `::after` that
  // covers its positioned ancestor (a whole-row link counts as one target).
  const hitBox = (el) => {
    let { left, top, right, bottom } = el.getBoundingClientRect()
    const grow = (b) => {
      left = Math.min(left, b.left)
      top = Math.min(top, b.top)
      right = Math.max(right, b.right)
      bottom = Math.max(bottom, b.bottom)
    }
    // A control inside its label is hit through the label too (a switch, a checkbox).
    const lab = el.closest('label')
    if (lab) grow(lab.getBoundingClientRect())
    for (const c of el.children) if (getComputedStyle(c).position === 'absolute') grow(c.getBoundingClientRect())
    const after = getComputedStyle(el, '::after')
    if (after.content !== 'none' && after.position === 'absolute' && el.offsetParent) grow(el.offsetParent.getBoundingClientRect())
    return { width: right - left, height: bottom - top }
  }
  const label = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`
  const targets = document.querySelectorAll(
    'button, a[href], [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], summary, select, input:not([type="hidden"])',
  )
  for (const el of targets) {
    if (!visible(el) || el.closest('[data-audit-skip]') || el.closest('[aria-hidden="true"]')) continue
    // A text link inside a sentence is exempt (the rule's own exemption).
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement?.closest('p')) continue
    // Visually hidden controls behind a styled label (native radios and checkboxes) are measured by their label.
    if (el.tagName === 'INPUT' && ['radio', 'checkbox'].includes(el.type)) continue
    const r = hitBox(el)
    if (r.width <= 1 || r.height <= 1) continue // visually hidden until focused (skip link)
    if (Math.round(r.height) < 44 || Math.round(r.width) < 44)
      out.push(`target ${Math.round(r.width)}×${Math.round(r.height)} ${label(el)}`)
  }
  for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea')) {
    if (!visible(el)) continue
    const box = el.getBoundingClientRect()
    if (box.width <= 1 || box.height <= 1) continue // a visually hidden native control behind its label
    const s = getComputedStyle(el)
    if (parseFloat(s.fontSize) < 16) out.push(`input font ${s.fontSize} ${label(el)}`)
    if (Math.round(el.getBoundingClientRect().height) < 48)
      out.push(`input height ${Math.round(el.getBoundingClientRect().height)} ${label(el)}`)
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const small = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim() || !n.parentElement || !visible(n.parentElement)) continue
    const p = n.parentElement
    if (p.closest('svg') && !p.closest('text')) continue
    const fs = parseFloat(getComputedStyle(p).fontSize)
    if (fs < 12) small.add(`text ${fs}px "${n.textContent.trim().slice(0, 30)}"`)
  }
  out.push(...small)
  return out.slice(0, 60)
}

async function signIn(context, who) {
  const res = await context.request.post(`${BASE}/api/session`, { data: { username: who, password: who } })
  if (!res.ok()) throw new Error(`sign-in ${who}: ${res.status()}`)
}

async function fill(page, route) {
  if (route.includes('<bed>')) {
    await page.goto(`${BASE}/a`)
    const href = await page.locator('a[href^="/a/bed/"]').first().getAttribute('href', { timeout: 8000 })
    return href ? auditPath(route, { bed: href.split('/')[3] }) : route
  }
  if (route.includes('<adm>')) {
    await page.goto(`${BASE}${route.startsWith('/d') ? '/d' : '/n/w/3'}`)
    const sel = route.startsWith('/d') ? 'a[href^="/d/"]' : 'a[href^="/n/"]:not([href^="/n/w"])'
    const href = await page
      .locator(sel)
      .first()
      .getAttribute('href', { timeout: 8000 })
      .catch(() => null)
    const id = href?.split('/')[2] ?? '10'
    return auditPath(route, { adm: id })
  }
  return route
}

async function focusRing(page) {
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const s = getComputedStyle(el)
    return s.outlineStyle === 'solid' && s.outlineWidth === '2px' && s.outlineColor === 'rgb(15, 118, 110)' && s.outlineOffset === '2px'
      ? null
      : `focus ring ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} offset ${s.outlineOffset} on ${el.tagName}`
  })
}

async function peekCheck(page) {
  const trigger = page.locator('[data-peek-trigger]').first()
  if ((await trigger.count()) === 0) return null
  await trigger.focus()
  await page.keyboard.press('Enter')
  const open = await page
    .locator('[data-peek-popup]')
    .first()
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false)
  if (!open) return 'peek did not open on Enter'
  await page.keyboard.press('Escape')
  const closed = await page
    .locator('[data-peek-popup]')
    .first()
    .waitFor({ state: 'hidden', timeout: 2000 })
    .then(() => true)
    .catch(() => false)
  return closed ? null : 'peek did not close on Escape'
}

async function reducedMotion(page) {
  return page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      const d = [...s.transitionDuration.split(','), ...s.animationDuration.split(',')].map((x) => parseFloat(x) || 0)
      if (d.some((x) => x > 0) && !el.closest('[data-recording]')) bad.push(`motion ${el.tagName} ${s.transitionDuration}`)
      if (bad.length > 10) break
    }
    return bad
  })
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
mkdirSync(OUT, { recursive: true })
try {
  for (const role of ROLES) {
    if (ONLY && role.who !== ONLY) continue
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 800 }, locale: 'en-US' })
      await context.route('**/api/ai/**', (r) => {
        aiRequests++
        return r.abort()
      })
      await signIn(context, role.who)
      const page = await context.newPage()
      for (const route of role.routes) {
        const path = await fill(page, route)
        await page.goto(`${BASE}${path}`)
        await page.waitForLoadState('networkidle').catch(() => {})
        const violations = await page.evaluate(inspect)
        const ring = await focusRing(page)
        if (ring) violations.push(ring)
        if (width === 1100) {
          const p = await peekCheck(page)
          if (p) violations.push(p)
        }
        const name = `${role.who}-${width}-${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}.png`
        if (width !== 320) await page.screenshot({ path: join(OUT, name), fullPage: true })
        report.pages.push({ who: role.who, width, path, violations, shot: width !== 320 ? name : null })
        report.violations += violations.length
        console.log(`${violations.length ? '✗' : '✓'} ${role.who} ${width} ${path} ${violations.length}`)
      }
      await context.close()
    }
  }
  // Reduced motion, once.
  const rm = await browser.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' })
  await rm.route('**/api/ai/**', (r) => {
    aiRequests++
    return r.abort()
  })
  await signIn(rm, 'anita')
  const page = await rm.newPage()
  await page.goto(`${BASE}/n/w/2`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const motion = await reducedMotion(page)
  report.pages.push({ who: 'anita', width: 1100, path: '/n/w/2 (reduced motion)', violations: motion, shot: null })
  report.violations += motion.length
  await rm.close()
} finally {
  await browser.close()
}
report.aiRequests = aiRequests
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(`violations ${report.violations}, AI requests ${aiRequests}, report ${join(OUT, 'report.json')}`)
process.exit(report.violations === 0 && aiRequests === 0 ? 0 : 1)
