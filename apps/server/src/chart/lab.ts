/**
 * The lab eval's labels and per-class report (charting/model-accuracy "Lab eval scored like the ward", "Lab eval labels
 * from the dataset", "Synthetic photos in the lab eval"). Pure: `scripts/eval.ts` reads the files and makes the requests;
 * this module plans and scores them with the ward's own scoring (`scoring.ts`). No model requests here.
 */
import {
  CONTAINER_KINDS,
  FLUID_KINDS,
  NEGATIVE_ISSUES,
  URINE_COLOURS,
  VOLUME_TOLERANCE_ML,
  type CaptureReadResult,
  type ClassRow,
  type ContainerKind,
  type FluidKind,
  type Rate,
  type ReadMode,
  type ReadingIssue,
  type UrineColour,
  type VolumeError,
} from '@meniscus/shared'
import { rate, summariseVolume, tallyClasses } from './scoring.ts'

export const EXPECTED_OUTCOMES = ['positive', 'degraded', 'negative'] as const
export type ExpectedOutcome = (typeof EXPECTED_OUTCOMES)[number]

/** One photo's truth, from a dataset record or an image-synthesis sidecar (the manifest's field names). */
export interface LabLabel {
  id: string
  /** `expected_container` */
  container: ContainerKind | null
  /** `expected_fluid` */
  fluid: FluidKind | null
  /** `liquid_colour`, kept only for urine. */
  urine_colour: UrineColour | null
  expected_ml: number | null
  ml_tolerance: number | null
  /** `expected_outcome` */
  outcome: ExpectedOutcome | null
  /** `synthetic === true` */
  synthetic: boolean
  /** `label_status === 'verified'` and `verified_by` is a non-empty string; `verified` with `verified_by: null` is a draft. */
  verified: boolean
}

export interface Sample {
  file: string
  source: 'real' | 'synthetic'
  /** The staff container hint the read gets; none with `--no-hint`, or for a real file matched only by id. */
  hint?: ContainerKind
  label: LabLabel
}

/** Upstream requests per photo, per mode (must match pipeline.ts `readCapture`). */
export const REQUESTS_PER_PHOTO: Record<ReadMode, number> = { spark: 1, 'sam+spark': 3 }

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const oneOf = <T extends string>(list: readonly T[], x: unknown): T | null => ((list as readonly unknown[]).includes(x) ? (x as T) : null)
const count = (x: unknown, min: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= min ? x : null)

/** Our vocabularies only: anything else (`clear`, `n/a`, an unknown kind, a non-number) is null. */
function labelOf(id: string, labels: Record<string, unknown>, top: Record<string, unknown>): LabLabel {
  const fluid = oneOf(FLUID_KINDS, labels.expected_fluid)
  return {
    id,
    container: oneOf(CONTAINER_KINDS, labels.expected_container),
    fluid,
    urine_colour: fluid === 'urine' ? oneOf(URINE_COLOURS, labels.liquid_colour) : null,
    expected_ml: count(labels.expected_ml, 0),
    ml_tolerance: count(labels.ml_tolerance, Number.MIN_VALUE),
    outcome: oneOf(EXPECTED_OUTCOMES, labels.expected_outcome),
    synthetic: top.synthetic === true,
    verified: top.label_status === 'verified' && typeof top.verified_by === 'string' && top.verified_by.trim() !== '',
  }
}

/** The dataset's `manifest.jsonl`: one label per record id. Unknown fields are ignored; a malformed line is reported and skipped. */
export function parseLabels(jsonl: string, onMalformed: (line: number) => void = () => {}): Map<string, LabLabel> {
  const out = new Map<string, LabLabel>()
  jsonl.split('\n').forEach((text, i) => {
    if (!text.trim()) return
    let record: unknown
    try {
      record = JSON.parse(text)
    } catch {
      record = undefined
    }
    if (!isObject(record) || typeof record.id !== 'string' || !record.id) return onMalformed(i + 1)
    out.set(record.id, labelOf(record.id, record, record))
  })
  return out
}

