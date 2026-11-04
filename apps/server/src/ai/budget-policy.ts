/**
 * How each model action spends the request budget (capture/read-budget). Domain, over `AiPorts`: it classes the action
 * by its bed's acuity, picks the read mode the hourly budget still allows, reserves every request the action can make
 * before the first is sent, runs it on that ticket and returns unsent slots when it ends.
 *
 * Choosing a mode happens once, before any request; nothing is retried, queued or sent later. A refused action throws
 * the `MetaBudgetError` from `reserve` (the route maps it to 429) having sent nothing.
 */
import { MetaBudgetError, type Priority, type Ticket } from '@meniscus/meta'
import { MAX_READ_WARNINGS, type AcuityStatus, type ReadMode } from '@meniscus/shared'
import { config } from '../config.ts'
import type { AiPorts } from './ports.ts'

export type BudgetClass = 'critical' | 'routine'
export type ActionKind = 'read' | 'meal' | 'voice' | 'note' | 'explain'

/** The warning a read run in `spark` mode because `sam+spark` no longer fit gets (first, so it is never cut). */
export const BUDGET_PRESSURE = 'budget pressure: read without segmentation'
/** The warning a tray read with a comparable served photo gets when only 3 or 4 fit, so it reads without comparing. */
export const BUDGET_NO_COMPARISON = 'budget pressure: read without comparison'

/** `critical` when the bed's level or suggestion is; an action with no bed is `routine`. */
export const budgetClass = (status: AcuityStatus | null | undefined): BudgetClass =>
  status && (status.level === 'critical' || status.suggested === 'critical') ? 'critical' : 'routine'

export const priorityOf = (cls: BudgetClass): Priority => (cls === 'critical' ? 'high' : 'normal')
export const classOf = (priority: Priority): BudgetClass => (priority === 'high' ? 'critical' : 'routine')

export interface Plan {
  /** Null for actions with no read mode (voice, note, Explain). */
  mode: ReadMode | null
  /** Every request the action can make in that mode. */
  requests: number
  /** Requests it can have in flight at once: 2 for `sam+spark` (both SAM requests together, each pair in turn), else 1. */
  peak: number
  priority: Priority
  /** `sam+spark` was wanted, and only 1 request fits, or budget pressure cut a stable or bedless read to 1. */
  downgraded: boolean
  /** A tray read compares its served photo (5 requests). */
  compare: boolean
  /** A comparable served photo, but only 3 or 4 fit: read with 3 and no comparison. */
  uncompared: boolean
}

export interface PlanOptions {
  /** A tray read's served photo is comparable: found, other bytes, both sizes readable. */
  served?: boolean
  /** Percent of the cap in use from which budget pressure applies (default `BUDGET_PRESSURE_PCT`). */
  pressurePct?: number
}

/** No bed, or the higher of the bed's set and suggested level is `stable`: the reads budget pressure cuts. */
const pressured = (status: AcuityStatus | null | undefined): boolean =>
  !status || (status.level === 'stable' && (status.suggested === null || status.suggested === 'stable'))

/** Requests sent in the last hour plus those held by open tickets, against the pressure point ⌊cap · pct / 100⌋. */
function underPressure(budget: Pick<AiPorts['budget'], 'stats'>, pct: number): boolean {
  const s = budget.stats()
  return s.lastHour + s.held >= Math.floor((s.perHour * pct) / 100)
}

/** Requests per action and mode (design §4.3). */
const FIXED: Record<Exclude<ActionKind, 'read' | 'meal'>, number> = { voice: 2, note: 1, explain: 1 }

/**
 * Pure over the budget's counts. Budget pressure first: a `sam+spark` photo or tray read with no bed, or for a stable
 * bed, once `pressurePct` of the cap is in use, is `spark` (1), served photo or not. Then a `sam+spark` tray read with a
 * comparable served photo is 5 (peak 2: the served SAM pair starts after the collected pair settles) when 5 fit, else 3
 * with no comparison when 3 fit. Otherwise `sam+spark` (3, peak 2) when it is wanted and 3 fit under the class's hourly
 * ceiling; else `spark` (1). In-flight slots never change the mode: `reserve` refuses a busy `sam+spark` read instead.
 * When even 1 does not fit, the plan is still `spark`, and `reserve` refuses it with the retry time.
 */
