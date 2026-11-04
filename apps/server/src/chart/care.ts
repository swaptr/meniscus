/**
 * Care plan rules (charting/care-plan). Pure: orders, entries, meals, reviews and the clock in; `CareStatus` and
 * review prompts out. Every message ends "Review." and never names the patient. No model requests.
 *
 * Nil by mouth and thickened fluids judge each record by the order in force at its charted time ([start, end)), over
 * the rolling 24 h. Limits and targets use the active order over the chart day, counting approved and pending intake.
 */
import {
  CARE_KINDS,
  CATHETER_REVIEW_FROM,
  FLUID_LIMIT_WARN,
  INTAKE_TARGET_CHECKS,
  SCOPE_CATEGORIES,
  catheterSince,
  chartDay,
  outputDevices,
  type Admission,
  type Alert,
  type CareInput,
  type CareKind,
  type CareOrder,
  type CareProgress,
  type CareReview,
  type CareStatus,
  type CareValues,
  type CatheterType,
  type Entry,
  type EntryCategory,
  type FluidScope,
  type Meal,
  type MeasureEveryH,
  type RecordAlertKind,
  type UrineWindow,
} from '@meniscus/shared'
import { alertsFor } from './alerts.ts'
import { localDate, when } from './time.ts'

const DAY_MS = 24 * 3_600_000

/** A bed with no orders. */
export const emptyCare = (): CareStatus => ({ orders: [], fluid_limit: null, intake_target: null, catheter: null })

// ---------- values: stored JSON ⇄ edge ----------

/** Each kind's value as stored: times as epoch ms, keys in a fixed order, so equal values store equal JSON. */
export interface StoredCareValues {
  acuity: CareValues['acuity']
  nil_by_mouth: { until: number | null }
  thickened_fluids: CareValues['thickened_fluids']
  fluid_limit: CareValues['fluid_limit']
  intake_target: CareValues['intake_target']
  /** `measure_every_h` only when set, so a value without one stores the same JSON either way. */
  catheter: { type: CatheterType; inserted_at: number; measure_every_h?: MeasureEveryH }
  stoma: CareValues['stoma']
  drain: CareValues['drain']
  voiding: CareValues['voiding']
  /** Targets always present (null when not set); an absent key reads as null. */
  diet: { type: CareValues['diet']['type']; texture: CareValues['diet']['texture']; kcal?: number | null; protein_g?: number | null }
}
interface CareCodec<K extends CareKind> {
  /** A request body, or a value as returned (to normalise a stored row). */
  toRow: (value: CareInput<K> | CareValues[K]) => StoredCareValues[K]
  fromRow: (row: StoredCareValues[K]) => CareValues[K]
}
const iso = (ms: number) => new Date(ms).toISOString()
export const CARE_CODEC: { [K in CareKind]: CareCodec<K> } = {
  acuity: { toRow: (v) => ({ level: v.level }), fromRow: (r) => ({ level: r.level }) },
  nil_by_mouth: {
    toRow: (v) => ({ until: v.until == null ? null : Date.parse(v.until) }),
    fromRow: (r) => ({ until: r.until === null ? null : iso(r.until) }),
  },
  thickened_fluids: { toRow: (v) => ({ level: v.level }), fromRow: (r) => ({ level: r.level }) },
  fluid_limit: { toRow: (v) => ({ ml: v.ml, scope: v.scope }), fromRow: (r) => ({ ml: r.ml, scope: r.scope }) },
  intake_target: { toRow: (v) => ({ ml: v.ml }), fromRow: (r) => ({ ml: r.ml }) },
  catheter: {
    toRow: (v) => ({
      type: v.type,
      inserted_at: Date.parse(v.inserted_at),
      ...(v.measure_every_h != null && { measure_every_h: v.measure_every_h }),
    }),
    fromRow: (r) => ({ type: r.type, inserted_at: iso(r.inserted_at), measure_every_h: r.measure_every_h ?? null }),
  },
  stoma: { toRow: (v) => ({ type: v.type }), fromRow: (r) => ({ type: r.type }) },
  drain: { toRow: (v) => ({ site: v.site }), fromRow: (r) => ({ site: r.site }) },
  voiding: { toRow: (v) => ({ method: v.method }), fromRow: (r) => ({ method: r.method }) },
  diet: {
    toRow: (v) => ({ type: v.type, texture: v.texture, kcal: v.kcal ?? null, protein_g: v.protein_g ?? null }),
    fromRow: (r) => ({ type: r.type, texture: r.texture, kcal: r.kcal ?? null, protein_g: r.protein_g ?? null }),
  },
}
/** The stored JSON of a value. Equal values (times normalised) give equal strings. */
export const careJson = <K extends CareKind>(kind: K, value: CareInput<K> | CareValues[K]): string =>
  JSON.stringify(CARE_CODEC[kind].toRow(value))
