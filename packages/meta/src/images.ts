/**
 * Image generation and editing with Muse Image: `POST /v1/images/generations`
 * and `POST /v1/images/edits`, JSON bodies, `b64_json` replies.
 * Wire types mirrored from https://dev.meta.ai/docs/api-reference/images/schemas
 * and https://dev.meta.ai/docs/api-reference/images/edit-image (checked 2026-11-03).
 * Every call is checked locally first, so a bad call never costs a request.
 */
import { InvalidImageRequestError, MetaOutputError } from './errors.ts'
import type { CallOptions } from './responses.ts'
import type { Request } from './transport.ts'

// ---------- wire ----------

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'

export interface ImageToolEnablement {
  enable_image_search?: boolean
  /** `false` also drops the browser tools. */
  enable_web_search?: boolean
  enable_shell?: boolean
}

/** Exactly one of the two (docs: image-generation "Edits"). `image_url`: https URL or `data:image/...;base64,...`. */
export type ImageInputItem = { image_url: string; file_id?: never } | { file_id: string; image_url?: never }

export interface CreateImageRequest {
  model: string
  prompt: string
  /** 1–10, default 1. */
  n?: number
  /** "WxH": sets the aspect ratio only; ≤ 16:1. */
  size?: string
  /** Default b64_json. */
  response_format?: 'url' | 'b64_json'
  /** Default webp. */
  output_format?: ImageOutputFormat
  /** API default high. */
  reasoning_strength?: 'low' | 'high'
  /** 0–2; affects planning, not image sampling. */
  temperature?: number
  user?: string
  /** 400 unsupported_parameter on muse-image-1.0: never sent. */
  moderation?: string
  /** Never sent. */
  stream?: boolean
  /** All tools on when omitted. */
  tool_enablement?: ImageToolEnablement
}

export interface EditImageBodyJsonParam extends CreateImageRequest {
  /** 1–10 items. */
  images: ImageInputItem[]
}

export interface ImageObject {
  b64_json?: string
  url?: string
  revised_prompt?: string
}

export interface ImageGenUsage {
  input_tokens?: number
  input_tokens_details?: { image_tokens?: number; text_tokens?: number }
  output_tokens?: number
  total_tokens?: number
}

export interface ImagesResponse {
  /** Unix seconds. */
  created: number
  data: ImageObject[]
  /** Echoes the request; webp when omitted. */
  output_format?: string
  /** "Accepted but ignored"; always "opaque". */
  background?: string
  usage?: ImageGenUsage
}

// ---------- client params ----------

export interface GenerateImageParams {
  prompt: string
  /** Default 'muse-image-1.0'. */
  model?: string
  n?: number
  size?: string
  /** Omitted → API default webp. */
  outputFormat?: ImageOutputFormat
  /** Default 'low' (the API's default is 'high'). */
  reasoningStrength?: 'low' | 'high'
  temperature?: number
  /** Merged over all-false. */
  tools?: ImageToolEnablement
  /** This request only; omitted → the client's timeout. */
  timeoutMs?: number
}

export interface EditImageParams extends GenerateImageParams {
  images: ImageInputItem[]
}

export interface GeneratedImage {
  bytes: Uint8Array
  revisedPrompt?: string
}

export interface ImagesResult {
  created: number
  model: string
  outputFormat: ImageOutputFormat
  images: GeneratedImage[]
  usage?: ImageGenUsage
  ms: number
}

const SIZE = /^(\d+)x(\d+)$/

