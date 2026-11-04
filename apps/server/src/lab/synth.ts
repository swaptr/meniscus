/**
 * Dev-only image synthesis for the accuracy dataset (spec: eval/synthetic-images).
 *
 *   pnpm --filter @meniscus/server synth <plan.json> <outdir> [--yes]
 *
 * One plan item = one Muse Image request. Without --yes it only prints the plan
 * and the cost, and builds no client. With --yes it sends the items not yet made,
 * in order, and stops at the first failure: no retry, no second prompt.
 * Each image is written as returned, next to a provenance sidecar (draft labels).
 * Lines printed here hold ids, kinds, statuses, codes, timings and counts only.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { checkImageRequest, MetaTimeoutError, type ImageOutputFormat, type MetaClient } from '@meniscus/meta'
import { CONTAINER_KINDS, FLUID_KINDS, PORTIONS, URINE_COLOURS } from '@meniscus/shared'
import { z } from 'zod'

const USAGE = 'usage: synth <plan.json> <outdir> [--yes]'
const USD_PER_IMAGE = 0.01
const DEFAULT_MODEL = 'muse-image-1.0'
const DEFAULT_TIMEOUT_MS = 300_000
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/

// ---------- plan file ----------

const Options = {
  n: z.number().int().min(1).max(10).optional(),
  size: z.string().optional(),
  output_format: z.enum(['webp', 'png', 'jpeg']).optional(),
  reasoning_strength: z.enum(['low', 'high']).optional(),
}

/** Draft labels: the dataset manifest's field names and vocabularies, plus pass-through fields. */
const Labels = z.strictObject({
  expected_container: z.enum(CONTAINER_KINDS).optional(),
  expected_fluid: z.enum(FLUID_KINDS).optional(),
  liquid_colour: z.enum([...URINE_COLOURS, 'clear', 'n/a']).optional(),
  expected_ml: z.number().int().min(0).nullable().optional(),
  ml_tolerance: z.number().int().min(1).optional(),
  expected_outcome: z.enum(['positive', 'degraded', 'negative']).optional(),
  meal_portion_eaten: z.literal([...PORTIONS]).optional(),
  /** Opaque JSON object, copied unchanged. */
  truth: z.record(z.string(), z.unknown()).optional(),
  pair_id: z.string().min(1).optional(),
  pair_role: z.enum(['before', 'after']).optional(),
})
export type SynthLabels = z.infer<typeof Labels>

const Item = z.strictObject({
  id: z.string().regex(ID),
  kind: z.enum(['generate', 'edit']),
  prompt: z.string().refine((s) => s.trim() !== ''),
  labels: Labels.optional(),
  inputs: z.array(z.strictObject({ path: z.string().min(1), id: z.string().min(1).optional() })).optional(),
  ...Options,
})

const Plan = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1).optional(),
  defaults: z.strictObject(Options).optional(),
  items: z.array(z.unknown()).min(1),
})

/** A plan problem: the line after `invalid plan: `. Any one refuses the whole plan. */
export class PlanError extends Error {
  override name = 'PlanError'
}

export interface LoadedInput {
  /** As written in the plan (relative to the plan file). */
  path: string
  /** Dataset id, e.g. 'tray-001'. */
  id: string | null
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  dataUrl: string
}

export interface LoadedItem {
  id: string
  kind: 'generate' | 'edit'
  prompt: string
  n: number
  size?: string
  outputFormat: ImageOutputFormat
  reasoningStrength: 'low' | 'high'
  /** Exactly as in the plan file. */
  labels: Record<string, unknown>
  inputs: LoadedInput[]
  /** synth-<id>, or synth-<id>-1 … synth-<id>-n. */
  stems: string[]
}

export interface LoadedPlan {
  model: string
  items: LoadedItem[]
}

/** synth-<id> for n = 1; synth-<id>-1 … synth-<id>-n otherwise. */
export function outputStems(id: string, n: number): string[] {
  return n === 1 ? [`synth-${id}`] : Array.from({ length: n }, (_, k) => `synth-${id}-${k + 1}`)
}