/** A stored JSON value, as returned. */
export const careValue = <K extends CareKind>(kind: K, json: string): CareValues[K] =>
  // Written by careJson only.
  CARE_CODEC[kind].fromRow(JSON.parse(json) as StoredCareValues[K])

// ---------- times and words ----------

/** The first local `HH:MM` at or after the chart day's start, so a time before CHART_DAY_START falls on the next date. */
function timeInDay(day: { start: number }, hm: string): number {
  const d = new Date(day.start)
  const [h = 0, m = 0] = hm.split(':').map(Number)
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime()
  return t >= day.start ? t : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m).getTime()
}
/** Calendar days from `from`'s local date to `to`'s (DST-safe: 23 h and 25 h days round to one). */
const daysBetween = (from: number, to: number) => Math.round((localDate(to) - localDate(from)) / DAY_MS)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const SCOPE_WORDS: Record<FluidScope, string> = { oral: 'oral intake', total: 'total intake' }

// ---------- rules ----------

type OrderOf<K extends CareKind> = Extract<CareOrder, { kind: K }>
export interface CareContext<K extends CareKind> {
  /** This kind's orders, active or ended, oldest start first. */
  orders: OrderOf<K>[]
  active: OrderOf<K> | null
  /** Any status, charted at least over the last 24 h and the chart day. */
  entries: Entry[]
  /** Charted in the last 24 h. */
  meals: Meal[]
  /** The active order and those it continues (a catheter's chain, `catheterSince`), oldest first; [] when none is active. */
  chain: OrderOf<K>[]
  /** The latest review of any order in `chain`. */
  review: CareReview | null
  now: number
  /** chartDay(now). */
  day: { start: number; end: number }
  /** The bed has an active nil-by-mouth order. */
  nilByMouth: boolean
}
type StatusSlice = Partial<Pick<CareStatus, 'fluid_limit' | 'intake_target' | 'catheter'>>
export type CareRule<K extends CareKind> = (ctx: CareContext<K>) => { status?: StatusSlice; alerts: Alert[] }

const chartedAt = (x: { created_at: string }) => Date.parse(x.created_at)
/** The order is in force at `t`: from its start, included, to its end, excluded. */
export const inForce = (o: CareOrder, t: number) => Date.parse(o.start_at) <= t && (o.end_at === null || t < Date.parse(o.end_at))
/** The order of these in force at `t`, if any. */
export const orderAt = <O extends CareOrder>(orders: O[], t: number): O | undefined => orders.find((o) => inForce(o, t))
const counted = (e: Entry) => e.status !== 'rejected'
const sum = (es: Entry[]) => es.reduce((s, e) => s + e.volume_ml, 0)
const byId = (a: number, b: number) => a - b

/** Counted intake of these categories in the chart day: approved and pending, rejected left out. */
function progress(ctx: Pick<CareContext<CareKind>, 'entries' | 'day'>, categories: readonly EntryCategory[], of: number): CareProgress {
  const es = ctx.entries.filter(
    (e) => counted(e) && categories.includes(e.category) && chartedAt(e) >= ctx.day.start && chartedAt(e) < ctx.day.end,
  )
  const ml = sum(es)
  return {
    since: iso(ctx.day.start),
    ml,
    pending_ml: sum(es.filter((e) => e.status === 'pending')),
    of_ml: of,
    percent: Math.floor((100 * ml) / of),
  }
}
const pendingPart = (p: CareProgress) => (p.pending_ml ? ` (incl. ${p.pending_ml} mL pending)` : '')
const recordAlert = (kind: RecordAlertKind, message: string, entries: Entry[], meals: Meal[] = []): Alert => ({
  kind,
  message,
  entry_ids: entries.map((e) => e.id).sort(byId),
  meal_ids: meals.map((m) => m.id).sort(byId),
})

