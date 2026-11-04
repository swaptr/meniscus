/**
 * The printed chart's `Photos` section (web/ward "Photos on the printed chart"), DOM-free: the photo entries and photo
 * meals of the last 24 hours, newest first, at most 12, each with the one media id it fetches (its labeled copy, else
 * its raw photo). No requests.
 */
import type { Entry, Meal } from '@meniscus/shared'
import { DRINK_LABEL } from './drinks.ts'
import { clock } from './format.ts'
import { CATEGORY_LABEL } from './labels.ts'
import { MEAL_LABEL } from './meals.ts'
import { photoLabeled, photoMediaId } from './media-cache.ts'

export const PRINT_PHOTOS_MAX = 12
const DAY = 24 * 3_600_000

export interface PrintPhoto {
  key: string
  /** `09:10 · Urine 380 mL`, `12:40 · Lunch`. */
  title: string
  media_id: number
  /** Showing the stored labeled copy; false: the raw photo under `No labeled copy`. */
  labeled: boolean
  at: number
}

export function printPhotos(entries: readonly Entry[], meals: readonly Meal[], now: number): PrintPhoto[] {
  const recent = (iso: string) => {
    const t = Date.parse(iso)
    return t > now - DAY && t <= now
  }
  const fromEntries = entries.flatMap((e): PrintPhoto[] => {
    const raw = photoMediaId(e)
    if (raw === null || e.status === 'rejected' || !recent(e.created_at)) return []
    const copy = photoLabeled(e)
    const what = e.drink ? DRINK_LABEL[e.drink] : CATEGORY_LABEL[e.category]
    return [
      {
        key: `e${e.id}`,
        title: `${clock(e.created_at)} · ${what} ${e.volume_ml} mL`,
        media_id: copy?.id ?? raw,
        labeled: !!copy,
        at: Date.parse(e.created_at),
      },
    ]
  })
  const fromMeals = meals.flatMap((m): PrintPhoto[] => {
    if (m.voided_at || m.media?.kind !== 'photo' || !recent(m.created_at)) return []
    return [
      {
        key: `m${m.id}`,
        title: `${clock(m.created_at)} · ${MEAL_LABEL[m.meal]}`,
        media_id: m.labeled_media?.id ?? m.media.id,
        labeled: !!m.labeled_media,
        at: Date.parse(m.created_at),
      },
    ]
  })
  return [...fromEntries, ...fromMeals].toSorted((a, b) => b.at - a.at).slice(0, PRINT_PHOTOS_MAX)
}

/** Printing waits for every photo: true once each has loaded or failed (an empty section is ready at once). */
export const photosSettled = (photos: readonly { media_id: number }[], settled: ReadonlySet<number>): boolean =>
  photos.every((p) => settled.has(p.media_id))

/**
 * Fetches each listed photo once (`GET /api/media/<id>`), reporting each as it loads (`blob`) or fails (null). Resolves
 * when all have settled; never retries.
 */
export async function loadPrintPhotos(
  fetchMedia: (id: number, signal?: AbortSignal) => Promise<Blob>,
  photos: readonly { media_id: number }[],
  onSettled: (id: number, blob: Blob | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  const ids = [...new Set(photos.map((p) => p.media_id))]
  await Promise.all(
    ids.map((id) =>
      fetchMedia(id, signal).then(
        (b) => onSettled(id, b),
        () => onSettled(id, null),
      ),
    ),
  )
}
