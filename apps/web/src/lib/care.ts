/**
 * Care orders on screen: badges, the bed review's Care plan rows, bars and history, and the flags on entries and meals.
 * DOM-free and pure over an injected api; nothing here calls a model. Server local time is the ward's time.
 */
import {
  CARE_HISTORY_SHOWN,
  CARE_KINDS,
  CARE_LABEL,
  CARE_ORDER_ROLES,
  DIET_KCAL_RANGE,
  DIET_PROTEIN_RANGE,
  DIET_TARGET_ROLES,
  FLUID_LIMIT_RANGE,
  FLUID_LIMIT_WARN,
  CATEGORY_DIRECTION,
  IDDSI_DRINK_LEVELS,
  INTAKE_TARGET_RANGE,
  MEASURE_EVERY_H,
  UNMEASURED_VOIDING,
  DRAIN_SITES,
  STOMA_TYPES,
  VOIDING_METHODS,
  catheterSince,
  chartDay,
  readingInterval,
  type AcuityLevel,
  type Admission,
  type Alert,
  type BagChart,
  type CareInput,
  type CareKind,
  type CareOrder,
  type CareProgress,
  type CareReview,
  type CareStatus,
  type CatheterType,
  type DietType,
  type DrainSite,
  type StomaType,
  type VoidingMethod,
  type Entry,
  type EntryCategory,
  type FluidScope,
  type FoodTexture,
  type IddsiLevel,
  type Meal,
  type MeasureEveryH,
  type Portion,
  type RecordAlertKind,
  type StaffRef,
  type ThickenedLevel,
} from '@meniscus/shared'
import { ApiError, errorText, type Api } from './api.ts'
import type { Pending } from './capture.ts'
import type { Badge } from './flags.ts'
import { ACUITY_LABEL, DIET_LABEL, DRAIN_LABEL, FOOD_TEXTURE_LABEL, STOMA_LABEL, VOIDING_LABEL } from './labels.ts'
import { shortName } from './staff.ts'
import { clock, dayMonth, isoDate } from './format.ts'

type OrderOf<K extends CareKind> = Extract<CareOrder, { kind: K }>
/** One text per kind; a kind missing here is a compile error. */
type PerKind = { [K in CareKind]: (order: OrderOf<K>, care: CareStatus, now: number) => string }
/** A person, for the role checks (CARE_ORDER_ROLES, DIET_TARGET_ROLES); null when nobody is signed in. */
type Who = Pick<StaffRef, 'role'> | null

// ---------- times and words (from getHours/getMinutes, so no ICU build can vary them) ----------

const hhmm = (t: number) => clock(t)
const sameDate = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
/** `HH:MM`, prefixed `D Mon` when not on `now`'s date. */
export const when = (isoOrMs: string | number, now: number) => {
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs)
  return sameDate(t, now) ? hhmm(t) : `${dayMonth(t)} ${hhmm(t)}`
}

export const IDDSI_NAME = Object.fromEntries(IDDSI_DRINK_LEVELS.map((l) => [l.level, l.name])) as Record<IddsiLevel, string>
/** `2 Mildly thick`: the consistency chips. */
export const iddsiChip = (level: IddsiLevel) => `${level} ${IDDSI_NAME[level]}`
const SCOPE_WORDS: Record<FluidScope, string> = { oral: 'oral intake', total: 'total intake' }
const CATHETER_WORDS: Record<CatheterType, string> = { urethral: 'Urethral catheter', suprapubic: 'Suprapubic catheter' }

/** Litres with no trailing zeros: 1000 → '1', 1500 → '1.5', 1250 → '1.25'. */
export const litres = (ml: number) => String(Math.round(ml / 10) / 100)

/** The bed's active order of this kind, if any. */
export const activeOf = <K extends CareKind>(care: CareStatus, kind: K) => care.orders.find((o): o is OrderOf<K> => o.kind === kind)

// ---------- badges (ward bed card and the attendant's banner) ----------

/** The diet's targets: ` · 1800 kcal · 60 g protein`, each part only when set. */
const targetsText = (v: { kcal: number | null; protein_g: number | null }, sep: string) =>
  `${v.kcal !== null ? `${sep}${v.kcal} kcal` : ''}${v.protein_g !== null ? `${sep}${v.protein_g} g protein` : ''}`

