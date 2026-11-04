/**
 * Seeds a deployed app's real capture flow with the synthetic demo pack, over HTTP only, as a ward attendant at the
 * bed would with the web capture screen (dev only; `scripts/demo-capture.ts`).
 *
 *   pnpm --filter @meniscus/server demo:capture <base-url> [pack-dir] [--only a.jpg,b.jpg] [--user mohan] [--yes]
 *
 * `<pack-dir>/manifest.json` (default: apps/server/demo-pack) lists the images; every item must be `synthetic: true`.
 * Without --yes it prints the plan and sends nothing. With --yes it signs in (POST /api/session, the demo password:
 * the username, or DEMO_CAPTURE_PASSWORD), finds the beds (GET /api/admissions), then per image, one at a time, once
 * each: opens the bed (GET entries), shrinks the photo as the web's `shrinkPhoto` does, reads it (POST /api/ai/read:
 * 3 model requests in `sam+spark` mode, sent by the server), keeps it (POST media) and saves what the capture screen
 * would: a jug level, a bag reading, or an entry, linked to the read by `read_id` and to the photo by `media_id`. The
 * server stores the media, logs the read, and the result waits as a pending entry for a nurse. The first error stops
 * the run; nothing is retried or polled.
 *
 * Not reproduced: the labeled copy the web draws on a canvas (it fails soft there too, "Labeled copy not kept"); the
 * live overlay still draws from the stored segmentation. Logs only file names, beds, paths, statuses, mL and timings.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  BAG_CONTAINERS,
  BAG_MAX_ML,
  LEVEL_CONTAINERS,
  MAX_ENTRY_ML,
  PHOTO_MAX_BYTES,
  VOIDING_CONTAINER,
  emptiedByDefault,
  readingInterval,
  type AdmissionSummary,
  type BagContainer,
  type BagReadingInput,
  type BagReadingResult,
  type CaptureReadResult,
  type ContainerKind,
  type Entry,
  type EntryInput,
  type EntryList,
  type LevelContainer,
  type LevelInput,
  type LevelResult,
  type Logged,
  type MediaRef,
  type OutputDevices,
  type PhotoEvidence,
  type SegmentBox,
} from '@meniscus/shared'
import { z } from 'zod'

/** Upstream requests per photo read in `sam+spark` mode: SAM container, SAM liquid, Spark (pipeline.ts). */
export const REQUESTS_PER_ITEM = 3
/** The web's photo shrink (apps/web/src/lib/photo.ts): longest side ≤ 1280 px, JPEG at 0.82, once more at 0.6. */
export const MAX_SIDE = 1280
export const QUALITIES = [82, 60] as const
/** The synthetic pack checked into the repo. */
export const DEFAULT_PACK = join(import.meta.dirname, '..', '..', 'demo-pack')
/** Mohan Das, attendant on 5B and 2C: every default bed is on his wards. */
export const DEFAULT_USER = 'mohan'

/**
 * Story beds (scripts/demo-history.ts) whose pending captures fit the narrative: IV bags join 5B-1's high-confidence
 * captures (batch approve), should a read chart them (see UNCHARTED); a water jug is 5B-4's next level after 650 mL, so its drop is a pending intake with before
 * and after photos; a urine bag is 2C-5's overdue bag reading (catheter, read every 4 h), so its rise is pending output.
 */
export const DEFAULT_BEDS: Record<string, string> = { iv: '5B-1', water: '5B-4', urine: '2C-5' }
const FALLBACK_BED = '5B-1'

const USAGE = 'usage: demo:capture <base-url> [pack-dir] [--only a.jpg,b.jpg] [--user name] [--yes]'

