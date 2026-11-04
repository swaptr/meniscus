import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen.ts'

export const router = createRouter({
  routeTree,
  // Fetch a route's code chunk on hover/touch so navigation is instant.
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface StaticDataRouteOption {
    /** Page title: rendered once as the app bar <h1>, and used for document.title. */
    title?: string
  }
}
