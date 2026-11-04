/** Test fixtures: fictional beds of the demo hospital's ward 3A (id 2). Not imported by the app. */
import type { AdmissionSummary, Alert, AlertKind } from '@meniscus/shared'

const zeros = () => Array<number>(24).fill(0)

/** A stable 3A bed with nothing due; override what a scenario needs. */
export function bedSummary(n: number, over: Partial<AdmissionSummary> = {}): AdmissionSummary {
  return {
    id: 100 + n,
    bed: String(n),
    patient: `Patient ${n}`,
    weight_kg: 60,
    qr_token: `t${n}`,
    admitted_at: '2026-11-01T08:00:00Z',
    ward_id: 2,
    ward_code: '3A',
    ward_name: 'Medical Ward 3A',
    mrn: `AT-20000${n}`,
    totals: { in_ml: 0, out_ml: 0, balance_ml: 0, pending_ml: 0 },
    pending: 0,
    alerts: [],
    hourly: { in_ml: zeros(), out_ml: zeros(), in_logged: zeros() },
    urine_seen: null,
    care: { orders: [], fluid_limit: null, intake_target: null, catheter: null },
    devices: { urine: 'urinal', urine_from: 'default', urine_measured: true, bags: [] },
    acuity: { level: 'stable', source: 'ward', order_id: null, suggested: null, reasons: [] },
    nutrition: { dietitian_available: true, dietitian: null, referral: null },
    bag_levels: [],
    ...over,
  }
}

export const alert = (kind: AlertKind, message = ''): Alert => ({ kind, message }) as Alert
