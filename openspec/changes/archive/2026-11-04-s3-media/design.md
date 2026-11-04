# Design: s3-media

## Context

- Media bytes live in `media.bytes BLOB` (`apps/server/src/store/store.ts:161-175`). `insertMedia` (`:1592`) hashes and inserts in one synchronous transaction. `media(id)` and `photo(entryId)` read the BLOB with `mediaBytes` (`:1408`). `GET /api/media/:id` (`routes/media.ts`) sends it with `c.body`.
- The store is synchronous (`node:sqlite` `DatabaseSync`). Rows are deleted in its transactions: reject (`:1345`), void, and expiry (`expireMedia`, `:1392`, run on open `:1551` and on every upload `:1594`), using the `UNLINKED` predicate (`:1254`).
- `apps/server/scripts/demo-history.ts:562-577` writes media via `store.addMedia` with bytes in the input.
- Docker 29.8.2 and Compose 5.6.0 are on this machine. Podman is not.
- Apply order: drink-types → deploy-ready → **s3-media** → ui-polish → labeled-photo-copy → scale-store → postgres-store → read-queue. deploy-ready adds `serve.ts` (listen, graceful shutdown) and `GET /api/health`.

## Goals / Non-Goals

**Goals:** one S3 code path in dev (with `MEDIA_STORE=s3`) and prod; Supabase is an env-var change; no media bytes in the database; deletes are safe under sharing; S3 failures are explicit 503s; `pnpm verify` stays offline.

**Non-Goals:** presigned URLs, multipart, Range, a `files` adapter, migrating old data, multi-process locking (postgres-store), `linked_at` (scale-store).

## 0. Types and config

No `packages/shared` type changes. `@meniscus/meta` is untouched. The new server-internal types are below.

```ts
// apps/server/src/store/media/port.ts (store layer)
export interface MediaObject { body: ReadableStream<Uint8Array>; size: number }
export type MediaOp = 'put' | 'get' | 'head' | 'delete' | 'head-bucket' | 'list'
export class MediaStoreError extends Error {
  // Declared fields, not parameter properties: deploy-ready's erasableSyntaxOnly (Node type stripping).
  readonly op: MediaOp
  readonly status: number | 'timeout' | 'network'
  constructor(op: MediaOp, status: number | 'timeout' | 'network') {
    super(`media ${op} ${status}`)
    this.op = op
    this.status = status
  }
}
export interface MediaStore {
  readonly kind: 's3' | 'memory'
  /** Idempotent by content: the key is the hash, so the same key always carries the same bytes. */
  put(sha256: string, bytes: Uint8Array, mime: string): Promise<void>
  /** Streams the object. Throws MediaStoreError (404 included: a row without its object is an integrity fault, answered 503). */
  get(sha256: string): Promise<MediaObject>
  /** An absent object is not an error. */
  delete(sha256: string): Promise<void>
  /** media:sweep only: one HeadObject; undefined when the object is absent. */
  head(sha256: string): Promise<{ lastModified: number } | undefined>
  /** One HeadBucket. */
  check(): Promise<void>
  /** media:sweep only: ListObjectsV2 pages of { key, lastModified }. */
  list(): AsyncIterable<{ sha256: string; lastModified: number }>
}

// apps/server/src/store/store.ts changes
type MediaInput = { kind: SourceKind; mime: string; sha256: string; size: number; duration_ms?: number | null; served_meal?: MealKind | null }
addMedia(admissionId: number, input: MediaInput, staffId?: number | null): MediaRef | undefined
attachPhoto(entryId: number, mime: string, sha256: string, size: number): PhotoResult
media(id: number): MediaRef | undefined          // ref only; the route streams from the MediaStore
photo(entryId: number): MediaRef | undefined
hasMediaSha(sha256: string): boolean              // served by the media_sha256 index
openStore(path: string, opts?: { onMediaGone?: (shas: string[]) => void; readOnly?: boolean }): Store // readOnly: media:sweep; no expiry, no writes
```

