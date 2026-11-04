/**
 * The tray eval (charting/model-accuracy "Tray eval labels from the dataset", "Tray eval report", "Synthetic trays in
 * the tray eval", "Served and collected pairs in the tray eval"). Pure apart from `runTrayJob`, which reads one photo
 * (and its before) and makes one `readMeal` call: `scripts/eval.ts --tray-labels` plans, runs and prints it. Names are
 * never scored: dishes pair by `dish_kind`, then in list order. Scored through the ward's `scoring.ts` (pairDishes,
 * portionAgreement, summariseVolume at VOLUME_TOLERANCE_ML, tallyClasses by `final`, rate) and refused through the
 * ward's NEGATIVE_ISSUES and trayDrafts, so the tray eval and the ward's summary score alike.
 */
import {
  DISH_KINDS,
  MEAL_FLUID_KINDS,
  NEGATIVE_ISSUES,
  PORTIONS,
  VOLUME_TOLERANCE_ML,
  type ClassRow,
  type DishKind,
  type MealFluidKind,
  type MealIssue,
  type MealReadResult,
  type Portion,
  type PortionAgreement,
  type PortionBasis,
  type Rate,
  type ReadMode,
  type VolumeError,
  trayDrafts,
} from '@meniscus/shared'
import type { Ai } from '../ai/pipeline.ts'
import { servedCheck } from '../ai/compare.ts'
import { imageSize } from '../ai/image-size.ts'
import { EXPECTED_OUTCOMES, parseSidecar, rateText, type ExpectedOutcome } from './lab.ts'
import { pairDishes, portionAgreement, rate, summariseVolume, tallyClasses } from './scoring.ts'

/** The flags a tray eval refuses: `--tray-labels` replaces `--container-labels`, and a tray read takes no hint. */
export function trayEvalArgs(v: { trayLabels?: string; containerLabels?: string; noHint?: boolean }): { exit: 2; message: string } | null {
  if (v.trayLabels === undefined) return null
  if (v.containerLabels !== undefined) return { exit: 2, message: '--tray-labels cannot be combined with --container-labels' }
  if (v.noHint) return { exit: 2, message: '--tray-labels cannot be combined with --no-hint' }
  return null
}

/** One tray's truth; null fields are not scored. A true kind outside the vocabulary counts as `other`. */
export interface TrayTruth {
  dishes: { dish_kind: DishKind; portion: Portion | null }[]
  meal_portion: Portion | null
  /** `fluid_kind: none` dropped; `ml` null when `volume_ml_estimate` is. */
  fluids: { fluid_kind: MealFluidKind; ml: number | null }[]
  outcome: ExpectedOutcome | null
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const oneOf = <T extends string>(list: readonly T[], x: unknown): T | null => ((list as readonly unknown[]).includes(x) ? (x as T) : null)
const portionOf = (x: unknown): Portion | null => ((PORTIONS as readonly unknown[]).includes(x) ? (x as Portion) : null)

/**
 * Truth from `expected_items`, `expected_fluids` (and the meal portion and outcome given). Never reads names. A dish kind
 * outside DISH_KINDS, or a fluid kind outside MEAL_FLUID_KINDS other than `none`, is `other` ("Out-of-vocabulary values"):
 * dropping it would score a correct `other` read as a dish staff never had.
 */
function truthOf(items: unknown[], fluids: unknown, mealPortion: unknown, outcome: unknown): TrayTruth {
  return {
    dishes: items
      .filter(isObject)
      .map((d) => ({ dish_kind: oneOf(DISH_KINDS, d.dish_kind) ?? 'other', portion: portionOf(d.portion_eaten_pct) })),
    meal_portion: portionOf(mealPortion),
    fluids: (Array.isArray(fluids) ? fluids : []).filter(isObject).flatMap((f) => {
      if (f.fluid_kind === 'none') return []
      const ml = typeof f.volume_ml_estimate === 'number' && f.volume_ml_estimate >= 0 ? f.volume_ml_estimate : null
      return [{ fluid_kind: oneOf(MEAL_FLUID_KINDS, f.fluid_kind) ?? 'other', ml }]
    }),
    outcome: oneOf(EXPECTED_OUTCOMES, outcome),
  }
}

/** A `record_type: original` record with an `expected_items` array is a tray; anything else (augmented included) is not. */
export function trayLabels(record: Record<string, unknown>): TrayTruth | null {
  if (record.record_type !== 'original' || !Array.isArray(record.expected_items)) return null
  return truthOf(record.expected_items, record.expected_fluids, record.meal_portion_eaten, record.expected_outcome)
}

/** A verified synthetic sidecar whose `labels.truth.expected_items` is an array; portion and outcome from the top of `labels`. */
export function synthLabels(sidecar: Record<string, unknown>): TrayTruth | null {
  const labels = isObject(sidecar.labels) ? sidecar.labels : {}
  const truth = isObject(labels.truth) ? labels.truth : {}
  if (!Array.isArray(truth.expected_items)) return null
  return truthOf(truth.expected_items, truth.expected_fluids, labels.meal_portion_eaten, labels.expected_outcome)
}

export interface ManifestRecord {
  id: string
  file: string | null
  /** As read-outcomes reads it: synthetic and verified. */
  synthetic: boolean
  verified: boolean
  tray: TrayTruth | null
}

/** The dataset manifest by id. Malformed lines are skipped. */
export function trayManifest(jsonl: string): Map<string, ManifestRecord> {
  const out = new Map<string, ManifestRecord>()
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let r: unknown
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(r) || typeof r.id !== 'string' || !r.id) continue
    const side = parseSidecar(JSON.stringify(r))!
    out.set(r.id, {
      id: r.id,
      file: typeof r.file === 'string' ? r.file : null,
      synthetic: side.synthetic,
      verified: side.verified,
      tray: r.record_type === 'original' ? trayLabels(r) : null,
    })
  }
  return out
}

