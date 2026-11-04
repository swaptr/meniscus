/** GET /api/metrics (server/metrics): operational counts for the matron. No model request, no patient data. */
import { Hono } from 'hono'
import type { RequestBudget } from '@meniscus/meta'
import type { OperationalMetrics } from '@meniscus/shared'
import { actionCounts } from '../ai/budget-policy.ts'
import type { Metrics } from '../metrics.ts'
import type { Store } from '../store/port.ts'
import { requireRole, type Env } from './common.ts'

/** The app's model request budget, or a throw when the server has no model client (no API key). */
export type BudgetSource = () => Pick<RequestBudget, 'stats'>

export function metricsRoutes(store: Store, metrics: Metrics, budget: BudgetSource) {
  return new Hono<Env>().get('/metrics', requireRole(['matron']), async (c) => {
    let b: Pick<RequestBudget, 'stats'> | undefined
    try {
      b = budget()
    } catch {
      b = undefined
    }
    const s = b?.stats()
    const counts = b ? actionCounts(b) : undefined
    const zero = { admitted: 0, refused: 0, downgraded: 0 }
    const body: OperationalMetrics = {
      ...metrics.snapshot(),
      model_budget: s
        ? {
            cap: s.perHour,
            used: s.lastHour + s.held,
            held: s.held,
            remaining: { critical: s.remaining.high, routine: s.remaining.normal },
          }
        : null,
      model_actions: { critical: { ...(counts?.critical ?? zero) }, routine: { ...(counts?.routine ?? zero) } },
      ...(await store.sizes()),
    }
    return c.json(body)
  })
}
