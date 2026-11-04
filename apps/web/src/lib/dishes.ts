/**
 * A meal's dishes in the bed review's Nutrition section (web/ward "Dishes in the Nutrition section"): one line per
 * dish with its kind's label, marked when a meal amendment changed, added or removed it; and "Show tray", which fetches
 * the tray photo once per meal. DOM-free; no model requests.
 */
import type { DishValue, Meal, MealAmendment } from '@meniscus/shared'
import type { Api } from './api.ts'
import { DISH_LABEL } from './labels.ts'
import { PORTION_LABEL } from './meals.ts'
import { shortName } from './staff.ts'
import { hhmm } from './timeline.ts'
import type { TrayView } from './tray.ts'

export interface DishRow {
  key: string
  /** `rice · All`. */
  text: string
  /** The dish kind's label: `Rice`. */
  kind: string
  /** `Amended 14:10 by Anita T. · was rice`, `Added …`, `Removed …`, or null. */
  mark: string | null
  /** A baseline dish no longer on the meal: listed struck through, after the current ones. */
  removed: boolean
}

/** `(index, order among the list's dishes with that index)`: indices repeat when two dishes share a region. */
function keyed(dishes: readonly DishValue[]): Map<string, DishValue> {
  const seen = new Map<number, number>()
  const out = new Map<string, DishValue>()
  for (const d of dishes) {
    const k = seen.get(d.index) ?? 0
    seen.set(d.index, k + 1)
    out.set(`${d.index}:${k}`, d)
  }
  return out
}

const byWhom = (a: MealAmendment) => `${hhmm(a.at)} by ${a.by ? shortName(a.by.name) : 'unknown'}`
const differs = (a: DishValue | undefined, b: DishValue | undefined) => !a || !b || a.name !== b.name || a.portion !== b.portion

/**
 * The meal's dishes in order, then the removed ones. The baseline is the dish list before the first amendment; a current
 * dish pairs with the baseline dish of the same key. No amendment: no marks.
 */
export function dishRows(m: Pick<Meal, 'dishes' | 'amendments'>): DishRow[] {
  const line = (d: DishValue) => `${d.name} · ${PORTION_LABEL[d.portion]}`
  const current = keyed(m.dishes)
  const first = m.amendments[0]
  if (!first) return [...current].map(([key, d]) => ({ key, text: line(d), kind: DISH_LABEL[d.dish_kind], mark: null, removed: false }))
  const base = keyed(first.before.dishes)
  const steps = m.amendments.map((a) => ({ a, before: keyed(a.before.dishes), after: keyed(a.after.dishes) }))
  const rows: DishRow[] = [...current].map(([key, d]) => {
    const was = base.get(key)
    let mark: string | null = null
    if (!was) {
      const added = steps.find((s) => s.after.has(key))
      mark = `Added ${added ? byWhom(added.a) : ''}`.trim()
    } else if (differs(was, d)) {
      const latest = steps.findLast((s) => differs(s.before.get(key), s.after.get(key)))
      const old = [...(was.name !== d.name ? [was.name] : []), ...(was.portion !== d.portion ? [PORTION_LABEL[was.portion]] : [])]
      mark = `Amended ${latest ? byWhom(latest.a) : ''} · was ${old.join(' · ')}`
    }
    return { key, text: line(d), kind: DISH_LABEL[d.dish_kind], mark, removed: false }
  })
  for (const [key, d] of base) {
    if (current.has(key)) continue
    const gone = steps.find((s) => s.before.has(key) && !s.after.has(key))
    rows.push({
      key: `removed:${key}`,
      text: line(d),
      kind: DISH_LABEL[d.dish_kind],
      mark: `Removed ${gone ? byWhom(gone.a) : ''}`.trim(),
      removed: true,
    })
  }
  return rows
}

/** The kept tray photo's media id, for "Show tray"; null for a meal by hand or a voided meal (its photo deleted). */
export const trayMediaId = (m: Pick<Meal, 'media'>) => (m.media?.kind === 'photo' ? m.media.id : null)

/** The overlay over that photo: the read's regions, labelled by the saved dishes. */
export const dishTray = (m: Pick<Meal, 'evidence' | 'dishes'>): TrayView | null =>
  m.evidence ? { segmentation: m.evidence.segmentation, dishes: m.dishes, fluids: m.evidence.reading.fluids } : null

/** Each tray photo is fetched once (`GET /api/media/<id>`), however often "Show tray" is hidden and shown. */
export function trayPhotos(api: Pick<Api, 'media'>) {
  const cache = new Map<number, Promise<Blob>>()
  return {
    get(mediaId: number): Promise<Blob> {
      let p = cache.get(mediaId)
      if (!p) {
        p = api.media(mediaId)
        // A failed fetch may be tried again by the next tap.
        p.catch(() => cache.delete(mediaId))
        cache.set(mediaId, p)
      }
      return p
    },
  }
}