/** Badges per order: one for every kind but diet, which has up to two ("Diet badges on bed cards"). */
export const CARE_BADGE: { [K in CareKind]: (order: OrderOf<K>, care: CareStatus, now: number) => string[] } = {
  // Never a care badge: acuity has its own chip ("Acuity on bed cards"); careBadges leaves it out.
  acuity: (o) => [ACUITY_LABEL[o.value.level]],
  nil_by_mouth: () => ['NBM'],
  thickened_fluids: (o) => [`IDDSI ${o.value.level}`],
  fluid_limit: (o, care) => [`Limit ${litres(o.value.ml)} L · ${care.fluid_limit?.percent ?? 0}%`],
  intake_target: (o, care) => [`Target ${care.intake_target?.ml ?? 0}/${o.value.ml} mL`],
  catheter: (_o, care) => [`Catheter day ${care.catheter?.day ?? 1}`],
  // web/ward "Device badges on bed cards"; the default urinal has no order, so no badge.
  stoma: () => ['Stoma'],
  drain: () => ['Drain'],
  voiding: (o) => [VOIDING_LABEL[o.value.method]],
  // `<type> diet`, left out for a regular diet with a modified texture; then `Food IDDSI <level>` below 7.
  diet: (o) => {
    const { type, texture } = o.value
    return [...(type !== 'regular' || texture === 7 ? [`${DIET_LABEL[type]} diet`] : []), ...(texture < 7 ? [`Food IDDSI ${texture}`] : [])]
  },
}

function perKind<R>(
  map: { [K in CareKind]: (order: OrderOf<K>, care: CareStatus, now: number) => R },
  o: CareOrder,
  care: CareStatus,
  now: number,
): R {
  // Each order narrows to its own kind's text.
  return (map[o.kind] as (order: CareOrder, care: CareStatus, now: number) => R)(o, care, now)
}

/** Active orders other than acuity, which has its own chip and bed-review row (web/ward). */
export const planOrders = (care: CareStatus) => care.orders.filter((o) => o.kind !== 'acuity')

/** The badges of each active order other than acuity, in the order of `care.orders` (a diet gives up to two). */
export const careBadges = (care: CareStatus, now = Date.now()) => planOrders(care).flatMap((o) => perKind(CARE_BADGE, o, care, now))

// ---------- the bed review's Care plan ----------

export const CARE_ROW: PerKind = {
  // Not a Care plan row: acuity has its own row (carePlanView leaves it out).
  acuity: (o) => `Acuity · ${ACUITY_LABEL[o.value.level]}`,
  nil_by_mouth: (o, _care, now) =>
    `Nil by mouth · since ${when(o.start_at, now)} · ${o.value.until ? `until ${when(o.value.until, now)}` : 'no planned end'}`,
  thickened_fluids: (o) => `Thickened fluids · IDDSI ${iddsiChip(o.value.level)}`,
  fluid_limit: (o) => `Fluid limit · ${o.value.ml} mL ${SCOPE_WORDS[o.value.scope]}`,
  intake_target: (o) => `Intake target · ${o.value.ml} mL ${SCOPE_WORDS.oral}`,
  catheter: (o, care) =>
    `${CATHETER_WORDS[o.value.type]} · inserted ${dayMonth(Date.parse(o.value.inserted_at))} · Catheter day ${care.catheter?.day ?? 1}`,
  stoma: (o) => `${STOMA_LABEL[o.value.type]} · stoma bag`,
  drain: (o) => drainText(o.value.site),
  voiding: (o) => `${voidingText(o.value.method)}${unmeasured(o.value.method) ? ' · not measured' : ''}`,
  diet: (o) => dietText(o.value),
}

/** `Toilet` and `Pads`: urine is not measured (charting/alerts "Urine not measured"). */
export const unmeasured = (m: VoidingMethod) => (UNMEASURED_VOIDING as readonly VoidingMethod[]).includes(m)
/** `Chest drain`. */
const drainText = (site: DrainSite) => `${DRAIN_LABEL[site]} drain`
/** `Commode for urine`. */
const voidingText = (m: VoidingMethod) => `${VOIDING_LABEL[m]} for urine`

