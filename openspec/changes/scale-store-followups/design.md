# Design

**After the deadline.** Applies on top of the archived text and code of every change before it in the fixed order (§8): drink-types → deploy-ready → s3-media → ui-polish → labeled-photo-copy → postgres-store → **scale-store** → read-queue. The store is postgres-store's async Postgres store, and every SQL statement and trigger here is Postgres. tray-segmentation through dietitian-care are archived. Code line numbers below are as of 4 Nov, before s3-media's apply; task 1.1 re-finds each by name.

## 0. Changed types

### packages/shared

```ts
/** Reading interval by level (charting/acuity "Reading interval by acuity"). A catheter's `measure_every_h` overrides it (bag-periods "Reading interval"). */
export const ACUITY_INTERVAL_H: Record<AcuityLevel, number> = { critical: 1, watch: 2, stable: 4 }
/** Bed status (alerts, care, acuity, nutrition) may be reused this long on lists (charting/alerts "Alerts on chart reads"). Equal to the web's poll. */
export const STATUS_MAX_AGE_MS = 30_000

export interface ReadingInterval { h: number; from: 'catheter' | 'acuity' } // BREAKING: bag-alerts' 'catheter' | 'default'
/** Catheter first, then the level's interval. Replaces bag-alerts' readingInterval(admission, catheter) and its ward-code map. */
export function readingInterval(acuityIntervalH: number, catheter: { measure_every_h: number | null } | null): ReadingInterval
export interface AcuityStatus { /* acuity-budget's fields */ interval_h: number } // BREAKING
export interface BagChart { interval_h: number; interval_from: ReadingInterval['from']; periods: BagPeriod[] } // BREAKING via ReadingInterval
/** GET /api/beds/:token (bag-periods "Reading interval on the bed lookup"). */
export interface BedLookup extends Admission { reading_interval: ReadingInterval } // new
export interface Ward { /* … */ default_acuity_set_by: StaffRef | null; default_acuity_set_at: string | null } // BREAKING
export interface MediaRef { /* … */ sha256: string } // BREAKING: tray-segmentation's `string | null` narrowed
```

`emptiedByDefault(interval)` (bag-emptying, `EMPTIED_FROM_INTERVAL_H = 4`) is unchanged; it now receives the acuity or catheter interval. `@meniscus/meta` does not change: `stats()` already has `remaining` and `held`.

### Server config

- `BUDGET_PRESSURE_PCT`: integer 1–100, default 50. P = ⌊C · `BUDGET_PRESSURE_PCT` / 100⌋.

### Layer ownership