/** Pure: throws InvalidImageRequestError naming the field, before any request (docs: image-generation, schemas). */
export function checkImageRequest(p: GenerateImageParams | EditImageParams, edit = false): void {
  const bad = (m: string) => {
    throw new InvalidImageRequestError(m)
  }
  if (typeof p.prompt !== 'string' || !p.prompt.trim()) bad('prompt is blank')
  if (p.n !== undefined && !(Number.isInteger(p.n) && p.n >= 1 && p.n <= 10)) bad('n must be an integer from 1 to 10')
  if (p.temperature !== undefined && !(p.temperature >= 0 && p.temperature <= 2)) bad('temperature must be from 0 to 2')
  if (p.timeoutMs !== undefined && !(Number.isInteger(p.timeoutMs) && p.timeoutMs > 0)) bad('timeoutMs must be a positive integer')
  if (p.size !== undefined) {
    const m = SIZE.exec(p.size)
    const [w, h] = [Number(m?.[1]), Number(m?.[2])]
    if (!m || !w || !h) bad('size must be <width>x<height> in positive integers')
    if (Math.max(w, h) / Math.min(w, h) > 16) bad('size must not have one side over 16 times the other')
  }
  if (!edit) return
  const images = (p as EditImageParams).images
  if (!Array.isArray(images) || images.length < 1 || images.length > 10) bad('images must hold 1 to 10 inputs')
  images.forEach((it: { image_url?: unknown; file_id?: unknown }, i) => {
    const hasUrl = it.image_url !== undefined
    if (hasUrl === (it.file_id !== undefined)) bad(`images[${i}] must have exactly one of image_url and file_id`)
    const v = hasUrl ? it.image_url : it.file_id
    if (typeof v !== 'string' || !v) bad(`images[${i}] must be a non-empty string`)
  })
}

const FORMATS: readonly string[] = ['png', 'jpeg', 'webp'] satisfies ImageOutputFormat[]

function fromBase64(s: string): Uint8Array {
  let bin: string
  try {
    bin = atob(s)
  } catch {
    throw new MetaOutputError('image reply: b64_json is not base64')
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function createImages(request: Request, defaultModel: string) {
  /** The JSON body shared by both endpoints. Never sends stream, moderation, mask, input_fidelity, partial_images, user or store. */
  function body(p: GenerateImageParams, model: string): CreateImageRequest {
    const tools = Object.fromEntries(Object.entries(p.tools ?? {}).filter(([, v]) => typeof v === 'boolean'))
    return {
      model,
      prompt: p.prompt,
      n: p.n ?? 1,
      ...(p.size !== undefined && { size: p.size }),
      // Always explicit: a change in the API default can never switch us to URLs (no second request to fetch one).
      response_format: 'b64_json',
      ...(p.outputFormat !== undefined && { output_format: p.outputFormat }),
      reasoning_strength: p.reasoningStrength ?? 'low',
      ...(p.temperature !== undefined && { temperature: p.temperature }),
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false, ...tools },
    }
  }

  async function send(path: string, json: CreateImageRequest, p: GenerateImageParams, opts: CallOptions): Promise<ImagesResult> {
    const { data, ms } = await request<ImagesResponse>({
      method: 'POST',
      path,
      model: json.model,
      json,
      signal: opts.signal,
      ticket: opts.ticket,
      timeoutMs: p.timeoutMs,
    })
    const items = Array.isArray(data.data) ? data.data : []
    if (!items.length || items.some((d) => typeof d.b64_json !== 'string')) throw new MetaOutputError('image reply has no b64_json image')
    const echoed = data.output_format
    return {
      created: data.created,
      model: json.model,
      outputFormat: echoed !== undefined && FORMATS.includes(echoed) ? (echoed as ImageOutputFormat) : (p.outputFormat ?? 'webp'),
      images: items.map((d) => ({
        bytes: fromBase64(d.b64_json!),
        ...(d.revised_prompt !== undefined && { revisedPrompt: d.revised_prompt }),
      })),
      ...(data.usage && { usage: data.usage }),
      ms,
    }
  }

  /** One request to `POST /images/generations`. */
  async function generate(p: GenerateImageParams, opts: CallOptions = {}): Promise<ImagesResult> {
    checkImageRequest(p)
    return send('/images/generations', body(p, p.model ?? defaultModel), p, opts)
  }

  /** One JSON request to `POST /images/edits`; inputs are https or `data:` URLs (docs: edit-image example), or file ids. */
  async function edit(p: EditImageParams, opts: CallOptions = {}): Promise<ImagesResult> {
    checkImageRequest(p, true)
    const json: EditImageBodyJsonParam = { ...body(p, p.model ?? defaultModel), images: p.images }
    return send('/images/edits', json, p, opts)
  }

  return { generate, edit }
}