/** `Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein`: the care plan row, the worklist and the patient view. */
export const dietText = (v: CareOrder<'diet'>['value']) =>
  `Diet · ${DIET_LABEL[v.type]} · ${FOOD_TEXTURE_LABEL[v.texture]}${targetsText(v, ' · ')}`

/** The kind's own part of a History line. */
export const CARE_HISTORY_TEXT: PerKind = {
  acuity: (o) => `Acuity ${o.value.level}`,
  nil_by_mouth: (o, _care, now) => `Nil by mouth ${o.value.until ? `until ${when(o.value.until, now)}` : 'with no planned end'}`,
  thickened_fluids: (o) => `Thickened fluids IDDSI ${iddsiChip(o.value.level)}`,
  fluid_limit: (o) => `Fluid limit ${o.value.ml} mL ${SCOPE_WORDS[o.value.scope]}`,
  intake_target: (o) => `Intake target ${o.value.ml} mL`,
  catheter: (o) =>
    `${CATHETER_WORDS[o.value.type]} inserted ${dayMonth(Date.parse(o.value.inserted_at))}` +
    (o.value.measure_every_h != null ? `, bag reading every ${o.value.measure_every_h} h` : ''),
  stoma: (o) => STOMA_LABEL[o.value.type],
  drain: (o) => drainText(o.value.site),
  voiding: (o) => voidingText(o.value.method),
  diet: (o) => `Diet ${DIET_LABEL[o.value.type].toLowerCase()}, IDDSI ${o.value.texture}${targetsText(o.value, ', ')}`,
}

/** The catheter row's second line, from the chart read's `bags`: `Bag reading every 4 h · Ward default` (DESIGN.md 7.5). */
export const intervalLine = (bags: Pick<BagChart, 'interval_h' | 'interval_from'>) =>
  `Bag reading every ${bags.interval_h} h${bags.interval_from === 'default' ? ' · Ward default' : ''}`

const by = (s: StaffRef | null) => (s ? shortName(s.name) : 'staff not recorded')

/** `Nil by mouth until 14:00 · 06:00–09:00 · set by Meera P. · ended by Meera P.` */
export function historyLine(o: CareOrder, care: CareStatus, now: number): string {
  const span = `${when(o.start_at, now)}–${o.end_at ? when(o.end_at, now) : 'now'}`
  const ended = o.end_at ? ` · ended by ${by(o.ended_by)}` : ''
  return `${perKind(CARE_HISTORY_TEXT, o, care, now)} · ${span} · set by ${by(o.set_by)}${ended}`
}

/** `ml ≥ of` red, `ml ≥ FLUID_LIMIT_WARN × of` amber, else neutral: the same test as the server's prompts. */
export const limitTone = (p: Pick<CareProgress, 'ml' | 'of_ml'>): 'danger' | 'warn' | 'neutral' =>
  p.ml >= p.of_ml ? 'danger' : p.ml >= FLUID_LIMIT_WARN * p.of_ml ? 'warn' : 'neutral'

/** Before 08:00 the chart day began yesterday, so `since` carries its date, as the server's prompt does. */
const counted = (p: CareProgress, now: number) => `${p.ml} of ${p.of_ml} mL today since ${when(p.since, now)} · ${p.percent}%`
const pendingPart = (p: CareProgress) => (p.pending_ml ? ` · incl. ${p.pending_ml} mL pending` : '')

export const limitCaption = (p: NonNullable<CareStatus['fluid_limit']>, now: number) =>
  `${counted(p, now)} · ${p.left_ml} mL left${pendingPart(p)}`

export const targetCaption = (p: NonNullable<CareStatus['intake_target']>, now: number) =>
  `${counted(p, now)}${p.next_check ? ` · next check ${hhmm(Date.parse(p.next_check.at))}: ${p.next_check.ml} mL` : ''}${pendingPart(p)}`

