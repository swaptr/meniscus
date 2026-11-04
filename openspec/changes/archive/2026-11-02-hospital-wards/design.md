# Design

## Context

Today the store seeds six admissions on beds `1`–`6` with a global `UNIQUE(bed)`. `GET /api/admissions` returns them all, and every web screen (`/n`, `/a`, `/n/qr`, `/a/round`) works on that single flat list. Bed review and capture already key on the admission id and the QR token, never on the bed label, so wards can be added around them without touching entries, levels, photos or alerts.

## Types (packages/shared)

```ts
export interface Ward {
  id: number
  code: string // "5B"
  name: string // "Neurology Ward 5B"
  specialty: string // "Neurology"
  capacity: number
}

export interface WardSummary extends Ward {
  occupied: number
  pending: number
  beds_with_alerts: number
  /** Newest entry (any status) in the last 24 h. */
  last_entry_at: string | null
}

/** Response of GET /api/wards. */
export interface HospitalSummary {
  hospital: string
  wards: WardSummary[]
}

export interface Admission {
  // existing fields …
  ward_id: number
  ward_code: string
  ward_name: string
  mrn: string // fictional in the demo hospital
}
```

`AdmissionSummary` and `EntryList.admission` pick the new fields up through `Admission`.

## Decisions

### Store (apps/server/src/store)

- **Schema.** A new `ward` table: `id`, `code UNIQUE`, `name`, `specialty`, `capacity`.
  - New databases create `admission` with `ward_id INTEGER NOT NULL REFERENCES ward(id)`, `mrn TEXT NOT NULL` and `UNIQUE(ward_id, bed)` in place of the global `UNIQUE(bed)`, since bed 4 now exists on several wards.
  - Index `admission(ward_id)`.
- **Pre-ward databases.** In `migrate()`, before `SCHEMA` runs:
  - When `admission` exists without `ward_id` **and has rows** (an empty legacy table is dropped and re-created by `SCHEMA` instead, so the seed gets the new constraint): create `ward`, insert `W1` "Ward 1" (specialty "General", capacity = admission count), `ALTER TABLE admission ADD COLUMN ward_id INTEGER REFERENCES ward(id)` and `ADD COLUMN mrn TEXT`, then set `ward_id` to W1 and `mrn = 'W1-' || bed`.
  - The legacy global bed uniqueness stays. It is harmless with one ward.
  - Alternative considered: rebuilding the table to change the constraint (the 12-step SQLite rebuild). Rejected as more code and risk for dev-only files.
- **Seed data** lives in a new `store/demo-hospital.ts`:
  - Ward rows, plus patient rows (bed, fictional name, weight, MRN `AT-1xxxxx`).
  - Tokens stay random (`randomBytes(16)` base64url).
  - Fixed MRNs keep the data deterministic and visibly fake.
  - The founder-story patients from the old six-bed ward become ward 5B beds 1–6, so the demo history keeps its story.
  - Occupied beds: 2C 1, 2, 3, 5, 6 (bed 4 vacant); 3A 1–7 (bed 8 vacant); 5B 1–6; HDU 1–3 (bed 4 vacant).
- **Hospital name.** The constant `HOSPITAL_NAME = 'Meniscus Demo Hospital'` is exported from the same module. No table: one hospital per deployment.
- **Queries.**
  - `admissions(wardId?)` joins `ward` and filters with `WHERE ?1 IS NULL OR a.ward_id = ?1`, ordered by `w.code, CAST(a.bed AS INTEGER), a.bed`.
  - `wards()` returns ward rows with `occupied`, `pending` and `last_entry_at` from one grouped query.
  - `ward(id)` is used for the 404 check.
  - `toAdmission` maps the ward fields explicitly, which keeps the existing key-pinning test meaningful.

### Routes (apps/server/src/routes/chart.ts)

- `GET /wards` composes `store.wards()` with `alertsFor` over each ward's admissions to count `beds_with_alerts`. Alert logic stays out of the store; this matches `/admissions`.
- `GET /admissions?ward=` parses the value with the existing `id()` helper. A malformed or unknown value returns 404 `not_found`. No zod schema is needed for a single optional id.

### Web (apps/web)

- **`api.ts`:** `wards(signal)` and `admissions(ward?, signal?)`.
- **`ward.ts`:**
  - `ago(iso | null, now)` gives "just now", "12 min ago", "3 h ago" or "No entries today".
  - `wardCard(w, now)` returns the card strings.
  - Both are pure, so tests need no DOM.
- **Routes:**
  - `/n/` becomes the ward list. Cards link to `/n/w/$ward`.
  - The new file route `n/w.$ward.tsx` holds the old `/n` table, fed by `api.admissions(ward)`.
  - `/n/$id` gains a breadcrumb (ward list › ward › bed) and shows the MRN.
  - `/n/qr` and `/a/round` take a `ward` search param via `validateSearch`.
  - Per-ward resources are keyed by ward id (`ward:${id}`): the component stays mounted when only the param changes.
  - The ward dashboard header comes from `ward_name` on the admissions it loads, so opening a ward is one request.
  - `/a/` groups beds by `ward_code`. Each ward has a "Start ward round" link to `/a/round?ward=<id>`.
- **Round:**
  - `RoundBed` gains `ward_id` and `ward_code`.
  - The state gains `ward: { id, code, name, beds: RoundBed[] } | null` and `visited: number[]` (admission ids).
  - The route loads the ward's admissions and calls `round.setWard(...)`.
  - `onPhoto` adds the current bed to `visited` when it belongs to the round's ward. Otherwise it returns the new outcome `other_ward`, and the bed still becomes current.
  - Rounds started without a ward behave as today: no grid.
- **QR cards.** `bedCard` takes `ward_code` and `ward_name`. Its label is `5B · Bed 4`, with the ward name as a sub-label.
- **Sidebar.** The "Ward" link becomes "Wards".

### Demo history (apps/server/scripts/demo-history.ts)

- History rows are keyed by `[wardCode, bed]`. The story rows move to 5B unchanged.
- Every other occupied bed gets a generated routine day: intake of about 250–350 mL every 3 h, the latest within the last 2 h, and urine of about 300–400 mL every 3 h, the latest within the last 2 h. Small per-bed offsets keep it from looking copy-pasted. All entries are approved, so no low-output or logging-gap prompt fires: 6 h of urine is at least 600 mL, against at most 270 mL needed at 90 kg.
- Two extra realistic cases:
  - HDU bed 2 on IV fluids, which raises overload.
  - 3A bed 5 with two pending captures.

## Risks / Trade-offs

- [Every bed loads alert inputs on `/wards`, about 21 `recent()` queries] → These are small indexed SQLite reads in a single process. It is fine at hospital-ward scale. Revisit with a ward-level query only if it shows in timings.
- [Bookmarks to `/n` now land on the ward list, not the bed table] → It is one tap more, and the ward list is the better nurse home.
- [A legacy dev database keeps the global `UNIQUE(bed)`] → It has only one ward. New wards are added only by seeding an empty store.
- [Fictional MRNs could look real] → The prefix `AT-` and the "demo" hospital name mark them as fake. QR cards never show a name or MRN.

## Migration Plan

Existing `DATA_DIR` files migrate in place on the next start into ward `W1`. For the full demo hospital, start on a fresh `DATA_DIR` and run `pnpm --filter @meniscus/server demo`. There is nothing to roll back beyond the file: the old code would reject the extra columns only if it re-created the tables, and it doesn't.
