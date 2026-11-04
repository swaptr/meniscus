/** Bed history as a nursing I&O log: 12-hour shifts, newest first. DOM-free. */
import { SHIFTS, shiftStart, type Entry } from '@meniscus/shared'
import { isFlagged } from './flags.ts'
import { dayLabel } from './format.ts'

export interface Shift {
  /** Local start of the shift (epoch ms). */
  start: number
  /** The shift's name from `SHIFTS`, e.g. "day" or "night". */
  name: string
  in_ml: number
  out_ml: number
  pending: number
  /** Newest first. */
  entries: Entry[]
}

/** Groups entries into shifts, newest shift first. Totals count approved entries; `pending` counts pending ones. */
export function byShift(entries: Entry[]): Shift[] {
  const shifts = new Map<number, Shift>()
  for (const e of entries.toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const { start, name } = shiftStart(Date.parse(e.created_at))
    const sh = shifts.get(start) ?? { start, name, in_ml: 0, out_ml: 0, pending: 0, entries: [] }
    if (e.status === 'approved') {
      if (e.direction === 'in') sh.in_ml += e.volume_ml
      else sh.out_ml += e.volume_ml
    } else if (e.status === 'pending') sh.pending++
    sh.entries.push(e)
    shifts.set(start, sh)
  }
  return [...shifts.values()].sort((a, b) => b.start - a.start)
}

/** "Mon 2 Nov · Day 08:00–20:00": the shift's name and its hours from `SHIFTS`. */
export function shiftLabel(sh: Pick<Shift, 'start' | 'name'>): string {
  const day = dayLabel(sh.start)
  const i = SHIFTS.findIndex((x) => x.name === sh.name)
  const hours = i < 0 ? '' : ` ${SHIFTS[i]!.start}–${SHIFTS[(i + 1) % SHIFTS.length]!.start}`
  return `${day} · ${sh.name.charAt(0).toUpperCase()}${sh.name.slice(1)}${hours}`
}

export type Period = 'shift' | '24h' | 'all'
export interface LogFilter {
  direction?: Entry['direction']
  category?: Entry['category']
  status?: Entry['status']
  source?: Entry['source']
  period?: Period
  text?: string
  /** Corrected, amended, late or rejected entries only. */
  flagged?: boolean
}
export type SortKey = 'time' | 'type' | 'volume' | 'source' | 'status'
export interface LogSort {
  key: SortKey
  desc: boolean
}
export const PAGE_SIZE = 25

const STATUS_RANK: Record<Entry['status'], number> = { pending: 0, approved: 1, rejected: 2 }

/** Pure: entries matching every set filter. `now` decides the period windows. */
export function filterLog(entries: Entry[], f: LogFilter, now: number): Entry[] {
  const q = f.text?.trim().toLowerCase()
  const since = f.period === 'shift' ? shiftStart(now).start : f.period === '24h' ? now - 24 * 3_600_000 : -Infinity
  return entries.filter(
    (e) =>
      (!f.direction || e.direction === f.direction) &&
      (!f.category || e.category === f.category) &&
      (!f.status || e.status === f.status) &&
      (!f.source || e.source === f.source) &&
      (!f.flagged || isFlagged(e)) &&
      Date.parse(e.created_at) >= since &&
      (!q || `${e.item ?? ''} ${e.notes ?? ''}`.toLowerCase().includes(q)),
  )
}

/** Pure: sorted copy; ties fall back to newest first. Status ascending puts pending first. */
export function sortLog(entries: Entry[], sort: LogSort): Entry[] {
  const t = (e: Entry) => Date.parse(e.created_at)
  const dir = sort.desc ? -1 : 1
  const by = (a: Entry, b: Entry): number => {
    switch (sort.key) {
      case 'time':
        return t(a) - t(b) || a.id - b.id
      case 'volume':
        return a.volume_ml - b.volume_ml
      case 'type':
        return `${a.direction}:${a.category}`.localeCompare(`${b.direction}:${b.category}`)
      case 'source':
        return a.source.localeCompare(b.source)
      case 'status':
        return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    }
  }
  return entries.toSorted((a, b) => dir * by(a, b) || t(b) - t(a) || b.id - a.id)
}

export interface ShiftGroup {
  /** Totals cover every matching entry in the shift, not just this page. */
  shift: Shift
  rows: Entry[]
}

/**
 * The log as rendered: one page of matching rows, in shift groups when sorted by time.
 * `page` is zero-based and clamped to the last page.
 */
export function logView(entries: Entry[], f: LogFilter, sort: LogSort, now: number, page = 0) {
  const matched = sortLog(filterLog(entries, f, now), sort)
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const index = Math.min(Math.max(0, page), pages - 1)
  const rows = matched.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)
  const from = rows.length ? index * PAGE_SIZE + 1 : 0
  let groups: ShiftGroup[] | null = null
  if (sort.key === 'time') {
    const shifts = new Map(byShift(matched).map((sh) => [sh.start, sh]))
    groups = []
    for (const e of rows) {
      const start = shiftStart(Date.parse(e.created_at)).start
      const last = groups.at(-1)
      if (last?.shift.start === start) last.rows.push(e)
      else groups.push({ shift: shifts.get(start)!, rows: [e] })
    }
  }
  return {
    count: `${matched.length} of ${entries.length}`,
    rows,
    groups,
    page: { index, pages, range: rows.length ? `${from}–${from + rows.length - 1} of ${matched.length}` : '0 of 0' },
  }
}
