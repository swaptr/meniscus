/**
 * SAM 3.1 image segmentation over `POST /v1/responses` (non-streaming; docs:
 * "a non-streaming request returns the complete result in a single response,
 * in the same format"). Output is SAM special-token text, parsed with Meta's
 * `@meta-sam/parser`. https://dev.meta.ai/docs/sam/overview
 */
import {
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
  type SegmentationBoxRecord,
  type SegmentationDiagnostic,
  type SegmentationMaskRecord,
} from '@meta-sam/parser'
import { MetaOutputError } from './errors.ts'
import { assertCompleted, outputText, type CallOptions, type Result } from './responses.ts'
import type { createResponses } from './responses.ts'

export interface SegmentParams {
  /** https URL or `data:image/...;base64,...`. */
  image: string
  /** One short noun phrase ("urine bag"), not a command or a list. */
  prompt: string
  model?: string
  /** Default true. */
  includeConfidence?: boolean
  maskEncoding?: 'lossless' | 'one_bit'
}

export interface Segmentation extends Result {
  masks: readonly SegmentationMaskRecord[]
  boxes: readonly SegmentationBoxRecord[]
  diagnostics: readonly SegmentationDiagnostic[]
  /** Raw special-token output, for logging. */
  raw: string
}

export function createSam(responses: ReturnType<typeof createResponses>, defaultModel: string) {
  async function segment(p: SegmentParams, opts?: CallOptions): Promise<Segmentation> {
    const r = await responses.create(
      {
        model: p.model ?? defaultModel,
        metadata: {
          include_confidence: String(p.includeConfidence ?? true),
          mask_encoding: p.maskEncoding ?? 'lossless',
        },
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: p.prompt },
              { type: 'input_image', image_url: p.image },
            ],
          },
        ],
      },
      opts,
    )
    assertCompleted(r.response)
    const raw = outputText(r.response)
    const parsed = await parseImageStream(asEvents(raw)).finalResult
    if (parsed.outcome.status !== 'completed') {
      throw new MetaOutputError(`SAM output could not be parsed (${parsed.outcome.status})`, [], raw)
    }
    return {
      ...r,
      masks: recordsOfKind(parsed.records, 'mask'),
      boxes: recordsOfKind(parsed.records, 'box'),
      diagnostics: parsed.diagnostics,
      raw,
    }
  }
  return { segment }
}

/** Replay a complete output text as the event sequence the parser consumes. */
// eslint-disable-next-line @typescript-eslint/require-await -- the parser takes an AsyncIterable
async function* asEvents(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: 'output', output_index: 0, content_index: 0 }
  if (text) yield { type: 'response.output_text.delta', ...lane, delta: text }
  yield { type: 'response.output_text.done', ...lane, text }
  yield { type: 'response.completed' }
}
