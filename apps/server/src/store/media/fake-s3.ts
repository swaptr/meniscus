/**
 * An in-process S3 for tests: a `fetch` that implements PutObject, GetObject, HeadObject, DeleteObject, HeadBucket and
 * ListObjectsV2 (path-style) over a Map, records every request, and refuses one whose SigV4 signature or
 * `x-amz-content-sha256` does not match. Never touches the network.
 */
import { createHash } from 'node:crypto'
import { AwsV4Signer } from 'aws4fetch'

export const FAKE_S3 = {
  endpoint: 'https://s3.test/storage/v1/s3',
  region: 'local',
  bucket: 'meniscus-media',
  accessKeyId: 'ak-test-77bb',
  secretAccessKey: 'sk-test-55aa',
} as const

export interface FakeObject {
  bytes: Uint8Array
  mime: string
  lastModified: number
}

export interface FakeRequest {
  method: string
  /** The object key, or null for a bucket request. */
  key: string | null
  query: URLSearchParams
  headers: Headers
}

export interface FakeS3 {
  fetch: (req: Request) => Promise<Response>
  /** By key (`<sha[0:2]>/<sha>`). */
  objects: Map<string, FakeObject>
  requests: FakeRequest[]
  /**
   * Answers a request instead of the store when it returns a response (or a promise of one). A promise that resolves
   * undefined defers the request, which the store then answers (a slow PUT).
   */
  intercept?: ((req: Request, r: FakeRequest) => Response | Promise<Response | undefined> | undefined) | undefined
  /** Requests of this method (and, for objects, not bucket requests unless `bucket`). */
  count(method: string): number
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const xml = (status: number, code: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`, {
    status,
    headers: { 'content-type': 'application/xml' },
  })

export function createFakeS3({
  endpoint = FAKE_S3.endpoint,
  region = FAKE_S3.region,
  bucket = FAKE_S3.bucket,
  accessKeyId = FAKE_S3.accessKeyId,
  secretAccessKey = FAKE_S3.secretAccessKey,
  now = Date.now,
  pageSize = 1000,
}: {
  endpoint?: string
  region?: string
  bucket?: string
  accessKeyId?: string
  secretAccessKey?: string
  now?: () => number
  pageSize?: number
} = {}): FakeS3 {
  const base = new URL(endpoint)
  const prefix = `${base.pathname.replace(/\/+$/, '')}/`
  const objects = new Map<string, FakeObject>()
  const requests: FakeRequest[] = []

  /** Re-signs the request as received and compares: a wrong key, region, service or payload hash is refused. */
  const verify = async (req: Request, body: Uint8Array) => {
    const auth = req.headers.get('authorization') ?? ''
    const m =
      /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=[0-9a-f]{64}$/.exec(
        auth,
      )
    if (!m || m[1] !== accessKeyId || m[3] !== region || m[4] !== 's3') return false
    if (req.headers.get('x-amz-content-sha256') !== sha(body)) return false
    const signed = m[5]!.split(';')
    const headers = new Headers()
    for (const h of signed) if (h !== 'host') headers.set(h, req.headers.get(h) ?? '')
    const expected = await new AwsV4Signer({
      method: req.method,
      url: req.url,
      headers,
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region,
      datetime: req.headers.get('x-amz-date') ?? '',
    }).authHeader()
    return expected === auth
  }

  const answer = async (req: Request, r: FakeRequest, body: Uint8Array): Promise<Response> => {
    if (!(await verify(req, body))) return xml(403, 'SignatureDoesNotMatch')
    if (r.key === null) {
      if (req.method === 'HEAD') return new Response(null, { status: 200 })
      if (req.method === 'GET' && r.query.get('list-type') === '2') {
        const keys = [...objects.keys()].sort()
        const after = r.query.get('continuation-token')
        const from = after ? keys.findIndex((k) => k > after) : 0
        const page = from < 0 ? [] : keys.slice(from, from + pageSize)
        const truncated = from >= 0 && from + pageSize < keys.length
        const contents = page
          .map((k) => {
            const o = objects.get(k)!
            return `<Contents><Key>${k}</Key><LastModified>${new Date(o.lastModified).toISOString()}</LastModified><Size>${o.bytes.byteLength}</Size></Contents>`
          })
          .join('')
        const next = truncated ? `<NextContinuationToken>${page.at(-1)}</NextContinuationToken>` : ''
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${next}${contents}</ListBucketResult>`,
          { status: 200, headers: { 'content-type': 'application/xml' } },
        )
      }
      return xml(400, 'InvalidRequest')
    }
    const o = objects.get(r.key)
    switch (req.method) {
      case 'PUT':
        if (req.headers.has('x-amz-server-side-encryption') || req.headers.has('content-md5')) return xml(400, 'NotImplemented')
        objects.set(r.key, { bytes: body, mime: req.headers.get('content-type') ?? 'application/octet-stream', lastModified: now() })
        return new Response(null, { status: 200, headers: { etag: `"${sha(body).slice(0, 32)}"` } })
      case 'GET':
      case 'HEAD':
        if (!o) return req.method === 'GET' ? xml(404, 'NoSuchKey') : new Response(null, { status: 404 })
        return new Response(req.method === 'GET' ? o.bytes.slice() : null, {
          status: 200,
          headers: {
            'content-type': o.mime,
            'content-length': String(o.bytes.byteLength),
            'last-modified': new Date(o.lastModified).toUTCString(),
          },
        })
      case 'DELETE':
        objects.delete(r.key)
        return new Response(null, { status: 204 })
      default:
        return xml(405, 'MethodNotAllowed')
    }
  }

  const fake: FakeS3 = {
    objects,
    requests,
    count: (method) => requests.filter((r) => r.method === method && r.key !== null).length,
    fetch: async (req) => {
      const u = new URL(req.url)
      if (u.origin !== base.origin || !u.pathname.startsWith(prefix)) throw new TypeError('fetch failed')
      const [b, ...rest] = u.pathname.slice(prefix.length).split('/')
      const r: FakeRequest = { method: req.method, key: rest.length ? rest.join('/') : null, query: u.searchParams, headers: req.headers }
      requests.push(r)
      if (req.signal.aborted) throw req.signal.reason
      const body = new Uint8Array(await req.arrayBuffer())
      const intercepted = fake.intercept?.(req, r)
      if (intercepted) {
        // Like fetch: an aborted request rejects even while the store has not answered.
        const res = await Promise.race([
          intercepted,
          new Promise<never>((_, reject) =>
            req.signal.addEventListener(
              'abort',
              () => reject(req.signal.reason instanceof Error ? req.signal.reason : new Error('aborted')),
              {
                once: true,
              },
            ),
          ),
        ])
        if (res) return res
      }
      if (b !== bucket) return r.key === null && req.method === 'HEAD' ? new Response(null, { status: 404 }) : xml(404, 'NoSuchBucket')
      return answer(req, r, body)
    },
  }
  return fake
}
