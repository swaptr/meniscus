/**
 * Next up (DESIGN.md 5.23; web/ward "Next up on the ward dashboard", "Next up on the nurse home", web/dietitian
 * "Next up on the worklist"): what to do next, ranked, from the route's own load. Pure; sends nothing.
 *
 * Groups, in rank order: (1) overdue bag readings and red prompts; (2) amber prompts and bags due within 30 min or
 * past; (3) intake target checks due within 60 min and behind; (4) pending entries, one per bed, most first; (5) blue
 * prompts. One item per bed and action, in its highest group. Ties: due time (undated last), acuity, bed.
 */
import {
  ACUITY_LEVELS,
  ALERT_TONE,
  type AdmissionSummary,
  type AlertKind,
  type NutritionWorklist,
  type WardSummary,
} from '@meniscus/shared'
import { ago, clock, plural } from './format.ts'
import { ALERT_LABEL } from './labels.ts'
import { REFERRAL_REASON_LABEL } from './nutrition.ts'

export const NEXT_UP_WIDE = 5
export const NEXT_UP_PHONE = 3
/** A bag reading due within this many minutes is "due soon". */
export const BAG_DUE_SOON_MIN = 30
/** An intake target check within this many minutes is listed. */
export const TARGET_CHECK_MIN = 60

export const NOTHING_DUE = 'Nothing due. 0 waiting for approval.'

export type NextGroup = 1 | 2 | 3 | 4 | 5
export type NextChip = 'Overdue' | 'Review now' | 'Review' | 'Due' | 'Check' | `◷ ${number}`

export interface NextItem {
  group: NextGroup
  admissionId: number
  bed: string
  ward: string
  patient: string
  action: string
  chip: NextChip
  /** Tone of the chip: danger, warn, info or pending. */
  tone: 'danger' | 'warn' | 'info' | 'pending'
  when: string | null
  href: string
  /** Sort key: ms, or null (undated, last in its group). */
  dueAt: number | null
}

export interface NextUp {
  items: NextItem[]
  /** `2 more next up`, or null. */
  more: string | null
  /** Counts by action: `2 bag readings · 1 review now · 3 to approve`; empty when nothing is due. */
  head: string
  /** `Nothing due. 0 waiting for approval.` when there is nothing. */
  empty: string | null
}

const BAG_KINDS: readonly AlertKind[] = ['bag_reading_due', 'bag_reading_overdue']
const bedNo = (a: AdmissionSummary) => Number.parseInt(a.bed, 10) || 0
const urineDue = (a: AdmissionSummary) => {
  const b = a.bag_levels?.find((l) => l.container === 'urine_bag' && l.due_at !== null)
  return b ? { at: Date.parse(b.due_at!), read: Date.parse(b.read_at) } : null
}
const inMin = (ms: number) => Math.max(1, Math.round(ms / 60_000))

function bagWhen(due: { at: number; read: number } | null, now: number): string | null {
  if (!due) return null
  if (due.at <= now) return `last ${clock(due.read)} · ${ago(due.read, now)}`
  return `due ${clock(due.at)} · in ${inMin(due.at - now)} min`
}

/** Every candidate item of one bed, before dedupe. */
function candidates(a: AdmissionSummary, now: number): NextItem[] {
  const base = { admissionId: a.id, bed: a.bed, ward: a.ward_code, patient: a.patient, href: `/n/${a.id}` }
  const due = urineDue(a)
  const out: NextItem[] = []
  for (const al of a.alerts) {
    const tone = ALERT_TONE[al.kind]
    const bag = BAG_KINDS.includes(al.kind)
    const action = bag ? 'Bag reading' : ALERT_LABEL[al.kind]
    const dueAt = bag && due ? due.at : null
    const when = bag ? bagWhen(due, now) : null
    if (al.kind === 'bag_reading_overdue' || tone === 'danger')
      out.push({ ...base, group: 1, action, chip: bag ? 'Overdue' : 'Review now', tone: 'danger', when, dueAt })
    else if (tone === 'warn') out.push({ ...base, group: 2, action, chip: bag ? 'Due' : 'Review', tone: 'warn', when, dueAt })
    else out.push({ ...base, group: 5, action, chip: 'Check', tone: 'info', when, dueAt })
  }
  if (due && due.at - now <= BAG_DUE_SOON_MIN * 60_000)
    out.push({
      ...base,
      group: 2,
      action: 'Bag reading',
      chip: due.at <= now ? 'Overdue' : 'Due',
      tone: 'warn',
      when: bagWhen(due, now),
      dueAt: due.at,
    })
  const t = a.care.intake_target
  const check = t?.next_check
  if (t && check) {
    const at = Date.parse(check.at)
    if (at - now <= TARGET_CHECK_MIN * 60_000 && t.ml < check.ml)
      out.push({
        ...base,
        group: 3,
        action: 'Intake check',
        chip: 'Due',
        tone: 'warn',
        when: `${t.ml}/${check.ml} mL by ${clock(at)}`,
        dueAt: at,
      })
  }
  if (a.pending > 0)
    out.push({
      ...base,
      group: 4,
      action: `Approve ${plural(a.pending, 'entry', 'entries')}`,
      chip: `◷ ${a.pending}`,
      tone: 'pending',
      when: null,
      dueAt: null,
      href: `/n/${a.id}#waiting`,
    })
  return out
}