/** The review falls in the chart day containing `now` (since 08:00), not the calendar day. */
export function reviewedToday(review: CareReview | null, now: number): boolean {
  if (!review) return false
  const day = chartDay(now)
  const t = Date.parse(review.at)
  return t >= day.start && t < day.end
}

/** `Reviewed today 09:10 · Nikhil B.`, or `Last reviewed 2 Nov 09:10 · Nikhil B.` */
export function reviewLine(review: CareReview | null, now: number): string {
  if (!review) return 'No review recorded'
  const who = review.by ? ` · ${shortName(review.by.name)}` : ''
  return reviewedToday(review, now) ? `Reviewed today ${hhmm(Date.parse(review.at))}${who}` : `Last reviewed ${when(review.at, now)}${who}`
}

export interface CareBar {
  percent: number
  tone: 'danger' | 'warn' | 'neutral'
  caption: string
}
export interface CareRowView {
  order: CareOrder
  text: string
  bar: CareBar | null
  /** The catheter's review line, and whether "Reviewed today" is offered. */
  review: { text: string; offered: boolean } | null
  /** The catheter's bag reading interval line; null for other kinds or without `bags`. */
  interval: string | null
}
export interface CarePlanView {
  /** `No care orders` when nothing is active. */
  empty: string | null
  rows: CareRowView[]
  history: string[]
  /** History rows behind "Show all". */
  more: number
}

/** The Care plan section, from the bed review's own load: no request. */
export function carePlanView(
  care: CareStatus,
  history: CareOrder[],
  now: number,
  showAll = false,
  bags?: Pick<BagChart, 'interval_h' | 'interval_from'>,
): CarePlanView {
  const rows = planOrders(care).map((order): CareRowView => {
    const text = perKind(CARE_ROW, order, care, now)
    const bar =
      order.kind === 'fluid_limit' && care.fluid_limit
        ? { percent: care.fluid_limit.percent, tone: limitTone(care.fluid_limit), caption: limitCaption(care.fluid_limit, now) }
        : order.kind === 'intake_target' && care.intake_target
          ? { percent: care.intake_target.percent, tone: 'neutral' as const, caption: targetCaption(care.intake_target, now) }
          : null
    // Setting the catheter counts as its chart day's review (as on the server), so the day it is set offers none. The
    // catheter starts at its first order of the same type and insertion: changing only the interval is not a new one.
    const since = order.kind === 'catheter' ? Date.parse(catheterSince([...history, order], order)[0]!.start_at) : 0
    const review =
      order.kind === 'catheter' && care.catheter
        ? {
            text: reviewLine(care.catheter.last_review, now),
            offered: since < chartDay(now).start && !reviewedToday(care.catheter.last_review, now),
          }
        : null
    const interval = order.kind === 'catheter' && bags ? intervalLine(bags) : null
    return { order, text, bar, review, interval }
  })
  const shown = showAll ? history : history.slice(0, CARE_HISTORY_SHOWN)
  return {
    empty: rows.length ? null : 'No care orders',
    rows,
    history: shown.map((o) => historyLine(o, care, now)),
    more: history.length - shown.length,
  }
}

// ---------- flags on records ----------

const listed = (alerts: Alert[], kind: RecordAlertKind, pick: 'entry_ids' | 'meal_ids', id: number) =>
  alerts.some((a) => a.kind === kind && a[pick].includes(id))

/** Beside `entryFlags`: the drink's level, and the care and bag prompts that list it. */
export function careFlags(e: Entry, alerts: Alert[]): Badge[] {
  const out: Badge[] = []
  if (e.category === 'water' && e.iddsi_level !== null) out.push({ tone: 'neutral', text: `IDDSI ${e.iddsi_level}` })
  if (listed(alerts, 'nil_by_mouth_intake', 'entry_ids', e.id)) out.push({ tone: 'danger', text: 'During NBM' })
  if (listed(alerts, 'drink_too_thin', 'entry_ids', e.id)) out.push({ tone: 'danger', text: 'Thinner than ordered' })
  if (listed(alerts, 'drink_consistency_unrecorded', 'entry_ids', e.id)) out.push({ tone: 'warn', text: 'Consistency not recorded' })
  if (listed(alerts, 'bag_level_fell', 'entry_ids', e.id)) out.push({ tone: 'warn', text: 'Bag level fell' })
  return out
}

