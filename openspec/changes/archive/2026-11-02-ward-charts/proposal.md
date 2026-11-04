# Proposal

## Why

The nurse screens show totals as numbers in a table. A nurse, or a judge watching a 3-minute video, can't see the shape of a patient's day at a glance: when they drank, whether urine output is falling below the 0.5 mL/kg/h line that the low-output prompt uses, or where logging stopped. The voice button also gives no sign that it is hearing anything. Charts drawn from data we already store fix both, at zero model cost.

## What Changes

- **New: hourly series on admissions.** `GET /api/admissions` adds `hourly.in_ml`, `hourly.out_ml` (approved volume) and `hourly.in_logged` (non-rejected intake count) per admission: 24 rolling hourly buckets.
- **Bed review** gains:
  - a 24 h cumulative fluid balance chart: intake and output step lines with the balance;
  - a urine output rate chart (6 h rolling, mL/kg/h) with the 0.5 threshold line and below-threshold points marked, which shows why "low output" fired;
  - stacked intake and output bars by category;
  - a photo strip of the day's captures that opens each entry's evidence.
- **Ward dashboard:** each bed card gets a 24-cell activity strip of logged intake, so logging gaps stand out across the ward.
- **New printable daily chart:** `/n/<id>/print`, an I&O sheet by clock hour laid out like the paper form.
- **Voice capture:** while recording, the voice tile becomes "Stop and send", with an elapsed `m:ss / 1:00` timer and a live input level meter below it.
- **Intake and output log** (task 3.0): a data table grouped by 12-hour shift, with filters, column sort and 25 rows a page.

Upstream model requests per user action: **none change**.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `charting/entries`: adds "Hourly series".
- `web/ward`: adds:
  - "Fluid balance chart"
  - "Urine output rate against the threshold"
  - "Intake and output breakdown"
  - "Photo strip"
  - "Ward activity strip"
  - "Printable daily chart"
  - "Intake and output log by shift"
  - "Filter and sort the log"
- `web/capture`: adds "Recording feedback".

## Impact

- **`packages/shared`:** **BREAKING** (web-consumed, additive): `AdmissionSummary.hourly: { in_ml: number[]; out_ml: number[]; in_logged: number[] }`.
- **`apps/server`:** `store.admissions()` computes the buckets from the 24 h entries. Tests are in `chart.test.ts`.
- **`apps/web`:**
  - new `lib/charts.ts` (pure series maths);
  - new `components/charts.tsx` (hand-written SVG; no chart library, keeping each route under 100 KB gzipped);
  - routes `n/$id.tsx`, new `n/$id_.print.tsx`, `n/w.$ward.tsx` (from hospital-wards) and `a/bed.$token.tsx`;
  - `lib/recorder.ts` gets an `AnalyserNode` level and elapsed time through `listen()`, with injectable browser parts for tests.
- **Demo data:** `apps/server/scripts/synthetic-photo.ts` draws a synthetic urine bag (PNG) matching the stored SAM boxes, and `demo-history.ts` attaches it to photo entries so the photo strip and overlay have something to show. No real images.
- **Depends on:** `hospital-wards` (ward dashboard route) and `entry-evidence` (the photo strip opens the evidence view). Apply after both.

## Out of scope

- A jug level timeline.
- A ward stats strip and a model activity panel.
- A shift handover summary, which would need 1 model call.
- Exporting charts as images.
