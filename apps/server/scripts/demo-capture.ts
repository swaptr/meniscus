/**
 * Seeds a deployed app's capture flow with the synthetic demo pack over HTTP, as an attendant would (src/lab/demo-capture.ts).
 *
 *   pnpm --filter @meniscus/server demo:capture <base-url> [pack-dir] [--only a.jpg,b.jpg] [--user mohan] [--yes]
 *
 * Without --yes it prints the plan and sends nothing. With --yes: 3 model requests per photo (sent by the deployed
 * server), one photo at a time, once each, the first error stops. Password: DEMO_CAPTURE_PASSWORD, else the username.
 */
import { main } from '../src/lab/demo-capture.ts'

process.exit(
  await main(process.argv.slice(2), {
    fetch: (url, init) => fetch(url, init),
    log: console.log,
    password: process.env.DEMO_CAPTURE_PASSWORD || undefined,
  }),
)
