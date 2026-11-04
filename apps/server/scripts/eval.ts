/**
 * Accuracy evaluation: Spark-only vs SAM + Spark on photos of known volume.
 *
 *   pnpm --filter @meniscus/server eval <dir> [--modes spark,sam+spark] [--limit N] [--container-labels <manifest.jsonl>] [--no-hint] [--yes]
 *   pnpm --filter @meniscus/server eval <dir> --tray-labels <manifest.jsonl> [--modes …] [--limit N] [--yes]
 *
 * Without --yes it only prints the request plan and estimated cost. Requests
 * run sequentially, each sample once, no retries.
 *
 * Without labels, file names carry ground truth: `<container>-<ml>[-anything].<ext>`, e.g.
 * `urine_bag-450-angled.jpg`, `water_jug-1200.png`. `<container>` must be a
 * ContainerKind (passed to the pipeline as the staff hint unless --no-hint).
 * `--container-labels` labels photos from the real-world dataset's records (src/chart/lab.ts), and the
 * sidecar `<name>.json` beside a photo labels a synthetic one; synthetic photos are scored only with
 * verified labels, and apart from real ones. Scoring and tolerance are the ward's (src/chart/scoring.ts).
 * Writes `<dir>/eval-<timestamp>.json` with every reading for the README.
 *
 * `--tray-labels` makes it a tray eval (src/chart/tray-lab.ts): photos whose `record_type: original` record has
 * `expected_items`, verified synthetic trays, and verified synthetic `after` photos read with their before as the served
 * photo. A tray is 3 requests in `sam+spark` mode (5 for a pair), 1 in `spark` mode; a dry run unless approved.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { READ_MODES, VOLUME_TOLERANCE_ML, type CallTrace, type CaptureReadResult, type ReadMode } from '@meniscus/shared'
import { createAi } from '../src/ai/pipeline.ts'
import { livePorts } from '../src/ai/ports.ts'
import {
  labRead,
  labSections,
  labSummary,
  parseLabels,
  parseSidecar,
  planRequests,
  samplesFrom,
  skippedText,
  type LabLabel,
  type LabSummary,
  type Sample,
} from '../src/chart/lab.ts'
import {
  aloneText,
  pairSizesKnown,
  planTray,
  runTrayJob,
  skippedTrayText,
  trayEvalArgs,
  trayJobs,
  trayManifest,
  traySections,
  traySummary,
  type TrayRow,
} from '../src/chart/tray-lab.ts'
import { config, routineCeiling } from '../src/config.ts'
import { MODELS, metaClient } from '../src/model-api.ts'

// List prices (USD), dev.meta.ai/docs/pricing-rate-limits, 2026-11-02.
const PRICE = { sparkIn: 1.25 / 1e6, sparkOut: 4.25 / 1e6, samImage: 2.5 / 1000 }
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    modes: { type: 'string', default: READ_MODES.join(',') },
    limit: { type: 'string' },
    'container-labels': { type: 'string' },
    'tray-labels': { type: 'string' },
    'no-hint': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
})
const dir = positionals[0]
if (!dir) {
  console.error('usage: eval <dir> [--modes spark,sam+spark] [--limit N] [--container-labels <manifest.jsonl>] [--no-hint] [--yes]')
  process.exit(2)
}
const modes = values.modes.split(',').filter((m): m is ReadMode => (READ_MODES as readonly string[]).includes(m))
const hinted = !values['no-hint']

const refused = trayEvalArgs({ trayLabels: values['tray-labels'], containerLabels: values['container-labels'], noHint: values['no-hint'] })
if (refused) {
  console.error(refused.message)
  process.exit(refused.exit)
}
if (values['tray-labels'] !== undefined) await trayEval(dir, values['tray-labels'])

interface Row extends Sample {
  mode: ReadMode
  /** The label's volume; null when the photo has none (a negative, or an unknown volume). */
  truth: number | null
  read: number | null
  err: number | null
  confidence: number | null
  needs_review: boolean
  ms: number
  cost: number
  error?: string
  result?: CaptureReadResult
}