export const mealFlags = (m: Meal, alerts: Alert[]): Badge[] =>
  listed(alerts, 'nil_by_mouth_intake', 'meal_ids', m.id) ? [{ tone: 'danger', text: 'During NBM' }] : []

// ---------- loads ----------

/** The attendant's bed screen: the bed by its QR token, then its chart (two requests, in order). */
export const bedScreenLoad = (api: Api, token: string) => async (signal: AbortSignal) => {
  const admission = await api.bed(token, signal)
  return api.entries(admission.id, signal)
}

// ---------- changing orders (nurses and the matron; the server answers 403 to anyone else) ----------

/** What each kind's form holds: times as the person typed them, converted to the request at Save. */
export interface CareFormValues {
  /** Never offered in the add-order control: acuity is set on its own row (lib/acuity.ts). */
  acuity: { level: AcuityLevel | null }
  /** `HH:MM`, or null for no planned end. */
  nil_by_mouth: { until: string | null }
  /** None picked yet: Save stays disabled. */
  thickened_fluids: { level: ThickenedLevel | null }
  fluid_limit: { ml: number; scope: FluidScope }
  intake_target: { ml: number }
  /**
   * `YYYY-MM-DD`; `exact` keeps a changed order's insertion time while its date is unchanged. `every`: "Bag reading
   * every", null for the ward default; absent on a new form, which then sends none (the default).
   */
  catheter: { type: CatheterType; inserted: string; exact?: string; every?: MeasureEveryH | null }
  /** None picked yet: Save stays disabled. */
  stoma: { type: StomaType | null }
  drain: { site: DrainSite | null }
  /** Starts at the urinal, the default with no order. */
  voiding: { method: VoidingMethod }
  /** No type picked yet: Save stays disabled. A null target is not set (left out of the body). */
  diet: { type: DietType | null; texture: FoodTexture; kcal: number | null; protein_g: number | null }
}

const ymd = (d: Date) => isoDate(d)

/** `HH:MM` as the next such local time after `now`: a time at or before now means tomorrow. ISO. */
export function untilFrom(time: string, now: Date): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
  return t.toISOString()
}

/** `YYYY-MM-DD` as local midnight. ISO. */
export function insertedFrom(date: string): string {
  const [y = 0, mo = 1, d = 1] = date.split('-').map(Number)
  return new Date(y, mo - 1, d).toISOString()
}

/** One step of a limit or target stepper, kept inside its shared range. */
export const stepMl = (ml: number, dir: 1 | -1, range: { min: number; max: number; step: number }) =>
  Math.min(range.max, Math.max(range.min, ml + dir * range.step))

/** A target above an active limit, or a limit below an active target; null when they fit (equal is fine). */
export function targetConflict(care: CareStatus, kind: CareKind, ml: number): string | null {
  if (kind === 'intake_target') {
    const lim = activeOf(care, 'fluid_limit')
    return lim && ml > lim.value.ml ? `Above the fluid limit of ${lim.value.ml} mL` : null
  }
  if (kind === 'fluid_limit') {
    const target = activeOf(care, 'intake_target')
    return target && ml < target.value.ml ? `Below the intake target of ${target.value.ml} mL` : null
  }
  return null
}

interface CareFormRule<K extends CareKind> {
  defaults: (care: CareStatus, now: Date) => CareFormValues[K]
  /** "Change…": the form starts from the active order. */
  from: (order: OrderOf<K>) => CareFormValues[K]
  /** The request body, or null while Save stays disabled. */
  input: (form: CareFormValues[K], care: CareStatus, now: Date) => CareInput<K> | null
}

