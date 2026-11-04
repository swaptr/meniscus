/** The bed peek's lines (web/ward "Bed peek on the ward dashboard"), from the ward's one load. Pure; no request. */
import type { AdmissionSummary, AlertKind } from '@meniscus/shared'
import { careBadges } from './care.ts'
import { clock, plural, signedMl } from './format.ts'
import { ALERT_LABEL, ALERT_TONE } from './labels.ts'
import { tileBags, URINE_NOT_MEASURED } from './bed-tile.ts'

/** Prompt names in the peek's sentence form, where the chip's short label would read oddly. */
const PROMPT_NAME: Partial<Record<AlertKind, string>> = { low_urine_output: 'Low urine output' }

export interface BedPeek {
  title: string
  prompts: string[]
  balance: string
  bags: string[]
  care: string[]
  pending: string | null
  links: { label: string; href: string }[]
}

export function bedPeek(a: AdmissionSummary, now: number): BedPeek {
  const t = a.totals
  const limit = a.care.fluid_limit
  const balance = [
    `In ${t.in_ml} mL`,
    `Out ${t.out_ml} mL`,
    `Balance ${signedMl(t.balance_ml)}`,
    ...(limit ? [`Limit ${limit.of_ml} mL · ${limit.percent}%`] : []),
    ...(a.devices.urine_measured ? [] : [URINE_NOT_MEASURED]),
  ].join(' · ')
  const levels = a.bag_levels ?? []
  const bags = tileBags(a, now).map((b, i) => {
    const due = levels[i]?.due_at
    return `${b.name} ${b.level}${due ? ` · due ${clock(due)}` : ''}`
  })
  const care = careBadges(a.care, now)
  return {
    title: `Bed ${a.bed} · ${a.patient}`,
    prompts: a.alerts.map((x) => `${PROMPT_NAME[x.kind] ?? ALERT_LABEL[x.kind]}: ${ALERT_TONE[x.kind] === 'info' ? 'check' : 'review'}`),
    balance,
    bags,
    care,
    pending: a.pending ? `${a.pending} waiting for approval` : null,
    links: [
      { label: `Open bed ${a.bed}`, href: `/n/${a.id}` },
      ...(a.pending ? [{ label: plural(a.pending, 'entry waiting', 'entries waiting'), href: `/n/${a.id}#waiting` }] : []),
    ],
  }
}