const cost = (trace: CallTrace[]) =>
  trace.reduce(
    (s, t) =>
      s + (t.model === MODELS.sam ? PRICE.samImage : (t.input_tokens ?? 0) * PRICE.sparkIn + (t.output_tokens ?? 0) * PRICE.sparkOut),
    0,
  )

const ai = createAi(livePorts)
const files = (await readdir(dir)).filter((f) => MIME[extname(f).toLowerCase()])
const labelsFile = values['container-labels']
const labels = labelsFile
  ? parseLabels(await readFile(labelsFile, 'utf8'), (line) => console.error(`${labelsFile}:${line}: malformed record, skipped`))
  : null
/** The image-synthesis sidecar beside each photo, if any (null when it is not valid JSON). */
const sidecars = new Map<string, LabLabel | null>()
for (const f of files) {
  const stem = f.slice(0, -extname(f).length)
  const json = await readFile(join(dir, `${stem}.json`), 'utf8').catch(() => undefined)
  if (json !== undefined) sidecars.set(stem, parseSidecar(json))
}
const { samples: labelled, skipped } = samplesFrom(files, labels, sidecars, { hint: hinted })
const samples = values.limit ? labelled.slice(0, Math.max(0, Number(values.limit))) : labelled
if (!samples.length) {
  console.error(`no labelled images in ${dir} (expected <container>-<ml>.jpg, --container-labels, or verified sidecars)`)
  if (skipped.synthetic) console.error(skippedText(skipped.synthetic))
  process.exit(2)
}
const planned = planRequests(samples, modes)
const estUsd = samples.length * modes.reduce((a, m) => a + (m === 'sam+spark' ? 2 * PRICE.samImage : 0) + 0.01, 0)
const synthetic = samples.filter((s) => s.source === 'synthetic').length
console.log(
  `${samples.length} samples (${synthetic} synthetic) × ${modes.join(', ')}${hinted ? '' : ', no hint'}${skipped.unlabelled ? ` (${skipped.unlabelled} unlabelled skipped)` : ''}`,
)
if (skipped.synthetic) console.log(skippedText(skipped.synthetic))
// Eval reads name no bed, so they run routine: they can never use the critical reserve.
const ceiling = routineCeiling(config)
console.log(`plan: ${planned} model requests, est. ≤ $${estUsd.toFixed(2)} (routine budget ${ceiling}/h)`)
if (planned > ceiling) {
  console.error(`plan exceeds the routine budget of ${ceiling}/h; use --limit or raise the budget deliberately`)
  process.exit(2)
}
if (!values.yes) {
  console.log('dry run. Re-run with --yes to send these requests.')
  process.exit(0)
}
console.log('')

const jobs = modes.flatMap((mode) => samples.map((s) => ({ ...s, mode, truth: s.label.expected_ml })))
const rows: Row[] = []
for (const job of jobs) rows.push(await runJob(job))

async function runJob(job: Sample & { mode: ReadMode; truth: number | null }): Promise<Row> {
  const image = await readFile(join(dir!, job.file))
  try {
    const r = await ai.readCapture({ image, mime: MIME[extname(job.file).toLowerCase()]!, hint: job.hint, mode: job.mode })
    const read = r.reading.volume_ml
    const row: Row = {
      ...job,
      read,
      err: read === null || job.truth === null ? null : read - job.truth,
      confidence: r.reading.confidence,
      needs_review: r.needs_review,
      ms: r.ms,
      cost: cost(r.trace),
      result: r,
    }
    console.log(
      `${job.mode.padEnd(9)} ${job.file.padEnd(32)} truth ${String(job.truth ?? '—').padStart(5)}  read ${String(read ?? '—').padStart(5)}  conf ${r.reading.confidence.toFixed(2)}${r.needs_review ? '  review' : ''}`,
    )
    return row
  } catch (e) {
    // Class and code only: an upstream message or refusal can echo the photo's contents.
    const code = e instanceof Error && 'code' in e && typeof e.code === 'string' ? ` ${e.code}` : ''
    const error = e instanceof Error ? `${e.name}${code}` : 'error'
    console.log(`${job.mode.padEnd(9)} ${job.file.padEnd(32)} ERROR ${error}`)
    return { ...job, read: null, err: null, confidence: null, needs_review: true, ms: 0, cost: 0, error }
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)]! : NaN
}
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—')

