/**
 * The model accuracy window and the hospital view's search and load. Kept apart from `model-accuracy.ts` because `/n`'s
 * `validateSearch` ships in the shell: this module imports nothing but the Api type.
 */
import type { ModelQuality } from '@meniscus/shared'
import type { Api } from './api.ts'

/** The view's window: the same 7 days as the ward quality summary. */
export const MODEL_DAYS = 7

/** `/n`'s search: `{ view: 'model' }` for the hospital model view; anything else is the Wards view. */
export const hospitalView = (search: Record<string, unknown>): { view?: 'model' } => (search.view === 'model' ? { view: 'model' } : {})

/** The hospital model view's data: exactly one `GET /api/quality/model?days=7`, with no ward. No model request. */
export const hospitalModelLoad = (api: Api, signal: AbortSignal): Promise<ModelQuality> => api.modelQuality(null, MODEL_DAYS, signal)

/** `/n/w/$ward`'s search: `quality` or `qr`; anything else (an unknown or non-string `view`) is Beds. */
export const wardView = (search: Record<string, unknown>): { view?: 'qr' | 'quality' } =>
  search.view === 'qr' || search.view === 'quality' ? { view: search.view } : {}
