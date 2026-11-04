/**
 * The shared recipes, checked from their source (no DOM in node:test): what each scenario needs from the recipe
 * itself. The local screenshot audit (scripts/ui-audit.mjs) measures the same rules in a browser.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { stepperNames } from './lib/volume.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const tokens = read('./tokens.stylex.ts')
const token = (set: string, key: string) =>
  new RegExp(`export const ${set} = [\\s\\S]*?\\b${key}: (?:\\{ default: )?'([^']+)'`).exec(tokens)?.[1]

describe('recipes', () => {
  it('[web/interface] Visible keyboard focus: Segmented option', () => {
    const ui = read('./components/ui.styles.ts')
    assert.match(
      ui,
      /focus: \{[\s\S]*?outlineWidth: \{ default: 0, ':focus-visible': 2 \}[\s\S]*?outlineColor: color\.accent,[\s\S]*?outlineOffset: 2/,
    )
    assert.equal(token('color', 'accent'), '#0f766e')
    assert.match(read('./components/segmented.tsx'), /stylex\.props\(s\.seg, ui\.focus/)
  })

  it('[web/interface] Visible keyboard focus: Urine colour chip and capture tile', () => {
    // The urine colour picker is a ChoiceChips group; every chip carries the ring.
    assert.match(read('./components/urine-colour-picker.tsx'), /<ChoiceChips/)
    assert.match(read('./components/choice-chips.tsx'), /stylex\.props\(s\.chip, ui\.focus/)
    const bed = read('./routes/a/bed.$token.tsx')
    const tiles = [...bed.matchAll(/stylex\.props\(([^)]*)s\.tile\b/g)]
    assert.ok(tiles.length >= 4)
    for (const t of tiles) assert.match(t[1]!, /ui\.focus/)
  })

  it('[web/interface] Targets big enough for gloved hands: Default button', () => {
    const b = read('./components/button.tsx')
    assert.match(b, /size = 'touch'/)
    assert.match(b, /touch: \{\s*minHeight: layout\.tap,\s*minWidth: layout\.tap/)
    assert.equal(token('layout', 'tap'), '44px')
  })

  it('[web/interface] Targets big enough for gloved hands: Capture commit', () => {
    assert.match(read('./components/button.tsx'), /lg: \{\s*minHeight: layout\.tapGloved/)
    assert.equal(token('layout', 'tapGloved'), '52px')
    assert.match(read('./routes/a/bed.$token.tsx'), /<Button size="lg"/)
  })

  it('[web/interface] Text at least 12 px: Bed badge label', () => {
    assert.equal(token('text', 'xs'), '12px')
    assert.match(read('./components/ui.tsx'), /badgeWard: \{ fontSize: text\.xs/)
    // Both screens draw the ward code over the bed number through BedBadge (its `badgeWard` above), or a label at text.xs.
    for (const p of ['./routes/a/index.tsx', './routes/n/$id.tsx']) {
      assert.match(read(p), /<BedBadge ward=|bedLabel: \{ fontSize: text\.xs/)
      assert.doesNotMatch(read(p), /fontSize: (?!text\.)/)
    }
  })

  it('[web/interface] Reduced motion: Switch under reduced motion', () => {
    assert.match(tokens, /control: \{ default: '120ms', \[REDUCE\]: '0ms' \}/)
    assert.match(tokens, /const REDUCE = '@media \(prefers-reduced-motion: reduce\)'/)
    const sw = read('./components/switch-field.tsx')
    assert.match(sw, /@base-ui\/react\/switch/)
    assert.equal([...sw.matchAll(/transitionDuration: motion\.control/g)].length, 2)
  })

  it('names the stepper buttons by their field', () => {
    assert.deepEqual(stepperNames('Energy target'), { less: 'Less energy target', more: 'More energy target' })
  })
})
