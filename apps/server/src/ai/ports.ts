/**
 * The model capabilities the domain layer depends on — a structural subset of
 * the Meta client, so tests and offline evals can pass fakes.
 */
import type { MetaClient } from '@meniscus/meta'
import { metaClient } from '../model-api.ts'

export interface AiPorts {
  responses: Pick<MetaClient['responses'], 'create' | 'generateObject' | 'callTool'>
  sam: Pick<MetaClient['sam'], 'segment'>
  asr: Pick<MetaClient['asr'], 'transcribe'>
  /** Whole-action reservations and the counts budget pressure reads (capture/read-budget); only ai/budget-policy.ts calls it. */
  budget: Pick<MetaClient['budget'], 'fits' | 'reserve' | 'stats'>
}

/** Resolved per call so a missing key surfaces as a request error, not a boot crash. */
export const livePorts = (): AiPorts => metaClient()
