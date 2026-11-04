/**
 * Responses API — Meta's recommended protocol for Muse Spark (images, tools,
 * reasoning). Only the subset this app needs, typed from the schema reference:
 * https://dev.meta.ai/docs/api-reference/responses/schemas
 */
import { MetaOutputError, MetaResponseError } from './errors.ts'
import type { Ticket } from './budget.ts'
import type { Request } from './transport.ts'

// ---------- request ----------

/**
 * The schema also lists `none`, which Muse Spark and Muse Wonder answer with HTTP 400, so it is left out here. `max`:
 * `muse-spark-1.3` and `muse-wonder-1.0` only, not `*-contributor` (https://dev.meta.ai/docs/reasoning, 2026-11-04).
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type InputContent =
  | { type: 'input_text'; text: string }
  /**
   * `image_url`: https URL or `data:image/...;base64,...`, at most 20,971,520 characters (schemas,
   * `InputImageContentParamAutoParam`); inline images ≤ 50 MB, jpeg/png/gif/webp/x-icon, ≤ 50 per request, user messages
   * only (https://dev.meta.ai/docs/image-understanding). `detail` defaults to `auto`.
   */
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' | 'original' }

/** `EasyInputMessage`: `type` is optional and always `message` (https://dev.meta.ai/docs/api-reference/responses/schemas). */
export interface InputMessage {
  type?: 'message'
  role: 'user' | 'developer' | 'system' | 'assistant'
  content: string | InputContent[]
}

export type JsonSchema = Record<string, unknown>

export interface FunctionTool {
  type: 'function'
  name: string
  description?: string
  parameters: JsonSchema
  strict?: boolean
}

export interface ResponseCreateParams {
  model: string
  input: string | InputMessage[]
  /** Developer-role instructions for this request only. */
  instructions?: string
  /**
   * https://dev.meta.ai/docs/api-reference/responses/schemas (`TextResponseFormatConfiguration`). `json_object` is the
   * older JSON mode; prefer `json_schema`. No pipeline sends `json_object`.
   */
  text?: {
    format:
      /** `name`: letters, digits, `_`, `-`, ≤ 64 chars. `strict` defaults to false (https://dev.meta.ai/docs/structured-output). */
      | { type: 'json_schema'; name: string; schema: JsonSchema; strict?: boolean; description?: string }
      | { type: 'json_object' }
      | { type: 'text' }
  }
  tools?: FunctionTool[]
  /** Meta accepts only "auto"; anything else is HTTP 400. */
  tool_choice?: 'auto'
  parallel_tool_calls?: boolean
  /** `summary` replaces the deprecated `generate_summary` (https://dev.meta.ai/docs/api-reference/responses/schemas). */
  reasoning?: { effort?: ReasoningEffort; summary?: 'auto' | 'concise' | 'detailed' | null }
  /** Server-side retention. Defaults to false in this client (API default is true). */
  store?: boolean
  metadata?: Record<string, string>
  /** Minimum 16. */
  max_output_tokens?: number
  /** At most 64 characters. */
  safety_identifier?: string
}

// ---------- response ----------

/**
 * `ResponseUsage`. The schema marks `cached_tokens` and `reasoning_tokens` required; typed optional so an older or
 * segmentation reply without them still reads.
 */
export interface Usage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
  /** Image segmentation responses only. */
  images_processed?: number
  /** Video segmentation responses only (https://dev.meta.ai/docs/api-reference/responses/schemas). */
  video_frames_processed?: number
}

export type OutputItem =
  | {
      type: 'message'
      id?: string
      role: 'assistant'
      status?: ItemStatus
      phase?: string | null
      content: ({ type: 'output_text'; text: string } | { type: 'refusal'; refusal: string })[]
    }
  | {
      type: 'function_call'
      id?: string
      call_id: string
      namespace?: string | null
      name: string
      /** JSON string. */
      arguments: string
      status?: ItemStatus
    }
  | {
      type: 'reasoning'
      id: string
      /** May be empty: summaries are not guaranteed (https://dev.meta.ai/docs/reasoning). */
      summary: { type: 'summary_text'; text: string }[]
      content?: unknown[] | null
      encrypted_content?: string | null
      status?: ItemStatus
    }
  | { type: string; [k: string]: unknown }

/** Output item status (schemas). */
export type ItemStatus = 'in_progress' | 'completed' | 'incomplete'

/**
 * `ResponseErrorCode` (schemas): the `error.code` of an HTTP 200 reply whose `status` is `failed`. The schema leaves
 * `ResponseError`'s fields undocumented; `code` and `message` are assumed from `ResponseErrorEvent`.
 */
export type ResponseErrorCode =
  | 'server_error'
  | 'rate_limit_exceeded'
  | 'invalid_prompt'
  | 'vector_store_timeout'
  | 'invalid_image'
  | 'invalid_image_format'
  | 'invalid_base64_image'
  | 'invalid_image_url'
  | 'image_too_large'
  | 'image_too_small'
  | 'image_parse_error'
  | 'image_content_policy_violation'
  | 'invalid_image_mode'
  | 'image_file_too_large'
  | 'unsupported_image_media_type'
  | 'empty_image_file'
  | 'failed_to_download_image'
  | 'image_file_not_found'

export interface ResponseObject {
  id: string
  object: 'response'
  /** Unix seconds. Required in the schema; optional here so a minimal reply still reads. */
  created_at?: number
  completed_at?: number | null
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete'
  model: string
  output: OutputItem[]
  error: { code?: ResponseErrorCode | (string & {}); message?: string } | null
  /** The schema documents no `reason` enum; `max_output_tokens` is assumed (unverified). */
  incomplete_details: { reason?: string } | null
  usage?: Usage
}

