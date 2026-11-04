/**
 * A bed's acuity on screen (charting/acuity, web/ward): the bed card's chips and the bed review's acuity row. DOM-free
 * and pure over an injected api. A suggestion is shown with "Review" and is never applied: only a nurse's or the
 * matron's tap sends one PUT (or one DELETE, back to the ward default). Nothing here calls a model.
 */
import { ACUITY_LEVELS, type AcuityLevel, type AcuityStatus } from '@meniscus/shared'
import { errorText, type Api } from './api.ts'
import { ACUITY_LABEL, ACUITY_TONE, ALERT_LABEL } from './labels.ts'

/** The suggestion's reasons, as the prompts name them: `Low output, Overload`. */
const reasonText = (status: AcuityStatus) => status.reasons.map((k) => ALERT_LABEL[k]).join(', ')

/** The bed card's chips: the level, and a separate suggestion chip naming its reasons. */
export function acuityChips(status: AcuityStatus) {
  return {
    level: { text: ACUITY_LABEL[status.level], tone: ACUITY_TONE[status.level] },
    suggestion: status.suggested ? { text: `Suggested ${status.suggested} · Review`, reasons: reasonText(status) } : null,
  }
}

/** The level choice on the bed review: a level (an order) or the ward default. */
export type AcuityChoice = AcuityLevel | 'ward'
export const ACUITY_CHOICES: readonly (readonly [AcuityChoice, string])[] = [
  ...ACUITY_LEVELS.map((l) => [l, ACUITY_LABEL[l]] as const),
  ['ward', 'Ward default'],
]

export interface AcuityView {
  /** `Stable · Ward default`, `Critical · Order`. */
  label: string
  tone: (typeof ACUITY_TONE)[AcuityLevel]
  /** `Suggested critical: Low output. Review`, or null. */
  suggestion: string | null
  /** Nurses and the matron only; null for everyone else. */
  controls: {
    /** The selected choice: the order's level, or `ward` while the ward default applies. */
    value: AcuityChoice
    /** The level Confirm sets, when there is a suggestion. */
    confirm: AcuityLevel | null
  } | null
}

export function acuityView(status: AcuityStatus, decide: boolean): AcuityView {
  return {
    label: `${ACUITY_LABEL[status.level]} · ${status.source === 'order' ? 'Order' : 'Ward default'}`,
    tone: ACUITY_TONE[status.level],
    suggestion: status.suggested ? `Suggested ${status.suggested}: ${reasonText(status)}. Review` : null,
    controls: decide ? { value: status.source === 'order' ? status.level : 'ward', confirm: status.suggested } : null,
  }
}

/** One request for a picked choice, or null when it changes nothing (the current order, or the ward default again). */
export function acuityRequest(status: AcuityStatus, choice: AcuityChoice): { op: 'set'; level: AcuityLevel } | { op: 'clear' } | null {
  if (choice === 'ward') return status.source === 'order' ? { op: 'clear' } : null
  return status.source === 'order' && status.level === choice ? null : { op: 'set', level: choice }
}

/** Sends the one request, then reloads the bed review. A failure is shown and nothing more is sent. No model request. */
export async function applyAcuity(
  api: Api,
  admissionId: number,
  change: NonNullable<ReturnType<typeof acuityRequest>>,
  reload: () => unknown,
): Promise<{ ok: boolean; text: string }> {
  try {
    if (change.op === 'set') await api.setAcuity(admissionId, change.level)
    else await api.clearAcuity(admissionId)
  } catch (err) {
    return { ok: false, text: errorText(err) }
  }
  await reload()
  return { ok: true, text: change.op === 'set' ? `Acuity set to ${ACUITY_LABEL[change.level]}.` : 'Acuity back to the ward default.' }
}
