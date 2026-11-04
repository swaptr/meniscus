# Proposal

## Why

Today every bed is treated as if it might have every bag:
- the photo hint list, the by-hand "Bag level" switch and the round offer a urine, stoma and drain bag on every bed;
- a urine-bag reading on a bed with no catheter is charted silently, with nothing asking a nurse why;
- there is no way to say that a patient voids into a bedpan or commode, or uses the toilet and is not measured;
- a continent patient on the toilet whose urine nobody measures raises `low_urine_output` every 6 hours, from 0 mL.

The recorded demo needs both kinds of patient side by side. Most beds void into a urinal or commode, some are catheterised, one has a stoma, one a drain and one uses the toilet. Each bed should behave as its devices say.

## What Changes

- **Device orders** (`charting/care-plan`). How an admission's output is collected is recorded as care orders, reusing the catheter order rather than adding a second record of it:
  - **urine**: the existing `catheter` order means a catheter with a urine bag. A new `voiding` order `{ method }` (`urinal`, `bedpan`, `commode`, `toilet` or `pads`) says how a patient without one passes urine. With neither, the default is `urinal`.
  - **stoma**: a new `stoma` order `{ type }` (`colostomy` or `ileostomy`) means a stoma bag.
  - **drain**: a new `drain` order `{ site }` (`abdominal`, `chest`, `pelvic` or `wound`) means a drain bag.
  - All three follow the care-order rules: set and ended by a nurse or matron, a time range with history, no prompt of their own, and no model request.