| Module | Layer | Role |
| --- | --- | --- |
| `apps/server/src/store/pg/schema.sql` | store | `linked_at`, the ward audit columns, version tables, PL/pgSQL bump functions and triggers, `media_unlinked`, `model_read_admission`; `SCHEMA_VERSION` 1 → 2 |
| `apps/server/src/store/pg/<area>.ts` (postgres-store's areas) | store | `INDIRECT_TABLES`, `ruleEntries`, ward and all variants of the ward reads, `HOT_SQL`, expiry by `linked_at` |
| `apps/server/src/chart/view.ts` | domain | Bed status with bounded reuse |
| `apps/server/src/chart/acuity.ts`, `chart/bags.ts` | domain | `interval_h`; `readingInterval(acuity, catheter)` |
| `apps/server/src/ai/budget-policy.ts` | domain | The pressure rule; per-class counters |
| `apps/server/src/routes/chart.ts` | HTTP | `PUT /api/wards/:id/default-acuity`; `reading_interval` on `GET /api/beds/:token` |
| `apps/server/src/routes/metrics.ts` and the metrics middleware in `app.ts` | HTTP | `/api/metrics` |
| `apps/server/src/testing-load.ts`, `scripts/bench.ts` | test / script | Seeder and bench |
| `apps/web/src/routes/a/index.tsx` | web | Ward-first picker |
| `apps/web/src/lib/bags.ts`, `lib/round.ts`, `lib/care.ts` | web | Event defaults and the care-plan interval line from the server's interval |

## 1. Context

**Phase A** (acuity-budget design §1, archived with it; README "Scaling"): a fictional 500-bed hospital, 3 days of history.

- **Latency.** `GET /api/wards` takes 1.3–2.4 s at p50 and **5.8 s at p95** on Node's single thread. A save arriving during it waits that long.
- **Thread use.** Polling every 30 s from 20 ward dashboards, 10 bed reviews and 5 hospital lists keeps the thread **48 % busy** at 500 beds with full media (26 % tiny); the five hospital lists alone take 40 %.
- **Media in-row** (fixed by s3-media, which moves the bytes to an S3 bucket and drops `media.bytes`; kept for the record). The store was **4,234 MB with media in-row and 46 MB without** (99.1 % in `media`, ≈ 1.4 GB a day). The metadata columns sat after `bytes`, so reading them walked the BLOB's overflow chain:

| Read | With BLOBs | Without | Ratio |
| --- | --- | --- | --- |
| 64 media rows, metadata only, warm | 28.3 ms | 0.21 ms | 133× |
| One bed's chart read, warm | 3.65 ms | 1.12 ms | 3.3× |
| Chart read of all 500 beds, cold cache | 11.4 s | 0.74 s | 15× |

- **Where `chartView` goes** (ms per bed, tiny / full media): full entry read 3.3 / 13.3; lean read of the columns the rules use 0.66 / 0.63; pure rules 0.45 / 0.80.
- **Query plans.** `hourly` (`store.ts:890-893`) does `SCAN entry` because `(?2 IS NULL OR a.ward_id = ?2)` defeats the indexes (37–94 ms); a ward-scoped `admission CROSS JOIN entry` plans through `admission_ward` and `entry_admission_created` (2.9 ms). The same optional-ward form is in the list read `admissions` (`:888`), `careOrdersByWard` (`:1002-1004`) and `bagReadingsByWard` (`:1034-1035`). `expireMedia` (`:971`) runs on every upload and open and walks every media row older than 24 h, linked or not.

**Since Phase A.** The changes before this one add reads that Phase A never measured:
- tray-comparison: `servedPhoto` (per bed, `media_served` index, `UNLINKED` with `meal.served_media_id`) on every tray read and on `GET /api/admissions/:id/served-tray`; `meal_event`.
- bag-alerts: the low-output window (`to` at the newest urine-bag reading while under 2 × interval old, entries back to `window.from`, up to 30 h); `catheterOrdersByWard` over the full catheter history; `confirmed_duplicate_of`.
- read-outcomes and accuracy-views: `model_read` (with `admission_id`) and `read_link`; `readOutcomeRows(since, wardId?)`; accuracy-views' `retaken`, one `EXISTS` over `model_read` per tray read (same staff and admission, within `READ_RETAKE_MINUTES`), with no index added.
- dietitian and dietitian-care: `WardReads` (meals, latest referrals, covered wards, `assignmentsByWard`) per ward; `GET /api/nutrition/worklist`, polled every 30 s, reads the meals of the last `POOR_INTAKE_WINDOW_H` on the dietitian's wards; `admission_dietitian`; diet orders in `care_order`; the patient nutrition read with histories capped at `NUTRITION_HISTORY_LIMIT` (20).

## 2. Goals / Non-Goals

**Goals**
- Hospital-wide reads cost about the same as a ward read in steady state: at most one full recompute per bed per `STATUS_MAX_AGE_MS`.
- Media expiry reads only never-linked rows, and still reports every deleted hash to s3-media's `onMediaGone`.
- Every number in README "Scaling" is reproducible with `pnpm --filter @meniscus/server bench` and visible in `/api/metrics`.
- Stable and bedless reads use Spark only under pressure; intervals follow the patient's acuity, unless a catheter order sets one.
- **Latency budget** at 500 beds with 150 KB media, reported by the bench (machine-dependent, so reported, not asserted): `GET /api/wards` and `GET /api/admissions?ward=` p95 ≤ 50 ms when reused and ≤ 600 ms on a full recompute; thread use of the Phase A screen mix plus 2 dietitian worklists ≤ 10 %. read-queue's "stays in scale-store's p95 budget" refers to these.

**Non-Goals**
- A server cluster, Postgres (postgres-store), the object store itself (s3-media), background workers, queues (read-queue), retries.
- Changing alert thresholds per acuity. Acuity changes the reading interval. Through it, it changes bag-emptying's reading-due prompts and bag-alerts' low-output window end (2 × interval), never a threshold. A suggested level never changes the interval, so `low_urine_output` raising `suggested: critical` cannot shorten its own window.
- Windowing the bed review's entries (proposal, Out of scope).

## 3. Capacity model

Utilisation is U = Σ screens × service ÷ 30 s.

| Read | Projected service time |
| --- | --- |
| Hospital list, reused | `store.wards()` 13 ms + map lookups |
| Hospital list, one recompute per 30 s | 500 × (0.66 + 0.45) ≈ 0.55 s |
| Ward dashboard | hourly 3 ms + totals 2 ms + 25 bed statuses (reused, or ≈ 28 ms recomputed) |
| Dietitian worklist (not reused) | one ward-scoped meal read per covered ward + referrals; measured by the bench |

With the Phase A screen mix, U ≈ 3–4 %, and the longest synchronous block is about 0.55 s once per 30 s. The repo bench confirms or replaces these.

**Budget with pressure** (C 120, R 36, P 60). Between 60 and 84 in use, stable and bedless reads cost 1 instead of 3 (or 5 with a served photo): 24 reads where 8 would fit. Watch and critical beds keep "Read mode fits the budget" and "Served tray reads fit the budget". Critical beds keep acuity-budget's guarantee (36 requests, 12 `sam+spark` reads an hour) and stay `sam+spark` while 3 fit.

## 4. Decisions

### 4.1 Media: expiry by `linked_at` (bytes stay in s3-media's object store)

s3-media (applied before) owns where the bytes live: the S3 bucket, content-addressed by `sha256`, PUT before the row's INSERT, one DELETE after COMMIT when no row has the hash (`onMediaGone`, `collectGone`), the per-hash lock and `media:sweep`. This change adds no media file, port or sweep. It changes only which rows expiry reads.

**Expiry becomes O(unlinked).** `media.linked_at timestamptz`, set by the transaction that first links the media: an entry, a level, a level's after-emptying photo (`level.proof_media_id`, bag-emptying), a meal's tray photo, a meal's served photo (`meal.served_media_id`, tray-comparison), the labeled copy of an entry, level or meal (`entry.labeled_media_id`, `level.labeled_media_id`, `meal.labeled_media_id`, labeled-photo-copy), a bag reading, `attachPhoto`. The predicate `linked_at IS NULL` replaces `UNLINKED` (postgres-store's `pg/media.ts`, as ported from bag-emptying, tray-comparison and labeled-photo-copy) in expiry, `liveMedia`, `gcMedia` and `servedPhoto`:
- expiry is `DELETE FROM meniscus.media WHERE linked_at IS NULL AND created_at < $1 RETURNING sha256` over the partial index `media_unlinked ON meniscus.media (created_at) WHERE linked_at IS NULL`, keeping s3-media's `RETURNING sha256` so `onMediaGone` still gets every expired hash and its object is deleted;
- `servedPhoto` keeps tray-comparison's `media_served` index; its `${UNLINKED}` becomes `media.linked_at IS NULL`.

