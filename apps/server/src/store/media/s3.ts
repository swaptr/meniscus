/**
 * The S3 media store (server/storage): Supabase Storage's S3 protocol in production, the Supabase CLI's local stack in
 * development. `aws4fetch` only signs (`AwsClient.sign`); each request is sent exactly once through the injected
 * `fetch`. `AwsClient.fetch` is never used: it retries 5xx and 429 and always calls the global `fetch`.
 * Supabase refuses SSE headers and Content-MD5 (https://supabase.com/docs/guides/storage/s3/compatibility), so none
 * are sent. Errors carry only the operation and status, never a key, hash or credential.
 */
import { AwsClient } from 'aws4fetch'
import { MediaStoreError, objectKey, shaOfKey, type MediaObject, type MediaOp, type MediaStore } from './port.ts'

export interface S3MediaOptions {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** `<endpoint>/<bucket>/<key>`; false: `<bucket>.<endpoint host>/<key>` (AWS virtual-hosted style). */
  forcePathStyle: boolean
  /** Default `globalThis.fetch`; tests pass the fake S3's. */
  fetch?: (req: Request) => Promise<Response>
  /** Default `AbortSignal.timeout`; tests pass one they abort (node:test's fake timers do not fake it). */
  timeoutSignal?: (ms: number) => AbortSignal
}

/** How long one request may wait for its response headers (charting/media "Media store unavailable"). */
export const MEDIA_TIMEOUT_MS = 10_000
/** The five predefined XML entities (a continuation token is opaque and may contain them). */
const unescapeXml = (v: string) =>
  v.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e] ?? '')
/** SHA-256 of an empty body: the signed payload hash of every request without one. */
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export function createS3MediaStore(o: S3MediaOptions): MediaStore {
  const aws = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, service: 's3', region: o.region })
  const send = o.fetch ?? ((req: Request) => globalThis.fetch(req))
  const timeoutSignal = o.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms))
  const base = new URL(o.endpoint)
  const basePath = base.pathname.replace(/\/+$/, '')
  /** The bucket's URL, with `suffix` (a key or a query) appended. */
  const url = (suffix: string) => {
    if (o.forcePathStyle) return `${base.origin}${basePath}/${o.bucket}${suffix}`
    return `${base.protocol}//${o.bucket}.${base.host}${basePath}${suffix || '/'}`
  }

  /** One signed request, sent once. Only the wait for the headers is timed: a streamed body runs as long as it needs. */
  const request = async (op: MediaOp, target: string, init: { method: string; headers?: Record<string, string>; body?: Uint8Array }) => {
    const timer = timeoutSignal(MEDIA_TIMEOUT_MS)
    const abort = new AbortController()
    const onTimeout = () => abort.abort(timer.reason)
    if (timer.aborted) onTimeout()
    else timer.addEventListener('abort', onTimeout, { once: true })
    try {
      const signed = await aws.sign(target, {
        method: init.method,
        headers: { 'x-amz-content-sha256': EMPTY_SHA, ...init.headers },
        ...(init.body ? { body: init.body as Uint8Array<ArrayBuffer> } : {}),
        signal: abort.signal,
      })
      return await send(signed)
    } catch {
      // Never the error itself: fetch's and the signer's carry the URL.
      throw new MediaStoreError(op, timer.aborted ? 'timeout' : 'network')
    } finally {
      timer.removeEventListener('abort', onTimeout)
    }
  }
  /** The status as an error, after releasing the body. */
  const fail = async (op: MediaOp, res: Response): Promise<never> => {
    await res.body?.cancel().catch(() => {})
    throw new MediaStoreError(op, res.status)
  }
  const done = async (res: Response) => void (await res.body?.cancel().catch(() => {}))

  return {
    kind: 's3',
    put: async (sha256, bytes, mime) => {
      const res = await request('put', url(`/${objectKey(sha256)}`), {
        method: 'PUT',
        headers: { 'content-type': mime, 'x-amz-content-sha256': sha256 },
        body: bytes,
      })
      if (!res.ok) await fail('put', res)
      await done(res)
    },
    get: async (sha256): Promise<MediaObject> => {
      const res = await request('get', url(`/${objectKey(sha256)}`), { method: 'GET' })
      if (!res.ok || !res.body) return fail('get', res)
      const size = Number(res.headers.get('content-length'))
      return { body: res.body, size: Number.isFinite(size) ? size : -1 }
    },
    delete: async (sha256) => {
      const res = await request('delete', url(`/${objectKey(sha256)}`), { method: 'DELETE' })
      if (!res.ok && res.status !== 404) await fail('delete', res)
      await done(res)
    },
    head: async (sha256) => {
      const res = await request('head', url(`/${objectKey(sha256)}`), { method: 'HEAD' })
      if (res.status === 404) return done(res).then(() => undefined)
      if (!res.ok) return fail('head', res)
      await done(res)
      const lastModified = Date.parse(res.headers.get('last-modified') ?? '')
      if (Number.isNaN(lastModified)) throw new MediaStoreError('head', res.status)
      return { lastModified }
    },
    check: async () => {
      const res = await request('head-bucket', url(''), { method: 'HEAD' })
      if (!res.ok) await fail('head-bucket', res)
      await done(res)
    },
    list: async function* () {
      let token: string | undefined
      // A store that names a token twice would page forever: listing stops at the first repeat.
      const seen = new Set<string>()
      do {
        const q = new URLSearchParams({ 'list-type': '2', ...(token ? { 'continuation-token': token } : {}) })
        const res = await request('list', `${url('')}?${q.toString()}`, { method: 'GET' })
        if (!res.ok) await fail('list', res)
        const xml = await res.text()
        for (const [, body] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const sha256 = shaOfKey(/<Key>([^<]*)<\/Key>/.exec(body!)?.[1] ?? '')
          const lastModified = Date.parse(/<LastModified>([^<]*)<\/LastModified>/.exec(body!)?.[1] ?? '')
          if (sha256 && !Number.isNaN(lastModified)) yield { sha256, lastModified }
        }
        const next = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)</.exec(xml)?.[1] : undefined
        token = next && unescapeXml(next)
        if (token !== undefined) {
          if (seen.has(token)) token = undefined
          else seen.add(token)
        }
      } while (token)
    },
  }
}
