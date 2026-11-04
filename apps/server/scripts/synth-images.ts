/**
 * Synthetic test images for the accuracy dataset (dev only).
 *
 *   pnpm --filter @meniscus/server synth <plan.json> <outdir> [--yes]
 *
 * Without --yes it prints the request count and cost and builds no client.
 * With --yes: 1 Muse Image request per plan item not yet made, in order, no retries.
 */
import { config } from '../src/config.ts'
import { main } from '../src/lab/synth.ts'
import { metaClient } from '../src/model-api.ts'

process.exit(
  await main(process.argv.slice(2), {
    client: metaClient,
    perHour: config.MODEL_API_MAX_REQUESTS_PER_HOUR,
    reservePct: config.CRITICAL_RESERVE_PCT,
    log: console.log,
  }),
)