It equals the merged NOT EXISTS rule because media losing its last link is deleted on the spot (tray-comparison's "Media goes with its record"); a test compares both predicates over the seeded store, served photos and labeled copies included.

**Alternatives rejected.** Keeping the NOT EXISTS predicate (walks every media row older than 24 h on each upload). This change's earlier plan, content-addressed files on the server's disk with its rejection of an object store, is obsolete: s3-media chose the object store and owns the bytes.

### 4.2 Read path: compute on read, reuse for at most 30 s, never after a write

**Option A, precomputed rows, rejected.** An `admission_status` table written in each write transaction is wrong exactly when it matters: `low_urine_output` (6 h, and bag-alerts' window ending at 2 × interval), `logging_gap` (3 h), the 14:00/20:00 intake checks, `nil_by_mouth_overdue`, the 08:00 catheter review, the reading-due prompts, `bag_nearly_full`'s 24 h and every rolling 24 h window change with no write.

**Option B, chosen.**
- `chart/view.ts` keeps `Map<admissionId, { at, version, epoch, status }>`, where `status` is **one unit**: alerts (care, bag and nutrition prompts included), care (diet orders included), acuity (with `interval_h`) and nutrition (`nutrition.dietitian` and `dietitian_available` included), computed together by one `chartView` call. No part is cached alone, so a list never mixes a fresh care block with stale alerts.
- **Its inputs**, all from tables the triggers cover: entries, levels (urine-bag reading times, `levels.before`, `confirmed_duplicate_of`), care orders (acuity, catheter with `measure_every_h`, diet), meals and `meal_event` amendments, referrals, `admission_dietitian`, the admission (weight, admitted time), and the ward (`default_acuity`) and dietitian cover (`staff_ward`) through the epoch.
- An entry is reused iff its version and epoch match and 0 ≤ now − at < `STATUS_MAX_AGE_MS`.
- Only `GET /api/admissions` and `GET /api/wards` use it. `GET /api/admissions/:id/entries`, the nutrition read, the worklist, Explain and **the budget class always compute fresh** for their bed (a few ms): an admission decision never rides on a cached status.
- **Staleness bound.** A list read at t uses a status computed after t − 30 s, so a prompt due at T is on every list read from T + 30 s; a dashboard polling every 30 s shows it by T + 60 s. This covers bag-alerts' window ending at 2 × interval like any other clock prompt ("Bag window ends with no write"). Tests assert only the bound (from 12:00:31, from 16:00:31), never when within it the prompt appears.

**Version bumps by Postgres triggers, not by hand.**
- `meniscus.admission_version (admission_id integer PRIMARY KEY, v integer NOT NULL)` and `meniscus.store_epoch (v integer NOT NULL)`, seeded with one row.
- Every table with an `admission_id` column gets one `AFTER INSERT OR UPDATE OR DELETE … FOR EACH ROW` trigger named `bump_<table>` running `meniscus.bump_admission()`, which upserts `v = v + 1` for `NEW.admission_id` and, when it differs, `OLD.admission_id`, skipping a NULL bed (a bedless `model_read`). The bump row-locks only that bed's version row, so writes to different beds do not contend. After dietitian-care that is `entry`, `level` (bag readings included), `media`, `meal`, `care_order` (acuity, catheter and diet orders), `bed_assignment`, `model_read` (read-outcomes, accuracy-views), `referral` (dietitian) and `admission_dietitian` (dietitian-care). `bed_assignment` and `model_read` feed no status; their bumps cost one recompute that changes nothing, and the guard keeps no exemption list.
- Tables reaching a bed through another key are listed in `INDIRECT_TABLES` (exported from `pg/schema.ts`), each with its own PL/pgSQL function that reads the bed through the parent row: `entry_event` via `entry_id`, `care_review` via `order_id`, and `admission` itself via `id`.
- `meal_event` (tray-comparison) is not listed: its rows are only inserted, by `amendMeal`, in the same transaction as the `UPDATE meal` that bumps the bed, and its own triggers refuse updates and deletes. `read_link` is not listed: it feeds no status.
- Ward-level state bumps the epoch by a `FOR EACH STATEMENT` trigger running `meniscus.bump_epoch()`: `ward` (`default_acuity` and its audit columns) and `staff_ward` (dietitian cover; nurse teams too, which is rare and harmless).
- **Guard test.** It reads `information_schema.columns` (`column_name = 'admission_id'`, schema `meniscus`) joined with `pg_trigger`, and fails for any such table lacking its `bump_<table>` trigger, for any `INDIRECT_TABLES` entry or epoch table without its trigger, and when a bedless `model_read` insert fails or bumps anything. A future table, read-queue's included, cannot silently skip the reuse drop.
- A missed bump would still be bounded by 30 s.

**Lean rule read.** `await store.ruleEntries(admissionId, since)` selects the columns the rules use (id, admission_id, direction, category, volume_ml, item, notes, source, status, created_at, urine_colour, iddsi_level, `level_id`, and `levels.before.created_at`, the bag's previous reading at save, for bag-alerts' spread) as `RuleEntry`. `since` is bag-alerts' `min(now − 24 h, chart-day start, window.from)`, so the window can still reach 30 h back. `alertsFor`, `careChart` and `urineInWindow` take `RuleEntry[]`; `Entry` is assignable. A test checks `careChart(lean)` and the alerts deep-equal those from the full read for every seeded bed.

**Ward-scoped statements.** Each optional-ward statement is split into a ward form and an all-wards form, so neither carries `$n::int IS NULL OR`: `hourlyForWard` (`meniscus.admission CROSS JOIN meniscus.entry … WHERE a.ward_id = $1`) and `hourlyAll`; the `admissions` list; `careOrdersByWard` and `catheterOrdersByWard`; `bagReadingsByWard`; dietitian's ward meals and latest referrals, and dietitian-care's `assignmentsByWard`. 37 → 2.9 ms for the ward dashboard's hourly series.

**Indexes added.** `media_unlinked` (§4.1; `media_sha256` is s3-media's) and `model_read_admission ON meniscus.model_read (admission_id, created_at)`, which serves accuracy-views' `retaken` `EXISTS` and the ward-scoped `readOutcomeRows`. dietitian-care's `admission_dietitian_current` and `_admission`, dietitian's `referral_admission` and `referral_in_progress`, and tray-comparison's `media_served` already serve their reads.

**Plan guard.** The store exports `HOT_SQL`: the list, hourly, care, catheter, bag and ward-reads statements, `ruleEntries`, `servedPhoto`, expiry, the worklist's meal read and `readOutcomeRows` with its `retaken` `EXISTS`. The bench runs `EXPLAIN (FORMAT JSON)` on each at 500 beds, after `ANALYZE`, and fails on a `Seq Scan` of `entry`, `media`, `level`, `meal`, `care_order`, `model_read`, `referral` or `admission_dietitian`. No plan test in the unit suite: the planner rightly seq-scans small tables.

### 4.3 Budget pressure

`plan()` gains one rule, ahead of tray-comparison's served rule and acuity-budget's fit rule: when `sam+spark` is wanted, used ≥ P, and the action names no bed or `groupLevel = max(level, suggested)` is `stable`, choose `spark` (1 request, `budget pressure` warning). The bed is `admission_id` on photo and tray reads alike (tray-comparison's "Tray reads name their bed").
- **Served trays.** For such a read the served photo is still looked up, so `comparison` names it with `served: null`, as in tray-comparison's "Room for two"; nothing is sent on it. Watch and critical beds go on to the served rule (5, or 3 with 3–4 left) and the fit rule.
- **Mode, then concurrency.** The rule reads the hourly count only. The concurrency check then applies to the chosen mode, so a pressure `spark` read needs 1 free slot ("Pressure, not concurrency"), and "Busy, not downgraded" still refuses a critical `sam+spark` read with 3 of 4 slots busy.
- The rule uses the **higher of the set and suggested levels**, the same as the class, so 3A bed 2 (stable, suggested critical) keeps `sam+spark` and acuity-budget's "Classes at the routine ceiling" holds at 84 in use.
- **Counters.** Per class `{ admitted, refused, downgraded }`. `downgraded` counts admitted actions planned below their mode's requests: the pressure rule (3 or 5 → 1), the fit rule (3 → 1) and the served rule (5 → 3).

### 4.4 Acuity follow-ups

- **Ward default route.** `PUT /api/wards/:id/default-acuity` in `routes/chart.ts`: matron check, then 404, then body (400). The store writes `default_acuity`, `default_acuity_set_by` and `default_acuity_set_at` (columns in `SCHEMA`) in one statement; the `ward` trigger bumps the epoch.
- **Interval.** `acuity.interval_h = ACUITY_INTERVAL_H[level]` (the set level, never the suggestion). bag-alerts' `readingInterval(admission, catheter)` (`packages/shared/src/index.ts:831`, bag-emptying's at the time of writing) becomes `readingInterval(acuity.interval_h, catheter)`: `{ h: measure_every_h, from: 'catheter' }` when the active catheter sets one, else `{ h: acuity.interval_h, from: 'acuity' }`. Its private ward-code map is deleted. `bagChart` (`chart/bags.ts:197`), `urineWindow` and the reading-due prompts take that interval, so the low-output window of a `watch` bed ends at 4 h, not 8 h.
- **The bed lookup.** `GET /api/beds/:token` (`routes/chart.ts:283`) returns `BedLookup`: the admission plus `reading_interval`, from its active acuity and catheter orders and its ward's default (two indexed reads).
- **Event defaults.** bag-emptying's `emptiedByDefault(interval)` stays; only its input changes. The web stops calling `readingInterval(admission)`:
  - the capture screen's check and by-hand bag form use `bags.interval_h` from the bed screen's `GET …/entries` (`lib/bags.ts:85` `emptiedDefault`, `routes/a/bed.$token.tsx:689`);
  - the round's `RoundBed.interval` is the scanned card's `reading_interval` (`lib/round.ts:239`), for a bed of the round's ward, from another ward, or in a round with no ward. This closes bag-alerts' accepted risk "[Round bed from another ward]".
- **Care-plan line.** bag-alerts' ` · Ward default` and `Ward default (<h> h)` become ` · By acuity` and `By acuity (<h> h)`, with `<h>` from `acuity.interval_h`, so the form still shows the level's interval while a catheter interval is set ("Order beats acuity"). apps/web/DESIGN.md §7.5 gains the wording (task 7.4).

### 4.5 Metrics

- **Collection.** One middleware, first in `createApp`, records the method, `routePath(c, -1)` from `hono/route` (the pattern, never `c.req.path`), the status and the duration after `next()`. A request whose last matched path is the middleware's own `*` matched no route and is counted under `unmatched`. Task 6.2 confirms `routePath` against the Hono version then pinned.
- **Storage.** Counters in a `Map<"METHOD route status", number>`; a ring buffer of 1,000 latencies per method and route, p50 and p95 computed on read.
- **Model numbers** from `budget.stats()` and budget-policy's counters. Store size from `stat` of the db and WAL; media from one `SELECT count(*), SUM(media.size) FROM media` (the bytes are in s3-media's bucket, so no file count or bucket listing).
- **The route.** Matron only (401 with no session, 403 for other roles). The shape `OpsMetrics` lives in `routes/metrics.ts`; the web does not consume it. read-queue adds `read_queue` to it.
- **Never holds** paths with ids or tokens, bodies, query strings or names. Route patterns cover `/api/ai/meal` with its `admission_id` and `meal` fields and the served-tray route alike. The "Nothing identifying" test greps the whole body.

### 4.6 Bench (`apps/server/scripts/bench.ts`)

Ports the Phase A bench. `--admissions 100,500`, `--days 3`, `--media-kb 2` (150 reproduces the size table), `--dir` (default an `os.tmpdir()` subdirectory, removed afterwards).
- **Seed** through raw SQL and s3-media's memory media store (`--media-kb` sets each object's size): entries, levels and urine-bag readings with catheter orders (some with `measure_every_h`), acuity orders, meals with tray and served photos and amendments, referrals, dietitian assignments and diet orders, and tray and photo reads in `model_read`, some retaken.
- **Measure** through `testApp` with a fake upstream and `globalThis.fetch` replaced by a thrower: the Phase A screens plus 2 dietitian worklists covering every ward, the hospital accuracy view, and `GET /api/admissions/:id/served-tray`.
- **Print** a markdown table with the §2 latency budget beside each measured p95.
- **Exit 1** on any upstream or network call, a `HOT_SQL` scan of a guarded table (§4.2), or a reused status not equal to a fresh one.

`"bench": "tsx scripts/bench.ts"`, with no `--env-file`, so it never reads `.env`. Not part of `pnpm verify`.

### 4.7 Web

- **Picker** (`routes/a/index.tsx:31`, today `api.admissions(undefined)`): wards from `GET /api/wards`, then one ward's beds.
- **Fingerprint**: `source-view.tsx` and `lib/tray.ts` drop the `Fingerprint not recorded` branch now that `sha256` is a string. tray-comparison's `Photo deleted · fingerprint …` and `Served tray deleted · fingerprint …` read the proof and are unchanged.
- **Bags**: `lib/bags.ts`, `lib/round.ts` and `lib/care.ts` as in §4.4; `interval_from` reads `catheter` or `acuity`.

## 5. Data flow

```
list read ─► view.status(bed): cached {at, version, epoch} matches and age < 30 s ? reuse : chartView(lean read + rules)
write (any table with admission_id, or INDIRECT_TABLES) ─► trigger ─► admission_version[bed]++ ─► next list read recomputes that bed
ward default / staff_ward ─► trigger ─► store_epoch++ ─► every bed recomputes
bed lookup ─► admission + active acuity and catheter + ward default ─► reading_interval
media upload ─► s3-media: lock(sha) ─► PUT ─► tx (row, linked_at NULL) ─► commit
first link (entry, level, proof, meal tray, served or labeled copy, bag reading) ─► tx sets linked_at
reject/void/expire (linked_at IS NULL) ─► tx deletes rows RETURNING sha256 ─► commit ─► s3-media: onMediaGone ─► DELETE if no row has its sha256
model action ─► fresh status(bed) ─► class, groupLevel ─► plan (pressure, served, fit) ─► concurrency for that mode ─► reserve ─► pipeline
```

## 5a. Tests on Postgres

- Every test runs on postgres-store's in-process test database, a fresh database per test (its design §5), through `await testApp()`. `seedLoad` writes with plain SQL on that database.
- **Covered in the default run:** the `pg_trigger` guard and the table-driven bump test (§4.2), the "same rows as before" predicate test and `RETURNING sha256` (§4.1), the ward audit columns, the lean-read and reuse tests, and the version-2 start and refusal (postgres-store's "Schema created on start" and "Other schema version refused" tests, re-run at 2).
- **Covered with `PG_TEST_URL`** (opt-in, the local stack): the same suite on a real server, which adds the bump triggers' row locks under real concurrency and the partial index `media_unlinked` with real statistics. The in-process database has one connection, so concurrent bumps run one after the other there.
- **The plan guard** runs in the bench only (task 8.1), at 500 beds, after `ANALYZE`, on the in-process database by default and on `PG_TEST_URL` when set.
- **Version first.** With an async store, a write can commit while a status is being computed. `view.status` reads the bed's version and the epoch before it reads the inputs, and stores the result under that version, so a status computed across a write is stored under the older version and recomputed on the next read. A test interleaves a write between the version read and the rule read and sees the next list read recompute.

## 6. Schema (no upgrade path)

Per postgres-store's rule (server/storage "Schema created on start" and "Other schema version refused"), this change edits `apps/server/src/store/pg/schema.sql` and bumps the Postgres `SCHEMA_VERSION` in `pg/schema.ts` from 1 to 2. If the live `SCHEMA_VERSION` is not 1 at apply time, stop: changes were applied out of order. It adds no upgrade step:
- `meniscus.media` gains `linked_at timestamptz`. s3-media already dropped the bytes and made `sha256` not null; the shared `MediaRef.sha256` becomes `string` here (§0, **BREAKING** for the web type);
- `meniscus.ward` gains `default_acuity_set_by integer REFERENCES meniscus.staff (id)` and `default_acuity_set_at timestamptz`;
- the version tables, `meniscus.bump`, `meniscus.bump_admission`, one function per `INDIRECT_TABLES` entry, `meniscus.bump_epoch` and their triggers, `media_unlinked` and `model_read_admission` are created with the schema, with RLS enabled on the two new tables (postgres-store's start-time check covers them). `media_sha256` is s3-media's.

A database at version 1 fails to start with postgres-store's hint; it is never migrated. **Deploy**: stop the server, drop and recreate the `meniscus` schema (the bootstrap SQL of postgres-store design §4.5; locally, `drop schema meniscus cascade` on the stack), start the new build, which creates the version-2 tables and seeds them, re-run `scripts/demo-history.ts` if the demo history is wanted, run `media:sweep --delete` (s3-media) for the old objects, and check `/api/metrics` `media` and `store`. **Rollback**: run the previous build on a database at version 1. The pressure rule and metrics are code only.

## 7. Risks / Trade-offs

- **Stable patients read less accurately under pressure, served trays included.** → Spark-only's measured error is in the accuracy eval; low confidence still gates review; the response names the mode, the nurse sees `budget pressure`, and the served photo is still named in `comparison`.
- **Reuse staleness.** → Bounded at 30 s on lists and 60 s on a polling dashboard; the bed review, the nutrition read, the worklist and every model action are always fresh.
- **A table added later without triggers.** → The `pg_trigger` guard test fails.
- **Bumps that change nothing** (`model_read`, `bed_assignment`, nurse-team `staff_ward`). → One recompute of a few ms each; cheaper than an exemption list that could hide a real input.
- **A watch bed's events start at `Check`, not `Emptied`.** → That is bag-emptying's rule (interval under 4 h) applied to the acuity interval; the chips stay editable, and a wrong check surfaces as `bag_level_fell` for review.
- **Per-process state.** → The reuse and metrics reset on restart, documented.

## 8. Order and overlaps

**Fixed apply order:** drink-types → deploy-ready → s3-media → ui-polish → labeled-photo-copy → postgres-store → **scale-store** → read-queue. tray-segmentation through dietitian-care, care-plan, bag-emptying and image-synthesis are archived. Every MODIFIED block here copies the text it merges onto at archive time: the live spec plus the latest earlier delta in that order.

| Block | Copied from |
| --- | --- |
| capture/read-budget "Read mode fits the budget" | tray-comparison (MODIFIED acuity-budget's) |
| capture/read-budget "Served tray reads fit the budget" | tray-comparison (ADDED) |
| charting/alerts "Alerts on chart reads" | `openspec/specs` (no earlier change edits it) |
| charting/bag-periods "Reading interval" | bag-alerts (MODIFIED bag-emptying's) |
| web/capture "Bag photos record readings" | labeled-photo-copy (MODIFIED bag-emptying's archived text) |
| web/ward "Media fingerprint shown" | tray-segmentation (ADDED) |
| web/ward "Bag reading interval on the care plan" | bag-alerts (ADDED) |
| web/ward-round "Bag readings in the round" | bag-alerts (ADDED) |

**Spec text notes.**
- "Read mode fits the budget" adds `or "Reads under budget pressure"` to tray-comparison's exception (498 → 531 characters). To stay under 500 it drops "requested or by default," (a `sam+spark` read is one in that mode however chosen) and "it is" before "refused". The in-flight sentence and all five scenarios, "Busy, not downgraded" and "In-flight minimum from config" included, are tray-comparison's; only "Room for three" moves from 3A bed 4 (`stable`, downgraded at 81 in use) to 5B bed 1 (`watch`), as before.
- "Served tray reads fit the budget" adds `, unless "Reads under budget pressure" applies` (495 → 539). It says "(found, other bytes, sizes readable)" as tray-comparison's "Whole action admitted up front" does, "ceiling" for "hourly ceiling", "and `comparison` names" and "warning only `comparison unavailable`". Its five scenarios move from 3A bed 4 (`stable`), which pressure would downgrade at 79–84 in use, to 5B bed 1 (`watch`, the same routine ceiling of 84); their counts are unchanged.
- "Bag reading interval on the care plan" stays at 498 with "By acuity" for "Ward default" and "(null for acuity)".
- "Bag photos record readings" is copied word for word from labeled-photo-copy (its photo plus labeled-copy uploads, three requests for a segmented `sam+spark` save); "Bag readings in the round" (495) from bag-alerts. Only scenarios are added.

| Change | Overlap | Resolution |
| --- | --- | --- |
| **bag-emptying** (archived) | `readingInterval` and its private ward-code map; `emptiedByDefault`; `level.proof_media_id`; bag readings in `level` | Its "scale-acuity" follow-ups: the map goes and the body reads acuity (§4.4); the catheter clause it asked to drop is now bag-alerts' and is kept; `emptiedByDefault` needs no map; the `proof_media_id` link sets `linked_at`. "Bag photos record readings" gains "Watch bed". |
| **tray-segmentation** (archived) | `media.sha256` (null for old media), `src/hash.ts`, "Media fingerprint", "Media fingerprint shown"; meal `proof` keeps photo hashes | fresh-schema makes `sha256` set at every upload ("Media SHA-256 fingerprint"), so only web/ward "Media fingerprint shown" is MODIFIED, dropping its null branch; s3-media names objects with `sha256Hex`. Of the three gaps its design names for "scale-acuity", "Budget spent" and the bed on `/api/ai/meal` were closed by acuity-budget and tray-comparison; the third, the `string` narrowing, is here (tasks 1.2, 7.2). A voided meal's proof hash may name a deleted object; proof keeps the hash, not the bytes. |
| **read-outcomes** (before) | `model_read` (`admission_id`), `read_link`; accuracy by mode | Pressure downgrades store `mode: spark`, so its view splits them. `model_read` gets the version triggers; `read_link` feeds no status and gets none. Its "scale-acuity MODIFIES Reads name their bed" note was acuity-budget's, which did. |
| **dietitian** (before) | `nutrition` on chart reads; `WardReads`; referrals; dietitian ward cover in `staff_ward`; the worklist | `nutrition` is part of the cached unit; `referral` gets bed triggers and `staff_ward` the epoch trigger. Its ward meal and referral reads get ward and all forms and join `HOT_SQL`. The worklist is not reused and joins the bench. |
| **acuity-budget** (before) | `capture/read-budget`, `charting/acuity`, `default_acuity`, the class; its tasks.md:85 | ADDED pressure, ward-default route and interval. As its tasks.md:85 asks, "Read mode fits the budget" copies tray-comparison's text, not acuity-budget's. The class stays fresh per action. |
| **tray-comparison** (before) | "Read mode fits the budget", "Served tray reads fit the budget"; "Tray reads name their bed"; `servedPhoto`, `UNLINKED` with `meal.served_media_id`, `media_served`; `meal_event`; its tasks 11.4, 11.5 and design §14 | (1) "Read mode fits the budget" copies its text, keeping "Requests in flight never change the mode" and `unless "Served tray reads fit the budget" applies`. (2) "Reads under budget pressure" covers tray reads with a bed (its class and level) and comparable served photos: a stable bed's makes 1 in `spark`, naming the served photo; watch and critical go to "Served tray reads fit the budget" ("Served tray under pressure"). (3) That requirement is MODIFIED to defer to pressure, with its scenarios on a watch bed. (4) `linked_at` is set when a served photo is linked, and `servedPhoto`, expiry and "last reference" use it. (5) `meal_event` needs no trigger of its own (§4.2). |
| **bag-alerts** (before) | "Reading interval" (catheter first), "Low urine output" (window to 2 × interval), "Bag reading interval on the care plan", "Bag readings in the round"; `readingInterval(admission, catheter)`; its tasks.md "Workflow follow-up" and design "Overlaps" | Every item of its list: "Reading interval" rebased, catheter first, then acuity, keeping Catheter interval, Longer than the ward's, Not set and Order ended with `acuity`, plus "Catheter before acuity"; acuity's statement says "which the bed uses unless its catheter order sets one"; MODIFIED web/ward "Bag reading interval on the care plan"; the type `'catheter' \| 'acuity'` and `readingInterval(acuity, catheter)` (§0, §4.4); the low-output claim corrected (§2); `ruleEntries` carries `levels.before.created_at` and loads back to `window.from` (§4.2); the unit's inputs (§4.2); this order. Also "Bag readings in the round" (the scanned card's interval). "Low urine output" needs no edit: its text names the interval, and its 3A and HDU scenarios are 4 h and 1 h under acuity too. |
| **accuracy-views** (archived) | Tray reads logged with `admission_id`; `read_id` on meals; the `retaken` outcome (`READ_RETAKE_MINUTES`, an `EXISTS` over `model_read`); the hospital accuracy view | No shared requirement. A meal's `read_link` is written in the meal's transaction, which bumps the bed. `retaken` is derived on read, so it writes nothing and adds no request field; its `EXISTS` is served by `model_read_admission` (§4.2) and guarded by the bench. Metrics count `/api/ai/meal` by pattern only. |
| **dietitian-care** (archived) | `admission_dietitian`; diet orders in `care_order`; `nutrition.dietitian`, `dietitian_available`, diet badges; patient nutrition read; histories ≤ `NUTRITION_HISTORY_LIMIT` | Its tasks.md "Workflow follow-up" row. `admission_dietitian` gets the bed triggers and diet orders are covered by `care_order`'s; the unit already holds `nutrition` and `care`, so they are reused together within 30 s. The worklist and the nutrition read are not reused. Its indexes serve its reads, and its histories are capped at 20, so no pagination is needed; its `WardReads` read `assignmentsByWard` gets the ward and all forms and joins `HOT_SQL`. |
| **drink-types**, **deploy-ready** (before) | none in this change's requirements | deploy-ready's sign-in gate covers `GET /api/metrics` (matron check still applies) and the bench's `testApp`. |
| **s3-media** (before) | media bytes, `media_sha256`, `sha256 NOT NULL`, `onMediaGone` with `RETURNING sha256`, `media:sweep`, schema 7 → 8 | This change's earlier "Media files on disk" and "Media files go with their last reference", `media-files.ts` and orphan sweep are dropped; s3-media's "Objects go with their last media row" covers the bytes. Expiry by `linked_at` keeps `RETURNING sha256`. Metrics' media size is `SUM(media.size)`. |
| **ui-polish** (before) | none in this change's requirements | — |
| **labeled-photo-copy** (before) | `labeled_media_id` on `entry`, `level` and `meal`; `UNLINKED` with three more `NOT EXISTS`; web/capture "Bag photos record readings" | The labeled link sets `linked_at` (§4.1) and is in the "same rows" test; "Bag photos record readings" copies its text. |
| **postgres-store** (before) | the async `Store` and `Db`, `schema.sql` at version 1, the area modules, the bed and ward locks, the test database and `PG_TEST_URL` | Every statement here is written for Postgres; the triggers and guard are added to its baseline with `SCHEMA_VERSION` 1 → 2 (§6). `linked_at` is set inside each link's locked `tx`; the ward default acuity route takes the ward lock first, joining its lock table. None of its MODIFIED requirements is one this change modifies. Its lock-first guard and race tests are unchanged, with `setWardDefaultAcuity` added to the guard |
| **read-queue** (after) | "Read mode fits the budget" (pressure clause, in-flight sentence, "Busy, not downgraded"); `/api/metrics`; the §2 latency budget | Its tasks 1.1 copy this text, which keeps tray-comparison's in-flight sentence and "Busy, not downgraded", as its design §9 asked. Its note that trays give way first under pressure now holds only for bedless and stable-bed trays. It adds `read_queue` to the metrics body. |
| **image-synthesis** (archived) | none | — |
| **fresh-schema** (archived first) | No upgrade steps; removed every older-store requirement | postgres-store carried the rule to Postgres; this change edits its baseline with one version bump, 1 → 2 (§6). "Stored media moves to files", the BLOB move, `media:inline` and bag-alerts' older-store requirement are gone. |

## 9. Open questions

- Whether `ACUITY_INTERVAL_H` should become a per-hospital setting. It is returned on each read and on the bed lookup, so the web needs no change either way.
