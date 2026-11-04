/**
 * Request counts and latencies since the server started (server/metrics), kept in memory per process. Only the
 * method, the matched route pattern (never the concrete path), the status and the duration are recorded.
 */
import type { MiddlewareHandler } from 'hono'
import { matchedRoutes } from 'hono/route'
import type { OperationalMetrics } from '@meniscus/shared'

/** Latencies kept per method and route: the last 1,000. */
export const LATENCY_WINDOW = 1_000
export const UNMATCHED = 'unmatched'

interface RouteStats {
  method: string
  route: string
  byStatus: Map<number, number>
  /** Ring buffer of the last LATENCY_WINDOW durations in ms. */
  ring: number[]
  next: number
}

/** The p-th percentile (nearest rank) of `xs`. */
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

export function createMetrics(clock: () => number = () => performance.now()) {
  const routes = new Map<string, RouteStats>()

  const record = (method: string, route: string, status: number, ms: number) => {
    const key = `${method} ${route}`
    let r = routes.get(key)
    if (!r) routes.set(key, (r = { method, route, byStatus: new Map(), ring: [], next: 0 }))
    r.byStatus.set(status, (r.byStatus.get(status) ?? 0) + 1)
    if (r.ring.length < LATENCY_WINDOW) r.ring.push(ms)
    else r.ring[r.next] = ms
    r.next = (r.next + 1) % LATENCY_WINDOW
  }

  /**
   * First on the root app. After the response, the route is the pattern of the last matched handler registered for a
   * method (`matchedRoutes` from `hono/route`, Hono 4.13: `{ path, method, handler }[]`, middleware carrying the method
   * `ALL`). A request that only middleware matched (an unknown path answered by `notFound`) is `unmatched`.
   */
  const middleware: MiddlewareHandler = async (c, next) => {
    const start = clock()
    try {
      await next()
    } finally {
      const handler = matchedRoutes(c).findLast((r) => r.method !== 'ALL')
      record(c.req.method, handler?.path ?? UNMATCHED, c.res.status, Math.round(clock() - start))
    }
  }

  const snapshot = (): Pick<OperationalMetrics, 'requests' | 'latency_ms'> => {
    const all = [...routes.values()].sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method))
    return {
      requests: all.flatMap((r) =>
        [...r.byStatus].sort(([a], [b]) => a - b).map(([status, count]) => ({ method: r.method, route: r.route, status, count })),
      ),
      latency_ms: all.map((r) => ({ method: r.method, route: r.route, p50: percentile(r.ring, 50), p95: percentile(r.ring, 95) })),
    }
  }

  return { middleware, snapshot, record }
}

export type Metrics = ReturnType<typeof createMetrics>