type Message = Extract<OutputItem, { type: 'message' }>
type FunctionCallItem = Extract<OutputItem, { type: 'function_call' }>

const isMessage = (i: OutputItem): i is Message => i.type === 'message'
const isFunctionCall = (i: OutputItem): i is FunctionCallItem => i.type === 'function_call'

/** Concatenated `output_text` parts (raw JSON has no `output_text` field; that is an SDK helper). */
export function outputText(r: ResponseObject): string {
  return r.output
    .filter(isMessage)
    .flatMap((m) => m.content)
    .map((c) => (c.type === 'output_text' ? c.text : ''))
    .join('')
}

export function refusal(r: ResponseObject): string | undefined {
  for (const m of r.output.filter(isMessage)) for (const c of m.content) if (c.type === 'refusal') return c.refusal
  return undefined
}

export function functionCalls(r: ResponseObject): FunctionCallItem[] {
  return r.output.filter(isFunctionCall)
}

/** Throw unless the model finished normally and did not refuse. */
export function assertCompleted(r: ResponseObject): void {
  if (r.status !== 'completed') {
    const why = r.error?.message ?? r.incomplete_details?.reason ?? r.status
    throw new MetaResponseError(`response ${r.id} ${r.status}: ${why}`, r.id, r.status, r.error?.code ?? r.incomplete_details?.reason)
  }
  const refused = refusal(r)
  if (refused) throw new MetaResponseError(`response ${r.id} refused: ${refused}`, r.id, 'refused', 'refusal')
}

// ---------- validation (Standard Schema, so any zod/valibot/arktype schema works) ----------

/** Minimal Standard Schema v1 surface: https://standardschema.dev */
export interface StandardSchema<Out = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly validate: (value: unknown) => StandardResult<Out> | Promise<StandardResult<Out>>
  }
}
type StandardResult<Out> =
  | { readonly value: Out; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string; readonly path?: readonly (PropertyKey | { key: PropertyKey })[] }[] }

export async function validate<T>(schema: StandardSchema<T>, raw: string, what: string): Promise<T> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new MetaOutputError(`${what}: not valid JSON`, [], raw)
  }
  const r = await schema['~standard'].validate(value)
  if (r.issues) {
    const issues = r.issues.map((i) => {
      const path = i.path?.map((p) => (typeof p === 'object' ? String(p.key) : String(p))).join('.')
      return path ? `${path}: ${i.message}` : i.message
    })
    throw new MetaOutputError(`${what}: ${issues.join('; ')}`, issues, raw)
  }
  return r.value
}

// ---------- endpoint + high-level helpers ----------

export interface CallOptions {
  signal?: AbortSignal
  /** Slots reserved for the whole action (`RequestBudget.reserve`); the request takes one from it instead of acquiring its own. */
  ticket?: Ticket
}

export interface Result {
  response: ResponseObject
  usage: Usage | undefined
  ms: number
}

/** A function tool paired with the validator for its arguments. */
export interface ToolDef<T> {
  name: string
  description: string
  parameters: JsonSchema
  schema: StandardSchema<T>
}

export function createResponses(request: Request, defaults: { store: boolean }) {
  async function create(params: ResponseCreateParams, opts: CallOptions = {}): Promise<Result> {
    // Never ask for the optional 24 h prompt cache: `store: false` does not disable caching,
    // and leaving the field out keeps the documented in-memory default. Stripped here so
    // casts and plain JS callers (generateObject, callTool, sam.segment) are covered too.
    // https://dev.meta.ai/docs/prompt-caching
    const { prompt_cache_retention: _dropped, ...body } = params as ResponseCreateParams & { prompt_cache_retention?: unknown }
    const { data, ms } = await request<ResponseObject>({
      method: 'POST',
      path: '/responses',
      model: params.model,
      json: { store: defaults.store, ...body },
      signal: opts.signal,
      ticket: opts.ticket,
    })
    return { response: data, usage: data.usage, ms }
  }

  /**
   * Schema-constrained JSON (`text.format: json_schema`, strict), validated
   * client-side because the API constrains shape, not semantics.
   */
  async function generateObject<T>(
    params: Omit<ResponseCreateParams, 'text' | 'tools' | 'tool_choice'> & {
      output: { name: string; jsonSchema: JsonSchema; schema: StandardSchema<T> }
    },
    opts?: CallOptions,
  ): Promise<Result & { object: T }> {
    const { output, ...rest } = params
    const r = await create(
      { ...rest, text: { format: { type: 'json_schema', name: output.name, schema: output.jsonSchema, strict: true } } },
      opts,
    )
    assertCompleted(r.response)
    const text = outputText(r.response)
    if (!text) throw new MetaOutputError(`${output.name}: empty output`)
    return { ...r, object: await validate(output.schema, text, output.name) }
  }

  /**
   * Offer one function tool; return every validated call. With
   * `tool_choice: "auto"` (the only value Meta accepts) zero calls is valid.
   */
  async function callTool<T>(
    params: Omit<ResponseCreateParams, 'text' | 'tools' | 'tool_choice'> & { tool: ToolDef<T> },
    opts?: CallOptions,
  ): Promise<Result & { calls: { callId: string; input: T }[]; text: string }> {
    const { tool, ...rest } = params
    const r = await create(
      {
        ...rest,
        tool_choice: 'auto',
        tools: [{ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }],
      },
      opts,
    )
    assertCompleted(r.response)
    const calls: { callId: string; input: T }[] = []
    for (const c of functionCalls(r.response)) {
      if (c.name !== tool.name) continue
      calls.push({ callId: c.call_id, input: await validate(tool.schema, c.arguments, `${tool.name} arguments`) })
    }
    return { ...r, calls, text: outputText(r.response) }
  }

  return { create, generateObject, callTool }
}