export function plan(
  kind: ActionKind,
  wanted: ReadMode | null,
  status: AcuityStatus | null | undefined,
  budget: Pick<AiPorts['budget'], 'fits' | 'stats'>,
  opts: PlanOptions = {},
): Plan {
  const priority = priorityOf(budgetClass(status))
  const base = { priority, downgraded: false, compare: false, uncompared: false }
  if (kind !== 'read' && kind !== 'meal') return { ...base, mode: null, requests: FIXED[kind], peak: 1 }
  const spark = { ...base, mode: 'spark' as const, requests: 1, peak: 1 }
  if (wanted === 'sam+spark' && pressured(status) && underPressure(budget, opts.pressurePct ?? config.BUDGET_PRESSURE_PCT))
    return { ...spark, downgraded: budget.fits(1, priority) }
  const served = kind === 'meal' && opts.served === true
  if (wanted === 'sam+spark' && served && budget.fits(5, priority))
    return { ...base, mode: 'sam+spark', requests: 5, peak: 2, compare: true }
  if (wanted === 'sam+spark' && budget.fits(3, priority)) return { ...base, mode: 'sam+spark', requests: 3, peak: 2, uncompared: served }
  return { ...spark, downgraded: wanted === 'sam+spark' && budget.fits(1, priority) }
}

/** Model actions per class since the process started (server/metrics): a downgraded one was admitted for fewer requests than its mode plans. */
export interface ActionCounts {
  admitted: number
  refused: number
  downgraded: number
}

const counts = new WeakMap<object, Record<BudgetClass, ActionCounts>>()
const zero = (): ActionCounts => ({ admitted: 0, refused: 0, downgraded: 0 })

/** The action counts of the actions run on `budget` (one per client, so per process in the server). */
export function actionCounts(budget: object): Record<BudgetClass, ActionCounts> {
  let c = counts.get(budget)
  if (!c) counts.set(budget, (c = { critical: zero(), routine: zero() }))
  return c
}

export interface BudgetedAction {
  /** The mode asked for, or the configured default; null for actions without one. */
  mode: ReadMode | null
  /** The bed's acuity, computed fresh by the route; null with no bed. */
  status: AcuityStatus | null | undefined
  /** A tray read's served photo is comparable (PlanOptions). */
  served?: boolean
}

/**
 * Plans and reserves (no `await` in between, so concurrent actions cannot race), runs `run` on the ticket, adds the
 * `budget pressure` warning on a downgrade, and releases the ticket in `finally`.
 */
export async function withBudget<T>(
  kind: ActionKind,
  action: BudgetedAction,
  ports: () => AiPorts,
  run: (mode: ReadMode, ticket: Ticket, plan: Plan) => Promise<T>,
): Promise<T> {
  const { budget } = ports()
  const p = plan(kind, action.mode, action.status, budget, { served: action.served })
  const tally = actionCounts(budget)[classOf(p.priority)]
  let ticket: Ticket
  try {
    ticket = budget.reserve(p.requests, { priority: p.priority, peak: p.peak })
  } catch (e) {
    if (e instanceof MetaBudgetError) tally.refused++
    throw e
  }
  tally.admitted++
  if (p.downgraded || p.uncompared) tally.downgraded++
  try {
    const result = await run(p.mode ?? 'spark', ticket, p)
    if (!p.downgraded && !p.uncompared) return result
    const r = result as T & { warnings: string[] }
    const warning = p.downgraded ? BUDGET_PRESSURE : BUDGET_NO_COMPARISON
    return { ...r, warnings: [warning, ...r.warnings].slice(0, MAX_READ_WARNINGS) }
  } finally {
    ticket.release()
  }
}
