/**
 * Test-only: what the SQLite store answered when the Postgres areas were ported (postgres-store tasks group 4), kept as
 * the expected values of the area tests now that SQLite is gone. `recorded/<area>.json` holds, per `pair()`, every call
 * the test made on the old store, in order: its result (or the error it threw) and the media hashes it reported.
 *
 * `expected(area)` replays them: `session().store` answers each call with the next recorded result, so
 * `assert.deepEqual(await pg.x(…), expected.x(…))` still compares Postgres with the old store's exact answer.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Duplicate, Forbidden, ReadLinkTaken, ServedTaken, type Store } from '../port.ts'

/** The store's methods, answered at once (the recorded results are values, not promises). */
export type RecordedStore = {
  [K in Exclude<keyof Store, 'tx' | 'withShaLock' | 'close'>]: Store[K] extends (...a: infer A) => Promise<infer R>
    ? (...a: A) => R
    : Store[K]
}

type Tagged =
  | { $: 'u' }
  | { $: 'map'; v: [unknown, unknown][] }
  | { $: 'set'; v: unknown[] }
  | { $: 'date'; v: string }
  | { $: 'o'; v: Record<string, unknown> }
type Thrown = { name: string; message: string; duplicate?: unknown }
type Call = { v?: unknown; e?: Thrown; gone?: string[][] }

const decode = (x: unknown): unknown => {
  if (x === null || typeof x !== 'object') return x
  if (Array.isArray(x)) return x.map(decode)
  if (!('$' in x)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, decode(v)]))
  const t = x as Tagged
  switch (t.$) {
    case 'u':
      return undefined
    case 'map':
      return new Map(t.v.map(([k, v]) => [decode(k), decode(v)]))
    case 'set':
      return new Set(t.v.map(decode))
    case 'date':
      return new Date(t.v)
    case 'o':
      return Object.fromEntries(Object.entries(t.v).map(([k, v]) => [k, decode(v)]))
  }
}

const rebuild = (e: Thrown): Error => {
  if (e.name === 'ReadLinkTaken') return new ReadLinkTaken()
  if (e.name === 'ServedTaken') return new ServedTaken()
  if (e.name === 'Forbidden') return new Forbidden()
  if (e.name === 'Duplicate') return new Duplicate(decode(e.duplicate) as ConstructorParameters<typeof Duplicate>[0])
  const err = new Error(e.message)
  err.name = e.name
  return err
}

/** The recorded answers of one area's test file; each `session()` is the next `pair()`'s. */
export function expected(area: string) {
  const file = fileURLToPath(new URL(`./recorded/${area}.json`, import.meta.url))
  const sessions = JSON.parse(readFileSync(file, 'utf8')) as Call[][]
  let next = 0
  return {
    session(onMediaGone?: (shas: string[]) => void) {
      const calls = sessions[next++]
      if (!calls) throw new Error(`recorded/${area}.json: no session ${next - 1}`)
      let i = 0
      const value = <T>(): T => {
        const c = calls[i++]
        if (!c) throw new Error(`recorded/${area}.json: session ${next - 1} has no call ${i - 1}`)
        for (const shas of c.gone ?? []) onMediaGone?.(shas)
        if (c.e) throw rebuild(c.e)
        return decode(c.v) as T
      }
      const store = new Proxy({} as RecordedStore, { get: () => () => value() })
      return { store, value }
    },
  }
}
