/** Copy and lists for app-wide screens (not found, route error) and the routes the layout audit walks. Pure. */

/** `/nope` (web/interface "No blank media boxes": Not found): a not-found icon and a title naming the state. */
export const NOT_FOUND = {
  icon: 'not-found',
  title: 'Page not found',
  description: 'The link may be out of date.',
} as const

export const ROUTE_ERROR = {
  icon: 'error',
  title: 'This screen didn’t load',
  description: 'Saved entries are not affected.',
} as const

/** The widths the layout audit (scripts/ui-audit.mjs) opens every route at: a small phone, a phone, a desktop. */
export const AUDIT_WIDTHS = [320, 390, 1100] as const

/**
 * Who the layout audit (scripts/ui-audit.mjs) signs in as and the routes each opens (web/interface "Fits a phone
 * screen": Every route at 320 px). `<bed>` is a 3A bed's QR token and `<adm>` an admission, both read from the page.
 */
export const AUDIT_ROLES = [
  { who: 'ravi', routes: ['/', '/login', '/a', '/a/bed/<bed>', '/a/round?ward=2'] },
  {
    who: 'anita',
    routes: ['/', '/n', '/n?view=model', '/n/w/2', '/n/w/2?view=quality', '/n/w/2?view=qr', '/n/<adm>', '/n/<adm>/print'],
  },
  { who: 'lakshmi', routes: ['/n', '/n/w/3'] },
  { who: 'sana', routes: ['/', '/d', '/d/<adm>'] },
] as const

/** Every route the audit opens, once each. */
export const AUDIT_ROUTES: readonly string[] = [...new Set(AUDIT_ROLES.flatMap((r) => r.routes))]

/** A route with its placeholders filled in from the page. */
export const auditPath = (route: string, ids: { bed?: string; adm?: string }): string =>
  route.replace('<bed>', ids.bed ?? '<bed>').replace('<adm>', ids.adm ?? '<adm>')