export interface TrayJob {
  file: string
  source: 'real' | 'synthetic'
  /** Scored as a served and collected pair (an `after` with its before). */
  pair: boolean
  truth: TrayTruth
  /** The before photo, as a path relative to the folder (`../manifest-dir/…` resolved by the caller), when found. */
  before?: string
}

export interface TrayPlan {
  jobs: TrayJob[]
  /** Photos without tray labels (unlabelled, augmented, unverified synthetic). */
  skipped: number
  /** `after` photos with no before found, read alone. */
  alone: number
}

const stemOf = (file: string) => file.replace(/\.[^.]*$/, '')
/** The record whose id is the stem, or the longest id the stem ends with after a `-` (lab.ts' rule). */
function recordFor(stem: string, manifest: ReadonlyMap<string, ManifestRecord>): ManifestRecord | undefined {
  if (manifest.has(stem)) return manifest.get(stem)
  for (let i = stem.indexOf('-'); i >= 0; i = stem.indexOf('-', i + 1)) {
    const hit = manifest.get(stem.slice(i + 1))
    if (hit) return hit
  }
  return undefined
}

/**
 * Which photos are trays, and which synthetic `after` photos have a before. `sidecars` maps a file's stem to its parsed
 * sidecar JSON (null when it is not an object). `beside(file)` resolves a manifest record's `file` beside the manifest.
 */
export function trayJobs(
  files: readonly string[],
  manifest: ReadonlyMap<string, ManifestRecord>,
  sidecars: ReadonlyMap<string, Record<string, unknown> | null>,
  beside: (file: string) => string,
): TrayPlan {
  const jobs: TrayJob[] = []
  let skipped = 0
  let alone = 0
  const labelsOf = (stem: string) => {
    const s = sidecars.get(stem)
    return s && isObject(s.labels) ? s.labels : {}
  }
  for (const file of files) {
    const stem = stemOf(file)
    const record = recordFor(stem, manifest)
    const hasSidecar = sidecars.has(stem)
    const side = sidecars.get(stem) ?? null
    const sideLabel = side ? parseSidecar(JSON.stringify(side)) : null
    const synthetic = sideLabel?.synthetic === true || record?.synthetic === true || stem.startsWith('synth-')
    if (!synthetic) {
      if (record?.tray) jobs.push({ file, source: 'real', pair: false, truth: record.tray })
      else skipped++
      continue
    }
    // read-outcomes' sidecar rule: every source it has is verified.
    const sources = [...(hasSidecar ? [sideLabel] : []), ...(record ? [record] : [])]
    const truth = side ? synthLabels(side) : null
    if (!sources.length || !sources.every((s) => s?.verified === true) || !truth) {
      skipped++
      continue
    }
    const labels = labelsOf(stem)
    if (labels.pair_role !== 'after') {
      jobs.push({ file, source: 'synthetic', pair: false, truth })
      continue
    }
    const byPair = [...sidecars.keys()].find(
      (k) =>
        k !== stem && labelsOf(k).pair_id === labels.pair_id && labelsOf(k).pair_role === 'before' && typeof labels.pair_id === 'string',
    )
    const beforeFile = byPair && files.find((f) => stemOf(f) === byPair)
    const sourceIds = side && Array.isArray(side.source_ids) ? side.source_ids : []
    const named = typeof sourceIds[0] === 'string' ? manifest.get(sourceIds[0])?.file : null
    const before = beforeFile ?? (named ? beside(named) : undefined)
    if (before === undefined) {
      alone++
      jobs.push({ file, source: 'synthetic', pair: false, truth })
    } else jobs.push({ file, source: 'synthetic', pair: true, truth, before })
  }
  return { jobs, skipped, alone }
}

