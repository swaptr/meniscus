import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { AUDIT_ROUTES, AUDIT_WIDTHS, auditPath, NOT_FOUND } from './screens.ts'

describe('app-wide screens', () => {
  it('[web/interface] No blank media boxes: Not found', () => {
    assert.equal(NOT_FOUND.title, 'Page not found')
    assert.equal(NOT_FOUND.icon, 'not-found')
  })

  it('[web/interface] Fits a phone screen: Every route at 320 px', () => {
    // The layout audit (scripts/ui-audit.mjs) imports these and opens each route at each width, checking scrollWidth.
    assert.match(readFileSync(new URL('../../scripts/ui-audit.mjs', import.meta.url), 'utf8'), /from '\.\.\/src\/lib\/screens\.ts'/)
    assert.ok(AUDIT_WIDTHS.includes(320))
    // Every route file is opened by some role.
    const files = (d: URL, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const u = new URL(n, d)
        if (statSync(u).isDirectory()) files(new URL(`${n}/`, d), out)
        else if (n.endsWith('.tsx') && n !== '__root.tsx') out.push(new URL(n, d).pathname)
      }
      return out
    }
    const root = new URL('../routes/', import.meta.url)
    const pattern = (f: string) => {
      const rel = f
        .slice(root.pathname.length)
        .replace(/\.tsx$/, '')
        .replace(/(^|\/)index$/, '')
      const parts = rel.replace(/_\./g, '/').replace(/\./g, '/').split('/').filter(Boolean)
      return new RegExp(`^/${parts.map((p) => (p.startsWith('$') ? '[^/?]+' : p.replace(/_$/, ''))).join('/')}(\\?.*)?$`)
    }
    const opened = AUDIT_ROUTES.map((r) => auditPath(r, { bed: 'abc', adm: '10' }))
    for (const f of files(root)) {
      const re = pattern(f)
      assert.ok(
        opened.some((r) => re.test(r)),
        `${f.slice(root.pathname.length)} is opened by the audit`,
      )
    }
    assert.equal(auditPath('/a/bed/<bed>', { bed: 'abc' }), '/a/bed/abc')
    assert.equal(auditPath('/n/<adm>/print', { adm: '10' }), '/n/10/print')
  })
})
