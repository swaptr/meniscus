# Spec Delta

## Purpose
Where the server keeps chart media and how that store is configured, checked at start and swept: an S3-compatible bucket in every environment, development included, and an in-memory store for tests.

## ADDED Requirements

### Requirement: Media store settings
Loading configuration SHALL fail with an error that names each missing variable and `pnpm dev:s3` when `MEDIA_STORE=s3` and any of `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is unset. `MEDIA_STORE` is `s3` or `memory`, defaulting to `memory` unless `NODE_ENV=production`. `S3_BUCKET` defaults to `meniscus-media`, and `S3_FORCE_PATH_STYLE` to true. It makes no model request.

#### Scenario: Missing keys
- **WHEN** configuration is loaded with `NODE_ENV=development`, `MEDIA_STORE=s3`, `S3_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3` and `S3_REGION=local`, and no S3 keys
- **THEN** loading fails with an error naming `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `pnpm dev:s3`

#### Scenario: S3 defaults
- **WHEN** configuration is loaded with `NODE_ENV=development`, `MEDIA_STORE=s3`, `S3_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3`, `S3_REGION=local` and both keys, and no `S3_BUCKET` or `S3_FORCE_PATH_STYLE`
- **THEN** the media store is `s3` with bucket `meniscus-media` and path-style addressing

#### Scenario: Memory outside production
- **WHEN** configuration is loaded with no `MEDIA_STORE` or `S3_*` variable, once with `NODE_ENV=test` and once with no `NODE_ENV` (development)
- **THEN** both loads succeed and the media store is `memory`

### Requirement: Production media store
With `NODE_ENV=production`, loading configuration SHALL fail with an error naming the variable when `MEDIA_STORE` is not `s3` (unset or `memory`), or when `S3_ENDPOINT` is not an `https://` URL and its host is not a loopback host (`127.0.0.1`, `localhost` or `::1`). It makes no model request.

#### Scenario: Memory in production
- **WHEN** configuration is loaded with `NODE_ENV=production` and `MEDIA_STORE=memory`, and separately with `NODE_ENV=production` and no `MEDIA_STORE`
- **THEN** both loads fail with an error naming `MEDIA_STORE`

#### Scenario: Plain HTTP in production
- **WHEN** configuration is loaded with `NODE_ENV=production`, `MEDIA_STORE=s3`, all S3 settings, and `S3_ENDPOINT=http://abcdefghij.storage.supabase.co/storage/v1/s3`
- **THEN** loading fails with an error naming `S3_ENDPOINT`

#### Scenario: Supabase endpoint
- **WHEN** configuration is loaded with `NODE_ENV=production`, `MEDIA_STORE=s3`, `S3_ENDPOINT=https://abcdefghij.storage.supabase.co/storage/v1/s3`, `S3_REGION=eu-west-2` and both keys
- **THEN** loading succeeds with the media store `s3`, bucket `meniscus-media` and path-style addressing

#### Scenario: Local stack in a production smoke test
- **WHEN** configuration is loaded with `NODE_ENV=production`, `MEDIA_STORE=s3`, `S3_REGION=local`, both keys, and `S3_ENDPOINT` set in turn to `http://127.0.0.1:54321/storage/v1/s3`, `http://localhost:54321/storage/v1/s3` and `http://[::1]:54321/storage/v1/s3`
- **THEN** all three loads succeed with the media store `s3`
- **AND** with `S3_ENDPOINT=http://10.0.0.5:54321/storage/v1/s3` loading fails with an error naming `S3_ENDPOINT`

### Requirement: Bucket checked at start
With `MEDIA_STORE=s3`, the server SHALL send one request checking that `S3_BUCKET` exists and accepts its keys before it listens, after the web build check. On failure, it exits with status 1 and does not listen. The message names the bucket, the endpoint's host and the cause: the bucket is missing, the keys are refused, or the endpoint is unreachable. It never names the keys. It makes no model request.

#### Scenario: Bucket present
- **WHEN** the server starts and the object store answers the bucket check with HTTP 200
- **THEN** the server listens, and the object store received exactly one request before it did

#### Scenario: Missing bucket
- **WHEN** the server starts and the object store answers the bucket check for `meniscus-media` at `127.0.0.1:54321` with HTTP 404
- **THEN** the process exits with status 1, its message names `meniscus-media`, `127.0.0.1:54321` and `not found`, and the port is not listening

#### Scenario: Refused keys
- **WHEN** the server starts with `S3_SECRET_ACCESS_KEY=sk-test-55aa` and the object store answers the bucket check with HTTP 403
- **THEN** the process exits with status 1 with a message naming `keys refused`
- **AND** no output contains `sk-test-55aa`

#### Scenario: Unreachable endpoint
- **WHEN** the server starts with `S3_ENDPOINT=http://127.0.0.1:9/storage/v1/s3`, where nothing listens
- **THEN** the process exits with status 1 with a message naming `127.0.0.1:9` and `unreachable`, and the upstream model API received no request

### Requirement: Orphaned objects swept
`pnpm --filter @meniscus/server media:sweep` SHALL open the store read-only without running expiry, list the bucket, and report the objects no media row names that are over one hour old. With `--delete`, just before each delete it re-checks that no row names the object and re-reads its age, and deletes it only if both still hold: one HEAD and one DELETE per orphan, never retried. It prints counts only, never keys. It makes no model request.

#### Scenario: Dry run
- **WHEN** the bucket holds 3 objects that rows name and 2 that none names, uploaded 2 hours ago, and `media:sweep` runs
- **THEN** it prints `orphans 2 of 5` and the bucket still holds 5 objects

#### Scenario: Delete
- **WHEN** the same bucket is swept with `--delete`
- **THEN** it prints `deleted 2 of 5`, the bucket holds the 3 named objects, and the object store received exactly 2 HEAD and 2 delete requests

#### Scenario: Recent object kept
- **WHEN** an object that no row names was written 5 minutes ago, and `media:sweep --delete` runs
- **THEN** the object is kept

#### Scenario: Re-uploaded during the sweep: not deleted
- **WHEN** `media:sweep --delete` has listed an orphan written 2 hours ago, and before its delete the same bytes are uploaded again, so a media row names it and its object is rewritten
- **THEN** that object is kept, it prints `deleted 0 of 1`, and the object store received no delete request for it
- **AND** in a second run where only a media row naming a listed orphan is added before its delete, that object is kept too