/** The first problem with one raw item, worded for the plan's author. Names fields, never their values. */
function itemProblem(raw: Record<string, unknown>, issues: readonly z.core.$ZodIssue[]): string {
  const unknown = issues.find((i) => i.code === 'unrecognized_keys')
  if (unknown) return `unknown field ${unknown.keys.map((k) => [...unknown.path, k].join('.')).join(', ')}`
  const i = issues[0]!
  const [head, key] = i.path
  if (head === 'id') return 'id must be lowercase letters, digits and hyphens'
  if (head === 'prompt') return typeof raw.prompt === 'string' ? 'prompt is blank' : 'prompt must be a string'
  if (head === 'n') return 'n must be an integer from 1 to 10'
  if (head === 'kind') return 'kind must be generate or edit'
  if (head === 'labels' && typeof key === 'string') return `labels.${key} is not allowed`
  return `${i.path.join('.') || 'item'}: ${i.message}`
}

function sniff(b: Uint8Array): LoadedInput['mime'] | undefined {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  return undefined
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/**
 * Read and check a plan. Throws PlanError on the first problem: nothing is
 * sent for a plan with any invalid item. Reads, sniffs and hashes every input.
 */
export async function loadPlan(file: string): Promise<LoadedPlan> {
  const name = basename(file)
  let rawPlan: unknown
  try {
    rawPlan = JSON.parse(await readFile(file, 'utf8'))
  } catch (e) {
    throw new PlanError(`${name}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : 'not JSON'}`)
  }
  const top = Plan.safeParse(rawPlan)
  if (!top.success) {
    const i = top.error.issues[0]!
    throw new PlanError(
      `${name}: ${i.code === 'unrecognized_keys' ? `unknown field ${i.keys.join(', ')}` : `${i.path.join('.') || 'plan'}: ${i.message}`}`,
    )
  }
  const { defaults = {}, items: rawItems } = top.data
  const base = dirname(resolve(file))
  const seen = new Set<string>()
  const items: LoadedItem[] = []

  for (const [index, raw] of rawItems.entries()) {
    const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const label = typeof obj.id === 'string' && obj.id ? obj.id : `items[${index}]`
    const fail = (problem: string): never => {
      throw new PlanError(`${label}: ${problem}`)
    }
    const parsed = Item.safeParse(raw)
    if (!parsed.success) fail(itemProblem(obj, parsed.error.issues))
    const it = parsed.data!
    if (seen.has(it.id)) fail('duplicate id')
    seen.add(it.id)

    const n = it.n ?? defaults.n ?? 1
    const size = it.size ?? defaults.size
    try {
      checkImageRequest({ prompt: it.prompt, n, ...(size !== undefined && { size }) })
    } catch (e) {
      fail((e as Error).message)
    }
    if (it.kind === 'edit' && !(it.inputs && it.inputs.length >= 1 && it.inputs.length <= 10)) fail('an edit needs 1 to 10 inputs')
    if (it.kind === 'generate' && it.inputs !== undefined) fail('a generate item takes no inputs')

    const inputs: LoadedInput[] = []
    for (const input of it.inputs ?? []) {
      let bytes: Uint8Array
      try {
        bytes = await readFile(resolve(base, input.path))
      } catch {
        return fail(`input ${input.path} not found`)
      }
      const mime = sniff(bytes) ?? fail(`input ${input.path} is not JPEG, PNG or WebP`)
      inputs.push({
        path: input.path,
        id: input.id ?? null,
        mime,
        sha256: sha256(bytes),
        dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      })
    }

    items.push({
      id: it.id,
      kind: it.kind,
      prompt: it.prompt,
      n,
      ...(size !== undefined && { size }),
      outputFormat: it.output_format ?? defaults.output_format ?? 'webp',
      reasoningStrength: it.reasoning_strength ?? defaults.reasoning_strength ?? 'low',
      labels: (obj.labels as Record<string, unknown> | undefined) ?? {},
      inputs,
      stems: outputStems(it.id, n),
    })
  }

  // Output collisions: no two items may write the same file.
  const owner = new Map<string, string>()
  for (const item of items) {
    for (const stem of item.stems) {
      const prev = owner.get(stem)
      if (prev) throw new PlanError(`${prev} and ${item.id} both write ${stem}.json`)
      owner.set(stem, item.id)
    }
  }
  return { model: top.data.model ?? DEFAULT_MODEL, items }
}

// ---------- plan ----------

export interface PlanCounts {
  todo: LoadedItem[]
  made: string[]
  requests: number
  images: number
  usd: number
}

/** An item is made when all n of its sidecars exist; every other item is 1 request. */
export function planFor(p: LoadedPlan, outDir: string): PlanCounts {
  const isMade = (it: LoadedItem) => it.stems.every((s) => existsSync(join(outDir, `${s}.json`)))
  const todo = p.items.filter((it) => !isMade(it))
  const images = todo.reduce((a, it) => a + it.n, 0)
  return {
    todo,
    made: p.items.filter(isMade).map((it) => it.id),
    requests: todo.length,
    images,
    usd: images * USD_PER_IMAGE,
  }
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

// ---------- sending ----------

/** Provenance sidecar beside each image: the output contract with the dataset (design §7). */
export interface SynthSidecar {
  id: string
  synthetic: true
  label_status: 'draft'
  verified_by: null
  generator: string
  plan_item: string
  kind: 'generate' | 'edit'
  image: string
  index: number
  prompt: string
  revised_prompt: string | null
  created: number
  output_format: ImageOutputFormat
  sha256: string
  source_sha256?: string[]
  source_ids?: (string | null)[]
  labels: Record<string, unknown>
}

class SynthError extends Error {
  override name = 'SynthError'
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

/** The code printed for a failure: never the message, which may echo upstream text. */
function codeOf(e: unknown): string {
  const code = (e as { code?: unknown }).code
  if (typeof code === 'string' && code) return code
  return e instanceof Error ? e.name : 'error'
}

/** Sends the items not yet made, in order, one request each; stops at the first failure. */
export async function runPlan(
  p: LoadedPlan,
  o: { client: MetaClient; outDir: string; timeoutMs: number; log: (line: string) => void },
): Promise<{ sent: number; failed?: { item: string; code: string } }> {
  const { todo, requests } = planFor(p, o.outDir)
  await mkdir(o.outDir, { recursive: true })
  const start = o.client.budget.stats().total
  const sent = () => o.client.budget.stats().total - start

  for (const item of p.items) {
    if (!todo.includes(item)) {
      o.log(`${item.id} ${item.kind} made`)
      continue
    }
    const t0 = performance.now()
    try {
      const params = {
        model: p.model,
        prompt: item.prompt,
        n: item.n,
        ...(item.size !== undefined && { size: item.size }),
        outputFormat: item.outputFormat,
        reasoningStrength: item.reasoningStrength,
        timeoutMs: o.timeoutMs,
      }
      const r =
        item.kind === 'edit'
          ? await o.client.images.edit({ ...params, images: item.inputs.map((i) => ({ image_url: i.dataUrl })) })
          : await o.client.images.generate(params)
      // Checked before any file of this item is written.
      if (r.images.length < item.n) throw new SynthError('image_count')

      const ext = item.outputFormat === 'jpeg' ? 'jpg' : item.outputFormat
      for (const [k, stem] of item.stems.entries()) {
        const image = r.images[k]!
        const file = `${stem}.${ext}`
        await writeFile(join(o.outDir, file), image.bytes)
        const sidecar: SynthSidecar = {
          id: stem,
          synthetic: true,
          label_status: 'draft',
          verified_by: null,
          generator: r.model,
          plan_item: item.id,
          kind: item.kind,
          image: file,
          index: k + 1,
          prompt: item.prompt,
          revised_prompt: image.revisedPrompt ?? null,
          created: r.created,
          output_format: item.outputFormat,
          sha256: sha256(image.bytes),
          ...(item.kind === 'edit' && {
            source_sha256: item.inputs.map((i) => i.sha256),
            source_ids: item.inputs.map((i) => i.id),
          }),
          labels: item.labels,
        }
        // Written after its image: a sidecar means that image is complete.
        await writeFile(join(o.outDir, `${stem}.json`), `${JSON.stringify(sidecar, null, 2)}\n`)
      }
      o.log(`${item.id} ${item.kind} sent 200 ${r.ms}ms`)
    } catch (e) {
      const code = codeOf(e)
      const status = (e as { status?: unknown }).status
      o.log(`${item.id} ${item.kind} failed ${typeof status === 'number' ? status : '—'} ${Math.round(performance.now() - t0)}ms`)
      if (e instanceof MetaTimeoutError) o.log(`${item.id} timed out: the request may still be billed`)
      o.log(`stopped at ${item.id}: ${code}; ${sent()} of ${requests} requests sent`)
      return { sent: sent(), failed: { item: item.id, code } }
    }
  }
  o.log(`${sent()} of ${requests} requests sent`)
  return { sent: sent() }
}

// ---------- CLI ----------

export interface SynthDeps {
  /** The server's single Meta client. Built only with --yes. */
  client: () => MetaClient
  /** The configured hourly limit (MODEL_API_MAX_REQUESTS_PER_HOUR), used by a dry run. */
  perHour: number
  /** The configured critical reserve (CRITICAL_RESERVE_PCT), used by a dry run: the script runs at normal priority. Default 0. */
  reservePct?: number
  log: (line: string) => void
  /** Per image request. Default 300 s. */
  timeoutMs?: number
}

/** The whole CLI except process wiring; returns the exit code. */
export async function main(argv: string[], deps: SynthDeps): Promise<0 | 1 | 2> {
  const { log } = deps
  let args: { positionals: string[]; yes: boolean }
  try {
    const a = parseArgs({ args: argv, allowPositionals: true, options: { yes: { type: 'boolean', default: false } } })
    args = { positionals: a.positionals, yes: a.values.yes }
  } catch {
    log(USAGE)
    return 2
  }
  const [planFile, outDir] = args.positionals
  if (!planFile || !outDir || args.positionals.length > 2) {
    log(USAGE)
    return 2
  }

  let plan: LoadedPlan
  try {
    plan = await loadPlan(planFile)
  } catch (e) {
    if (!(e instanceof PlanError)) throw e
    log(`invalid plan: ${e.message}`)
    return 2
  }
  const counts = planFor(plan, outDir)

  // A dry run builds no client (so it needs no key) and checks the configured limit less the critical reserve: the
  // script's requests run at normal priority, so they can never use the share kept for critical beds.
  let client: MetaClient | undefined
  let perHour = deps.perHour
  let left = deps.perHour - Math.floor((deps.perHour * (deps.reservePct ?? 0)) / 100)
  if (args.yes) {
    try {
      client = deps.client()
    } catch (e) {
      log(e instanceof Error ? e.message : String(e))
      return 2
    }
    const s = client.budget.stats()
    perHour = s.perHour
    left = s.remaining.normal
  }

  const generate = plan.items.filter((it) => it.kind === 'generate').length
  log(
    `${count(plan.items.length, 'item')} (${generate} generate, ${plan.items.length - generate} edit), ${counts.made.length} already made`,
  )
  log(
    `plan: ${count(counts.requests, 'request')}, ${count(counts.images, 'image')}, $${counts.usd.toFixed(2)} (budget ${perHour}/h, ${left} left)`,
  )
  if (counts.requests > left) {
    log(`plan needs ${count(counts.requests, 'request')}; ${left} left this hour`)
    return 2
  }
  if (!client) {
    log('dry run. Re-run with --yes to send these requests.')
    return 0
  }
  const r = await runPlan(plan, { client, outDir, timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, log })
  return r.failed ? 1 : 0
}
