/** Media store settings (server/storage): literal envs only, every one with an explicit NODE_ENV or none on purpose. */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseConfig } from './config.ts'

const LOCAL = 'http://127.0.0.1:54321/storage/v1/s3'
const SUPABASE = 'https://abcdefghij.storage.supabase.co/storage/v1/s3'
const KEYS = { S3_ACCESS_KEY_ID: 'ak-test-77bb', S3_SECRET_ACCESS_KEY: 'sk-test-55aa' }

describe('media store config', () => {
  it('[server/storage] Media store settings: Missing keys', () => {
    assert.throws(
      () => parseConfig({ NODE_ENV: 'development', MEDIA_STORE: 's3', S3_ENDPOINT: LOCAL, S3_REGION: 'local' }),
      (err: Error) => {
        for (const s of ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'pnpm dev:s3']) assert.ok(err.message.includes(s), err.message)
        assert.ok(!err.message.includes('S3_ENDPOINT'), err.message)
        return true
      },
    )
  })

  it('[server/storage] Media store settings: S3 defaults', () => {
    const c = parseConfig({ NODE_ENV: 'development', MEDIA_STORE: 's3', S3_ENDPOINT: LOCAL, S3_REGION: 'local', ...KEYS })
    assert.equal(c.MEDIA_STORE, 's3')
    assert.equal(c.S3_BUCKET, 'meniscus-media')
    assert.equal(c.S3_FORCE_PATH_STYLE, true)
  })

  it('[server/storage] Media store settings: Memory outside production', () => {
    assert.equal(parseConfig({ NODE_ENV: 'test' }).MEDIA_STORE, 'memory')
    assert.equal(parseConfig({}).MEDIA_STORE, 'memory')
  })

  it('[server/storage] Production media store: Memory in production', () => {
    for (const env of [{ MEDIA_STORE: 'memory' }, {}]) {
      assert.throws(() => parseConfig({ NODE_ENV: 'production', ...env }), /MEDIA_STORE/)
    }
  })

  it('[server/storage] Production media store: Plain HTTP in production', () => {
    const env = { NODE_ENV: 'production', MEDIA_STORE: 's3', S3_REGION: 'eu-west-2', ...KEYS }
    assert.throws(() => parseConfig({ ...env, S3_ENDPOINT: 'http://abcdefghij.storage.supabase.co/storage/v1/s3' }), /S3_ENDPOINT/)
  })

  it('[server/storage] Production media store: Supabase endpoint', () => {
    const c = parseConfig({ NODE_ENV: 'production', MEDIA_STORE: 's3', S3_ENDPOINT: SUPABASE, S3_REGION: 'eu-west-2', ...KEYS })
    assert.equal(c.MEDIA_STORE, 's3')
    assert.equal(c.S3_BUCKET, 'meniscus-media')
    assert.equal(c.S3_FORCE_PATH_STYLE, true)
  })

  it('[server/storage] Production media store: Local stack in a production smoke test', () => {
    const env = { NODE_ENV: 'production', MEDIA_STORE: 's3', S3_REGION: 'local', ...KEYS }
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      assert.equal(parseConfig({ ...env, S3_ENDPOINT: `http://${host}:54321/storage/v1/s3` }).MEDIA_STORE, 's3', host)
    }
    assert.throws(() => parseConfig({ ...env, S3_ENDPOINT: 'http://10.0.0.5:54321/storage/v1/s3' }), /S3_ENDPOINT/)
  })

  it('[server/storage] Media store settings: an endpoint that is not a URL names S3_ENDPOINT', () => {
    assert.throws(
      () => parseConfig({ NODE_ENV: 'development', MEDIA_STORE: 's3', S3_ENDPOINT: 'nope', S3_REGION: 'local', ...KEYS }),
      /S3_ENDPOINT/,
    )
  })
})

describe('database config', () => {
  const PW = 'Xy9-secret'
  const REMOTE = `postgresql://meniscus_app:${PW}@db.abcdefghij.supabase.co:5432/postgres`
  const POOLER = `postgresql://meniscus_app.abcdefghij:${PW}@aws-0-eu-west-2.pooler.supabase.com`
  const ca = join(mkdtempSync(join(tmpdir(), 'meniscus-ca-')), 'ca.crt')
  writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n')
  const fails = (env: Record<string, string>, ...names: string[]) =>
    assert.throws(
      () => parseConfig({ NODE_ENV: 'test', ...env }),
      (err: Error) => {
        for (const s of names) assert.ok(err.message.includes(s), err.message)
        assert.ok(!err.message.includes(PW), err.message)
        return true
      },
    )

  it('[server/storage] Database connection settings: Remote host without certificate check', () => {
    fails({ DATABASE_URL: `${REMOTE}?sslmode=require`, DATABASE_CA_FILE: ca }, 'DATABASE_URL', 'sslmode=verify-full')
  })

  it('[server/storage] Database connection settings: Remote host with certificate check', () => {
    const c = parseConfig({ NODE_ENV: 'test', DATABASE_URL: `${REMOTE}?sslmode=verify-full`, DATABASE_CA_FILE: ca })
    assert.equal(c.DATABASE_URL, `${REMOTE}?sslmode=verify-full`)
    assert.equal(c.DATABASE_POOL_MAX, 5)
  })

  it('[server/storage] Database connection settings: Local database without TLS', () => {
    const c = parseConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
    assert.equal(c.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
  })

  it('[server/storage] Database connection settings: Not a database URL', () => {
    fails({ DATABASE_URL: './data/meniscus.db' }, 'DATABASE_URL')
  })

  it('[server/storage] Session connection: Transaction mode only', () => {
    fails({ DATABASE_URL: `${POOLER}:6543/postgres?sslmode=verify-full`, DATABASE_CA_FILE: ca }, 'DATABASE_SESSION_URL', '6543')
  })

  it('[server/storage] Session connection: Transaction mode for requests, session mode for the worker', () => {
    const c = parseConfig({
      NODE_ENV: 'test',
      DATABASE_URL: `${POOLER}:6543/postgres?sslmode=verify-full`,
      DATABASE_SESSION_URL: `${POOLER}:5432/postgres?sslmode=verify-full`,
      DATABASE_CA_FILE: ca,
    })
    assert.equal(new URL(c.DATABASE_URL!).port, '6543')
    assert.equal(new URL(c.DATABASE_SESSION_URL!).port, '5432')
  })
})