const CARE_FORM: { [K in CareKind]: CareFormRule<K> } = {
  acuity: {
    defaults: () => ({ level: null }),
    from: (o) => ({ level: o.value.level }),
    input: (f) => (f.level === null ? null : { level: f.level }),
  },
  nil_by_mouth: {
    defaults: () => ({ until: null }),
    from: (o) => ({ until: o.value.until ? hhmm(Date.parse(o.value.until)) : null }),
    input: (f, _care, now) => ({ until: f.until ? untilFrom(f.until, now) : null }),
  },
  thickened_fluids: {
    defaults: () => ({ level: null }),
    from: (o) => ({ level: o.value.level }),
    input: (f) => (f.level === null ? null : { level: f.level }),
  },
  fluid_limit: {
    defaults: () => ({ ml: FLUID_LIMIT_RANGE.default, scope: 'total' }),
    from: (o) => ({ ...o.value }),
    input: (f, care) => (targetConflict(care, 'fluid_limit', f.ml) ? null : { ml: f.ml, scope: f.scope }),
  },
  intake_target: {
    // Never opens in conflict with an active limit.
    defaults: (care) => ({ ml: Math.min(INTAKE_TARGET_RANGE.default, activeOf(care, 'fluid_limit')?.value.ml ?? Infinity) }),
    from: (o) => ({ ml: o.value.ml }),
    input: (f, care) => (targetConflict(care, 'intake_target', f.ml) ? null : { ml: f.ml }),
  },
  catheter: {
    defaults: (_care, now) => ({ type: 'urethral', inserted: ymd(now) }),
    from: (o) => ({
      type: o.value.type,
      inserted: ymd(new Date(o.value.inserted_at)),
      exact: o.value.inserted_at,
      every: o.value.measure_every_h ?? null,
    }),
    input: (f) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.inserted)) return null
      const same = f.exact !== undefined && ymd(new Date(f.exact)) === f.inserted
      return {
        type: f.type,
        inserted_at: same ? f.exact! : insertedFrom(f.inserted),
        ...(f.every !== undefined && { measure_every_h: f.every }),
      }
    },
  },
  stoma: {
    defaults: () => ({ type: null }),
    from: (o) => ({ type: o.value.type }),
    input: (f) => (f.type === null ? null : { type: f.type }),
  },
  drain: {
    defaults: () => ({ site: null }),
    from: (o) => ({ site: o.value.site }),
    input: (f) => (f.site === null ? null : { site: f.site }),
  },
  voiding: {
    defaults: () => ({ method: 'urinal' }),
    from: (o) => ({ method: o.value.method }),
    input: (f) => ({ method: f.method }),
  },
  diet: {
    defaults: () => ({ type: null, texture: 7, kcal: null, protein_g: null }),
    from: (o) => ({ ...o.value }),
    // Targets go back exactly as the form holds them; a non-dietitian's form keeps the active order's.
    input: (f) =>
      f.type === null
        ? null
        : {
            type: f.type,
            texture: f.texture,
            ...(f.kcal !== null && { kcal: f.kcal }),
            ...(f.protein_g !== null && { protein_g: f.protein_g }),
          },
  },
}

/** "Bag reading every" choices: `Ward default (<h> h)` first (the bed's interval without a catheter interval), then each interval. */
export type EveryChoice = 'default' | `${MeasureEveryH}`
export const everyChoices = (admission: Pick<Admission, 'ward_code'>): [EveryChoice, string][] => [
  ['default', `Ward default (${readingInterval(admission, null).h} h)`],
  ...MEASURE_EVERY_H.map((h): [EveryChoice, string] => [`${h}`, `${h} h`]),
]
export const everyChoice = (every: MeasureEveryH | null | undefined): EveryChoice => (every == null ? 'default' : `${every}`)
export const everyOf = (choice: EveryChoice): MeasureEveryH | null => (choice === 'default' ? null : (Number(choice) as MeasureEveryH))

/** A new order's form: the shared ranges' defaults, the target capped at an active limit, a catheter inserted today. */
export const formDefaults = <K extends CareKind>(kind: K, care: CareStatus, now = new Date()): CareFormValues[K] =>
  CARE_FORM[kind].defaults(care, now)
/** "Change…": the form filled from the active order. */
export const formFrom = <K extends CareKind>(order: OrderOf<K>): CareFormValues[K] => (CARE_FORM[order.kind] as CareFormRule<K>).from(order)
/** The PUT body, or null while Save stays disabled (no level picked, a target above the limit, a limit below the target). */
export const careInput = <K extends CareKind>(kind: K, form: CareFormValues[K], care: CareStatus, now: Date): CareInput<K> | null =>
  CARE_FORM[kind].input(form, care, now)