/** Requests per job and mode: a tray 3 (`sam+spark`) or 1; a pair 5, or 3 when either size is unreadable; 1 in `spark`. */
export function planTray(jobs: readonly (TrayJob & { sizesKnown?: boolean })[], modes: readonly ReadMode[]): number {
  return jobs.reduce((n, j) => n + modes.reduce((a, m) => a + (m === 'spark' ? 1 : j.pair && j.sizesKnown !== false ? 5 : 3), 0), 0)
}

export const skippedTrayText = (k: number) => `${k} photo${k === 1 ? '' : 's'} without tray labels, skipped`
export const aloneText = (k: number) => `${k} pair${k === 1 ? '' : 's'} without ${k === 1 ? 'its' : 'their'} before, read alone`

/** Both sizes readable, so a pair is planned at 5. */
export const pairSizesKnown = (after: Uint8Array, afterMime: string, before: Uint8Array, beforeMime: string) =>
  imageSize(after, afterMime) !== null && imageSize(before, beforeMime) !== null

/** What a tray read returned, for scoring: closed-list values and numbers. */
export interface TrayRead {
  dishes: { dish_kind: DishKind; portion: Portion; basis: PortionBasis }[]
  portion: Portion
  fluids: { fluid_kind: MealFluidKind; ml: number }[]
  needs_review: boolean
  issues: readonly MealIssue[]
}

export const trayRead = (r: Pick<MealReadResult, 'reading' | 'needs_review'>): TrayRead => ({
  dishes: r.reading.dishes.map((d) => ({ dish_kind: d.dish_kind, portion: d.portion, basis: d.basis })),
  portion: r.reading.portion,
  fluids: r.reading.fluids.map((f) => ({ fluid_kind: f.fluid_kind, ml: f.volume_ml })),
  needs_review: r.needs_review,
  issues: r.reading.issues,
})

/** One read in one mode; `read` null when it errored (listed, never scored). */
export interface TrayRow {
  file: string
  source: 'real' | 'synthetic'
  pair: boolean
  mode: ReadMode
  truth: TrayTruth
  read: TrayRead | null
  error?: string
}

