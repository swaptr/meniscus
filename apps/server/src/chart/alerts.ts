/**
 * Rule-based alerts (PLAN §4). Pure: admission + entries + clock → alerts.
 * Volume rules count approved entries only; every message asks for review, never diagnoses.
 */
import {
  ALERT_RULES as R,
  urineInWindow,
  type Admission,
  type Alert,
  type Entry,
  type UrineColour,
  type UrineWindow,
} from '@meniscus/shared'
import { when } from './time.ts'

const HOUR = 3_600_000
/** Words that ask for review on their own. Cloudy alone does not (not a sign of infection in older adults). */
const APPEARANCE = /\b(blood|bloody|pink|red|brown|clots?)\b/gi
const DARK = /\bdark\b/i
/** Colour names that ask for review on their own; `dark` only alongside low output. */
const REVIEW_COLOURS: ReadonlySet<UrineColour> = new Set(['pink', 'red', 'brown'])

const sum = (entries: Entry[]) => entries.reduce((s, e) => s + e.volume_ml, 0)

/**
 * `nilByMouth`: the bed has an active nil-by-mouth order (charting/care-plan), which holds back `logging_gap`.
 * `window`: the low-output window (`urineWindow`), default `(now − 6 h, now]`. Its sum reads every approved urine entry
 * passed in, which may reach back before the 24 h the other rules use.
 * `urineMeasured`: false while urine is not measured (charting/alerts "Urine not measured"), which holds back
 * `low_urine_output` (so `mismatch` and `intake_incomplete`) and `overload`.
 */
export function alertsFor(
  admission: Admission,
  entries: Entry[],
  now: number,
  { nilByMouth = false, window, urineMeasured = true }: { nilByMouth?: boolean; window?: UrineWindow; urineMeasured?: boolean } = {},
): Alert[] {
  const win = window ?? { from: now - R.lowOutputWindowH * HOUR, to: now, bagAt: null }
  const at = (e: Entry) => Date.parse(e.created_at)
  const admitted = Date.parse(admission.admitted_at)
  const admittedFor = now - admitted
  const within = (h: number) => entries.filter((e) => now - at(e) < h * HOUR)
  const day = within(24).filter((e) => e.status !== 'rejected')
  const approved = day.filter((e) => e.status === 'approved')
  const intake = sum(approved.filter((e) => e.direction === 'in'))
  const output = sum(approved.filter((e) => e.direction === 'out'))
  const alerts: Alert[] = []

  const w = admission.weight_kg
  if (urineMeasured && w && win.to - admitted >= R.lowOutputWindowH * HOUR) {
    const threshold = R.lowOutputMlPerKgH * w * R.lowOutputWindowH
    // Its own approved list, over everything passed in; whole mL, so the message and the comparison agree.
    const urine = urineInWindow(
      entries.filter((e) => e.category === 'urine' && e.status === 'approved'),
      win.from,
      win.to,
    )
    if (urine < threshold) {
      const span = win.bagAt === null ? `${R.lowOutputWindowH} h` : `the ${R.lowOutputWindowH} h to the ${when(win.bagAt, now)} bag reading`
      alerts.push({
        kind: 'low_urine_output',
        message: `Urine output ${urine} mL in ${span}, below ${Math.round(threshold)} mL (${R.lowOutputMlPerKgH} mL/kg/h at ${w} kg). Review.`,
      })
      alerts.push(
        intake >= R.adequateIntakeMl
          ? {
              kind: 'mismatch',
              message: `Intake ${intake} mL logged in 24 h with low output. Review output measurement and fluid status before ordering tests.`,
            }
          : {
              kind: 'intake_incomplete',
              message: `Only ${intake} mL intake logged in 24 h. Intake data may be incomplete; review before concluding dehydration.`,
            },
      )
    }
  }

  const balance = intake - output
  if (urineMeasured && balance > R.overloadBalanceMl) {
    alerts.push({ kind: 'overload', message: `24 h balance +${balance} mL (in ${intake}, out ${output}). Review fluid status.` })
  }

  // "Check jug and meals" is the wrong nudge for a fasting patient.
  if (
    !nilByMouth &&
    admittedFor >= R.loggingGapH * HOUR &&
    !within(R.loggingGapH).some((e) => e.direction === 'in' && e.status !== 'rejected')
  ) {
    alerts.push({ kind: 'logging_gap', message: `No intake logged in the last ${R.loggingGapH} h. Check jug and meals.` })
  }

  const low = alerts.some((a) => a.kind === 'low_urine_output')
  const seen = (e: Entry): string[] => {
    const text = `${e.item ?? ''} ${e.notes ?? ''}`
    const words = [...text.matchAll(APPEARANCE)].map((m) => m[1]!.toLowerCase())
    if (e.urine_colour && REVIEW_COLOURS.has(e.urine_colour)) words.push(e.urine_colour)
    if (low && (e.urine_colour === 'dark' || DARK.test(text))) words.push('dark')
    return words
  }
  const noted = day
    .filter((e) => e.direction === 'out')
    .map(seen)
    .filter((w) => w.length)
  if (noted.length) {
    const words = [...new Set(noted.flat())]
    alerts.push({
      kind: 'appearance',
      message: `${words.join(', ')} noted on ${noted.length} output entr${noted.length === 1 ? 'y' : 'ies'}. Review.`,
    })
  }

  return alerts
}
