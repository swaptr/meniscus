/**
 * The web build, served outside /api on the same origin (server/hosting "Web build served", "Web app routes fall back
 * to index.html", "Web cache headers"). Files come from `serveStatic`, which refuses paths that leave the root and any
 * `%` in the path. No session and no model request.
 */
import { serveStatic } from '@hono/node-server/serve-static'
import type { MiddlewareHandler } from 'hono'

/** Vite's content-hashed output: safe to cache for a year. Everything else must be revalidated on each load. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
export const NO_CACHE = 'no-cache'

const isApi = (path: string) => path === '/api' || path.startsWith('/api/')
const noop = async () => {}

/** GET and HEAD outside /api: the file, else `index.html` for an extension-less path, else on to the 404. */
export function webApp(webDist: string): MiddlewareHandler {
  const files = serveStatic({ root: webDist })
  const index = serveStatic({ root: webDist, path: 'index.html' })
  return async (c, next) => {
    const path = c.req.path
    if (isApi(path) || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) return next()
    const file = await files(c, noop)
    if (file instanceof Response) {
      file.headers.set('Cache-Control', path.startsWith('/assets/') ? IMMUTABLE : NO_CACHE)
      return file
    }
    // A deep link (`/a/bed/<token>`, `/n/w/2`) opens the app; a missing `/assets/x.js` stays a 404, never HTML.
    if (path.slice(path.lastIndexOf('/') + 1).includes('.')) return next()
    const page = await index(c, noop)
    if (!(page instanceof Response)) return next()
    page.headers.set('Cache-Control', NO_CACHE)
    return page
  }
}
