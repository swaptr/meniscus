/**
 * The ward dashboard's layout and head figures (DESIGN.md 5.9, 7.6; web/ward "Ward board on wide screens", "Metric peeks
 * on stats"). Pure, from the beds' one load: no request.
 */
import type { AdmissionSummary, AlertTone } from '@meniscus/shared'
import { plural, signedMl } from './format.ts'
import { ALERT_TONE } from './labels.ts'
import { worstOf } from './snapshot.ts'

/** From this width the beds are a board of aligned rows; narrower, tiles. */
export const BOARD_MIN = 1100
export const BOARD_QUERY = `(min-width: ${BOARD_MIN}px)`

export const BOARD_HEADERS = ['Bed', 'Acuity', 'Status', 'Last 24 h', 'Balance', 'Bags', 'Pending', 'Care'] as const

export const bedLayout = (width: number): 'board' | 'tiles' => (width >= BOARD_MIN ? 'board' : 'tiles')

/** Columns of the tile grid at a viewport width: one per row up to 640 px, then two. */
export const tileColumns = (width: number): number => (width <= 640 ? 1 : 2)

/** A bed's worst open prompt tone, or null (the snapshot's and the stat chips' tone). */
export const bedPromptTone = (a: Pick<AdmissionSummary, 'alerts'>): AlertTone | null => worstOf(a.alerts.map((x) => ALERT_TONE[x.kind]))

export interface StatLine {
  label: string
  href: string
}

export interface WardStat {
  id: 'danger' | 'warn' | 'pending' | 'balance'
  tone: 'danger' | 'warn' | 'pending' | 'neutral'
  /** The chip's words (`Review now`, `8 pending`). */
  label: string
  /** The figure beside it. */
  value: string
  unit: string
  /** The peek's title and its lines, one per bed behind the figure. */
  title: string
  lines: StatLine[]
}

const bedHref = (a: AdmissionSummary) => `/n/${a.id}`
const name = (a: AdmissionSummary) => `Bed ${a.bed} · ${a.patient}`

/**
 * The ward head's stat chips: beds whose worst prompt is red, then amber, the pending entries, and the ward's 24 h
 * balance. Each lists the beds behind it, each linking to the bed. Chips with nothing behind them are left out, except
 * the balance.
 */
export function wardStats(beds: readonly AdmissionSummary[]): WardStat[] {
  const out: WardStat[] = []
  for (const tone of ['danger', 'warn'] as const) {
    const these = beds.filter((a) => bedPromptTone(a) === tone)
    if (!these.length) continue
    out.push({
      id: tone,
      tone,
      label: tone === 'danger' ? 'Review now' : 'Review',
      value: String(these.length),
      unit: '',
      title: `${tone === 'danger' ? 'Review now' : 'Review'}: ${plural(these.length, 'bed', 'beds')}`,
      lines: these.map((a) => ({ label: `${name(a)} · ${plural(a.alerts.length, 'prompt', 'prompts')}`, href: bedHref(a) })),
    })
  }
  const pending = beds.reduce((n, a) => n + a.pending, 0)
  if (pending > 0) {
    const these = beds.filter((a) => a.pending > 0).toSorted((x, y) => y.pending - x.pending)
    out.push({
      id: 'pending',
      tone: 'pending',
      label: `${pending} pending`,
      value: String(these.length),
      unit: these.length === 1 ? 'bed' : 'beds',
      title: `${pending} waiting for approval`,
      lines: these.map((a) => ({ label: `${name(a)} · ${a.pending} pending`, href: bedHref(a) })),
    })
  }
  const balance = beds.reduce((n, a) => n + a.totals.balance_ml, 0)
  out.push({
    id: 'balance',
    tone: 'neutral',
    label: 'Ward balance',
    value: signedMl(balance).replace(/ mL$/, ''),
    unit: 'mL',
    title: `Ward balance, last 24 hours: ${signedMl(balance)}`,
    lines: beds
      .toSorted((x, y) => Math.abs(y.totals.balance_ml) - Math.abs(x.totals.balance_ml))
      .map((a) => ({ label: `${name(a)} · ${signedMl(a.totals.balance_ml)}`, href: bedHref(a) })),
  })
  return out
}
