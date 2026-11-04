/** One bed's encodings for the ward board row and tile (DESIGN.md 5.9; web/ward "Bed tile encodings"). Pure. */
import type { AcuityLevel, AdmissionSummary, BagLevel } from '@meniscus/shared'
import { careBadges } from './care.ts'
import { percent, signedMl } from './format.ts'
import { ACUITY_LABEL, ALERT_LABEL, ALERT_TONE, BAG_NAME, bedTone, STATUS_LABEL } from './labels.ts'
import { groupLevel, overloadTone } from './ward.ts'

/** A bag reading due within this many minutes reads `Due`. */
export const BAG_DUE_MIN = 30
export const URINE_NOT_MEASURED = 'Urine not measured'

export interface TileBag {
  container: BagLevel['container']
  name: string
  /** 0..1 of capacity, or null without a capacity. */
  fill: number | null
  percent: string | null
  level: string
  due: 'Due' | 'Overdue' | null
}

export interface BedTile {
  id: number
  bed: string
  ward: string
  patient: string
  tone: ReturnType<typeof bedTone>
  status: string
  acuity: { level: AcuityLevel; label: string; suggested: string | null }
  balance: { text: string; tone: 'warn' | 'neutral'; note: string | null; inOut: string }
  bags: TileBag[]
  pending: string | null
  /** The worst prompt, then `+<n>`. */
  prompt: { label: string; more: number } | null
  /** Up to 2 care badges, then `+<n>`. */
  care: { badges: string[]; more: number }
  referral: string | null
  href: string
  peekLabel: string
}

export function tileBags(a: Pick<AdmissionSummary, 'bag_levels' | 'alerts'>, now: number): TileBag[] {
  const overdueAlert = a.alerts.some((x) => x.kind === 'bag_reading_overdue')
  return (a.bag_levels ?? []).map((b) => {
    const fill = b.capacity_ml ? Math.min(1, b.level_ml / b.capacity_ml) : null
    const dueAt = b.due_at ? Date.parse(b.due_at) : null
    const due =
      dueAt !== null && (dueAt <= now || (b.container === 'urine_bag' && overdueAlert))
        ? 'Overdue'
        : dueAt !== null && dueAt - now <= BAG_DUE_MIN * 60_000
          ? 'Due'
          : null
    return {
      container: b.container,
      name: b.container in BAG_NAME ? BAG_NAME[b.container as keyof typeof BAG_NAME] : b.container,
      fill,
      percent: fill === null ? null : percent(fill),
      level: b.capacity_ml ? `${b.level_ml}/${b.capacity_ml} mL` : `${b.level_ml} mL`,
      due,
    }
  })
}

const TONE_ORDER = { danger: 0, warn: 1, info: 2 } as const

export function bedTile(a: AdmissionSummary, now: number): BedTile {
  const tone = bedTone(a.alerts, a.pending)
  const level = groupLevel(a)
  const worst = a.alerts.toSorted((x, y) => TONE_ORDER[ALERT_TONE[x.kind]] - TONE_ORDER[ALERT_TONE[y.kind]])[0]
  const badges = careBadges(a.care, now)
  const measured = a.devices.urine_measured
  const ref = a.nutrition.referral
  return {
    id: a.id,
    bed: a.bed,
    ward: a.ward_code,
    patient: a.patient,
    tone,
    status: STATUS_LABEL[tone],
    acuity: {
      level,
      label: ACUITY_LABEL[level],
      suggested: a.acuity.suggested ? `Suggested ${ACUITY_LABEL[a.acuity.suggested]} · Review` : null,
    },
    balance: {
      text: signedMl(a.totals.balance_ml),
      tone: overloadTone(a.totals.balance_ml, a.devices),
      note: measured ? null : URINE_NOT_MEASURED,
      inOut: `${a.totals.in_ml} in · ${a.totals.out_ml} out`,
    },
    bags: tileBags(a, now),
    pending: a.pending ? `◷ ${a.pending}` : null,
    prompt: worst ? { label: ALERT_LABEL[worst.kind], more: a.alerts.length - 1 } : null,
    care: { badges: badges.slice(0, 2), more: Math.max(0, badges.length - 2) },
    referral: ref && ref.status !== 'closed' ? 'Referred to dietitian' : null,
    href: `/n/${a.id}`,
    peekLabel: `About bed ${a.bed}`,
  }
}
