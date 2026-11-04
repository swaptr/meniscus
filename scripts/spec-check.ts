/**
 * Requirement ↔ test traceability (the part OpenSpec does not check).
 *
 *   node scripts/spec-check.ts          check; exit 1 on problems
 *   node scripts/spec-check.ts --list   per-capability coverage
 *
 * - Requirements come from openspec/specs/<capability>/spec.md (`### Requirement: <name>`),
 *   plus ADDED/MODIFIED/RENAMED-TO requirements of active changes (so tests written during
 *   apply may cite them before archive). Requirements an active change REMOVES or RENAMES FROM
 *   no longer need a citing test (their tests move with the change).
 * - A test cites a requirement by starting its title with `[<capability>] <Requirement name>`,
 *   optionally followed by `: <scenario>`.
 * - Fails on: a citation naming no known requirement; any archived-spec requirement no test cites.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SPECS = join(ROOT, 'openspec/specs')
const CHANGES = join(ROOT, 'openspec/changes')
const TEST_ROOTS = ['apps', 'packages'].map((d) => join(ROOT, d))
const TEST_FILE = /\.test\.tsx?$/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dev-dist', '.git'])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const capabilityOf = (specFile: string, base: string) => relative(base, specFile).split(sep).slice(0, -1).join('/')
const requirementNames = (md: string) => [...md.matchAll(/^### Requirement: (.+?)\s*$/gm)].map((m) => m[1]!)

/** capability → requirement names that must be cited. */
const live = new Map<string, Set<string>>()
for (const f of walk(SPECS).filter((p) => p.endsWith(`${sep}spec.md`))) {
  live.set(capabilityOf(f, SPECS), new Set(requirementNames(readFileSync(f, 'utf8'))))
}

/** Names under `## REMOVED Requirements`, plus RENAMED `- FROM:` names. */
function retiredNames(md: string): string[] {
  const removed = /^## REMOVED Requirements\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(md)?.[1] ?? ''
  return [...requirementNames(removed), ...[...md.matchAll(/^- FROM: `### Requirement: (.+?)`\s*$/gm)].map((m) => m[1]!)]
}

/** capability → requirement names a test may cite (live + in-flight changes). */
const citable = new Map<string, Set<string>>([...live].map(([k, v]) => [k, new Set(v)]))
/** capability → live requirement names an active change retires. */
const retired = new Map<string, Set<string>>()
for (const change of readdirSync(CHANGES).filter((n) => n !== 'archive' && statSync(join(CHANGES, n)).isDirectory())) {
  const base = join(CHANGES, change, 'specs')
  for (const f of walk(base).filter((p) => p.endsWith(`${sep}spec.md`))) {
    const md = readFileSync(f, 'utf8')
    const set = citable.get(capabilityOf(f, base)) ?? new Set<string>()
    for (const name of requirementNames(md)) set.add(name)
    for (const m of md.matchAll(/^- TO: `### Requirement: (.+?)`\s*$/gm)) set.add(m[1]!)
    citable.set(capabilityOf(f, base), set)
    const gone = retired.get(capabilityOf(f, base)) ?? new Set<string>()
    for (const name of retiredNames(md)) gone.add(name)
    retired.set(capabilityOf(f, base), gone)
  }
}

interface Citation {
  capability: string
  requirement: string
  where: string
}

/** Titles are the first string argument of describe/it/test/suite. */
const TITLE = /\b(?:describe|it|test|suite)(?:\.\w+)?\(\s*(['"`])\[([a-z0-9-]+(?:\/[a-z0-9-]+)*)\] (.+?)\1/g
const citations: Citation[] = []
for (const f of TEST_ROOTS.flatMap((r) => walk(r)).filter((p) => TEST_FILE.test(p))) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(TITLE)) {
    const line = src.slice(0, m.index).split('\n').length
    const requirement = m[3]!.split(': ')[0]!.trim()
    citations.push({ capability: m[2]!, requirement, where: `${relative(ROOT, f)}:${line}` })
  }
}

const problems: string[] = []
for (const c of citations) {
  if (!citable.get(c.capability)?.has(c.requirement)) {
    problems.push(`${c.where}: cites [${c.capability}] "${c.requirement}", which no spec or active change defines`)
  }
}
const cited = (cap: string, req: string) => citations.some((c) => c.capability === cap && c.requirement === req)
for (const [cap, reqs] of live) {
  for (const req of reqs)
    if (!cited(cap, req) && !retired.get(cap)?.has(req)) problems.push(`openspec/specs/${cap}: requirement "${req}" has no citing test`)
}

if (process.argv.includes('--list')) {
  for (const [cap, reqs] of [...citable].sort()) {
    const n = [...reqs].filter((r) => cited(cap, r)).length
    console.log(`${live.has(cap) ? ' ' : '*'} ${cap.padEnd(28)} ${n}/${reqs.size} requirements cited`)
  }
  console.log('(* = only in an active change)')
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'))
  console.error(
    `\nspec:check failed: ${problems.length} problem(s). Tests cite requirements as it('[<capability>] <Requirement name>: <scenario>').`,
  )
  process.exit(1)
}
console.log(
  `spec:check ok: ${citations.length} citations, ${[...live.values()].reduce((a, s) => a + s.size, 0)} live requirements all cited`,
)
