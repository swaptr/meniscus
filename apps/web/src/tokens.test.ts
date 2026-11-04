import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { contrast } from './lib/contrast.ts'

// Parses tokens.stylex.ts as text (StyleX vars cannot be evaluated outside the compiler).
const src = readFileSync(new URL('./tokens.stylex.ts', import.meta.url), 'utf8')
const colorBlock = /export const color = stylex\.defineVars\(\{([\s\S]*?)\}\)/.exec(src)?.[1] ?? ''
const color = Object.fromEntries([...colorBlock.matchAll(/^\s*(\w+):\s*'(#[0-9a-f]{6})'/gim)].map((m) => [m[1]!, m[2]!]))
const c = (name: string): string => {
  const v = color[name]
  assert.ok(v, `color.${name} is defined`)
  return v
}
const pair = (fg: string, bg: string, min: number) => {
  const r = contrast(c(fg), c(bg))
  assert.ok(r >= min, `${fg} on ${bg} is ${r.toFixed(2)}, needs ${min}`)
}

describe('tokens: contrast (DESIGN.md 2.1)', () => {
  it('[web/interface] Contrast checked: Output text on its tint', () => {
    assert.equal(c('outputText'), '#7d3570')
    assert.equal(contrast(c('outputText'), c('outputBg')).toFixed(2), '6.68')
    assert.equal(c('output'), '#9a4a8a')
    assert.equal(contrast(c('output'), c('bg')).toFixed(2), '5.64')
    pair('intakeText', 'intakeBg', 4.5)
    pair('warnText', 'warnBg', 4.5)
    for (const t of ['fg', 'muted']) for (const b of ['bg', 'canvas', 'subtle', 'rail']) pair(t, b, 4.5)
    for (const t of ['danger', 'info', 'pending', 'ok']) pair(t, `${t}Bg`, 4.5)
    pair('fg', 'accentBg', 4.5)
  })

  it('[web/interface] Contrast checked: Capture tile hint', () => {
    assert.equal(c('onAccent'), '#ffffff')
    assert.equal(contrast(c('onAccent'), c('accent')).toFixed(2), '5.47')
    pair('onAccent', 'accentStrong', 4.5)
  })

  it('[web/interface] Contrast checked: Progress track', () => {
    assert.equal(c('border'), '#d0dbe0')
    for (const fill of ['accent', 'ok', 'warnText', 'danger']) pair(fill, 'border', 3.8)
    assert.equal(contrast(c('borderStrong'), c('bg')).toFixed(2), '3.59')
    pair('borderStrong', 'canvas', 3)
    pair('borderStrong', 'subtle', 3)
    for (const m of ['intake', 'output']) pair(m, 'bg', 3)
    // A drink segment's intake outline on its intake tint (DESIGN.md 2.1 "Drink kinds").
    assert.equal(contrast(c('intake'), c('intakeBg')).toFixed(2), '3.76')
  })
})
