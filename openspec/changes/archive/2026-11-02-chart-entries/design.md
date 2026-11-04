# Design

## Store (`apps/server/src/store/`)

`openStore(path: string, now = Date.now): Store` over `DatabaseSync` (`node:sqlite`, stable in Node 24). `':memory:'` in tests. `PRAGMA journal_mode=WAL; foreign_keys=ON`. `STRICT` tables:

```sql
admission(id INTEGER PK, bed TEXT UNIQUE, patient TEXT, weight_kg REAL, qr_token TEXT UNIQUE, admitted_at INTEGER)
entry(id INTEGER PK, admission_id INTEGER REFERENCES admission, direction TEXT, category TEXT, volume_ml INTEGER,
      item TEXT, notes TEXT, source TEXT, confidence REAL, status TEXT DEFAULT 'pending',
      created_at INTEGER, reviewed_at INTEGER)
```

Times are epoch ms; the API returns ISO strings. Seeding runs in one transaction when `admission` is empty: beds 1–6, fictional names, `qr_token = randomBytes(16).toString('base64url')`.

`Store` methods: `admissions()`, `admissionByToken(t)`, `admission(id)`, `addEntry(id, input)`, `entries(id)`, `review(entryId, action, volume?)`, `close()`. Totals are computed in SQL over `created_at >= now - 24h`.

Review is a single `UPDATE … WHERE id = ? AND status = 'pending'`; zero changed rows → `not_found` or `not_pending` after a lookup, so two nurses approving at once cannot double-apply.

## Validation (`routes/chart.ts`)

`EntryInput`: `direction`, `category` (must belong to the direction: in = water | food | iv, out = urine | stoma | drain | vomit), `volume_ml` integer 1–5000, `item`/`notes` ≤ 200 chars or null, `source` photo | voice | text | manual, `confidence` 0–1 optional. Ids are positive integers; a non-numeric id is 404.

## App

`createApp({ store, … })`; `app.ts` opens `${DATA_DIR}/meniscus.db` (default `./data`, created if missing) for the real app. Guards: `noStore` + `bearer` on `/api/*` with `/api/health` exempt; `rateLimit` on `/api/ai/*` only.