/** One rule per kind; a kind missing here, or in the web's registries, is a compile error. */
export const CARE_RULES: { [K in CareKind]: CareRule<K> } = {
  // Acuity orders the dashboard and sets the budget class (chart/acuity.ts); it raises no prompt of its own.
  acuity: () => ({ alerts: [] }),

  nil_by_mouth: (ctx) => {
    const alerts: Alert[] = []
    const during = (x: { created_at: string }) => ctx.now - chartedAt(x) < DAY_MS && orderAt(ctx.orders, chartedAt(x)) !== undefined
    const entries = ctx.entries.filter((e) => counted(e) && (e.category === 'water' || e.category === 'food') && during(e))
    const meals = ctx.meals.filter((m) => m.voided_at === null && m.portion > 0 && during(m))
    if (entries.length || meals.length) {
      // A listed meal's own fluid entry counts with the meal, not as an entry.
      const own = new Set(meals.flatMap((m) => (m.entry_id === null ? [] : [m.entry_id])))
      const drinks = entries.filter((e) => !own.has(e.id))
      const mealMl = sum(entries.filter((e) => own.has(e.id)))
      const parts = [
        drinks.length ? `${count(drinks.length, 'entry', 'entries')} (${sum(drinks)} mL)` : '',
        meals.length ? `${count(meals.length, 'meal', 'meals')}${mealMl ? ` (${mealMl} mL)` : ''}` : '',
      ].filter(Boolean)
      alerts.push(recordAlert('nil_by_mouth_intake', `Intake charted while nil by mouth: ${parts.join(', ')}. Review.`, entries, meals))
    }
    const until = ctx.active?.value.until
    if (until != null && ctx.now >= Date.parse(until)) {
      alerts.push({
        kind: 'nil_by_mouth_overdue',
        message: `Nil by mouth past its planned end of ${when(Date.parse(until), ctx.now)} and still active. Review.`,
      })
    }
    return { alerts }
  },

  thickened_fluids: (ctx) => {
    const thin: Entry[] = []
    const unrecorded: Entry[] = []
    for (const e of ctx.entries) {
      if (e.category !== 'water' || !counted(e) || ctx.now - chartedAt(e) >= DAY_MS) continue
      const o = orderAt(ctx.orders, chartedAt(e))
      if (!o) continue
      if (e.iddsi_level === null) unrecorded.push(e)
      else if (e.iddsi_level < o.value.level) thin.push(e)
    }
    const drinks = (es: Entry[]) => count(es.length, 'drink', 'drinks')
    return {
      alerts: [
        ...(thin.length ? [recordAlert('drink_too_thin', `Drink consistency: ${drinks(thin)} thinner than ordered. Review.`, thin)] : []),
        ...(unrecorded.length
          ? [
              recordAlert(
                'drink_consistency_unrecorded',
                `Drink consistency: ${drinks(unrecorded)} with no consistency recorded. Review.`,
                unrecorded,
              ),
            ]
          : []),
      ],
    }
  },

  fluid_limit: (ctx) => {
    const o = ctx.active
    if (!o) return { alerts: [] }
    const p = progress(ctx, SCOPE_CATEGORIES[o.value.scope], o.value.ml)
    const left = Math.max(0, p.of_ml - p.ml)
    const text = `${p.ml} of ${p.of_ml} mL ${SCOPE_WORDS[o.value.scope]}${pendingPart(p)} today since ${when(ctx.day.start, ctx.now)}, ${p.percent}%, ${left} mL left. Review.`
    // Exact numbers; `percent` is floored for display only.
    const alerts: Alert[] =
      p.ml >= p.of_ml
        ? [{ kind: 'fluid_limit_reached', message: `Fluid limit reached: ${text}` }]
        : p.ml >= FLUID_LIMIT_WARN * p.of_ml
          ? [{ kind: 'fluid_limit_near', message: `Fluid limit: ${text}` }]
          : []
    return { status: { fluid_limit: { ...p, scope: o.value.scope, left_ml: left } }, alerts }
  },

  intake_target: (ctx) => {
    const o = ctx.active
    if (!o) return { alerts: [] }
    const p = progress(ctx, SCOPE_CATEGORIES.oral, o.value.ml)
    const checks = INTAKE_TARGET_CHECKS.map((c) => ({ at: timeInDay(ctx.day, c.at), ml: Math.ceil(c.fraction * o.value.ml) })).sort(
      (a, b) => a.at - b.at,
    )
    const next = checks.find((c) => c.at > ctx.now) ?? null
    // The latest check passed today, unless it came before the order.
    const passed = checks.filter((c) => c.at <= ctx.now).at(-1)
    const alerts: Alert[] =
      !ctx.nilByMouth && passed && passed.at >= Date.parse(o.start_at) && p.ml < passed.ml
        ? [
            {
              kind: 'intake_target_behind',
              message: `Behind intake target: ${p.ml} of ${p.of_ml} mL oral intake${pendingPart(p)} by ${when(passed.at, ctx.now)}, expected ${passed.ml}. Review.`,
            },
          ]
        : []
    return { status: { intake_target: { ...p, next_check: next && { at: iso(next.at), ml: next.ml } } }, alerts }
  },

  catheter: (ctx) => {
    const o = ctx.active
    if (!o) return { alerts: [] }
    // Day of insertion is day 1, by calendar date.
    const day = daysBetween(Date.parse(o.value.inserted_at), ctx.now) + 1
    // The catheter's first order: changing only its interval starts a new row, not a new catheter (design.md §7).
    const since = Date.parse((ctx.chain[0] ?? o).start_at)
    const reviewedAt = ctx.review ? Date.parse(ctx.review.at) : null
    const reviewed = reviewedAt !== null && reviewedAt >= ctx.day.start && reviewedAt < ctx.day.end
    // Setting the order counts as that chart day's review.
    const due = since < ctx.day.start && ctx.now >= timeInDay(ctx.day, CATHETER_REVIEW_FROM) && !reviewed
    return {
      status: { catheter: { day, review_due: due, last_review: ctx.review } },
      alerts: due ? [{ kind: 'catheter_review', message: `Catheter day ${day}: is it still needed? Review.` }] : [],
    }
  },

  // Output devices say how output is collected (charting/care-plan "Output device orders"); `bag_without_device` and the
  // unmeasured-urine hold read them in chart/bags.ts and chart/alerts.ts, not here.
  stoma: () => ({ alerts: [] }),
  drain: () => ({ alerts: [] }),
  voiding: () => ({ alerts: [] }),

  // A diet order is for the kitchen and the ward; it raises no prompt and adds no progress (charting/care-plan "Diet order").
  diet: () => ({ alerts: [] }),
}