/** The job's one `readMeal`: the after with its before as the served photo in `sam+spark` mode, else alone. Never retried. */
export async function runTrayJob(
  ai: Pick<Ai, 'readMeal'>,
  job: TrayJob,
  mode: ReadMode,
  load: (file: string) => Promise<{ bytes: Uint8Array; mime: string }>,
): Promise<TrayRow> {
  const row = { file: job.file, source: job.source, pair: job.pair, mode, truth: job.truth }
  try {
    const image = await load(job.file)
    const before = job.before !== undefined && mode === 'sam+spark' ? await load(job.before) : null
    const served = before
      ? { bytes: before.bytes, mime: before.mime, check: servedCheck(image.bytes, image.mime, { ...before, sha256: null }) }
      : undefined
    const r = await ai.readMeal({ image: image.bytes, mime: image.mime, mode, served })
    return { ...row, read: trayRead(r) }
  } catch (e) {
    return { ...row, read: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** The draft's fluid mL as the ward's draft sums it: null when no fluid has a volume. */
const draftFluid = (r: TrayRead) => {
  const ml = r.fluids.reduce((n, f) => n + f.ml, 0)
  return ml > 0 ? ml : null
}

/** Refused: no draft (`trayDrafts`), or a NEGATIVE_ISSUES code. Flagged: sent to review. Drafted: a one-tap draft. */
export const trayDecision = (r: TrayRead): 'drafted' | 'flagged' | 'refused' =>
  trayDrafts({ dishes: r.dishes, fluid_ml: draftFluid(r) }) === 0 ||
  r.issues.some((i) => (NEGATIVE_ISSUES as readonly string[]).includes(i))
    ? 'refused'
    : r.needs_review
      ? 'flagged'
      : 'drafted'

const RIGHT: Record<ExpectedOutcome, readonly string[]> = {
  positive: ['drafted', 'flagged'],
  degraded: ['flagged', 'refused'],
  negative: ['flagged', 'refused'],
}

export type PortionScore = Pick<PortionAgreement, 'exact' | 'within_quarter'>

export interface TrayReport {
  n: number
  errors: number
  dish_kinds: ClassRow[]
  /** Dish portions, by the read's basis. */
  portions: Partial<Record<PortionBasis, PortionScore>>
  /** Pairs as `[true kind, read kind, quarters apart]`, in order, for checking. */
  dish_pairs: [DishKind, DishKind, number | null][]
  meal_portion: PortionScore
  fluid_kinds: ClassRow[]
  fluid_ml: VolumeError
  outcomes: { outcome: ExpectedOutcome; n: number; drafted: number; flagged: number; refused: number; right: Rate }[]
}

/** Read against true portions, in quarters (the ward's `portionAgreement`). */
function portionScore(pairs: { model: Portion; final: Portion }[]): PortionScore {
  const { exact, within_quarter } = portionAgreement(pairs)
  return { exact, within_quarter }
}

/** Rows of one section and mode, scored. */
export function trayReport(rows: readonly TrayRow[]): TrayReport {
  const ok = rows.filter((r): r is TrayRow & { read: TrayRead } => r.read !== null)
  const kindRows: { model: string; final: string; settled: true }[] = []
  const fluidRows: { model: string; final: string; settled: true }[] = []
  const dishPairs: TrayReport['dish_pairs'] = []
  const byBasis = new Map<PortionBasis, { model: Portion; final: Portion }[]>()
  const meal: { model: Portion; final: Portion }[] = []
  const ml: { model: number | null; final: number | null }[] = []
  for (const r of ok) {
    // The ward's pairing: each read dish takes the first unpaired true dish of its kind, then the rest in order. A read
    // dish with no true one has no truth, so `by: 'final'` skips it.
    for (const { model: x, final: t } of pairDishes(r.read.dishes, r.truth.dishes)) {
      if (!t) continue
      kindRows.push({ model: x?.dish_kind ?? 'none', final: t.dish_kind, settled: true })
      if (!x) continue
      dishPairs.push([t.dish_kind, x.dish_kind, t.portion === null ? null : Math.abs(x.portion - t.portion) / 25])
      if (t.portion !== null) byBasis.set(x.basis, [...(byBasis.get(x.basis) ?? []), { model: x.portion, final: t.portion }])
    }
    if (r.truth.meal_portion !== null) meal.push({ model: r.read.portion, final: r.truth.meal_portion })
    const asDish = <F extends { fluid_kind: string }>(f: F) => ({ ...f, dish_kind: f.fluid_kind, portion: null })
    for (const { model: x, final: t } of pairDishes(r.read.fluids.map(asDish), r.truth.fluids.map(asDish))) {
      if (!t) continue
      fluidRows.push({ model: x?.fluid_kind ?? 'none', final: t.fluid_kind, settled: true })
      if (x && t.ml !== null) ml.push({ model: x.ml, final: t.ml })
    }
  }
  return {
    n: ok.length,
    errors: rows.length - ok.length,
    dish_kinds: tallyClasses(kindRows, 'final'),
    portions: Object.fromEntries([...byBasis].map(([b, ps]) => [b, portionScore(ps)])),
    dish_pairs: dishPairs,
    meal_portion: portionScore(meal),
    fluid_kinds: tallyClasses(fluidRows, 'final'),
    fluid_ml: summariseVolume(ml, VOLUME_TOLERANCE_ML),
    outcomes: EXPECTED_OUTCOMES.flatMap((outcome) => {
      const rs = ok.filter((r) => r.truth.outcome === outcome)
      if (!rs.length) return []
      const by = (x: string) => rs.filter((r) => trayDecision(r.read) === x).length
      const right = rs.filter((r) => RIGHT[outcome].includes(trayDecision(r.read))).length
      return [
        { outcome, n: rs.length, drafted: by('drafted'), flagged: by('flagged'), refused: by('refused'), right: rate(right, rs.length) },
      ]
    }),
  }
}

export type TraySection = 'real' | 'synthetic' | 'pairs'
/** Real trays, synthetic trays and served/collected pairs never mix; one report per mode in each. */
export function traySummary(rows: readonly TrayRow[]): Record<TraySection, Partial<Record<ReadMode, TrayReport>>> {
  const sectionOf = (r: TrayRow): TraySection => (r.pair ? 'pairs' : r.source)
  const out: Record<TraySection, Partial<Record<ReadMode, TrayReport>>> = { real: {}, synthetic: {}, pairs: {} }
  for (const s of ['real', 'synthetic', 'pairs'] as const) {
    for (const mode of [...new Set(rows.map((r) => r.mode))]) {
      const rs = rows.filter((r) => sectionOf(r) === s && r.mode === mode)
      if (rs.length) out[s][mode] = trayReport(rs)
    }
  }
  return out
}

const table = (title: string, rows: ClassRow[]) =>
  rows.length
    ? [
        `| True ${title} | Count | Read right | Read instead |`,
        '|---|---|---|---|',
        ...rows.map((r) => `| ${r.model} | ${r.n} | ${rateText(r.kept)} | ${r.corrections.map((c) => `${c.to} ${c.n}`).join(', ')} |`),
        '',
      ]
    : []

/** Outcome rows as `n | drafted | flagged | refused | right call`. */
export const outcomeLine = (o: TrayReport['outcomes'][number]) =>
  `${o.n} | ${o.drafted} | ${o.flagged} | ${o.refused} | ${rateText(o.right)}`

function reportLines(mode: ReadMode, r: TrayReport): string[] {
  const portion = (label: string, p: PortionScore) => `| ${label} | ${rateText(p.exact)} | ${rateText(p.within_quarter)} |`
  return [
    `### ${mode} · ${r.n} tray${r.n === 1 ? '' : 's'}${r.errors ? ` (${r.errors} errored, not scored)` : ''}`,
    '',
    ...table('dish kind', r.dish_kinds),
    '| Portion | Exact | Within one quarter |',
    '|---|---|---|',
    ...(['measured', 'model'] as const).flatMap((b) => (r.portions[b] ? [portion(`dish (${b})`, r.portions[b])] : [])),
    portion('meal', r.meal_portion),
    '',
    ...table('fluid kind', r.fluid_kinds),
    r.fluid_ml.of
      ? `Fluid mL: ${r.fluid_ml.mae_ml ?? '—'} mean error · within ±${VOLUME_TOLERANCE_ML} mL ${rateText(r.fluid_ml.within)}`
      : 'No fluid with a volume truth.',
    '',
    ...(r.outcomes.length
      ? [
          '| Expected | n | Drafted | Flagged | Refused | Right call |',
          '|---|---|---|---|---|---|',
          ...r.outcomes.map((o) => `| ${o.outcome} | ${outcomeLine(o)} |`),
          '',
        ]
      : []),
  ]
}

/** The Markdown the tray eval writes: real trays, synthetic trays, then pairs. */
export function traySections(s: ReturnType<typeof traySummary>): string {
  const section = (title: string, reports: Partial<Record<ReadMode, TrayReport>>) => {
    const modes = Object.keys(reports) as ReadMode[]
    return modes.length ? [`## ${title}`, '', ...modes.flatMap((m) => reportLines(m, reports[m]!))] : []
  }
  return [
    ...section('Real trays', s.real),
    ...section('Synthetic trays (verified labels)', s.synthetic),
    ...section('Pairs (served and collected)', s.pairs),
  ].join('\n')
}