`onMediaGone` receives, after each COMMIT, the hashes of the media rows that the transaction deleted, collected with `DELETE … RETURNING sha256`. It is called once with each distinct hash, including those from expiry on open. If the transaction rolls back, nothing is reported.

**Config** (`src/config.ts`, zod, and `.env.example`):

| Var | Rule | Default |
| --- | --- | --- |
| `MEDIA_STORE` | `s3` or `memory`; production requires `s3` (unset or `memory` fails) | `memory` unless `NODE_ENV=production`; none in production |
| `S3_ENDPOINT` | URL; required for `s3`; in production `https://`, except a loopback host (`127.0.0.1`, `localhost`, `::1`) so a local production smoke test can use the local stack | none |
| `S3_REGION` | required for `s3` | none |
| `S3_BUCKET` | | `meniscus-media` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required for `s3`; server-only, never logged | none |
| `S3_FORCE_PATH_STYLE` | `stringbool` | `true` |

`NODE_ENV` defaults to `development` (`config.ts:19`), so a test, script or spawned server that sets nothing gets `memory`. Every test that spawns the server or loads config sets its env explicitly: `MEDIA_STORE=memory` in development; in production, `MEDIA_STORE=s3` with either the loopback local stack or a fake `https://` S3 behind the injected `fetch`, whichever the test needs. A developer opts into S3 with `MEDIA_STORE=s3` in `.env` (`.env.example` shows it).

Values by environment:

| | Local (Supabase CLI) | Supabase hosted |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://127.0.0.1:54321/storage/v1/s3` | `https://<project_ref>.storage.supabase.co/storage/v1/s3` |
| `S3_REGION` | `local` | the project region shown in Storage → S3 configuration (for example `eu-west-2`) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `S3 Access Key` / `S3 Secret Key` from `supabase status` | an S3 access key pair created in Storage → S3 configuration |
| `S3_FORCE_PATH_STYLE` | `true` | `true` |

Sources: [S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication) (endpoint format, `forcePathStyle: true`, local region `local` and endpoint, and access keys being server-only), and [S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility). No `SUPABASE_*` alias is needed: the generic names map one-to-one.

## 1. Layers

| Module | Layer | What |
| --- | --- | --- |
| `src/store/media/port.ts` | store | `MediaStore`, `MediaObject`, `MediaStoreError` |
| `src/store/media/s3.ts` | store | `createS3MediaStore({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, fetch?, timeoutSignal? })`, signing with `aws4fetch` |
| `src/store/media/memory.ts` | store | `createMemoryMediaStore()`, a `Map`, with fault injection for tests |
| `src/store/media/lock.ts` | store | `withShaLock(sha, fn)`: an in-process per-hash promise chain |
| `src/store/media/contract.ts` | test helper | `mediaStoreContract(name, make)`, run against every adapter |
| `src/routes/media.ts`, `src/routes/chart.ts` | routes | PUT before insert, streamed GET, 503 mapping, gc after commit |
| `src/media-gc.ts` | server | `collectGone(store, media, log)`: the `onMediaGone` handler |
| `src/lab/media-sweep.ts`, `scripts/media-sweep.ts` | lab | `media:sweep` |
| `src/start-checks.ts` | server | new, no side effects: `startChecks(config, media, store)` (the web build check, moved from `index.ts`, then `media.check()`) |
| `src/index.ts` | server | imports `startChecks` and passes it as the `beforeListen` of deploy-ready's `startServer` |
| `supabase/config.toml`, root `package.json` `dev:s3` | repo | dev S3 |

Routes and `src/ai` never import `src/lab`. `createApp({ media = createMemoryMediaStore() })` mirrors the default `store = openStore(':memory:')`.

## 2. Decision: the dev S3 is the Supabase CLI local stack