const summary = modes.map((mode) => {
  const rs = rows.filter((r) => r.mode === mode)
  const ok = rs.filter((r) => r.err !== null)
  const abs = ok.map((r) => Math.abs(r.err!))
  const auto = ok.filter((r) => !r.needs_review)
  return {
    mode,
    n: rs.length,
    read: ok.length,
    mae_ml: abs.length ? Math.round(abs.reduce((a, b) => a + b, 0) / abs.length) : null,
    // Over photos with a volume truth (a negative has none).
    within_tol: pct(abs.filter((e) => e <= VOLUME_TOLERANCE_ML).length, rs.filter((r) => r.truth !== null).length),
    /** Accuracy of what would be one-tap confirmed — the number that matters clinically. */
    auto_confirm_rate: pct(auto.length, rs.length),
    auto_confirm_mae_ml: auto.length ? Math.round(auto.reduce((a, r) => a + Math.abs(r.err!), 0) / auto.length) : null,
    errors: rs.filter((r) => r.error).length,
    median_ms: median(ok.map((r) => r.ms)),
    usd_per_photo: rs.length ? +(rs.reduce((a, r) => a + r.cost, 0) / rs.length).toFixed(5) : null,
  }
})

/** Per class and per expected outcome, real and synthetic apart, with the ward's scoring. */
const lab: LabSummary = labSummary(
  rows.map((r) => ({ file: r.file, source: r.source, mode: r.mode, label: r.label, read: r.result ? labRead(r.result) : null })),
  { hinted, skippedSynthetic: skipped.synthetic },
)
const scored = (reports: LabSummary['real']) =>
  Object.fromEntries(Object.entries(reports).map(([mode, r]) => [mode, { classes: r.classes, outcomes: r.outcomes, volume: r.volume }]))

console.log('')
console.table(summary)
const out = join(dir, `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
const report = {
  models: MODELS,
  tolerance_ml: VOLUME_TOLERANCE_ML,
  hinted,
  summary,
  real: scored(lab.real),
  synthetic: scored(lab.synthetic),
  skipped,
  rows,
}
await writeFile(out, JSON.stringify(report, null, 2))
await writeFile(out.replace(/\.json$/, '.md'), markdown())
console.log(`\nwrote ${out} (+ .md) — ${metaClient().budget.stats().total} model requests sent`)

/** README-ready summary: one row per mode, then error per container. */
function markdown(): string {
  const lines = summary.map(
    (s) =>
      `| ${s.mode} | ${s.n} | ${s.mae_ml ?? '—'} | ${s.within_tol} | ${s.auto_confirm_rate} | ${s.auto_confirm_mae_ml ?? '—'} | ${(s.median_ms / 1000).toFixed(1)} s | $${s.usd_per_photo ?? '—'} |`,
  )
  const containerOf = (r: Row) => r.label.container ?? r.hint ?? 'unknown'
  const containers = [...new Set(rows.map(containerOf))].sort()
  const byContainer = containers.flatMap((c) =>
    modes.map((mode) => {
      const rs = rows.filter((r) => containerOf(r) === c && r.mode === mode && r.err !== null)
      const mae = rs.length ? Math.round(rs.reduce((a, r) => a + Math.abs(r.err!), 0) / rs.length) : null
      return `| ${c} | ${mode} | ${rs.length} | ${mae ?? '—'} |`
    }),
  )
  return [
    `# Accuracy run ${new Date().toISOString().slice(0, 16)}Z`,
    '',
    `Models: ${MODELS.spark}, ${MODELS.sam}. Tolerance ±${VOLUME_TOLERANCE_ML} mL. "One-tap" = readings that skip manual review.`,
    '',
    `| Mode | Photos | MAE (mL) | Within ±${VOLUME_TOLERANCE_ML} mL | One-tap rate | One-tap MAE (mL) | Median latency | Cost / photo |`,
    '|---|---|---|---|---|---|---|---|',
    ...lines,
    '',
    '| Container | Mode | Read | MAE (mL) |',
    '|---|---|---|---|',
    ...byContainer,
    '',
    labSections(lab),
  ].join('\n')
}