// ---------- the chart's prompt list ----------

export interface ChartInput {
  admission: Admission
  /** Any status, charted at least since min(now − 24 h, chartDay(now).start). */
  entries: Entry[]
  /** Active orders, and orders ended in the last 24 h; any kind. */
  orders: CareOrder[]
  /** Charted in the last 24 h. Only nil by mouth reads them. */
  meals: Meal[]
  /** Reviews of the active catheter's orders (its chain); the latest counts. */
  reviews: CareReview[]
  /** The admission's full catheter history, for the active catheter's chain; default `orders`. */
  catheterHistory?: readonly CareOrder[]
  /** The low-output window (`urineWindow`); default `(now − 6 h, now]`. */
  window?: UrineWindow
  now: number
}

function runRule<K extends CareKind>(kind: K, input: ChartInput, base: Pick<CareContext<K>, 'now' | 'day' | 'nilByMouth'>) {
  const orders = input.orders
    .filter((o): o is OrderOf<K> => o.kind === kind)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
  const active = orders.find((o) => o.end_at === null) ?? null
  const chain: OrderOf<K>[] = !active
    ? []
    : active.kind === 'catheter'
      ? (catheterSince(input.catheterHistory ?? input.orders, active as CareOrder<'catheter'>) as OrderOf<K>[])
      : [active]
  const inChain = new Set(chain.map((o) => o.id))
  const review = input.reviews.filter((r) => inChain.has(r.order_id)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null
  return CARE_RULES[kind]({ ...base, orders, active, chain, entries: input.entries, meals: input.meals, review })
}

/** The existing prompts, then the care prompts in CARE_KINDS order, and the care status. */
export function careChart(input: ChartInput): { alerts: Alert[]; care: CareStatus } {
  const { now } = input
  const active = input.orders.filter((o) => o.end_at === null)
  const nilByMouth = active.some((o) => o.kind === 'nil_by_mouth')
  const care: CareStatus = { ...emptyCare(), orders: CARE_KINDS.flatMap((k) => active.filter((o) => o.kind === k)) }
  const alerts = alertsFor(input.admission, input.entries, now, {
    nilByMouth,
    urineMeasured: outputDevices(active).urine_measured,
    ...(input.window && { window: input.window }),
  })
  const base = { now, day: chartDay(now), nilByMouth }
  for (const kind of CARE_KINDS) {
    const r = runRule(kind, input, base)
    Object.assign(care, r.status)
    alerts.push(...r.alerts)
  }
  return { alerts, care }
}