/** The End dialog's button: `Catheter removed`, `Drain removed`, else `End <kind>`. */
export const endButtonText = (kind: CareKind) =>
  kind === 'catheter' ? 'Catheter removed' : kind === 'drain' ? 'Drain removed' : `End ${CARE_LABEL[kind].toLowerCase()}`
const END_CONFIRM: Partial<Record<CareKind, string>> = {
  catheter: 'Catheter removed?',
  drain: 'Drain removed?',
  stoma: 'End the stoma order?',
  voiding: 'Back to the urinal default?',
}
/** The device forms' choices (web/ward "Output devices on the care plan"), in the shared order. */
export const STOMA_CHOICES = STOMA_TYPES.map((t) => [t, STOMA_LABEL[t]] as const)
export const DRAIN_CHOICES = DRAIN_SITES.map((d) => [d, DRAIN_LABEL[d]] as const)
export const VOIDING_CHOICES = VOIDING_METHODS.map(
  (m) => [m, unmeasured(m) ? `${VOIDING_LABEL[m]} (not measured)` : VOIDING_LABEL[m]] as const,
)

export const endConfirmText = (kind: CareKind) => END_CONFIRM[kind] ?? `End ${CARE_LABEL[kind].toLowerCase()}?`

/** Whether this person may set, change or end this kind's orders (CARE_ORDER_ROLES). */
export const mayOrder = (kind: CareKind, staff: Who) => staff !== null && CARE_ORDER_ROLES[kind].includes(staff.role)
/** Only a dietitian sets, changes or removes a diet's energy and protein targets. */
export const mayEditTargets = (staff: Who) => staff !== null && DIET_TARGET_ROLES.includes(staff.role)

/** Kinds this person may add here: those not active that their role orders, in CARE_KINDS order, never acuity (its own row). */
export const addableKinds = (care: CareStatus, staff: Who) =>
  CARE_KINDS.filter((k) => k !== 'acuity' && mayOrder(k, staff) && !care.orders.some((o) => o.kind === k))

/**
 * The care plan's add control: with one addable kind (a dietitian's diet) a single `Add <kind>` button opens that form
 * directly; with several, `Add order` reveals the kind chooser; null with none.
 */
export function addControl(kinds: CareKind[]): { label: string; direct: CareKind | null } | null {
  if (kinds.length === 0) return null
  const only = kinds.length === 1 ? kinds[0]! : null
  return only ? { label: `Add ${CARE_LABEL[only].toLowerCase()}`, direct: only } : { label: 'Add order', direct: null }
}

export const DIET_END_TARGETS = 'Only a dietitian can end a diet with targets.'
export const DIET_TARGETS_FORBIDDEN = 'Only a dietitian can change energy and protein targets.'
export const DIET_TARGET_RANGES = { kcal: DIET_KCAL_RANGE, protein_g: DIET_PROTEIN_RANGE } as const

const hasTargets = (o: CareOrder) => o.kind === 'diet' && (o.value.kcal !== null || o.value.protein_g !== null)

/**
 * The row's controls for this person: "Change…" when their role orders the kind; "End…" too, except a diet with targets
 * for anyone but a dietitian, who instead reads `note`.
 */
export function rowActions(order: CareOrder, staff: Who): { change: boolean; end: boolean; note: string | null } {
  if (!mayOrder(order.kind, staff)) return { change: false, end: false, note: null }
  const blocked = hasTargets(order) && !mayEditTargets(staff)
  return { change: true, end: !blocked, note: blocked ? DIET_END_TARGETS : null }
}

/** The diet form's read-only targets for a non-dietitian: `1800 kcal · 60 g protein · set by a dietitian`; null with none. */
export function targetsLine(v: { kcal: number | null; protein_g: number | null }): string | null {
  const parts = targetsText(v, ' · ')
  return parts ? `${parts.slice(3)} · set by a dietitian` : null
}

