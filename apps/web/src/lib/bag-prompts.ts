/**
 * Bag prompts on the bed review and the check screen: a bag without its device, the order a prompt asks for, and the
 * falls a missed emptying can explain. DOM-free and request-free; kept apart from lib/bags.ts so the bed review's
 * first paint does not carry the save plans (DESIGN.md 10).
 */
import {
  BAG_CONTAINERS,
  BAG_ORDER,
  type Alert,
  type BagChart,
  type BagContainer,
  type BagReading,
  type OutputDevices,
  type StaffRef,
} from '@meniscus/shared'
import { BAG_NAME } from './labels.ts'
import { canDecide } from './staff.ts'

const DAY_MS = 24 * 3_600_000
const t = (r: Pick<BagReading, 'created_at'>) => Date.parse(r.created_at)
const byTime = (a: BagReading, b: BagReading) => t(a) - t(b) || a.id - b.id

/** The order a bag needs, as the warnings name it: `No catheter`, `No stoma`, `No drain`. */
const DEVICE_WORD: Record<(typeof BAG_ORDER)[BagContainer], string> = { catheter: 'catheter', stoma: 'stoma', drain: 'drain' }
export interface BagMismatch {
  /** The care kind that would put this bag on record ("Add catheter"). */
  kind: (typeof BAG_ORDER)[BagContainer]
  /** The check screen's line (web/capture "Bag photo on a bed without that bag"). */
  check: string
  /** The round's line (web/ward-round "Bag readings on beds without the bag"). */
  round: string
  /** The offer after saving, for a nurse or matron. */
  add: string
}
/** A bag reading of a bag not in `devices.bags`; null when the bag is on record. Nothing is refused. */
export function bagMismatch(container: BagContainer, devices: Pick<OutputDevices, 'bags'>): BagMismatch | null {
  if (devices.bags.includes(container)) return null
  const kind = BAG_ORDER[container]
  const word = DEVICE_WORD[kind]
  return {
    kind,
    check: `No ${word} on the care plan for this bed. Saving charts it and asks the nurse to review.`,
    round: `No ${word} on the care plan: saving asks the nurse to review.`,
    add: `Add ${word}`,
  }
}

/**
 * The order a `bag_without_device` prompt asks for ("Add catheter", "Add stoma", "Add drain"), from the bag its message
 * names first (`Urine bag reading at 10:30, …`); null for any other prompt.
 */
export function promptDevice(alert: Alert): Pick<BagMismatch, 'kind' | 'add'> | null {
  if (alert.kind !== 'bag_without_device') return null
  const bag = BAG_CONTAINERS.find((b) => alert.message.startsWith(`${BAG_NAME[b]} reading`))
  if (!bag) return null
  const kind = BAG_ORDER[bag]
  return { kind, add: `Add ${DEVICE_WORD[kind]}` }
}

/** One bag's readings in `bags`, oldest first. */
export const readingsOf = (bags: BagChart, container: BagContainer): BagReading[] =>
  bags.periods
    .filter((p) => p.container === container)
    .flatMap((p) => p.readings)
    .sort(byTime)

/** A fall prompt and the reading it is about. */
export interface Fall {
  alert: Alert
  reading: BagReading
  /** The reading it fell from, when the chart read lists it (it does when that is within 24 h). */
  prev_at: string | null
}

/**
 * Each `bag_level_fell` prompt, in order, with its reading: by the entry it lists, else (a fall to 0, which charts
 * nothing) the next fall without an entry in the last 24 h.
 */
export function fallsOf(bags: BagChart, alerts: readonly Alert[], now: number): Fall[] {
  const all = BAG_CONTAINERS.flatMap((c) => readingsOf(bags, c).map((r, i, rs) => ({ reading: r, prev_at: rs[i - 1]?.created_at ?? null })))
  const falls = all.filter((f) => f.reading.fell)
  const used = new Set<number>()
  const out: Fall[] = []
  for (const alert of alerts) {
    if (alert.kind !== 'bag_level_fell') continue
    const id = alert.entry_ids[0]
    const hit =
      id === undefined
        ? falls.find((f) => !used.has(f.reading.id) && !f.reading.entry && now - t(f.reading) < DAY_MS)
        : falls.find((f) => f.reading.entry?.id === id)
    if (!hit) continue
    used.add(hit.reading.id)
    out.push({ alert, ...hit })
  }
  return out
}

export const offersMissedEmptying = (staff: Pick<StaffRef, 'role'> | null) => canDecide(staff)
