import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { contrast } from './lib/contrast.ts'

// No DOM test environment: the computed sizes follow from the one input recipe (`f.input`) and the token values, so
// these read the source. The browser audit (scripts/ui-audit.mjs) measures the computed values at runtime.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const tokens = read('./tokens.stylex.ts')
const token = (set: string, key: string) => {
  const block = new RegExp(`export const ${set} = stylex\\.defineVars\\(\\{([\\s\\S]*?)\\n\\}\\)`).exec(tokens)?.[1] ?? ''
  return new RegExp(`^\\s*${key}: '([^']+)'`, 'm').exec(block)?.[1]
}
const recipe = /input: \{([\s\S]*?)\n {2}\},/.exec(read('./components/form.styles.ts'))?.[1] ?? ''
/** Style keys a call-site style adds on top of `f.input`. */
const overrides = (src: string, key: string) => new RegExp(`^ {2}${key}: \\{([^\\n]*)`, 'm').exec(src)?.[1] ?? ''

describe('inputs that do not zoom', () => {
  it('the input recipe is 17 px text, 48 px tall, with a 3:1 boundary', () => {
    assert.match(recipe, /minHeight: 48/)
    assert.match(recipe, /fontSize: text\.lg/)
    assert.equal(token('text', 'lg'), '17px')
    assert.match(recipe, /borderColor: \{ default: color\.borderStrong/)
    assert.equal(token('color', 'borderStrong'), '#78899a')
    assert.equal(contrast('#78899a', token('color', 'bg')!).toFixed(2), '3.59')
  })

  it('[web/interface] Inputs that do not zoom: Reject reason note', () => {
    const src = read('./components/reason-dialog.tsx')
    assert.match(src, /stylex\.props\(f\.input, s\.textarea\)/)
    const extra = overrides(src, 'textarea')
    assert.doesNotMatch(extra, /fontSize/)
    assert.match(extra, /minHeight: 88/)
  })

  it('[web/interface] Inputs that do not zoom: Entry log filters', () => {
    const src = read('./components/entry-log.tsx')
    const controls = (src.match(/<(select|input)\b/g) ?? []).length
    const styled = (src.match(/stylex\.props\(f\.input\b/g) ?? []).length
    assert.ok(controls >= 4, 'category, source and status selects and the search input')
    assert.equal(styled, controls, 'every select and input takes f.input')
    for (const k of ['select', 'search']) assert.doesNotMatch(overrides(src, k), /fontSize|minHeight|height/)
  })
})