/**
 * An image-synthesis sidecar (`synth-<id>.json`): its `labels` read with the manifest's rules, plus `synthetic`,
 * `label_status` and `verified_by`. Other label keys (a tray's `meal_portion_eaten`, `truth`, `pair_id`, `pair_role`) and
 * the provenance fields are ignored. Null when it is not a JSON object.
 */
export function parseSidecar(json: string): LabLabel | null {
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    return null
  }
  if (!isObject(obj)) return null
  return labelOf(typeof obj.id === 'string' ? obj.id : '', isObject(obj.labels) ? obj.labels : {}, obj)
}

const stemOf = (file: string) => file.replace(/\.[^.]*$/, '')

/** `<container>-<ml>[-anything]`: the file-name rule for unlabelled real photos. */
export function parseName(file: string): { container: ContainerKind; ml: number } | null {
  const m = /^([a-z_]+)-(\d+)(?:-.*)?$/.exec(stemOf(file))
  const container = m && oneOf(CONTAINER_KINDS, m[1])
  return container ? { container, ml: Number(m[2]) } : null
}

/** The record whose id is the stem, or the longest id the stem ends with after a `-`. */
function recordFor(stem: string, labels: Map<string, LabLabel> | null): LabLabel | undefined {
  if (!labels) return undefined
  if (labels.has(stem)) return labels.get(stem)
  for (let i = stem.indexOf('-'); i >= 0; i = stem.indexOf('-', i + 1)) {
    const hit = labels.get(stem.slice(i + 1))
    if (hit) return hit
  }
  return undefined
}

/**
 * Which photos are scored, with what truth. Per file:
 * 1. synthetic when its sidecar or its record says `synthetic: true`, or its name starts with `synth-`;
 * 2. a synthetic file is kept only when every source it has (sidecar, record) is verified, else skipped at no request;
 * 3. a synthetic file's labels come from its record, else its sidecar, never its name; its hint is its expected container;
 * 4. a real file matched to a record takes the record's labels and the name's container as hint (none when matched by id
 *    only); an unmatched real file falls back to the name rule; anything else is skipped as unlabelled.
 * `sidecars` maps a file's stem to its parsed sidecar (null when present but not valid JSON).
 */
export function samplesFrom(
  files: readonly string[],
  labels: Map<string, LabLabel> | null,
  sidecars: ReadonlyMap<string, LabLabel | null>,
  { hint = true }: { hint?: boolean } = {},
): { samples: Sample[]; skipped: { synthetic: number; unlabelled: number } } {
  const samples: Sample[] = []
  const skipped = { synthetic: 0, unlabelled: 0 }
  for (const file of files) {
    const stem = stemOf(file)
    const record = recordFor(stem, labels)
    const hasSidecar = sidecars.has(stem)
    const side = sidecars.get(stem) ?? null
    const synthetic = side?.synthetic === true || record?.synthetic === true || stem.startsWith('synth-')
    if (synthetic) {
      const sources = [...(hasSidecar ? [side] : []), ...(record ? [record] : [])]
      const label = record ?? side
      if (!sources.length || !sources.every((s) => s?.verified === true) || !label) {
        skipped.synthetic++
        continue
      }
      samples.push({ file, source: 'synthetic', ...(hint && label.container && { hint: label.container }), label })
      continue
    }
    const name = parseName(file)
    if (record) {
      samples.push({ file, source: 'real', ...(hint && name && { hint: name.container }), label: record })
      continue
    }
    if (!name) {
      skipped.unlabelled++
      continue
    }
    samples.push({
      file,
      source: 'real',
      ...(hint && { hint: name.container }),
      label: { ...labelOf(stem, {}, {}), container: name.container, expected_ml: name.ml },
    })
  }
  return { samples, skipped }
}

/** Model requests the plan sends: 3 a photo in `sam+spark` mode, 1 in `spark` mode. Skipped files are not planned. */
export const planRequests = (samples: readonly Sample[], modes: readonly ReadMode[]) =>
  samples.length * modes.reduce((a, m) => a + REQUESTS_PER_PHOTO[m], 0)

export const skippedText = (k: number) => `${k} synthetic photo${k === 1 ? '' : 's'} without verified labels, skipped`

