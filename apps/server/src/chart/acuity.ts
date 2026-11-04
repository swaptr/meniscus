/**
 * A bed's acuity (charting/acuity). Pure: its active acuity order, its ward's default and its prompts in; `AcuityStatus`
 * out. A suggestion only ever raises the level, is never stored and never applied: a nurse confirms it with one PUT.
 * No model requests.
 */
import { ACUITY_SUGGEST, type AcuityLevel, type AcuityStatus, type Alert, type CareOrder } from '@meniscus/shared'

export function acuityFor(order: CareOrder<'acuity'> | null | undefined, wardDefault: AcuityLevel, alerts: readonly Alert[]): AcuityStatus {
  const level = order ? order.value.level : wardDefault
  const kinds = alerts.map((a) => a.kind)
  const hits = (list: readonly string[]) => kinds.filter((k) => list.includes(k))
  const critical = hits(ACUITY_SUGGEST.critical)
  const watch = hits(ACUITY_SUGGEST.watch)
  const [suggested, reasons]: [AcuityLevel | null, typeof kinds] =
    level !== 'critical' && critical.length ? ['critical', critical] : level === 'stable' && watch.length ? ['watch', watch] : [null, []]
  return { level, source: order ? 'order' : 'ward', order_id: order?.id ?? null, suggested, reasons }
}
