/**
 * Tray proof on the web, DOM-free: the packed dish masks a meal keeps (decoded with the web's own base64, never
 * `@meniscus/meta`), their overlay geometry and labels, the proof rows and media fingerprints. No requests.
 */
import type {
  DishValue,
  Entry,
  Meal,
  MealDish,
  MealFluid,
  MediaRef,
  SourceKind,
  TrayPhotoProof,
  TrayRegion,
  TraySegmentation,
} from '@meniscus/shared'
import { decodeBits } from './contour.ts'
import { mealFluidLine } from './drinks.ts'
import { DISH_LABEL } from './labels.ts'
import { PORTION_LABEL } from './meals.ts'
import { shortName } from './staff.ts'
import { hhmm } from './timeline.ts'

/** What a tray overlay draws: the regions, and the dishes and drinks that name them. */
export interface TrayView {
  segmentation: TraySegmentation | null
  dishes: DishValue[]
  fluids: MealFluid[]
}

export { decodeBits }

/** A region's label lines: `<index> <name> · <portion>` per dish in it, `<index> <name> · <Kind> · <mL> mL` per drink. */
export function trayRegionLines(r: Pick<TrayRegion, 'index'>, tray: Pick<TrayView, 'dishes' | 'fluids'>): string[] {
  return [
    ...tray.dishes.filter((d) => d.index === r.index).map((d) => `${r.index} ${d.name} · ${PORTION_LABEL[d.portion]}`),
    ...tray.fluids.filter((f) => f.index === r.index).map((f) => `${r.index} ${mealFluidLine(f)}`),
  ]
}

const pct = (v: number, of: number) => Math.round((1000 * v) / of) / 10

/** The region labels, at each box's top left in percent; regions nothing names get none. */
export function trayLabels(tray: TrayView, w: number, h: number): { index: number; left: number; top: number; lines: string[] }[] {
  return (tray.segmentation?.regions ?? []).flatMap((r) => {
    const lines = trayRegionLines(r, tray)
    return lines.length ? [{ index: r.index, left: pct(r.box.left, w), top: pct(r.box.top, h), lines }] : []
  })
}

/** The outline starts on when the tray has regions to draw. */
export const trayOutlineDefault = (tray: TrayView | null | undefined) => !!tray?.segmentation?.regions.length

/** `3f2a…c9`: the first 4 and last 2 hex of a SHA-256, or null when none was recorded. */
export const fingerprint = (sha256: string | null) => (sha256 ? `${sha256.slice(0, 4)}…${sha256.slice(-2)}` : null)

/** The meta line under a kept photo or recording, titled with the full value. */
export function fingerprintLine(kind: SourceKind, sha256: string | null): { text: string; title: string | undefined } {
  const short = fingerprint(sha256)
  if (!short) return { text: 'Fingerprint not recorded', title: undefined }
  return { text: `${kind === 'voice' ? 'Recording' : 'Photo'} fingerprint: ${short}`, title: sha256! }
}

/** The fingerprint line for an entry's kept photo or recording; null when nothing was kept. */
export const sourceFingerprint = (e: Pick<Entry, 'media'>) => (e.media ? fingerprintLine(e.media.kind, e.media.sha256) : null)

export interface ProofPhoto {
  /** Null once the photo is deleted (voided): nothing is fetched. */
  media_id: number | null
  line: string
  fingerprint: { text: string; title: string | undefined } | null
  /** The labeled copy kept with the tray photo; null for the served photo, or when none was kept. */
  labeled: MediaRef | null
}

export interface ProofView {
  photo: ProofPhoto
  /** The overlay of the saved dishes on the read's regions. */
  tray: TrayView | null
  /** The served tray photo, the before of the pair; null when the meal has none. */
  served: ProofPhoto | null
  /** The served photo's regions, labelled from the saved dishes matched to them (by served region number). */
  servedTray: TrayView | null
  /** Between the pair: `1 rice · 80% served · 40% left · Half eaten` per measured dish, or `No dish measured`. */
  stat: string | null
  /**
   * `<index> <name> · <kind> · [measured <portion> · ]AI <portion> · saved <portion>`; `changed` when the saved value
   * differs from the read.
   */
  rows: { text: string; changed: boolean }[]
  saved: string
}

/** The media a proof fetches when opened (Labeled first), in order: the tray's labeled copy or photo, then the served photo. */
export const proofMedia = (v: ProofView): number[] =>
  [v.photo.media_id === null ? null : (v.photo.labeled?.id ?? v.photo.media_id), v.served?.media_id ?? null].filter(
    (id): id is number => id !== null,
  )