/** What a read classified, for scoring: closed-list values and numbers. */
export interface LabRead {
  container: ContainerKind
  fluid: FluidKind
  volume_ml: number | null
  urine_colour: UrineColour | null
  drafted: boolean
  needs_review: boolean
  issues: readonly ReadingIssue[]
}
export const labRead = (r: CaptureReadResult): LabRead => ({
  container: r.reading.container,
  fluid: r.reading.fluid,
  volume_ml: r.reading.volume_ml,
  urine_colour: r.reading.urine_colour ?? null,
  drafted: r.draft !== null,
  needs_review: r.needs_review,
  issues: r.reading.issues,
})

/** One photo read in one mode; `read` is null when it errored (listed, never scored). */
export interface LabRow {
  file: string
  source: Sample['source']
  mode: ReadMode
  label: LabLabel
  read: LabRead | null
  error?: string
}

export type Decision = 'drafted' | 'flagged' | 'refused'
/** Refused: no draft, or a negative issue. Flagged: a draft sent to review. Drafted: a one-tap draft. */
export function decision(r: Pick<LabRead, 'drafted' | 'needs_review' | 'issues'>): Decision {
  if (!r.drafted || r.issues.some((i) => (NEGATIVE_ISSUES as readonly string[]).includes(i))) return 'refused'
  return r.needs_review ? 'flagged' : 'drafted'
}

/** The right call: a draft (one-tap or flagged) for a positive photo; a flag or a refusal for a degraded or negative one. */
const RIGHT: Record<ExpectedOutcome, readonly Decision[]> = {
  positive: ['drafted', 'flagged'],
  degraded: ['flagged', 'refused'],
  negative: ['flagged', 'refused'],
}

export interface OutcomeRow {
  outcome: ExpectedOutcome
  n: number
  drafted: number
  flagged: number
  refused: number
  right: Rate
}

export interface LabReport {
  /** Scored photos (errors excluded). */
  n: number
  errors: number
  /** Over rows with a numeric truth. */
  volume: VolumeError
  /** Within each photo's own `ml_tolerance`; null when no scored photo has one. */
  within_own_tolerance: Rate | null
  /** Per true class (recall). `container` is null when the run passed the hint. */
  classes: { container: ClassRow[] | null; fluid: ClassRow[]; urine_colour: ClassRow[] }
  /** One row per expected outcome present, in EXPECTED_OUTCOMES order. */
  outcomes: OutcomeRow[]
}

/** Rows of one source and one mode, scored with the ward's rules. */
export function labReport(rows: readonly LabRow[], { hinted }: { hinted: boolean }): LabReport {
  const ok = rows.filter((r): r is LabRow & { read: LabRead } => r.read !== null)
  const own = ok.filter((r) => r.read.volume_ml !== null && r.label.expected_ml !== null && r.label.ml_tolerance !== null)
  const tally = (pick: (r: LabRow & { read: LabRead }) => { model: string; final: string | null } | null) =>
    tallyClasses(
      ok.flatMap((r) => {
        const p = pick(r)
        return p ? [{ ...p, settled: true }] : []
      }),
      'final',
    )
  return {
    n: ok.length,
    errors: rows.length - ok.length,
    volume: summariseVolume(
      ok.filter((r) => r.label.expected_ml !== null).map((r) => ({ model: r.read.volume_ml, final: r.label.expected_ml })),
    ),
    within_own_tolerance: own.length
      ? rate(own.filter((r) => Math.abs(r.read.volume_ml! - r.label.expected_ml!) <= r.label.ml_tolerance!).length, own.length)
      : null,
    classes: {
      container: hinted ? null : tally((r) => ({ model: r.read.container, final: r.label.container })),
      fluid: tally((r) => ({ model: r.read.fluid, final: r.label.fluid })),
      urine_colour: tally((r) =>
        r.label.fluid === 'urine' ? { model: r.read.urine_colour ?? 'none', final: r.label.urine_colour } : null,
      ),
    },
    outcomes: EXPECTED_OUTCOMES.flatMap((outcome) => {
      const rs = ok.filter((r) => r.label.outcome === outcome)
      if (!rs.length) return []
      const by = (d: Decision) => rs.filter((r) => decision(r.read) === d).length
      const right = rs.filter((r) => RIGHT[outcome].includes(decision(r.read))).length
      return [
        { outcome, n: rs.length, drafted: by('drafted'), flagged: by('flagged'), refused: by('refused'), right: rate(right, rs.length) },
      ]
    }),
  }
}

