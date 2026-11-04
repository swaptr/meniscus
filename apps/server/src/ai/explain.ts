/** Alert explanation for the nurse: one Spark request, plain text, review framing. */
import type { Admission, Alert, Entry, Totals } from '@meniscus/shared'

export const EXPLAIN_SYSTEM = `You support ward nurses reviewing a patient's fluid intake/output chart.
Explain the listed rule-based alerts in plain language in at most 4 short sentences.
Say which recorded numbers triggered each alert and what the nurse could check (measurement errors, unlogged intake, timing).
Never diagnose, never recommend medication or orders. Use the word "review". Do not invent values that are not given.`

/** De-identified context: bed, weight, totals, alerts and entry volumes/times. Never the patient's name. */
export function explainContext(a: Admission, totals: Totals, alerts: Alert[], recent: Entry[], now: number): string {
  const hoursAgo = (iso: string) => ((now - Date.parse(iso)) / 3_600_000).toFixed(1)
  const lines = recent
    .filter((e) => e.status !== 'rejected')
    .map(
      (e) =>
        `- ${hoursAgo(e.created_at)} h ago: ${e.direction} ${e.category} ${e.volume_ml} mL (${e.status})${e.notes ? `, note: ${e.notes}` : ''}`,
    )
  return [
    `Bed ${a.bed}${a.weight_kg ? `, weight ${a.weight_kg} kg` : ''}.`,
    `Last 24 h approved: in ${totals.in_ml} mL, out ${totals.out_ml} mL, balance ${totals.balance_ml} mL; pending ${totals.pending_ml} mL.`,
    'Alerts:',
    ...alerts.map((x) => `- ${x.kind}: ${x.message}`),
    'Entries (last 24 h):',
    ...(lines.length ? lines : ['- none']),
  ].join('\n')
}