- **`devices` on chart reads** (`charting/care-plan`). `GET /api/admissions` items and `GET /api/admissions/:id/entries` carry `devices`: the urine method and where it comes from (`catheter`, `voiding` or `default`), whether urine is measured (not for `toilet` or `pads`), and the bags on record.
- **Bag reading without the device** (`charting/bag-periods`). A reading of a bag the bed has no order for is still saved and charted, as now. It also raises `bag_without_device` (amber), for example `Urine bag reading at 10:30, but no catheter is on the care plan. Review.`. Adding the order clears it. Readings taken while an order was in force never raise it.
- **Unmeasured urine** (`charting/alerts`, `web/ward`). While urine is not measured (`devices.urine_measured` false: `toilet` or `pads`, with no catheter), neither `low_urine_output` nor `overload` is raised, so neither are `mismatch` and `intake_incomplete`. The balance chart labels its output `Output (urine not measured)` and notes `Urine not measured` after the balance; the printable chart heads its output column `Out (urine not measured)` and ends its totals with the same note. Urinal, bedpan and commode entries count as today.
- **Bedpan and commode photos** (`capture/photo-reading`). `CONTAINER_KINDS` gain `bedpan` and `commode_pan`. Spark may return them (the reading prompt's container list names them too), SAM segments them, and their drafts are `out` / `urine`. The read makes the same requests as any photo read.
- **Capture follows the devices** (`web/capture`):
  - the photo container hint lists the bed's own containers first and never lists a bag the bed has no order for;
  - by hand, urine is labelled with the bed's method, and "Bag level" is offered only for the bed's bags, already on for urine on a catheterised bed (MODIFIED **Bag level by hand**);
  - a photo read as a bag the bed has no order for is drafted and saved as usual, with a warning that the nurse will be asked to review. A nurse or matron is offered "Add catheter" (or stoma, or drain).
- **Round** (`web/ward-round`): the same warning on a bag reading for a bed without that bag. Saving is unchanged.
- **Nurse views** (`web/ward`):
  - device rows and forms on the care plan;
  - device badges on bed cards;
  - `bag_without_device` coloured amber, with "Add catheter", "Add stoma" or "Add drain" for a nurse or matron.
- **Demo** (`scripts/demo-history.ts`, fictional):
  - catheters on HDU-1, 3A-3, 2C-5, 2C-2 and now 2C-6;
  - a drain order on 2C-2, whose drain readings already exist;
  - an ileostomy with stoma-bag readings on 2C-3;
  - commodes on 2C-1, 3A-4 and 5B-6, and a bedpan on HDU-3;
  - the toilet, unmeasured, on 3A-7;
  - every other bed on the urinal default;
  - each photo's evidence names its bed's own container (urinal, bedpan, commode pan; a urine bag only on catheter beds), so those photo entries now log reads.
  Every existing guard row is unchanged, and the guard gains 2C-3, device and evidence rows (design §8).
- **No schema change.** `care_order.kind` has no CHECK and its value is JSON. No stored column lists container kinds. `STORE_SCHEMA_VERSION` stays as it is, and scale-store and postgres-store are not edited.

### Upstream model requests per user action (before → after)

| Action | Before | After |
|---|---|---|
| Photo read (`sam+spark` / `spark`), including a bag on a bed without that bag, a bedpan or a commode pan | 3 / 1 | 3 / 1 (unchanged; no extra request on a device mismatch) |
| Setting or ending a `voiding`, `stoma` or `drain` order | — | 0 |
| Saving a bag reading on a bed without that bag; "Add catheter" from the check screen | 0 | 0 |
| `devices`, `bag_without_device`, the unmeasured-urine hold, capture choices | — | 0 |
| `POST /api/ai/explain` | 1 | 1 (its prompt list may hold `bag_without_device`; still no patient name) |

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `CARE_KINDS` / `CareKind` gain `stoma`, `drain` and `voiding`, after `catheter` and before `diet`. `CareValues` gains their values. The web's exhaustive care labels, forms and history text must handle them.
  - **BREAKING**: `CONTAINER_KINDS` / `ContainerKind` gain `bedpan` and `commode_pan`. The web's container labels and `SAM_CONCEPT` must add them.
  - **BREAKING**: `ALERT_KINDS` / `AlertKind` gain `bag_without_device`, after `bag_nearly_full`. The web's exhaustive `ALERT_LABEL` and `ALERT_TONE` must add it.
  - New: `VOIDING_METHODS`, `STOMA_TYPES`, `DRAIN_SITES`, `UNMEASURED_VOIDING`, `BAG_ORDER` (bag → care kind), `OutputDevices`, and the pure helper `outputDevices(orders)`, one source for the server and the web.
- HTTP:
  - **BREAKING**: `GET /api/admissions` items and `GET /api/admissions/:id/entries` gain `devices: OutputDevices`.
  - `PUT` and `DELETE /api/admissions/:id/care/{stoma,drain,voiding}` exist, under the care-order rules.
  - `POST /api/ai/read` accepts the hints `bedpan` and `commode_pan`, and its reading may name them.
  - Alerts may carry `bag_without_device`.

### Out of scope

- **Urostomy and nephrostomy**: their output is urine charted from a bag other than the urine bag. That needs its own category rule.
- **Several drains or stomas per patient**: one bag of each kind, as bag-alerts' capacities assume.
- **Weighed pads**: `pads` means unmeasured. No weight-to-volume entry.
- **Reading-due prompts for stoma and drain bags**: still catheter only (bag-emptying).
- **Refusing a bag reading on a bed without the bag**: it is charted and flagged, never refused.
- **New synthetic images or eval items for bedpans and commode pans**: `synth` and `eval` need the user's approval to send requests.
- **Any automatic device change**: a reading never sets an order.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `charting/care-plan`: adds **Output device orders**, **Output device order values** and **Output devices on chart reads**; MODIFIED **Care status on chart reads** (the device kinds in the order list).
- `charting/bag-periods`: adds **Bag reading without the device**.
- `charting/alerts`: MODIFIED **Low urine output** (a commode and bedpan scenario) and **Fluid overload** (not while urine is not measured); adds **Urine not measured**.
- `capture/photo-reading`: adds **Bedpan and commode reads**.
- `web/capture`: MODIFIED **Bag level by hand**; adds **Capture choices follow the bed's devices** and **Bag photo on a bed without that bag**.
- `web/ward-round`: adds **Bag readings on beds without the bag**.
- `web/ward`: adds **Output devices on the care plan**, **Device badges on bed cards**, **Urine rate not drawn when not measured** and **Bag without a device on the bed review**; MODIFIED **Change care orders from the bed review** (the device kinds in the add menu), **Fluid balance chart** and **Printable daily chart** (urine not measured).

20 requirements: 13 added and 7 modified. Each MODIFIED block copies the latest text in the order accuracy-views → dietitian-care → model-api-guards → meta-wire-types-refresh → this change:
- **Change care orders from the bed review** as dietitian-care modifies it;
- **Low urine output** as bag-alerts archived it, body verbatim (496 characters, no room for the hold, which is **Urine not measured**), with one scenario added;
- **Fluid overload**, **Care status on chart reads**, **Fluid balance chart**, **Printable daily chart** and **Bag level by hand** as live (bag-emptying archived the last), none modified by an earlier change.

## Impact

- `packages/shared/src/index.ts`: the kinds, values, constants and `outputDevices` above.
- `apps/server`:
  - `src/chart/care.ts`: the three order codecs;
  - `src/routes/care.ts`: their validation;
  - `src/chart/bags.ts`: `bag_without_device`;
  - `src/chart/alerts.ts`: the unmeasured hold;
  - `src/chart/view.ts`: `devices` on both reads;
  - `src/ai/reading.ts`, `src/ai/draft.ts` and `src/ai/segmentation.ts`: the two containers;
  - `scripts/demo-history.ts`.
- `apps/web`:
  - `lib/bags.ts`, `lib/capture.ts`, `lib/round.ts`, `lib/care.ts`, `lib/labels.ts`;
  - `routes/a/bed.$token.tsx`, `routes/a/round.tsx`;
  - `components/care-plan.tsx`, `components/care-forms.tsx`, `components/care-badges.tsx`, `components/bag-reading.tsx`, `components/bed-charts.tsx`;
  - `routes/n/$id_.print.tsx`, `routes/n/w.$ward.tsx`.
- README: "Emptying bags" gains devices.
- No new dependencies, no env vars, no schema version change, no new model calls.
- Order: … → model-api-guards → meta-wire-types-refresh → **patient-devices** → ui-polish → scale-store → postgres-store → read-queue. For the overlaps with ui-polish (**Care badges on bed cards**) and scale-store (**Bag photos record readings**, **Bag readings in the round**), see design §9.
