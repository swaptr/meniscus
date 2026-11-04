/** One drink icon map, one drink label map, one drink shade (DESIGN.md 2.1 "Drink kinds", 5.24; design.md D13). */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it } from 'node:test'

const SRC = join(import.meta.dirname, '..')
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p)
  }
  return out
}
const files = walk(SRC).map((p) => ({ path: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))
const ICON_HOME = 'components/drink-label.tsx'
const DRINK_ICONS = ['glass-water', 'leaf', 'citrus', 'tree-palm', 'blend', 'cup-soda']

describe('drink kinds: one map each', () => {
  it('has one drink icon map', () => {
    const others = files.filter(
      (f) =>
        f.path !== ICON_HOME &&
        (/Record<DrinkKind,\s*ComponentType/.test(f.text) || DRINK_ICONS.some((i) => f.text.includes(`lucide-react/icons/${i}'`))),
    )
    assert.deepEqual(
      others.map((f) => f.path),
      [],
    )
  })

  it('has one drink label map, in @meniscus/shared', () => {
    const others = files.filter((f) => /Record<DrinkKind,\s*string>/.test(f.text))
    assert.deepEqual(
      others.map((f) => f.path),
      [],
    )
  })

  it('draws drinks in the one intake shade, never a hue per kind', () => {
    for (const p of ['lib/drinks.ts', ICON_HOME]) {
      const t = files.find((f) => f.path === p)!.text
      assert.ok(!/#[0-9a-f]{3,6}\b/i.test(t), `${p} has no hex colour`)
    }
    assert.match(files.find((f) => f.path === ICON_HOME)!.text, /color\.intakeText/)
  })
})
