/**
 * Exceptions to the static design rules in design.test.ts (design.md D10). Each entry is a path (relative to
 * `src/`, prefix match) with the reason it may break the rule. Keep this list short; a new entry needs a reason a
 * reviewer accepts.
 */
export const DESIGN_ALLOW: Record<string, readonly { path: string; why: string }[]> = {
  hex: [
    { path: 'tokens.stylex.ts', why: 'the theme itself' },
    { path: 'lib/hues.ts', why: 'spec’d categorical and outcome hues' },
    { path: 'lib/urine.ts', why: 'urine drawn in the colours seen (spec’d)' },
    { path: 'lib/contrast.ts', why: 'pure colour maths' },
    { path: 'global.css', why: 'reset only; the canvas colour before StyleX applies' },
  ],
  weight: [],
  zIndex: [{ path: 'components/balance-timeline.tsx', why: 'readout stacking inside the chart’s own box, not an app layer' }],
  spacing: [],
  fontPx: [],
  motion: [],
  focus: [],
  buttonSize: [],
  input: [],
  time: [],
  confidence: [],
  required: [],
  uppercase: [],
  glyph: [],
}