| Option | Parity with Supabase | Moving parts | Status (Nov 2026) |
| --- | --- | --- | --- |
| **Supabase CLI** (`supabase start`) | Exact: it runs the same `storage-api` S3 layer, with the same path (`/storage/v1/s3`), region (`local`), unsupported headers and bucket limits | 3 containers (Postgres, storage-api, Kong gateway) once the unused services are off; one CLI | maintained; local S3 documented on the auth page |
| MinIO | different implementation | 1 container | community edition went source-only in Oct 2025 (no official images) and into maintenance mode in Dec 2025; reportedly archived since ([linuxiac](https://linuxiac.com/minio-ends-active-development/), [ayedo](https://ayedo.de/en/posts/minio-im-maintenance-mode/)) |
| Garage | different implementation; needs a layout, key creation and bucket steps | 1 container plus 3 setup commands | maintained, AGPL |
| SeaweedFS | different implementation | 1 container (`weed server -s3`) | maintained, Apache 2.0 |
| LocalStack | AWS S3 emulation, not Supabase | 1 container plus an account | since 2026.03.0 it needs an auth token, even on the free Hobby tier ([LocalStack](https://blog.localstack.cloud/localstack-for-aws-release-2026-03-0/)) |

We choose the Supabase CLI. Supabase's S3 has quirks. It rejects SSE headers on PutObject and Content-MD5, and has no versioning ([compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)). The CLI reproduces those, while a generic S3 would hide them until production. It also gives postgres-store a local Supabase Postgres from the same `supabase start`. SeaweedFS is the fallback if the CLI is unavailable: the adapter is generic, so only the env vars change.

**Setup** (committed `supabase/config.toml`, [config reference](https://supabase.com/docs/guides/local-development/cli/config)):

```toml
project_id = "meniscus"

[storage]
enabled = true
file_size_limit = "26MiB"

[storage.buckets.meniscus-media]
public = false
file_size_limit = "26MiB"
allowed_mime_types = ["image/jpeg", "image/png", "image/webp", "image/gif", "audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"]

[studio]
enabled = false
[auth]
enabled = false
[realtime]
enabled = false
[edge_runtime]
enabled = false
[local_smtp]
enabled = false
[analytics]
enabled = false
```

Root `package.json`:

```json
"dev:s3": "pnpm dlx supabase@3.0.0 start && pnpm dlx supabase@3.0.0 status",
"dev:s3:stop": "pnpm dlx supabase@3.0.0 stop"
```

`supabase status` prints `S3 Storage URL`, `S3 Access Key`, `S3 Secret Key` and `S3 Region`. The user pastes those four values into `.env` as `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_REGION`. No agent or script reads or writes `.env`. The CLI is version 3.0.0 (`pnpm view supabase version`), run through `pnpm dlx`, so it adds no lockfile entry. Task 1.1 confirms that dlx runs its binary install. If it does not, the fallback is the Supabase-documented global install (`brew install supabase/tap/supabase` or the release binary), and the script calls `supabase` directly. Production buckets are created by the user in the dashboard, private, with the same size and MIME limits.

## 3. Decision: `aws4fetch` as the S3 client

| | `aws4fetch` 1.0.20 | `@aws-sdk/client-s3` 3.1161.0 |
| --- | --- | --- |
| Install size | one file, no dependencies | ~100 transitive `@aws-sdk/*`/`@smithy/*` packages |
| Tests | injected `fetch`: an offline fake S3 records every request, the same pattern as `createMetaClient` | a custom `requestHandler` or a mock library |
| Retries | `AwsClient.fetch` retries up to 10 times on 5xx and 429 by default, through the global `fetch`; signing alone (`aws.sign`) sends nothing, so we send once ourselves | `maxAttempts: 3` by default; must be set to 1 |
| Checksums | none unless we add them | default CRC32 headers since v3.729 (`requestChecksumCalculation: WHEN_SUPPORTED`); must be set to `WHEN_REQUIRED` for S3-compatibles |
| Streaming GET | `Response.body` is the web stream Hono returns | `Body.transformToWebStream()` |
| Supabase docs | SigV4 is the documented requirement ("expects requests to be made using AWS Signature Version 4") | used in the examples |

We choose `aws4fetch` as a **signer only**. Each operation builds its request, signs it with `aws.sign(url, init)` (or `new AwsV4Signer({ …, url, method, headers, body }).sign()`), and sends the signed `Request` once with the injected `fetch` (default `globalThis.fetch`). `aws.fetch` is never called: in 1.0.20 it retries up to 10 times on 5xx and 429 by default and always uses the global `fetch`, which would break the no-retry rule and bypass the fake S3. A contract test asserts that a 503 and a 429 each make exactly 1 request. The project's Meta client is fetch-based with an injected `fetch`, and postgres-store already planned this signer. The offline fake S3 lets the s3 adapter itself run in `pnpm verify`. The operations are few: PutObject, GetObject, HeadObject (sweep only), DeleteObject, HeadBucket and ListObjectsV2. None needs an XML body except ListObjectsV2's response, whose `<Key>` and `<LastModified>` values (hex keys, ISO dates) are read with a fixed pattern in the sweep only. `AwsClient` is built with `service: 's3'` and `region: S3_REGION` set explicitly, because custom endpoints do not reveal them. Every request has `timeoutSignal(10_000)`, an injectable factory defaulting to `AbortSignal.timeout`; tests pass one that returns a signal they abort, because node:test's fake timers do not fake `AbortSignal.timeout`, and `x-amz-content-sha256` is set to the hash we already computed, so the payload is signed. **Risk:** `aws4fetch` releases rarely. If it breaks, `@aws-sdk/client-s3` replaces it behind the same port with `maxAttempts: 1` and `WHEN_REQUIRED` checksums.

Addressing: path-style is `<endpoint>/<bucket>/<sha[0:2]>/<sha>`. With `S3_FORCE_PATH_STYLE=false`, the bucket becomes a subdomain of the endpoint host (AWS virtual-hosted style).

## 4. Upload, serve, delete

**Upload** (`POST /api/admissions/:id/media`, `POST /api/entries/:id/photo`):
1. zod validation and sniffing as today. A refused file reaches no S3 request.
2. The chart checks, before any S3 request: the admission exists (else 404 `not_found`); for `POST /api/entries/:id/photo`, the entry exists (404 `not_found`), is pending (409 `not_pending`) and links no media (409 `photo_exists`). A refused upload makes 0 S3 requests ("Refused by the chart before the PUT").
3. `sha = sha256Hex(bytes)` (`src/hash.ts`).
4. `withShaLock(sha, async () => { await media.put(sha, bytes, mime); return store.addMedia(…, { sha256: sha, size }) })`. A `MediaStoreError` becomes 503 `media_unavailable`, and no row is stored. The insert re-checks the same rules in its transaction. If it still refuses (a request that changed the chart between step 2 and the insert), the route answers that refusal and the object is left for `collectGone([sha])`, which deletes it unless another row names it.
5. The hashes that `onMediaGone` reports from the insert's expiry are collected (below) before the response.

Single PutObject (≤ 25 MB of voice, under Supabase's 50 MB Free limit). No SSE header, since Supabase refuses one; no Content-MD5; no `If-None-Match` (not documented for PutObject). Idempotence comes from content addressing.

**Serve** (`GET /api/media/:id`, `GET /api/entries/:id/photo`): `ref = store.media(id)`, else 404. Then `obj = await media.get(ref.sha256)` and `new Response(obj.body, { headers: { 'Content-Type': ref.mime, 'Content-Length': String(ref.size), 'Cache-Control': 'no-store' } })`. The body streams from S3 to the client, and only the headers wait. A `MediaStoreError` before the headers becomes 503. A stream that fails midway aborts the connection: the headers are sent, so no status can follow. Presigned URLs are rejected for three reasons. They would expose a bearer link to patient media that works without our session check. They would put the bucket host in the browser's CSP and network log. And an issued URL keeps working until it expires, even after the entry is rejected.

**Delete** (`collectGone`): the `onMediaGone(shas)` handler records the hashes in a per-request list (an `AsyncLocalStorage` set by a middleware). After the route's handler, the middleware runs this for each hash: `withShaLock(sha, async () => { if (!store.hasMediaSha(sha)) await media.delete(sha) })`. That is one DELETE per object, awaited before the response is sent, sequentially (≤ 3 per request in practice: a voided meal's tray, served and labeled photos). A failure is logged (`media delete 503 12ms media=41`) and swallowed: the record's change already committed, and the object waits for `media:sweep`. Hashes reported on open, from expiry before listening, are deleted in `beforeListen` after the bucket check.

**The race** ("Same bytes uploaded during a delete"). Upload and delete hold the same per-hash lock: the upload across PUT and INSERT, the delete across the row check and DELETE. Either the delete runs first and the upload's PUT then recreates the object, or the upload commits first and the delete sees the row and keeps the object. This holds within one process. The deployment is one Render instance. Overlap during a rolling deploy is not covered, and postgres-store replaces the lock with `pg_advisory_xact_lock`.

**Orphans** come from a crash between PUT and INSERT, or a failed DELETE. `media:sweep` runs in its own process beside the live server, so the in-process lock does not cover it:
- It opens the store with `openStore(path, { readOnly: true })`: no expiry run and no writes, so it never deletes rows or reports hashes itself.
- It lists the bucket (ListObjectsV2 pages) and counts the objects whose hash no row has (`hasMediaSha`) and whose `LastModified` is older than the 1 h grace. The dry run stops there.
- With `--delete`, just before each candidate's DELETE it re-checks `hasMediaSha` and re-reads the object with one HeadObject. It deletes only when there is still no row and `LastModified` is still older than 1 h. A re-upload of the same bytes during the sweep rewrites the object (new `LastModified`) and adds a row, so either re-check keeps it ("Re-uploaded during the sweep: not deleted"). An absent object (HEAD 404) is skipped.
- **Residual race.** Between the HEAD and the DELETE, a re-upload of the same bytes could rewrite the object and commit its row, and the DELETE would then remove a named object. A conditional DELETE (`If-Unmodified-Since` or `If-Match` with the HEAD's value) would close it, but Supabase's [S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility) table lists conditional headers only for HeadObject (and GetObject), not for DeleteObject, so the sweep sends none. The window is the HEAD's round trip, and only bytes that were orphaned for over an hour and are then uploaded again at that moment are exposed. If it happens, the row's reads answer 503 `media_unavailable` until the photo is captured again. Revisit when Supabase documents conditional deletes.
- That is 1 HEAD + 1 DELETE per orphan, sequential, never retried. A failed HEAD or DELETE is counted, logged as `media head 503 12ms`, and left for the next run.

The grace keeps an upload that is between PUT and INSERT safe. It is user-run, not run on start: a listing grows with the bucket.

## 5. Start, shutdown, health (overlap with deploy-ready)

- **Start** (`index.ts`, over deploy-ready's `startServer({ fetch, store, host, port, graceMs, beforeListen })`): `parseConfig` → open the store → `startServer` with a `beforeListen` that runs the web build check (production), then `await media.check()` (1 HeadBucket), then deletes the hashes from expiry on open → listen. `src/start-checks.ts` exports `startChecks(config, media, store)`, which builds that `beforeListen`; it has no side effects, so tests import it without spawning (importing `index.ts` would open the store and listen). Spawn tests stay in `src/process.test.ts`, with every `S3_*` variable set explicitly. A rejection means nothing listens and `index.ts` exits 1. A failure prints `media store: bucket meniscus-media not found at 127.0.0.1:54321` (or `keys refused` or `unreachable`), plus ` (run pnpm dev:s3)` outside production, and exits 1. The endpoint host is printed, never the path's credentials or the keys.
- **Shutdown**: deletes run inside requests, so deploy-ready's grace (`SHUTDOWN_GRACE_MS`) covers them, and nothing else is pending. No client to close (fetch).
- **Health**: `GET /api/health` stays S3-free (deploy-ready's "reads no store"), so an S3 outage does not make Render restart the instance in a loop. Media requests show the outage as 503s.

## 6. Schema (fresh-schema, version 7 → 8)

The `media` table loses `bytes`, and `sha256` becomes `TEXT NOT NULL`. `CREATE INDEX media_sha256 ON media (sha256)` is added. `STORE_SCHEMA_VERSION` goes from 7 (drink-types) to 8; stop if the live value is not 7. There is no upgrade step: an older store fails to open with the existing "Store schema version" message, and the user deletes `DATA_DIR` and runs `pnpm --filter @meniscus/server demo`. **No migration of existing local media**, because the user deleted the databases. `demo-history.ts` then writes every photo and recording through `media.put` plus `store.addMedia` under `withShaLock`, against whatever `MEDIA_STORE` is configured.

## 7. Privacy

- The bucket is private. Access keys bypass RLS and stay on the server ([auth](https://supabase.com/docs/guides/storage/s3/authentication)). The web never sees the endpoint or a signed URL.
- Logs carry the operation, status or error name, duration and media id (`media put 403 41ms media=88`). They never carry a key, `sha256`, body, access key id, secret, `Authorization` or `X-Amz-Signature`. `MediaStoreError` messages carry only `op` and `status`. An error with the request inside, from `aws4fetch` or fetch, is never logged raw.
- Encryption: Supabase refuses SSE headers, so we send none and rely on the provider's at-rest encryption. Its platform-security page documents TLS 1.2+ in transit but not at-rest encryption for Storage. Confirm at-rest encryption, and the HIPAA terms if real patient data is ever used, with Supabase before production. Recorded in deployment docs (§10).

## 8. Tests (offline)

- **Contract suite** (`media/contract.ts`): put/get round trip with size; the same key twice gives one object; get of an absent key throws `MediaStoreError`; delete of an absent key resolves; list returns hashes and dates. It runs for `memory` always, and for `s3` against an **in-process fake S3** (a `fetch` that implements the five operations over a `Map` and records requests and their headers, checking that `x-amz-content-sha256` matches the body and that `Authorization` is SigV4 with region and service `s3`). It runs against a **real endpoint** only when `S3_TEST_ENDPOINT` (plus `S3_TEST_REGION`, `S3_TEST_BUCKET`, `S3_TEST_ACCESS_KEY_ID` and `S3_TEST_SECRET_ACCESS_KEY`) is set in the shell; otherwise that run is skipped with `t.skip`. `tsx --test` loads no `.env`, so `pnpm verify` never touches the network.
- Route tests use `createApp({ store, media })` with the memory store or the fake-S3 store for request counts, status faults (503, 429, 500, 403), a timeout (a fake `fetch` that never resolves and an injected `timeoutSignal` the test aborts, since node:test's fake timers do not fake `AbortSignal.timeout`), and a deferred PUT for the race.
- Config tests call `parseConfig` with literal env objects.
- The start check is tested through deploy-ready's `startServer({ fetch, store, host: '127.0.0.1', port: 0, graceMs, beforeListen: startChecks(config, media, store) })` with the fake S3, not by spawning: a rejection rejects `startServer`, and a connect to its port is refused. Config objects are built with explicit `NODE_ENV` and `MEDIA_STORE`.

## 9. Risks / Trade-offs

- **Dev parity needs Docker and the CLI** (`MEDIA_STORE=s3` in `.env`). That is accepted for parity. Tests do not need them (`memory` or the fake). Unset, development uses `memory`, which works for quick runs, but media is gone after a restart while the rows remain, so reads answer 503 `media_unavailable`. A startup warning says so.
- **Single-process lock.** It is correct for one instance and replaced by postgres-store.
- **One more request on rejects and voids** (S3 DELETE latency, ~10–50 ms). The alternative was a background queue, which spec tests could not pin down and which could lose deletes on shutdown.
- **`aws4fetch` maintenance:** see §3.
- **Supabase rate limits and the 50 MB Free file limit** are above our 25 MB cap.

## 10. Effects on later changes and docs (for their owners; not edited here)

- **postgres-store**: drop its media adapter plan. That means `MEDIA_STORE=files|supabase`, the `SUPABASE_S3_*` vars, `SUPABASE_MEDIA_BUCKET`, the `files` adapter and its `supabase-s3.ts`, and the "Media in Supabase Storage", "Storage objects go with their last reference" and "Media store settings" requirements. `server/storage` exists after this change, so its delta drops `## Purpose` and ADDs only its Postgres requirements. Its `MediaStore` port becomes this one, made async-store-aware: the per-hash lock becomes `pg_advisory_xact_lock`. Its `media:sweep` task is done here. `db:import` copies no bytes (media is already in S3), so it only checks the hashes with `media.get`. It accepts the final SQLite version, renumbered below.
- **scale-store**: drop "Media files on disk" and "Media files go with their last reference", `media-files.ts` (tasks 5.1–5.3), 5.5's `bytes` drop and orphan sweep, and 5.6's README files text. Keep `linked_at`/`media_unlinked` (5.4): expiry's delete must keep `RETURNING sha256` so `onMediaGone` still fires. Its metrics' media size becomes `SUM(media.size)`. Its §4.1 "an object store (a dependency…)" rejection is obsolete.
- **Schema numbers**: s3-media 7 → 8. labeled-photo-copy bumps to 9. scale-store goes from 9 to 10, and postgres-store's importer accepts 10. read-queue's "stays 8" becomes "stays 10".
- **labeled-photo-copy**: the labeled copy is its own media row with its own hash, so it gets its own object and is deleted by the same rule. It needs no change.
- **docs/deployment.md**:
  - Render env lists the `S3_*` vars with the Supabase values (§0);
  - "Create the private bucket `meniscus-media` (26 MiB limit, the 9 MIME types) and an S3 access key pair in Storage → S3 configuration";
  - no persistent disk is needed for media;
  - the start check's failure messages;
  - `media:sweep` as a periodic manual task;
  - the at-rest encryption and HIPAA check (§7).

## 11. Photo cap: 8 MB (added during apply)

- **Why.** A phone photo shrunk to ≤ 1280 px as JPEG q 0.82 is a few hundred KB. The old 15 MB cap only let unshrunk originals through, which cost bucket space, upload time on ward Wi-Fi, and model-request bytes. 8 MiB leaves room for a PNG or a detailed photo. **BREAKING** for any client that sent photos between 8 and 15 MB.
- **One constant.** `PHOTO_MAX_BYTES = 8 * 1024 * 1024` and `PHOTO_MAX_LABEL = '8 MB'` in `packages/shared`. `MEDIA_TYPES.photo.maxBytes` and the server's `MAX_IMAGE` (`routes/validate.ts`) use them, so `POST /api/admissions/:id/media`, `POST /api/entries/:id/photo`, `POST /api/ai/read` and `POST /api/ai/meal` all refuse a larger photo with 400 `invalid_request` (`image must be 1 B – 8 MB`) before any model or S3 request. Voice stays at 25 MB, the body limit at 26 MB, and the bucket's limit at 26 MiB (voice needs it; photos are capped by the server).
- **Web.** `shrinkPhoto` encodes at q 0.82. If that is over the cap, it re-encodes once at q 0.6 (`PHOTO_QUALITIES`, never more). If that is still over, it throws `PhotoTooLargeError` before any request. `encodeWithinCap(encode)` is the pure part, tested with a fake encoder. Every picker shows `photoTooLargeMessage()` (`Photo too large · max 8 MB. Retake closer or in better light.`), and `photoErrorText` maps a server 413 or 400 `invalid_request` on a photo upload or read to the same message. Saves (meal, bag) keep their generic error text, because a 400 there can come from other fields.

## 12. Tray read with a served photo: 1 GET (added during apply)

Before this change, `POST /api/ai/meal` loaded the bed's newest served photo from the `media.bytes` column. Now it reads it from the media store with **1 GET**, after the validation and the bed's lookup and **before any model request**. A failed or timed-out GET is answered 503 `media_unavailable` with **0 model requests** (charting/media "Media store unavailable", scenario "Served tray photo unreadable"). Treating it as "no served photo" (3 model requests and no comparison) was rejected: it would silently change the read's request count and its result. The GET is buffered (the comparison needs the whole image), not streamed.