const Item = z.object({
  file: z
    .string()
    .regex(/^[\w.-]+\.(jpe?g|png|webp)$/i, 'a plain image file name')
    .refine((f) => basename(f) === f),
  category: z.string(),
  container: z.string(),
  fluid: z.string(),
  expected_ml: z.number().nonnegative(),
  liquid_colour: z.string().nullable(),
  synthetic: z.unknown(),
  source_id: z.string().optional(),
  /** The bed to capture at, `<ward>-<bed>` (e.g. "5B-1"); default by category (DEFAULT_BEDS). */
  bed: z
    .string()
    .regex(/^[A-Za-z0-9]+-[A-Za-z0-9]+$/, 'a bed label like 5B-1')
    .optional(),
})
const Manifest = z.object({ items: z.array(Item).min(1) })
export type DemoItem = z.infer<typeof Item>

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface CaptureDeps {
  fetch: Fetch
  log: (line: string) => void
  /** Overrides the demo password (the username). */
  password?: string | undefined
  /** Image bytes → the shrunk JPEG the web would upload. Default: ImageMagick. */
  shrink?: (bytes: Uint8Array) => Promise<Uint8Array>
  /** Mean `#rrggbb` of the box's central half, as the web's `sampleColour`; null when unknown. Default: ImageMagick. */
  colour?: (jpeg: Uint8Array, box: SegmentBox) => Promise<string | null>
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
export const bedOf = (it: DemoItem) => it.bed ?? DEFAULT_BEDS[it.category] ?? FALLBACK_BED
const labelOf = (a: Pick<AdmissionSummary, 'ward_code' | 'bed'>) => `${a.ward_code}-${a.bed}`
const isLevel = (c: string): c is LevelContainer => (LEVEL_CONTAINERS as readonly string[]).includes(c)
const isBag = (c: string): c is BagContainer => (BAG_CONTAINERS as readonly string[]).includes(c)
/** What the capture screen saves a read of this container as. */
const pathOf = (c: string) => (isLevel(c) ? 'jug level' : isBag(c) ? 'bag reading' : 'entry')
/**
 * Containers no photo read charts: an IV bag reads as container and liquid `other`, which maps to no category
 * (ai/draft.ts), so the capture screen says "Nothing to chart was found". Its read is still sent and logged.
 */
const UNCHARTED = new Set(['other', 'none'])

/** A failed HTTP step: its status and the server's error code only (a message could echo input). */
class StepError extends Error {
  override readonly name = 'StepError'
}

export async function main(argv: string[], deps: CaptureDeps): Promise<0 | 1 | 2> {
  const { log } = deps
  let base: URL
  let dir: string
  let yes: boolean
  let user: string
  let only: string[] | undefined
  try {
    const a = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { yes: { type: 'boolean', default: false }, only: { type: 'string' }, user: { type: 'string' } },
    })
    if (a.positionals.length < 1 || a.positionals.length > 2) throw new Error()
    base = new URL(a.positionals[0]!)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error()
    dir = a.positionals[1] ?? DEFAULT_PACK
    yes = a.values.yes
    user = a.values.user ?? DEFAULT_USER
    only = a.values.only
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    log(USAGE)
    return 2
  }

  let items: DemoItem[]
  try {
    const parsed = Manifest.safeParse(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')))
    if (!parsed.success) {
      log(`invalid manifest: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
      return 2
    }
    items = parsed.data.items
  } catch {
    log(`cannot read ${join(dir, 'manifest.json')}`)
    return 2
  }
  const notSynthetic = items.filter((it) => it.synthetic !== true)
  if (notSynthetic.length) {
    log(`refused: not synthetic: ${notSynthetic.map((it) => it.file).join(', ')} (only synthetic: true items are sent)`)
    return 2
  }
  if (only) {
    const unknown = only.filter((f) => !items.some((it) => it.file === f))
    if (unknown.length || !only.length) {
      log(`--only: not in the manifest: ${unknown.join(', ') || '(empty)'}`)
      return 2
    }
    items = items.filter((it) => only.includes(it.file))
  }
  for (const it of items)
    if (!existsSync(join(dir, it.file))) {
      log(`missing image: ${it.file}`)
      return 2
    }

  const origin = base.origin + base.pathname.replace(/\/+$/, '')
  const planned = items.length * REQUESTS_PER_ITEM
  log(`${plural(items.length, 'photo')} from ${dir} → ${origin} as ${user}, sam+spark, ${REQUESTS_PER_ITEM} model requests each`)
  for (const it of items)
    log(
      `  ${it.file.padEnd(22)} bed ${bedOf(it).padEnd(6)} ${it.container.padEnd(10)} → ${pathOf(it.container).padEnd(11)} ` +
        `expected ${String(it.expected_ml).padStart(5)} mL  ${REQUESTS_PER_ITEM} requests`,
    )
  const uncharted = items.filter((it) => UNCHARTED.has(it.container))
  if (uncharted.length)
    log(
      `note: ${uncharted.map((it) => it.file).join(', ')}: container "other" charts nothing from a photo (no IV category in ` +
        `the read); ${plural(uncharted.length * REQUESTS_PER_ITEM, 'request')} for read-log rows only. Leave out with --only.`,
    )
  log(`plan: ${plural(planned, 'model request')} on the deployment's budget (sent by its server, one read at a time)`)
  if (!yes) {
    log('dry run: nothing sent. Re-run with --yes to capture these photos.')
    return 0
  }

  // ---------- the attendant's session ----------
  let cookie = ''
  let staffId = 0
  /** One request, as the web's api.ts sends it: the cookie always, `X-Staff-Id` on every non-GET but /session. */
  const send = async (path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> => {
    const { json, ...rest } = init
    const headers: Record<string, string> = {}
    if (cookie) headers.cookie = cookie
    if (json !== undefined) headers['content-type'] = 'application/json'
    if ((rest.method ?? 'GET') !== 'GET' && path !== '/session' && staffId) headers['x-staff-id'] = String(staffId)
    const res = await deps.fetch(`${origin}/api${path}`, {
      ...rest,
      headers,
      ...(json !== undefined && { body: JSON.stringify(json) }),
    })
    if (!res.ok) {
      const body = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as { error?: unknown }) : null
      const code = typeof body?.error === 'string' ? ` ${body.error}` : ''
      throw new StepError(`${(rest.method ?? 'GET').toUpperCase()} /api${path.split('?')[0]} → ${res.status}${code}`)
    }
    return res
  }
  const call = async <T>(path: string, init?: RequestInit & { json?: unknown }) => (await (await send(path, init)).json()) as T
  const form = (fields: Record<string, Blob | string | undefined>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v)
    return f
  }

  const rows: { it: DemoItem; bed: string; path: string; ml: number | null; entry: Entry | null; requests: number; ms: number }[] = []
  let failed = false
  const shrink = deps.shrink ?? shrinkJpeg
  const colour = deps.colour ?? meanColour
  try {
    const res = await send('/session', { method: 'POST', json: { username: user, password: deps.password ?? user } })
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
    staffId = ((await res.json()) as { staff: { id: number } }).staff.id
    if (!cookie) throw new StepError('POST /api/session → no session cookie')
    log(`signed in as ${user}`)

    // The ward list the web opens beds from; each label once.
    const admissions = await call<AdmissionSummary[]>('/admissions')
    const byLabel = new Map(admissions.map((a) => [labelOf(a).toUpperCase(), a]))
    const missing = [...new Set(items.map(bedOf))].filter((b) => !byLabel.has(b.toUpperCase()))
    if (missing.length) throw new StepError(`no admission on bed ${missing.join(', ')}`)

    for (const it of items) {
      const bed = bedOf(it)
      const admission = byLabel.get(bed.toUpperCase())!
      const t0 = performance.now()
      let requests = 0
      try {
        const jpeg = await shrink(new Uint8Array(await readFile(join(dir, it.file))))
        const photo = new Blob([jpeg], { type: 'image/jpeg' })
        // Opening the bed: its devices set the hint list, its bag interval the bag event.
        const chart = await call<EntryList>(`/admissions/${admission.id}/entries`)
        const hint = hintsFor(chart.devices).includes(it.container as ContainerKind) ? it.container : undefined
        const r = await call<Logged<CaptureReadResult>>('/ai/read', {
          method: 'POST',
          body: form({ image: photo, hint, admission_id: String(admission.id) }),
        })
        requests = r.trace.length
        const fluid = r.segmentation?.fluid
        const evidence = toEvidence(r, fluid ? await colour(jpeg, fluid).catch(() => null) : null)
        // The photo first, then the record with its `media_id` (lib/media.ts linkMedia); a failed upload saves without it.
        const keep = async () => {
          try {
            return await call<MediaRef>(`/admissions/${admission.id}/media`, { method: 'POST', body: form({ file: photo, kind: 'photo' }) })
          } catch (e) {
            log(`${it.file}: photo not kept (${e instanceof Error ? e.message : 'error'})`)
            return null
          }
        }
        const level = isLevel(r.reading.container) && r.reading.volume_ml !== null ? r.reading.container : null
        const bag = isBag(r.reading.container) && r.reading.volume_ml !== null ? r.reading.container : null
        let entry: Entry | null
        let path: string
        if (level) {
          path = 'jug level'
          const m = await keep()
          const body: LevelInput = {
            container: level,
            volume_ml: clamp(r.reading.volume_ml ?? 0, 0),
            source: 'photo',
            confidence: r.reading.confidence,
            evidence,
            ...(m && { media_id: m.id }),
            read_id: r.read_id,
          }
          entry = (await call<LevelResult>(`/admissions/${admission.id}/levels`, { method: 'POST', json: body })).entry
        } else if (bag) {
          path = 'bag reading'
          const m = await keep()
          const bags = chart.bags
          const emptied = emptiedByDefault(bags ? { h: bags.interval_h, from: bags.interval_from } : readingInterval(admission))
          const colourOf = r.draft && bag === 'urine_bag' && r.draft.category === 'urine' ? r.draft : null
          const notes = r.draft?.notes?.trim()
          const body: BagReadingInput = {
            container: bag,
            event: emptied ? 'emptied' : 'check',
            volume_ml: Math.min(BAG_MAX_ML, Math.max(0, Math.round(r.reading.volume_ml!))),
            source: 'photo',
            ...(m && { media_id: m.id }),
            ...(r.reading.confidence !== null && { confidence: r.reading.confidence }),
            evidence,
            ...(notes && { notes: notes.slice(0, 200) }),
            ...(colourOf?.urine_colour && {
              urine_colour: colourOf.urine_colour,
              ...(colourOf.urine_rgb && { urine_rgb: colourOf.urine_rgb }),
            }),
            read_id: r.read_id,
          }
          entry = (await call<BagReadingResult>(`/admissions/${admission.id}/bag-readings`, { method: 'POST', json: body })).entry
        } else if (!r.draft || r.draft.volume_ml === null || r.draft.volume_ml < 1) {
          // The capture screen has nothing to save ("Nothing to chart was found"); the read stays in the read log.
          path = 'nothing to chart'
          entry = null
        } else {
          path = 'entry'
          const d = r.draft
          const m = await keep()
          const body: EntryInput = {
            direction: d.direction,
            category: d.category,
            volume_ml: clamp(d.volume_ml!),
            item: d.item,
            notes: d.notes,
            source: 'photo',
            confidence: r.reading.confidence,
            evidence,
            ...(d.category === 'urine' &&
              d.urine_colour && { urine_colour: d.urine_colour, ...(d.urine_rgb && { urine_rgb: d.urine_rgb }) }),
            ...((d.category === 'water' || d.category === 'food') && d.drink && { drink: d.drink }),
            read_id: r.read_id,
            read_draft: 0,
            ...(m && { media_id: m.id }),
          }
          entry = await call<Entry>(`/admissions/${admission.id}/entries`, { method: 'POST', json: body })
        }
        const ms = Math.round(performance.now() - t0)
        rows.push({ it, bed, path, ml: r.reading.volume_ml, entry, requests, ms })
        log(
          `${it.file}: bed ${bed} ${path} ${r.reading.volume_ml ?? '—'} mL (${r.mode}, ${plural(requests, 'request')}, ${ms} ms)` +
            (entry
              ? ` → entry ${entry.id} ${entry.status} ${entry.volume_ml} mL`
              : path === 'entry' || path === 'nothing to chart'
                ? ' → no entry'
                : ' → no entry (first reading: a baseline)'),
        )
      } catch (e) {
        rows.push({ it, bed, path: '—', ml: null, entry: null, requests, ms: Math.round(performance.now() - t0) })
        throw e
      }
    }
  } catch (e) {
    const what = e instanceof StepError ? e.message : `${e instanceof Error ? e.name : 'error'}`
    log(`ERROR ${what}; stopping (no retries)`)
    failed = true
  }

  log('')
  for (const { it, bed, path, ml, entry, requests } of rows)
    log(
      `${it.file.padEnd(22)} bed ${bed.padEnd(6)} ${path.padEnd(11)} expected ${String(it.expected_ml).padStart(5)}  read ${String(ml ?? '—').padStart(5)}  ` +
        `${entry ? `pending ${entry.volume_ml} mL` : 'no entry'}  ${plural(requests, 'request')}`,
    )
  log(
    `${plural(
      rows.reduce((a, r) => a + r.requests, 0),
      'model request',
    )} sent by the server (from each read's trace)`,
  )
  return failed ? 1 : 0
}

const clamp = (ml: number, min = 1) => Math.min(MAX_ENTRY_ML, Math.max(min, Math.round(ml)))

/** The bed's photo hints (apps/web/src/lib/capture.ts hintsFor), Auto-detect left out. */
export function hintsFor(devices: OutputDevices): ContainerKind[] {
  const urine = devices.urine === 'catheter' ? 'urine_bag' : VOIDING_CONTAINER[devices.urine]
  const own: ContainerKind[] = [...(urine && urine !== 'urine_bag' ? [urine] : []), ...devices.bags]
  const others: ContainerKind[] = ['urinal', 'bedpan', 'commode_pan', 'emesis_basin']
  return [...own, 'water_jug', 'water_bottle', 'cup', 'measuring_jug', ...others.filter((h) => !own.includes(h))]
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** Photo read → evidence, as the web's `toEvidence` (apps/web/src/lib/evidence.ts), with its server bounds. */
export function toEvidence(r: CaptureReadResult, colour: string | null): PhotoEvidence {
  return {
    kind: 'photo',
    mode: r.mode,
    ...(r.image_sha256 && { image_sha256: r.image_sha256 }),
    reading: {
      ...r.reading,
      reading_basis: cut(r.reading.reading_basis, 300),
      appearance: r.reading.appearance === null ? null : cut(r.reading.appearance, 200),
      issues: [...new Set(r.reading.issues)],
    },
    segmentation: r.segmentation,
    review_reasons: r.warnings.slice(0, 8).map((w) => cut(w, 200)),
    trace: r.trace.slice(0, 3),
    colour: r.segmentation?.fluid ? colour : null,
  }
}

/**
 * The web's `shrinkPhoto` locally: EXIF orientation applied, longest side ≤ 1280 px (never enlarged), metadata
 * stripped, JPEG at quality 82, once more at 60 if still over PHOTO_MAX_BYTES. ImageMagick (`magick`, else `convert`).
 */
export async function shrinkJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  return withTmp(bytes, async (src, tmp) => {
    for (const q of QUALITIES) {
      const out = join(tmp, `out-${q}.jpg`)
      await magick([src, '-auto-orient', '-resize', `${MAX_SIDE}x${MAX_SIDE}>`, '-strip', '-quality', String(q), out])
      const jpeg = new Uint8Array(await readFile(out))
      if (jpeg.byteLength <= PHOTO_MAX_BYTES) return jpeg
    }
    throw new Error('photo too large after shrinking')
  })
}

/** The web's `meanColour` of the fluid box's central half (inset 25% per side), as `#rrggbb`. */
export async function meanColour(jpeg: Uint8Array, box: SegmentBox): Promise<string | null> {
  const x0 = Math.ceil(box.left + (box.right - box.left) / 4)
  const y0 = Math.ceil(box.top + (box.bottom - box.top) / 4)
  const w = Math.floor(box.right - (box.right - box.left) / 4) - x0
  const h = Math.floor(box.bottom - (box.bottom - box.top) / 4) - y0
  if (w < 1 || h < 1) return null
  const out = await withTmp(jpeg, (src) =>
    magick([src, '-crop', `${w}x${h}+${x0}+${y0}`, '+repage', '-scale', '1x1!', '-format', '%[hex:p{0,0}]', 'info:']),
  )
  const hex = out.trim().slice(0, 6).toLowerCase()
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null
}

async function withTmp<T>(bytes: Uint8Array, fn: (src: string, dir: string) => Promise<T>): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), 'meniscus-capture-'))
  try {
    const src = join(tmp, 'in')
    await writeFile(src, bytes)
    return await fn(src, tmp)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** ImageMagick 7 (`magick`), else 6 (`convert`, as on CI runners); its stdout. */
async function magick(args: string[]): Promise<string> {
  try {
    return await run('magick', args)
  } catch (e) {
    if (e instanceof Error && e.message.endsWith('unavailable')) return run('convert', args)
    throw e
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => reject(new Error(`${cmd} unavailable`)))
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err.trim().split('\n').pop()}`))))
  })
}
