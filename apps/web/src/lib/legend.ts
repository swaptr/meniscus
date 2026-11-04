/** The ward legend (DESIGN.md 5.13): rows from ALERT_LABEL and ALERT_TONE, so a new prompt kind appears by itself. Pure. */
import { ALERT_KINDS, ALERT_TONE } from '@meniscus/shared'
import { ALERT_LABEL, STATUS_LABEL } from './labels.ts'

export interface LegendRow {
  tone: 'danger' | 'warn' | 'info' | 'pending' | 'ok'
  /** The status chip's text. */
  label: string
  /** What puts a bed in this tone, in words. */
  kinds: string[]
}

export function wardLegend(): LegendRow[] {
  const of = (tone: 'danger' | 'warn' | 'info') => ALERT_KINDS.filter((k) => ALERT_TONE[k] === tone).map((k) => ALERT_LABEL[k])
  return [
    { tone: 'danger', label: STATUS_LABEL.danger, kinds: of('danger') },
    { tone: 'warn', label: STATUS_LABEL.warn, kinds: of('warn') },
    { tone: 'info', label: STATUS_LABEL.info, kinds: of('info') },
    { tone: 'pending', label: STATUS_LABEL.pending, kinds: ['Entries waiting for approval'] },
    { tone: 'ok', label: STATUS_LABEL.ok, kinds: ['No prompt and nothing waiting'] },
  ]
}

/** A wide table's region name: always ends `scrolls sideways` (web/interface "Fits a phone screen"). */
export const scrollName = (label: string): string => (label.endsWith('scrolls sideways') ? label : `${label}, scrolls sideways`)
