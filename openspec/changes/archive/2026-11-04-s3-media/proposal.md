# Proposal: s3-media

## Why

Media bytes (photos, labeled copies, voice recordings) live in `media.bytes`, a BLOB column of the SQLite file under `DATA_DIR`. The hosting plan is Render with Supabase. Render's disk is per instance and the BLOBs make the store large and slow (scale-store measured 4.2 GB in-row against 46 MB without). Supabase Storage speaks the S3 protocol. If every environment, dev included, keeps media in an S3 bucket through one code path, moving to Supabase means changing env vars only: no code switch and no second adapter to test for the first time in production.

## What Changes

- **Media in an S3 bucket** (`charting/media`).
  - Each distinct content is one object `<sha256[0:2]>/<sha256>` in a private bucket. It is written before its media row commits, and the row keeps only metadata, so the `media.bytes` column is dropped.
  - Identical bytes share one object (idempotent PUT). Each upload still gets its own media id.
  - The web never contacts the bucket. `GET /api/media/:id` and `GET /api/entries/:id/photo` stay server-proxied with `no-store`. The bytes are streamed from the bucket, not buffered, and sent with a `Content-Length`.
- **Deleted with the last row** (`charting/media`). After a reject, void or expiry commits, the server deletes each object whose `sha256` no media row has any more. That is one DELETE per object, before the request answers. A per-hash lock in the process makes a racing upload of the same bytes safe. If a delete fails, the record's change stands and the object waits for `media:sweep`.
- **Bucket down** (`charting/media`). An upload or read whose one S3 request fails, or gets no answer within 10 s, is answered with 503 `media_unavailable`. A failed upload stores no row. S3 requests are never retried: `aws4fetch` only signs, and the server sends each request once (its `AwsClient.fetch`, which retries, is never used). An upload the chart refuses (404, 409) makes no S3 request.
- **Settings, start check, sweep** (new `server/storage`).
  - `MEDIA_STORE` is `s3` or `memory`. Outside production the default is `memory`; production requires `MEDIA_STORE=s3`, and `memory` is refused there.
  - The generic settings are `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` (default `meniscus-media`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE` (default true). Production requires an `https://` endpoint, except a loopback host (`127.0.0.1`, `localhost`, `::1`), so a local production smoke test can use the local stack.
  - Before listening, after deploy-ready's web build check, the server sends one HeadBucket (in `startServer`'s `beforeListen`) and exits 1 with a clear cause if it fails.
  - `media:sweep` opens the store read-only, lists the bucket and deletes, when asked, the objects that no row names and that are over 1 h old. Just before each delete it re-checks the row and re-reads the object's age (1 HEAD + 1 DELETE per orphan, never retried), so an object re-uploaded during the sweep is kept.
  - Log lines never carry keys, hashes, bytes or credentials.
- **Dev S3 = the Supabase CLI local stack.** A committed `supabase/config.toml` declares the private `meniscus-media` bucket and turns off the services Meniscus does not use. `pnpm dev:s3` starts the stack and prints the `S3_*` lines to paste into `.env`. Its endpoint is `http://127.0.0.1:54321/storage/v1/s3`, region `local`.
- **BREAKING: photo cap 8 MB** (`charting/media`, `capture/photo-reading`, `web/capture`). Photos are capped at 8 MiB (`PHOTO_MAX_BYTES` in `packages/shared`), down from 15 MB, on upload and on read; voice stays at 25 MB and the body limit at 26 MB. The web shrinks a photo (≤ 1280 px, JPEG q 0.82), re-encodes it once at q 0.6 if it is still over the cap, and otherwise shows `Photo too large · max 8 MB. Retake closer or in better light.` without sending anything; a server 413 or 400 `invalid_request` on a photo upload or read shows the same message.
- **No migration.** Existing local data is not moved. The schema goes from 7 to 8 (`media` loses `bytes`, `sha256` becomes `NOT NULL`, and the `media_sha256` index is added). An older store fails to open, as the fresh-schema rule says. Delete `DATA_DIR` and re-seed with `scripts/demo-history.ts`, which now writes its media through the media store.
- **Dependency:** `aws4fetch` (1.0.20, no dependencies), the one S3 client the request approved. The apply step installs it.

Out of scope:
- presigned or public URLs;
- multipart upload (the largest media is 25 MB);
- HTTP Range requests on media;
- a `files` adapter;
- moving media from an older store;
- Postgres (postgres-store);
- `media.linked_at` (scale-store);

## Upstream model requests

None. Every user action keeps its count: photo read 3 (or 1 Spark-only), text note 1, voice note 2, tray photo 3 (5 with a served photo, or 1). The S3 requests are not model requests: an upload makes 1 PUT, a read 1 GET, a tray read with a served photo 1 GET for that photo before any model request (a failed one is 503 with 0 model requests), and a delete 1 DELETE per gone object; start makes 1 HeadBucket; `media:sweep --delete` makes 1 HEAD + 1 DELETE per orphan after its listing.

## Capabilities

### New Capabilities
- `server/storage`: where the server keeps media, and how it is configured, checked at start and swept.

### Modified Capabilities
- `charting/media`:
  - ADDED **Media kept in an object store**, **Objects go with their last media row**, **Media store unavailable** and **Media store logs nothing identifying**;
  - MODIFIED **Serve media**, which adds `Content-Length`;
  - MODIFIED **Upload media**: photos up to 8 MB (was 15 MB). **BREAKING** for clients that sent larger photos.
- `capture/photo-reading`: MODIFIED **Upload validation**: `POST /api/ai/read` refuses an image over 8 MB with 400 (was 15 MB). **BREAKING**.
- `web/capture`: MODIFIED **Photos are shrunk before upload**: a photo over 8 MB after one lower-quality re-encode is not sent and shows `Photo too large · max 8 MB. Retake closer or in better light.`; a server 413 or 400 on a photo upload or read shows the same message.

## Impact

- `packages/shared`: `PHOTO_MAX_BYTES` (8 MiB) and `PHOTO_MAX_LABEL` (`'8 MB'`), which `MEDIA_TYPES.photo.maxBytes`, the server's `MAX_IMAGE` and the web's `shrinkPhoto` use. No type changes. The new error body `{"error":"media_unavailable"}` (503) is a string code, like the others. `MediaRef` is unchanged.
- `apps/server`:
  - new `src/store/media/{port,s3,memory}.ts`, `src/store/media/lock.ts` and `src/lab/media-sweep.ts`;
  - `src/store/store.ts` (schema 8: no `bytes`, `sha256 NOT NULL`, `media_sha256`, metadata-only `addMedia`/`attachPhoto`, deleted hashes reported after commit);
  - `src/routes/media.ts` and `routes/chart.ts` (PUT before insert, streamed GET, 503 mapping);
  - `src/config.ts`, `src/index.ts` (HeadBucket before `serve`), `src/app.ts` (`media` dependency);
  - `scripts/demo-history.ts` and `src/lab/fake-server.ts`;
  - a new `media:sweep` script.
- `apps/web`: `lib/photo.ts` (the cap in `shrinkPhoto`, `photoTooLargeMessage`, `photoErrorText`) and the photo pickers (meal form, bag photo button, served tray, round, bed capture). A 503 `media_unavailable` on upload shows the capture screen's existing upload error.
- Repo root: `supabase/config.toml`, a `dev:s3` script, `.env.example` and README "Run it".
- Dependency: `aws4fetch` in `@meniscus/server`.
- Later changes: postgres-store's media plan is taken over here, scale-store's media files are dropped, and the schema numbers move by one (design §10).
