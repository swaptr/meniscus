/**
 * The one place times, dates, volumes, rates and confidence are written (DESIGN.md §3.1).
 * Pure; never ICU (`toLocale*`), so the device locale cannot change the output.
 */

export const LOW_CONFIDENCE = 0.75

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

type When = number | string | Date
const at = (t: When): Date => (t instanceof Date ? t : new Date(t))
const two = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** `14:05`: 24-hour clock in local time. */
export function clock(t: When): string {
  const d = at(t)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** `3 Nov`. */
export function dayMonth(t: When): string {
  const d = at(t)
  return `${d.getDate()} ${MONTHS[d.getMonth()]!}`
}

/** `14:05` today, else `3 Nov 14:05`. */
export function dayClock(t: When, now: When): string {
  const d = at(t)
  return sameDay(d, at(now)) ? clock(d) : `${dayMonth(d)} ${clock(d)}`
}

/** `2026-11-03`: a local date for a native date input or a day key. */
export function isoDate(t: When): string {
  const d = at(t)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** `Tue 3 Nov 14:05`. */
export function dayLabelClock(t: When): string {
  return `${dayLabel(t)} ${clock(t)}`
}

/** `Tue 3 Nov`. */
export function dayLabel(t: When): string {
  const d = at(t)
  return `${DAYS[d.getDay()]!} ${dayMonth(d)}`
}

/** `14:00–15:00` for the hour starting at `start` (rounded down to the hour). */
export function hourRange(start: When): string {
  const h = at(start).getHours()
  return `${two(h)}:00–${two((h + 1) % 24)}:00`
}

/** `1200 mL`: integer, no grouping, normal space. */
export function ml(n: number): string {
  return `${Math.round(n)} mL`
}

/** `+120 mL`, `−80 mL` (U+2212), `0 mL`. */
export function signedMl(n: number): string {
  const r = Math.round(n)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} mL`
}

/** `1.5` (litres, at most one decimal, no trailing `.0`). */
export function litres(mlValue: number): string {
  return String(Math.round(mlValue / 100) / 10)
}

/** `82%` from a 0..1 share. */
export function percent(x: number): string {
  return `${Math.round(x * 100)}%`
}

/** `76% · 20/26`, or `— · 3/4` when the share is withheld. `pct` is 0..100. */
export function rate(r: { n: number; of: number; pct: number | null }): string {
  return `${r.pct === null ? '—' : `${Math.round(r.pct)}%`} · ${r.n}/${r.of}`
}

/** `just now`, `12 min ago`, `3 h ago`, else the day and time. */
export function ago(t: When, now: When): string {
  const min = Math.floor((at(now).getTime() - at(t).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  return dayClock(t, now)
}

/** `0:42`, `12:05` (minutes:seconds). */
export function duration(msValue: number): string {
  const s = Math.max(0, Math.round(msValue / 1000))
  return `${Math.floor(s / 60)}:${two(s % 60)}`
}

/** `1 entry`, `3 entries`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export const confidenceLow = (c: number): boolean => c < LOW_CONFIDENCE

/** `{ text: 'Photo · 82%', tone }`, warn below 75%. */
export function confidenceChip(source: string, c: number): { text: string; tone: 'warn' | 'neutral' } {
  return { text: `${source} · ${percent(c)}`, tone: confidenceLow(c) ? 'warn' : 'neutral' }
}