/** `--tray-labels`: plan (and, when approved, run) the tray eval, then exit. Never reaches the container eval above. */
async function trayEval(folder: string, manifestFile: string): Promise<never> {
  const manifest = trayManifest(await readFile(manifestFile, 'utf8'))
  const files = (await readdir(folder)).filter((f) => MIME[extname(f).toLowerCase()])
  const sidecars = new Map<string, Record<string, unknown> | null>()
  for (const f of files) {
    const stem = f.slice(0, -extname(f).length)
    const json = await readFile(join(folder, `${stem}.json`), 'utf8').catch(() => undefined)
    if (json === undefined) continue
    try {
      const v: unknown = JSON.parse(json)
      sidecars.set(stem, typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
    } catch {
      sidecars.set(stem, null)
    }
  }
  // A record's `file` is beside the manifest; jobs name it relative to the folder.
  const beside = (file: string) => relative(resolve(folder), resolve(dirname(manifestFile), file))
  const plan = trayJobs(files, manifest, sidecars, beside)
  const jobs = values.limit ? plan.jobs.slice(0, Math.max(0, Number(values.limit))) : plan.jobs
  const load = async (file: string) => ({
    bytes: new Uint8Array(await readFile(join(folder, file))),
    mime: MIME[extname(file).toLowerCase()] ?? 'image/jpeg',
  })
  const sized = await Promise.all(
    jobs.map(async (j) => {
      if (!j.pair || j.before === undefined) return j
      const [a, b] = [await load(j.file), await load(j.before)]
      return { ...j, sizesKnown: pairSizesKnown(a.bytes, a.mime, b.bytes, b.mime) }
    }),
  )
  const pairs = jobs.filter((j) => j.pair).length
  console.log(`${jobs.length} trays (${pairs} served and collected pairs) × ${modes.join(', ')}`)
  if (plan.skipped) console.log(skippedTrayText(plan.skipped))
  if (plan.alone) console.log(aloneText(plan.alone))
  const planned = planTray(sized, modes)
  // Tray eval reads name no bed, so they run routine.
  const ceiling = routineCeiling(config)
  console.log(`plan: ${planned} model requests (routine budget ${ceiling}/h)`)
  if (!jobs.length) process.exit(2)
  if (planned > ceiling) {
    console.error(`plan exceeds the routine budget of ${ceiling}/h; use --limit or --modes`)
    process.exit(2)
  }
  if (!values.yes) {
    console.log('dry run. Re-run with --yes to send these requests.')
    process.exit(0)
  }
  const trayAi = createAi(livePorts, { mealUseSam: true })
  const rows: TrayRow[] = []
  // One photo at a time, each once; a failed read is a row with its error, never a resend.
  for (const mode of modes) for (const job of jobs) rows.push(await runTrayJob(trayAi, job, mode, load))
  const out = join(folder, `tray-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await writeFile(out, JSON.stringify({ models: MODELS, summary: traySummary(rows), rows }, null, 2))
  await writeFile(
    out.replace(/\.json$/, '.md'),
    `# Tray eval ${new Date().toISOString().slice(0, 16)}Z\n\n${traySections(traySummary(rows))}`,
  )
  console.log(`wrote ${out} (+ .md) — ${metaClient().budget.stats().total} model requests sent`)
  process.exit(0)
}
