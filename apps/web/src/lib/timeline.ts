/**
 * An entry's story in plain language, oldest first: who captured it, what each model did, what was saved,
 * the review and every amendment. Pure; the data comes from the entry, its evidence and its events.
 */
import {
  DRINK_LABEL,
  type CallTrace,
  type DrinkKind,
  type Entry,
  type EntryEvent,
  type NoteEvidence,
  type PhotoEvidence,
  type StaffRef,
} from '@meniscus/shared'
import type { Tone } from '../components/ui.tsx'
import { bagSaved, isBagEntry } from './bag-rise.ts'
import { agreement } from './evidence.ts'
import { lateText } from './flags.ts'
import { CATEGORY_LABEL, CONTAINER_LABEL, MODEL_NAME, REJECT_LABEL } from './labels.ts'
import { ROLE_LABEL } from './staff.ts'
import { URINE_LABEL } from './urine.ts'
import { clock } from './format.ts'

export type StepKind = 'capture' | 'model' | 'check' | 'save' | 'review' | 'amend' | 'wait'

export interface TimelineStep {
  kind: StepKind
  /** HH:MM, local; only on steps a person did. */
  time?: string
  text: string
  tone: Tone
  /** Secondary detail, e.g. how long a model call took. */
  detail?: string
}

export const renderLine = (s: TimelineStep) => (s.time ? `${s.time} · ${s.text}` : s.text)

export const hhmm = (iso: string) => clock(iso)
export const who = (s: StaffRef | null) => (s ? `${s.name} (${ROLE_LABEL[s.role].toLowerCase()})` : 'staff not recorded')

const CAPTURE_VERB: Record<Entry['source'], string> = {
  photo: 'Photo',
  voice: 'Voice note',
  text: 'Typed note',
  manual: 'Entered by hand',
}

const drinkName = (d: DrinkKind | null | undefined) => (d ? DRINK_LABEL[d] : 'none')
const iddsi = (level: number | null) => (level === null ? 'none' : `IDDSI ${level}`)

const LEVEL_CONTAINERS = new Set(['water_jug', 'water_bottle'])
/** Saved from two jug or bottle levels: the volume is the drop, not the reading. */
export const isLevelEntry = (e: Entry) =>
  e.evidence?.kind === 'photo' && LEVEL_CONTAINERS.has(e.evidence.reading.container) && e.direction === 'in'

const seconds = (t: CallTrace) => `${(t.ms / 1000).toFixed(1)} s`
const model = (t: CallTrace) => MODEL_NAME[t.model] ?? t.model

function photoSteps(e: Entry, ev: PhotoEvidence): TimelineStep[] {
  const r = ev.reading
  const seg = ev.segmentation
  const container = CONTAINER_LABEL[r.container]
  const out: TimelineStep[] = []
  for (const t of ev.trace) {
    const step = (text: string, tone: Tone = 'info') => out.push({ kind: 'model', text, tone, detail: seconds(t) })
    switch (t.step) {
      case 'sam:container':
        step(seg?.container ? `${model(t)} outlined the ${container}` : `${model(t)} found no container`, seg?.container ? 'info' : 'warn')
        break
      case 'sam:liquid': {
        const fill = seg?.fill_fraction ?? null
        if (!seg?.fluid) step(`${model(t)} found no liquid`, 'warn')
        else step(fill === null ? `${model(t)} found the liquid` : `${model(t)} found the liquid, ${Math.round(fill * 100)}% full`)
        break
      }
      case 'spark:read':
        if (r.volume_ml === null) step(`${model(t)} could not read a volume`, 'warn')
        else if (isLevelEntry(e)) step(`${model(t)} read the ${container} level ${r.volume_ml} mL`)
        else step(r.capacity_ml ? `${model(t)} read ${r.volume_ml} mL of ${r.capacity_ml} mL` : `${model(t)} read ${r.volume_ml} mL`)
        break
      default:
        step(`${model(t)} ran ${t.step}`)
    }
  }
  const a = agreement(r, seg)
  if (a)
    out.push({
      kind: 'check',
      text: a.agree ? 'SAM and Spark agree' : 'SAM and Spark disagree: check the photo',
      tone: a.agree ? 'ok' : 'warn',
    })
  return out
}