export interface LabSummary {
  hinted: boolean
  skipped_synthetic: number
  /** Per mode run; real and synthetic photos never mix. */
  real: Partial<Record<ReadMode, LabReport>>
  synthetic: Partial<Record<ReadMode, LabReport>>
}

export function labSummary(
  rows: readonly LabRow[],
  { hinted, skippedSynthetic }: { hinted: boolean; skippedSynthetic: number },
): LabSummary {
  const part = (source: Sample['source']) => {
    const out: Partial<Record<ReadMode, LabReport>> = {}
    for (const mode of [...new Set(rows.map((r) => r.mode))]) {
      const rs = rows.filter((r) => r.source === source && r.mode === mode)
      if (rs.length) out[mode] = labReport(rs, { hinted })
    }
    return out
  }
  return { hinted, skipped_synthetic: skippedSynthetic, real: part('real'), synthetic: part('synthetic') }
}

/** As the ward shows a rate: `80% · 4/5`, or `— · 2/3` below MIN_N. */
export const rateText = (r: Rate) => `${r.pct === null ? '—' : `${r.pct}%`} · ${r.n}/${r.of}`

const classTable = (title: string, rows: ClassRow[]) =>
  rows.length
    ? [
        `| Expected ${title} | Photos | Read right | Read instead |`,
        '|---|---|---|---|',
        ...rows.map((r) => `| ${r.model} | ${r.n} | ${rateText(r.kept)} | ${r.corrections.map((c) => `${c.to} ${c.n}`).join(', ')} |`),
        '',
      ]
    : []

function reportLines(mode: ReadMode, r: LabReport, hinted: boolean): string[] {
  const v = r.volume
  const volume = v.of
    ? [
        `${v.mae_ml ?? '—'} mL mean error · within ±${VOLUME_TOLERANCE_ML} mL ${rateText(v.within)}`,
        ...(r.within_own_tolerance ? [`within own tolerance ${rateText(r.within_own_tolerance)}`] : []),
        ...(v.no_volume ? [`${v.no_volume} with no volume read`] : []),
      ].join(' · ')
    : 'No photo with a volume truth.'
  return [
    `### ${mode} · ${r.n} photo${r.n === 1 ? '' : 's'}${r.errors ? ` (${r.errors} errored, not scored)` : ''}`,
    '',
    volume,
    '',
    ...(r.outcomes.length
      ? [
          '| Expected | Photos | Drafted | Flagged | Refused | Right call |',
          '|---|---|---|---|---|---|',
          ...r.outcomes.map((o) => `| ${o.outcome} | ${o.n} | ${o.drafted} | ${o.flagged} | ${o.refused} | ${rateText(o.right)} |`),
          '',
        ]
      : []),
    ...(hinted ? ['Container hinted: not scored', ''] : classTable('container', r.classes.container ?? [])),
    ...classTable('fluid', r.classes.fluid),
    ...classTable('urine colour', r.classes.urine_colour),
  ]
}

/** The Markdown sections `eval.ts` appends to its report: real photos, then verified synthetic ones, then the skipped count. */
export function labSections(s: LabSummary): string {
  const section = (title: string, reports: Partial<Record<ReadMode, LabReport>>) => {
    const modes = Object.keys(reports) as ReadMode[]
    return [`## ${title}`, '', ...(modes.length ? modes.flatMap((m) => reportLines(m, reports[m]!, s.hinted)) : ['No photos.', ''])]
  }
  return [
    ...section('Real photos', s.real),
    ...(Object.keys(s.synthetic).length ? section('Synthetic photos (verified labels)', s.synthetic) : []),
    ...(s.skipped_synthetic ? [skippedText(s.skipped_synthetic), ''] : []),
  ].join('\n')
}
