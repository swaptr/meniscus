# Proposal

## Why

Meniscus looks like a single six-bed ward that someone typed in by hand, which makes it hard to picture inside a real hospital. A ward nurse would expect the opposite: the hospital census already lists every ward, bed and admitted patient, and staff only scan a bed card to start collecting evidence. The demo, and the judges' "would this work in my world" test, need that integrated look.

## What Changes

- A fictional hospital, **Meniscus Demo Hospital**, seeded on an empty store as if loaded from the hospital census:
  - Four wards: Surgical Ward 2C, Medical Ward 3A, Neurology Ward 5B and Renal HDU.
  - Each ward has a bed capacity and fictional admitted patients, each with an MRN, a weight and an admission time.
  - This replaces the single six-bed demo ward.
- **New** `GET /api/wards`: the hospital name and, per ward, its capacity, occupied beds, pending entries, beds with review prompts and last activity.
- **New** `GET /api/admissions?ward=<id>` filter. Without the filter the list covers the whole hospital, ordered by ward code and then by bed number.
- Every admission response gains `ward_id`, `ward_code`, `ward_name` and `mrn`. This is additive to `Admission`, `AdmissionSummary` and `EntryList.admission`.
- A store created before wards opens with its admissions placed in a single ward `W1`, keeping their entries and QR tokens.
- **Web: nurse:**
  - `/n` becomes the hospital's ward list.
  - `/n/w/<id>` is the per-ward dashboard, which is the old `/n` table filtered to that ward.
  - The bed review shows ward, bed and MRN.
- **Web: attendant:**
  - `/a` groups beds by ward, with a "Start ward round" button per ward.
  - A ward round started for a ward shows a grid of that ward's beds, ticked as their cards are scanned.
- **Web: QR cards** print per ward, labelled with the ward code and bed, still without patient names.
- `pnpm --filter @meniscus/server demo` writes history for every occupied bed, so quiet beds don't all raise low-output or logging-gap prompts. The story beds move to Neurology Ward 5B.
- **BREAKING (web):** `/n` no longer renders the bed table. Links to it now land on the ward list.

Upstream model requests per user action: **none change** (every request count stays the same; all new endpoints make 0 requests).

## Capabilities

### New Capabilities

- `charting/wards`: the hospital's wards and their census. Covers seeding the demo hospital, the ward summary list, filtering admissions by ward, the ward fields carried on every admission, and opening pre-ward stores.

### Modified Capabilities

- `charting/entries`: the "Demo ward" requirement is removed. Seeding moves to `charting/wards` as "Demo hospital".
- `web/ward`: adds the hospital ward list as the nurse home and the per-ward dashboard.
- `web/ward-round`: adds per-ward progress, with that ward's beds ticked as their cards are scanned.
- `web/bed-qr`: bed cards carry the ward code and ward name next to the bed number.

## Impact

- **`packages/shared`:**
  - New `Ward`, `WardSummary` and `HospitalSummary` types.
  - `Admission` gains `ward_id`, `ward_code`, `ward_name` and `mrn`. This flows into `AdmissionSummary` and `EntryList`.
- **`apps/server`:**
  - `store/store.ts`: `ward` table, `admission.ward_id`/`mrn`, seed, pre-ward migration and ward queries.
  - `routes/chart.ts`: `/wards` and `?ward=`.
  - `scripts/demo-history.ts`.
  - Tests in `chart.test.ts`.
- **`apps/web`:**
  - Routes `n/index.tsx` (ward list), new `n/w.$ward.tsx`, `n/$id.tsx`, `a/index.tsx`, `a/round.tsx` and `n/qr.tsx`.
  - Libs `ward.ts`, `round.ts`, `qr.ts` and `api.ts`, with their tests.
- **Docs:** README screens table.
- **No new dependencies and no model requests.**

## Out of scope

- A real census or ADT/FHIR import.
- Admit, discharge and transfer.
- QR cards for vacant beds.
- Staff login and per-ward access.
- Entry evidence (SAM overlay, audit trail) and charts. Those are separate changes.