function noteSteps(ev: NoteEvidence): TimelineStep[] {
  const out: TimelineStep[] = []
  if (ev.kind === 'text') out.push({ kind: 'model', text: `Typed: “${ev.transcript}”`, tone: 'neutral' })
  for (const t of ev.trace) {
    const detail = seconds(t)
    if (t.step === 'asr') out.push({ kind: 'model', text: `${model(t)} heard: “${ev.transcript}”`, tone: 'info', detail })
    else if (t.step === 'spark:note')
      out.push({
        kind: 'model',
        text: ev.draft_ml === null ? `${model(t)} drafted the entry` : `${model(t)} drafted ${ev.draft_ml} mL`,
        tone: 'info',
        detail,
      })
    else out.push({ kind: 'model', text: `${model(t)} ran ${t.step}`, tone: 'info', detail })
  }
  return out
}

function savedStep(e: Entry): TimelineStep {
  if (isBagEntry(e)) return { kind: 'save', text: bagSaved(e), tone: 'neutral' }
  if (isLevelEntry(e)) return { kind: 'save', text: `Saved ${e.recorded_ml} mL, the drop since the last level`, tone: 'neutral' }
  const ev = e.evidence
  const ai = ev?.kind === 'photo' ? ev.reading.volume_ml : ev ? ev.draft_ml : null
  if (ai !== null && ai !== e.recorded_ml)
    return { kind: 'save', text: `Saved ${e.recorded_ml} mL, changed from the AI's ${ai} mL`, tone: 'warn' }
  return { kind: 'save', text: `Saved ${e.recorded_ml} mL`, tone: 'neutral' }
}

function eventStep(v: EntryEvent): TimelineStep | null {
  const time = hhmm(v.at)
  switch (v.kind) {
    case 'recorded':
      return null
    case 'approved':
      return { kind: 'review', time, text: `Approved by ${who(v.by)}`, tone: 'ok' }
    case 'corrected':
      return { kind: 'review', time, text: `Corrected ${v.from_ml} → ${v.to_ml} mL by ${who(v.by)}`, tone: 'warn' }
    case 'rejected': {
      const reason = v.reason && v.reason in REJECT_LABEL ? REJECT_LABEL[v.reason as keyof typeof REJECT_LABEL] : null
      const why = reason ? `: ${reason}${v.note ? ` (${v.note})` : ''}` : v.note ? `: ${v.note}` : ''
      return { kind: 'review', time, text: `Rejected by ${who(v.by)}${why}`, tone: 'danger' }
    }
    case 'amended': {
      const parts: string[] = []
      if (v.from_ml !== v.to_ml) parts.push(`${v.from_ml} → ${v.to_ml} mL`)
      if (v.from_category && v.to_category && v.from_category !== v.to_category)
        parts.push(`${CATEGORY_LABEL[v.from_category].toLowerCase()} → ${CATEGORY_LABEL[v.to_category].toLowerCase()}`)
      if (v.from_colour !== v.to_colour)
        parts.push(
          `colour ${v.from_colour ? URINE_LABEL[v.from_colour].toLowerCase() : 'none'} → ${v.to_colour ? URINE_LABEL[v.to_colour].toLowerCase() : 'none'}`,
        )
      if (v.from_iddsi !== v.to_iddsi) parts.push(`consistency ${iddsi(v.from_iddsi)} → ${iddsi(v.to_iddsi)}`)
      if ((v.from_drink ?? null) !== (v.to_drink ?? null)) parts.push(`drink ${drinkName(v.from_drink)} → ${drinkName(v.to_drink)}`)
      return { kind: 'amend', time, text: `Amended ${parts.join(', ')} by ${who(v.by)}${v.reason ? `: ${v.reason}` : ''}`, tone: 'warn' }
    }
  }
}

export function timeline(e: Entry, events: readonly EntryEvent[]): TimelineStep[] {
  const late = e.late ? `, charted for ${hhmm(e.created_at)} (${lateText(e)} late)` : ''
  const steps: TimelineStep[] = [
    {
      kind: 'capture',
      time: hhmm(e.recorded_at),
      text: `${CAPTURE_VERB[e.source]} by ${who(e.created_by)}${late}`,
      tone: e.late ? 'info' : 'neutral',
    },
  ]
  if (e.evidence?.kind === 'photo') steps.push(...photoSteps(e, e.evidence))
  else if (e.evidence) steps.push(...noteSteps(e.evidence))
  steps.push(savedStep(e))
  for (const v of events) {
    const s = eventStep(v)
    if (s) steps.push(s)
  }
  if (e.status === 'pending') steps.push({ kind: 'wait', text: 'Waiting for approval', tone: 'pending' })
  return steps
}