export type CareChange = { op: 'set'; kind: CareKind; value: CareInput } | { op: 'end'; kind: CareKind } | { op: 'review' }

const DONE: Record<CareChange['op'], (kind: CareKind | null) => string> = {
  set: (k) => `${CARE_LABEL[k!]} saved.`,
  end: (k) => (k === 'catheter' ? 'Catheter removal recorded.' : `${CARE_LABEL[k!]} ended.`),
  review: () => 'Catheter review recorded for today.',
}

/**
 * One request, then the bed review's reload; a refusal (e.g. 409 `already_reviewed`) is shown and nothing more is
 * sent. No model request.
 */
export async function applyCare(
  api: Api,
  admissionId: number,
  change: CareChange,
  reload: () => unknown,
): Promise<{ ok: boolean; text: string }> {
  try {
    if (change.op === 'set') await api.setCare(admissionId, change.kind, change.value)
    else if (change.op === 'end') await api.endCare(admissionId, change.kind)
    else await api.reviewCatheter(admissionId)
  } catch (err) {
    // A diet refused for its targets: a dietitian changed them meanwhile. Say so, and show the order as it is now.
    if (change.op !== 'review' && change.kind === 'diet' && err instanceof ApiError && err.status === 403) {
      await reload()
      return { ok: false, text: change.op === 'set' ? DIET_TARGETS_FORBIDDEN : DIET_END_TARGETS }
    }
    return { ok: false, text: errorText(err) }
  }
  await reload()
  return { ok: true, text: DONE[change.op](change.op === 'review' ? null : change.kind) }
}

// ---------- capture with care (the check screen, by hand, the Meal form and "Add missed entry") ----------

/**
 * While nil by mouth is active: the warning before saving a drink or food, or a meal with some portion eaten or some
 * fluid. Null otherwise. Nothing is blocked; the save sends the same requests.
 */
export function nbmWarning(
  care: CareStatus,
  what: EntryCategory | { portion: Portion; fluid_ml: number | null },
  now: number,
): string | null {
  const o = activeOf(care, 'nil_by_mouth')
  if (!o) return null
  const intake = typeof what === 'string' ? what === 'water' || what === 'food' : what.portion > 0 || (what.fluid_ml ?? 0) > 0
  if (!intake) return null
  const until = o.value.until ? `, until ${when(o.value.until, now)}` : ''
  return `Nil by mouth since ${when(o.start_at, now)}${until}. Saving records it and asks the nurse to review.`
}

/** The save button: `Save anyway` under a nil-by-mouth warning. */
export const saveLabel = (warning: string | null, label = 'Save') => (warning ? 'Save anyway' : label)

/** A drink's consistency starts at the thickened-fluids level; none without the order or for other types. */
export const consistencyDefault = (care: CareStatus, category: EntryCategory): IddsiLevel | undefined =>
  category === 'water' ? activeOf(care, 'thickened_fluids')?.value.level : undefined

/** A level below the order's: the notice under the chips. Saving stays enabled. */
export function thinnerNotice(level: IddsiLevel | undefined | null, care: CareStatus): string | null {
  const ordered = activeOf(care, 'thickened_fluids')?.value.level
  if (ordered === undefined || level == null || level >= ordered) return null
  return `Thinner than ordered (IDDSI ${iddsiChip(ordered)}). The nurse is asked to review.`
}

/** A draft entering review: a drink gets the ordered level unless one is already picked. */
export const seedConsistency = (p: Pending, care: CareStatus): Pending => {
  const level = consistencyDefault(care, p.draft.category)
  return p.iddsi_level === undefined && level !== undefined ? { ...p, iddsi_level: level } : p
}

/** The type changed: the level is re-seeded from the order (and dropped for anything but a drink). */
export function withCategory(p: Pending, category: EntryCategory, care: CareStatus): Pending {
  const { iddsi_level: _dropped, ...rest } = p
  // Only drinks and food keep a drink kind.
  const drink = category === 'water' || category === 'food' ? p.draft.drink : null
  return seedConsistency({ ...rest, draft: { ...p.draft, category, direction: CATEGORY_DIRECTION[category], drink } }, care)
}