export function nextUp(beds: readonly AdmissionSummary[], now: number, { wide }: { wide: boolean }): NextUp {
  const byId = new Map(beds.map((b) => [b.id, b]))
  const seen = new Set<string>()
  const all = beds
    .flatMap((b) => candidates(b, now))
    .sort((x, y) => x.group - y.group)
    .filter((i) => {
      const k = `${i.admissionId}:${i.action.startsWith('Approve') ? 'approve' : i.action}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  const pendingOf = (i: NextItem) => byId.get(i.admissionId)?.pending ?? 0
  const acuity = (i: NextItem) => ACUITY_LEVELS.indexOf(byId.get(i.admissionId)?.acuity.level ?? 'stable')
  const bed = (i: NextItem) => bedNo(byId.get(i.admissionId)!)
  all.sort(
    (x, y) =>
      x.group - y.group ||
      (x.group === 4 ? pendingOf(y) - pendingOf(x) : 0) ||
      (x.dueAt ?? Infinity) - (y.dueAt ?? Infinity) ||
      acuity(x) - acuity(y) ||
      bed(x) - bed(y),
  )
  const max = wide ? NEXT_UP_WIDE : NEXT_UP_PHONE
  const items = all.slice(0, max)
  const hidden = all.length - items.length
  const bags = all.filter((i) => i.action === 'Bag reading').length
  const now1 = all.filter((i) => i.group === 1 && i.action !== 'Bag reading').length
  const review = all.filter((i) => i.group === 2 && i.action !== 'Bag reading').length
  const checks = all.filter((i) => i.group === 3 || i.group === 5).length
  const toApprove = beds.reduce((n, b) => n + b.pending, 0)
  const head = [
    bags && plural(bags, 'bag reading', 'bag readings'),
    now1 && `${now1} review now`,
    review && `${review} review`,
    checks && plural(checks, 'check', 'checks'),
    toApprove && `${toApprove} to approve`,
  ]
    .filter(Boolean)
    .join(' · ')
  return { items, more: hidden > 0 ? `${hidden} more next up` : null, head, empty: all.length ? null : NOTHING_DUE }
}

export interface WardNext {
  wardId: number
  label: string
  href: string
  tone: 'danger' | 'warn' | 'info' | 'pending'
}

const TONE_RANK = { danger: 0, warn: 1, info: 2 } as const

/** `/n`: wards with beds to review first, then by pending; each `<code> · <n> to review · <n> pending`. */
export function wardsNextUp(wards: readonly WardSummary[]): WardNext[] {
  return wards
    .filter((w) => w.beds_with_alerts > 0 || w.pending > 0)
    .toSorted(
      (a, b) =>
        Number(b.beds_with_alerts > 0) - Number(a.beds_with_alerts > 0) ||
        (a.worst_tone ? TONE_RANK[a.worst_tone] : 3) - (b.worst_tone ? TONE_RANK[b.worst_tone] : 3) ||
        b.pending - a.pending ||
        a.code.localeCompare(b.code),
    )
    .map((w) => ({
      wardId: w.id,
      label: `${w.code} · ${w.beds_with_alerts} to review · ${w.pending} pending`,
      href: `/n/w/${w.id}`,
      tone: w.beds_with_alerts > 0 ? (w.worst_tone ?? 'warn') : 'pending',
    }))
}

export interface ReferralNext {
  admissionId: number
  title: string
  detail: string
  href: string
}

/** `/d`: at most 3 referrals not yet acknowledged, oldest first. */
export function dietitianNextUp(w: NutritionWorklist, now: number): ReferralNext[] {
  return w.patients
    .filter((p) => p.nutrition.referral?.status === 'open')
    .toSorted((a, b) => Date.parse(a.nutrition.referral!.created_at) - Date.parse(b.nutrition.referral!.created_at))
    .slice(0, NEXT_UP_PHONE)
    .map((p) => {
      const r = p.nutrition.referral!
      return {
        admissionId: p.admission.id,
        title: `${p.admission.ward_code}-${p.admission.bed} · ${p.admission.patient}`,
        detail: `Referred ${clock(r.created_at)} · ${REFERRAL_REASON_LABEL[r.reason]} · ${ago(r.created_at, now)}`,
        href: `/d/${p.admission.id}`,
      }
    })
}
