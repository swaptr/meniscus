/**
 * Static design rules (design.md D10, DESIGN.md §2 and §9): reads the web source as text and fails on values that
 * bypass the tokens and recipes. A rule marked `todo` reports its sites without failing; the task that clears it
 * flips it to a real assertion. Exceptions live in design-allow.ts, each with its reason.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it } from 'node:test'
import { DESIGN_ALLOW } from './design-allow.ts'

const SRC = import.meta.dirname
const SKIP = new Set(['routeTree.gen.ts', 'tokens.stylex.ts', 'design.test.ts', 'design-allow.ts'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !SKIP.has(name)) out.push(p)
  }
  return out
}

const files = walk(SRC).map((p) => ({ path: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))

/** Drops comments so documentation may quote a forbidden value. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

type Rule = { id: keyof typeof DESIGN_ALLOW; title: string; re: RegExp; only?: (path: string) => boolean; todo?: boolean }

const tsx = (p: string) => p.endsWith('.tsx')
const styles = (p: string) => p.endsWith('.tsx') || p.endsWith('.styles.ts')

const RULES: Rule[] = [
  {
    id: 'fontPx',
    title: '[web/interface] Text at least 12 px',
    // A raw number or px font size; sizes come from `text.*` (12 px floor).
    re: /fontSize:\s*(?:\d|'\d+(?:\.\d+)?px')/g,
    only: styles,
  },
  {
    id: 'focus',
    title: '[web/interface] Visible keyboard focus',
    // Removing the outline without the focus ring on the same declaration.
    re: /outline(?:Style)?:\s*(?:'none'|\{\s*default:\s*'none'(?![^}]*:focus-visible))/g,
    only: styles,
  },
  {
    id: 'motion',
    title: '[web/interface] Reduced motion',
    // Durations come from `motion.*`; only opacity, transform and stroke-dashoffset animate.
    re: /(?:transition|animation)(?:Duration)?:\s*(?:\{[^}\n]*?)?'[^'\n]*\d+m?s|transitionProperty:\s*'[^'\n]*(?:height|width|box-shadow)/g,
    only: styles,
  },
  {
    id: 'input',
    title: '[web/interface] Inputs that do not zoom',
    re: /\bui\.input\b/g,
  },
  {
    id: 'buttonSize',
    title: '[web/interface] Targets big enough for gloved hands',
    // Buttons are `touch` (44) or `lg` (52); `sm` and `md` are retired.
    re: /<Button\b(?:[^<>]|=>)*?\bsize="(?:sm|md)"/g,
    only: tsx,
  },
  {
    id: 'time',
    title: '[web/interface] Times and dates written one way',
    re: /toLocale(?:Time|Date)?String\(|padStart\(2/g,
  },
  {
    id: 'confidence',
    title: '[web/interface] Confidence written one way',
    re: /%\s*confident|['`]Confidence[ :]/g,
  },
  { id: 'hex', title: 'colours come from the tokens', re: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/g, only: styles },
  { id: 'weight', title: 'weights come from the weight vars', re: /fontWeight:\s*\d/g, only: styles },
  { id: 'zIndex', title: 'layers come from the layer vars', re: /zIndex:\s*(?:\{[^}\n]*?)?\d/g, only: styles },
  {
    id: 'spacing',
    title: 'radius, padding, gap and margin come from the scale',
    re: /\b(?:borderRadius|padding(?:Inline|Block|Top|Bottom|Left|Right)?(?:Start|End)?|gap|rowGap|columnGap|margin(?:Inline|Block|Top|Bottom|Left|Right)?(?:Start|End)?):\s*(?:[1-9]\d*\b(?!%)|'[1-9]\d*px')/g,
    only: styles,
  },
  { id: 'required', title: 'no “(required)” markers', re: /\(required\)/g, only: tsx },
  { id: 'uppercase', title: 'no uppercase styling', re: /textTransform:\s*'uppercase'/g, only: styles },
  {
    id: 'glyph',
    title: 'icons are Lucide, never text glyphs',
    // JSX text that is only a glyph standing in for an icon.
    re: />\s*(?:✓|✔|✕|×|!|…|↓|↑|⚠|ⓘ|−|\+)\s*</g,
    only: tsx,
  },
]

function sites(rule: Rule): string[] {
  const allow = DESIGN_ALLOW[rule.id] ?? []
  const out: string[] = []
  for (const f of files) {
    if (rule.only && !rule.only(f.path)) continue
    if (allow.some((a) => f.path.startsWith(a.path))) continue
    const src = code(f.text)
    const raw = f.text.split('\n')
    for (const m of src.matchAll(rule.re)) {
      const line = src.slice(0, m.index).split('\n').length
      // An exception names its reason on the same line: `// focus-ok: <where the ring is>`, `// motion-ok: <why>`.
      if (rule.id === 'focus' && raw[line - 1]?.includes('focus-ok:')) continue
      if (rule.id === 'motion' && raw[line - 1]?.includes('motion-ok:')) continue
      out.push(`${f.path}:${line} ${m[0].replace(/\s+/g, ' ').slice(0, 60)}`)
    }
  }
  return out
}

describe('design rules (static)', () => {
  for (const rule of RULES) {
    const found = sites(rule)
    if (rule.todo) {
      it(rule.title, { todo: `${found.length} sites` }, () => assert.deepEqual(found, []))
    } else {
      it(rule.title, () => assert.deepEqual(found, [], `${found.length} sites break "${rule.id}":\n${found.join('\n')}`))
    }
  }
})