const proofPhoto = (kept: boolean, p: TrayPhotoProof, title: string, gone: string): ProofPhoto => {
  const by = p.captured_by ? ` · ${shortName(p.captured_by.name)}` : ''
  return kept
    ? {
        media_id: p.media_id,
        line: `${title} · ${hhmm(p.captured_at)}${by}`,
        fingerprint: fingerprintLine('photo', p.sha256),
        labeled: null,
      }
    : { media_id: null, line: `${gone} · fingerprint ${fingerprint(p.sha256) ?? 'not recorded'}`, fingerprint: null, labeled: null }
}

const percent = (c: number) => Math.round(c * 100)

/** The eaten-share stat line: each measured dish's served and left coverage and its portion eaten. */
function eatenShare(dishes: readonly MealDish[]): string {
  const measured = dishes.filter((d) => d.basis === 'measured' && d.measure && d.coverage !== null)
  if (!measured.length) return 'No dish measured'
  return measured
    .map(
      (d) =>
        `${d.index} ${d.name} · ${percent(d.measure!.served_coverage)}% served · ${percent(d.coverage!)}% left · ${PORTION_LABEL[d.portion]} eaten`,
    )
    .join(' · ')
}

/** Read and saved dishes paired by region number, then by order among the rest. */
function pairDishes<R extends DishValue>(read: readonly R[], saved: readonly DishValue[]) {
  const used = new Set<number>()
  const byIndex = saved.map((s) => {
    const k = s.index > 0 ? read.findIndex((r, i) => !used.has(i) && r.index === s.index) : -1
    if (k >= 0) used.add(k)
    return k
  })
  const rest = read.map((_, i) => i).filter((i) => !used.has(i))
  const pairs = saved.map((s, n) => ({ saved: s, read: read[byIndex[n]! >= 0 ? byIndex[n]! : (rest.shift() ?? -1)] }))
  return { pairs, unsaved: rest.map((i) => read[i]!) }
}

const dishName = (d: DishValue) => `${d.index > 0 ? `${d.index} ` : ''}${d.name} · ${DISH_LABEL[d.dish_kind]}`

/** "What the AI read"'s proof for a photo meal saved with evidence; null for any other meal. */
export function proofView(m: Meal): ProofView | null {
  const p = m.proof
  if (!p) return null
  const read: MealDish[] = m.evidence?.reading.dishes ?? []
  const { pairs, unsaved } = pairDishes(read, p.confirmed.dishes)
  const comparison = m.evidence?.comparison ?? null
  // A measured dish shows the measure, then the AI's own portion.
  const aiText = (r: MealDish) =>
    r.basis === 'measured'
      ? `measured ${PORTION_LABEL[r.portion]} · AI ${PORTION_LABEL[r.model_portion]}`
      : `AI ${PORTION_LABEL[r.portion]}`
  return {
    photo: {
      ...proofPhoto(m.media !== null, { ...p.photo, media_id: m.media?.id ?? p.photo.media_id }, 'Tray photo', 'Photo deleted'),
      labeled: m.media ? (m.labeled_media ?? null) : null,
    },
    tray: m.evidence ? { segmentation: m.evidence.segmentation, dishes: m.dishes, fluids: m.evidence.reading.fluids } : null,
    served: p.served
      ? proofPhoto(
          m.served_media !== null,
          { ...p.served, media_id: m.served_media?.id ?? p.served.media_id },
          'Served tray',
          'Served tray deleted',
        )
      : null,
    servedTray: comparison?.served
      ? {
          segmentation: comparison.served,
          dishes: m.dishes.flatMap((d) => {
            const match = d.index > 0 ? comparison.matches.find((x) => x.index === d.index) : undefined
            return match ? [{ ...d, index: match.served_index }] : []
          }),
          fluids: [],
        }
      : null,
    stat: comparison?.served ? eatenShare(read) : null,
    rows: [
      ...pairs.map(({ saved, read: r }) => ({
        text: `${dishName(saved)} · ${r ? `${aiText(r)} · ` : ''}saved ${PORTION_LABEL[saved.portion]}`,
        changed: !r || r.portion !== saved.portion,
      })),
      ...unsaved.map((r) => ({ text: `${dishName(r)} · AI ${PORTION_LABEL[r.portion]} · not saved`, changed: true })),
    ],
    saved: `Saved${p.confirmed_by ? ` by ${shortName(p.confirmed_by.name)}` : ''} · ${hhmm(p.confirmed_at)}`,
  }
}
