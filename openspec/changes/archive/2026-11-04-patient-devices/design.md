# Design

## Context

See proposal.md, "Why". This change applies after bag-alerts, accuracy-views, dietitian-care, model-api-guards and meta-wire-types-refresh have archived. The state today, for a bed with no bag:

- **Capture.** The bed screen's `HINTS` (`apps/web/src/routes/a/bed.$token.tsx:84`) list the urine, stoma and drain bags on every bed. `bagOfCategory` (`apps/web/src/lib/bags.ts:55`) offers "Bag level" for any urine, stoma or drain output. A photo read as a bag becomes a bag reading through `bagContainer` (`lib/bags.ts:49`), whatever the bed.
- **Server.** `POST /api/admissions/:id/bag-readings` accepts any bag on any admission. Nothing ties a bag to an order.
- **Prompts.** `bag_reading_due` and `bag_reading_overdue` already need an active catheter order (charting/bag-periods "Urine bag reading due"). `bag_level_fell` and `bag_nearly_full` come only from readings, so a bed with no readings never raises them. These need no change.
- **Low output and overload.** `low_urine_output` (`apps/server/src/chart/alerts.ts`) counts any approved urine entry, urinal ones included. So a bed that voids into a urinal already works. A bed whose urine nobody measures is flagged from 0 mL, and `overload` (charting/alerts "Fluid overload") counts its whole intake against 0 mL of output: 3A-7 drinks about 2400 mL a day (`scripts/demo-history.ts` `routine`). The bed review's balance chart and the printable chart show the same balance (web/ward "Fluid balance chart", "Printable daily chart").
- **Store.** `care_order.kind` has no CHECK ("the route validates it"), and `value` is JSON. No column constrains container kinds: `level.container` and `model_read.output` are free TEXT or JSON.
- **Containers.** `CONTAINER_KINDS` (`packages/shared/src/index.ts:10`) drive Spark's JSON-schema enum (`apps/server/src/ai/reading.ts:39`), the read hint (`routes/ai.ts:52`), `SAM_CONCEPT` (`ai/segmentation.ts:55`) and `CONTAINER_CATEGORY` (`ai/draft.ts:25`).

## Goals / Non-Goals

**Goals:**
- One record of each output device, reusing the catheter order.
- `devices` computed once, in `packages/shared`, for both the server and the web.
- No refusal and no extra model request when a reading and the devices disagree.

**Non-Goals:**
- Inferring a device from readings. A reading never sets an order.
- Changing any existing review prompt's wording, or the bag rules of charting/bag-periods. The Spark reading prompt only gains the two container names (§6).

## Decisions

### 1. Types (`packages/shared`)

```ts
export const CARE_KINDS = [
  'acuity', 'nil_by_mouth', 'thickened_fluids', 'fluid_limit', 'intake_target', 'catheter',
  'stoma', 'drain', 'voiding', // patient-devices
  'diet',                      // dietitian-care: still last
] as const

export const STOMA_TYPES = ['colostomy', 'ileostomy'] as const
export type StomaType = (typeof STOMA_TYPES)[number]
export const DRAIN_SITES = ['abdominal', 'chest', 'pelvic', 'wound'] as const
export type DrainSite = (typeof DRAIN_SITES)[number]
export const VOIDING_METHODS = ['urinal', 'bedpan', 'commode', 'toilet', 'pads'] as const
export type VoidingMethod = (typeof VOIDING_METHODS)[number]
/** Voiding methods whose urine is not measured: no low_urine_output. */
export const UNMEASURED_VOIDING = ['toilet', 'pads'] as const satisfies readonly VoidingMethod[]

export interface CareValues {
  // …existing kinds
  stoma: { type: StomaType }
  drain: { site: DrainSite }
  voiding: { method: VoidingMethod }
}

export const CONTAINER_KINDS = [
  'urinal', 'urine_bag', 'stoma_bag', 'drain_bag', 'bedpan', 'commode_pan', // + bedpan, commode_pan
  'emesis_basin', 'water_jug', 'water_bottle', 'cup', 'measuring_jug', 'food_tray', 'other', 'none',
] as const

/** The care kind whose active order puts each bag on record. */
export const BAG_ORDER = { urine_bag: 'catheter', stoma_bag: 'stoma', drain_bag: 'drain' } as const satisfies Record<
  BagContainer,
  CareKind
>
/** The container a voiding method's urine is measured in; null when it is not measured. */
export const VOIDING_CONTAINER = {
  urinal: 'urinal', bedpan: 'bedpan', commode: 'commode_pan', toilet: null, pads: null,
} as const satisfies Record<VoidingMethod, ContainerKind | null>

export type UrineMethod = 'catheter' | VoidingMethod
export interface OutputDevices {
  urine: UrineMethod
  urine_from: 'catheter' | 'voiding' | 'default'
  urine_measured: boolean
  /** In BAG_CONTAINERS order. */
  bags: BagContainer[]
}
/** Pure: the active orders → the devices on record. */
export function outputDevices(active: readonly CareOrder[]): OutputDevices

// ALERT_KINDS gains 'bag_without_device' after 'bag_nearly_full'.
// AdmissionListItem and EntriesResponse gain `devices: OutputDevices`.
```

`@meniscus/meta` is unchanged. The reading contract widens only through `CONTAINER_KINDS`.

### 2. Device model: care orders, reusing the catheter (chosen)

**Choice.** Urine is the existing `catheter` order or a new `voiding` order, with `urinal` when neither is active. Stoma and drain are new `stoma` and `drain` orders. All are rows of `care_order`, so they get, at no extra cost:
- ranges, history and the nurse-or-matron rule;
- the "in force at its charted time" lookup that `bag_without_device` needs;
- the care plan UI and the scale-store version triggers.

A catheter takes precedence over a voiding order, which may stay active as the plan for after the catheter comes out (a trial without catheter).

**Alternative: a per-admission `devices` record** (a table or a column, set by nurses or matrons). It would duplicate the catheter: the catheter day, the necessity review and the reading-due clock all already read the catheter order. Two sources for "has a catheter" would drift. It would also need its own history, audit and permission rules, and a schema version bump. Rejected.

**Alternative: derive devices from readings** ("this bed has had a urine-bag reading, so it has a catheter"). It is simple, but it is exactly the silent case this change removes, and it cannot express "uses the toilet". Rejected.

**Default `urinal`.** It needs no order, keeps every existing bed and test behaving as today for urine, and is the commonest method on a general ward. A ward-level default was considered and left out: no ward in the demo needs another.

### 3. `devices` on the reads

`chart/view.ts` calls `outputDevices(activeOrders)` next to `care`. It is a top-level field, not inside `care`, so charting/care-plan "Care status on chart reads: Fresh store" keeps its exact `care` object. The web reads it from the two loads it already makes. The round reads it from the ward list. There is no new endpoint.

### 4. `bag_without_device` (`apps/server/src/chart/bags.ts`)

For each bag in `BAG_CONTAINERS` order:
- take its readings charted in `(now − 24 h, now]`;
- keep those charted when no `BAG_ORDER[bag]` order was in force, from its start (included) to its end (excluded), using the full order history `care.ts` already loads for the catheter chain;
- raise the prompt if any remain and no such order is active now, naming the newest one's charted time.

Missing-order words: catheter, stoma, drain. One alert per bag, so a bed can hold two at once. The web keys alerts by index, not kind (task 4.4 checks this).

**Why an alert and not a refusal or a flag on the reading.** A refusal would lose a real measurement at the bedside. A flag on the reading would need a column, so a schema bump, and a way to clear it. The alert is derived, clears itself when the order is added, and already reaches the dashboard, `beds_with_alerts` and Explain.

### 5. Unmeasured urine (`apps/server/src/chart/alerts.ts`, web)

- **Spec shape.** The live **Low urine output** body is 496 characters, so it has no room for the condition. It is MODIFIED with its body copied verbatim and one scenario added (commode and bedpan entries count). The hold is its own ADDED requirement, **Urine not measured**, tied to `devices.urine_measured` and stating that it wins over **Low urine output** and **Fluid overload**. **Fluid overload** is MODIFIED to say so in its own body.
- **Server.** `lowUrineOutput` and the overload check return nothing when `!devices.urine_measured`. `mismatch` and `intake_incomplete` depend on low output, so they follow. The window, spreading and messages are untouched. Other output (stoma, drain, emesis) still counts in the balance; it simply never raises `overload` on such a bed.
- **Web.** The balance chart labels its output line `Output (urine not measured)` and follows the balance with `Urine not measured`. The printable chart heads its output column `Out (urine not measured)` and ends its totals row with the same note. Both read `devices` from the entries load the page already makes. The dashboard bed card's balance figure (`routes/n/w.$ward.tsx`) gets the same note from the list item's `devices` through `balanceNote` (scenario "Urine not measured" under **Device badges on bed cards**). The urine rate chart shows `Urine not measured` instead of the plot: `rateMessage(points, measured)` checks the flag before the weight, and `BedCharts` (whose `devices` prop is required) skips `urineRate`. The live rate body is 498 characters, so this is its own ADDED requirement, **Urine rate not drawn when not measured**. A switch from toilet to a measured method can raise the prompt at once, from 0 mL (spec scenario "Measured again"). This is accepted: it says "Review", and starting the window at the switch would need another rule that the 500-character body has no room for. A follow-up can add it.

### 6. Bedpan and commode pan (`apps/server/src/ai`)

- `SAM_CONCEPT`: `bedpan: 'bedpan'`, `commode_pan: 'commode pan'`.
- `CONTAINER_CATEGORY`: both map to `urine`, as `urinal` does.
- `draft.ts`'s item rule already turns `commode_pan` into `commode pan`.
- The Spark JSON schema's `container` enum comes from `CONTAINER_KINDS`, so it gains the two values. The prompt itself lists containers in prose (`READING_SYSTEM`, `reading.ts:66`: "urinals, urine/stoma/drain bags, …"), not from the enum, so that prose gains "bedpans, commode pans" after "urinals" (task 3.5). No other wording changes. The request counts are unchanged.
- **Eval baseline.** The recorded eval results predate the two kinds and the prose change, so they are stale for `bedpan` and `commode_pan` (no items) and, strictly, for every photo read, as the prompt text changed. Re-running the eval sends requests and needs the user's approval; this change does not do it.
- No synthetic images and no eval items are added: those send requests and need the user's approval (AGENTS.md).

### 7. Web (`apps/web`)

- `lib/capture.ts`: `hintsFor(devices)` builds the hint list in the spec's order from `VOIDING_CONTAINER`, `devices.bags` and the fixed intake list. `HINTS` becomes the label map.
- `lib/bags.ts`: `bagOfCategory(category, devices)` returns a bag only if it is in `devices.bags`. `bagMismatch(container, devices)` gives the check-screen and round warning.
- `routes/a/bed.$token.tsx`:
  - the "Bag level" switch starts on when offered;
  - urine by hand gets `item` from `VOIDING_CONTAINER`, or the catheter's `urine bag` when "Bag level" is off;
  - toilet and pads show the not-measured line;
  - after a mismatched save, a nurse or matron gets "Add <device>", which mounts the existing `care-forms.tsx` form for that kind.
- `components/bed-charts.tsx` / `lib/charts.ts` (balance chart) and `routes/n/$id_.print.tsx`: the `Urine not measured` labels (§5).
- The add-order control lists stoma, drain and urine collection between catheter and diet (MODIFIED **Change care orders from the bed review**, copied from dietitian-care).
- `components/care-plan.tsx`, `care-forms.tsx` and `care-badges.tsx` gain the three kinds, with the labels in `lib/labels.ts`. `ALERT_LABEL` and `ALERT_TONE` (exhaustive) gain `bag_without_device`.

### 8. Demo seed (`scripts/demo-history.ts`)

| Urine / bags | Beds |
|---|---|
| Catheter (urine bag) | HDU-1, 3A-3, 2C-5, 2C-2, **2C-6** (new: urethral, ordered at `ADMITTED + HOUR` like 3A-3, reviewed today by Meera Pillai) |
| + drain | **2C-2**: `{ site: "abdominal" }`, set with its catheter 24.5 h ago, so its three drain readings are in force |
| Stoma | **2C-3**: `{ type: "ileostomy" }` from admission; stoma bag emptied at 300, 260 and 280 mL about every 6 h, newest a check at 150 mL 1 h ago (below 400 mL, 80% of 500) |
| Commode | 2C-1, 3A-4, 5B-6 |
| Bedpan | HDU-3 |
| Toilet, not measured | **3A-7**: its routine urine rows are dropped |
| Urinal (default) | every other bed, 5B-4, 5B-5 and HDU-2 included |

**Evidence follows the device.** Today every photo urine entry not marked `container: 'urinal'` gets `urine_bag` evidence (`evidenceFor`, `demo-history.ts:454-493`), on beds with no catheter. After this change each photo carries its bed's own container:
- **Urine entries**: `urinal` on default beds, `bedpan` on HDU-3, `commode_pan` on 2C-1, 3A-4 and 5B-6, as synthetic `vesselEvidence` with drawn vessels (`VESSEL` gains `bedpan`, 1000 mL, and `commode_pan`, 1500 mL, boxed like the urinal), and `item` `bedpan` or `commode pan` on those beds' urine rows. No entry carries `urine_bag` evidence: urine-bag photos exist only as bag readings, and only on the catheter beds, whose urine rows are already dropped (`bagBeds`).
- **Bag readings**: `urine_bag` evidence only on the catheter beds above. Stoma and drain readings (2C-3, 2C-2) stay by hand, with no photo and no read; any photographed one would carry `stoma_bag` or `drain_bag`.
- **Story wording.** 5B-4's "latest bag is dark amber" and 5B-5's "pink-tinged urine in the latest bag" become the latest urinal; 5B-6's low-confidence note becomes `pan tilted, marks partly hidden`. Their prompts come from colour, notes and volumes, so they are unchanged.

**Read mix.** A non-bag photo logs a read (`entryRead`, `demo-history.ts:734-736`), so every photo urine entry now has a linked read where it had none:
- `accepted` gains every approved photo urine entry on the routine, care-routine, 5B story and HDU-2 beds;
- `pending` gains the three pending urine photos (5B-1's 400 mL, 5B-6's 300 mL, 3A-5's 350 mL), beside the voice notes;
- `corrected_by_nurse`, `edited_at_capture`, `rejected`, `abandoned`, `negative_confirmed`, `negative_overridden` and `nothing_drafted` are unchanged, as are the 3A-1, 3A-2, 3A-6, 3A-5 and 2C-3 fixed records;
- dropping 3A-7's urine rows removes no read, as they carried bag evidence and had none;
- the Model accuracy view's per-container rows gain `bedpan` and `commode_pan` (accuracy-views).

The header comment's model-accuracy paragraph says so, and drops "every photo entry but a bag's" and "Bag-photo entries have no read".

**Expected prompts.**
- **Existing rows unchanged.** 2C-6 stays `['bag_level_fell']`: its catheter clears `bag_without_device`, its newest reading 2 h ago is inside the 4 h interval, and its review is recorded. 2C-2 stays `['bag_nearly_full']`. 3A-3 stays `[]`. 3A-7 stays `[]`: "Urine not measured" holds both `low_urine_output` and `overload`, though it has about 2400 mL of intake and no output. 2C-1, 3A-4, 5B-6 and HDU-3 are unchanged, because voiding orders raise nothing and their urine still counts.
- **2C-3: `[]`.** Its routine day is prompt-free today (task 6.1 confirms it before the change). With its ileostomy and stoma readings: no `bag_without_device`, as the stoma order is in force from admission; no `bag_nearly_full`, as 150 mL is below 400 mL; no `bag_level_fell`, as the check follows an emptying; no `bag_reading_due` or `_overdue`, which are catheter only; no `low_urine_output`, as its urinal entries are unchanged and stoma output is not urine; no `overload`, as the 840 mL emptied only adds output.

**The guard** (`INTENDED` and the read-mix block):
- every existing `INTENDED` row unchanged, and `'2C-3': []` added;
- each admission's `devices` equal to the table above;
- no bed raising `bag_without_device`;
- the read-mix checks unchanged, plus: no entry's photo evidence names `urine_bag`; every photo urine entry's evidence container is its bed's `VOIDING_CONTAINER[devices.urine]`; and every photo urine entry links a read.

The recorded demo shows the mismatch live: on 3A-5 (default urinal), a bag photo read against the fake upstream.

### 9. Overlaps with other changes (not edited here)

- **dietitian-care** MODIFIES web/ward **Change care orders from the bed review**, whose "Acuity not offered here" scenario lists the add menu exactly. This change MODIFIES it again, copying dietitian-care's block and adding stoma, drain and urine collection to that list and to "Form defaults".
- **charting/care-plan "Care status on chart reads"** lists the `care.orders` order exactly, ending at catheter. dietitian-care left it unmodified because `diet` goes last. The device kinds go between catheter and diet, so this change MODIFIES it (live block, no in-flight change modifies it), listing `stoma`, `drain`, `voiding` and `diet` after catheter, with a scenario for the order.

- **ui-polish** MODIFIES web/ward **Care badges on bed cards**. Its block was copied before this change. Its rule ("one badge per active order other than acuity") already covers the device kinds, and this change's **Device badges on bed cards** gives their text. When ui-polish applies, its implementation must keep the device badges. No spec text conflicts.
- **scale-store**:
  - It MODIFIES web/capture **Bag photos record readings** and web/ward-round **Bag readings in the round**. This change modifies neither and adds separate requirements, so its archive drops nothing.
  - Its cached status unit must include `devices`, which is computed from `care_order`, already covered by its version triggers.
  - This change adds no schema and leaves the SQLite `STORE_SCHEMA_VERSION` unchanged. Later changes keep their own version lines.
- **postgres-store**: there is no new table. `care_order.value` as `jsonb` holds the new values. Its importer's accepted version is its own line, which this change does not touch.
- **read-queue**: a queued photo that completes later shows the same mismatch warning when it is saved, because the check uses the bed's `devices` at save time.

## Risks / Trade-offs

- [Existing tests post bag readings on beds without a catheter and assert exact alert lists] → they will now also see `bag_without_device`. Where the scenario's bed has the bag in the live spec story (3A bed 3, HDU bed 1), add the catheter to the fixture. Where the scenario is about a bed with no catheter (2C bed 6 "No catheter order"), assert that the prompt is included. Never drop an assertion.
- [The "Bag level" switch disappears on fixtures with no orders] → web tests for **Bag level by hand** set `devices.bags` in their fixtures, as the modified scenarios say.
- [Spark may now name `bedpan` or `commode_pan` for photos it used to call `urinal`] → both draft `out` / `urine`, as a urinal does, so the chart is the same. Per-container accuracy splits into the new rows.
- [`toilet` hides a real low output or overload] → it is the nurse's choice of method. The care plan row, the balance chart and the printable chart say `not measured`, and a catheter or measured method brings both prompts back.
- [Two `bag_without_device` on one bed] → alerts are keyed by index (task 4.4).

## Migration Plan

- **No schema change.** `STORE_SCHEMA_VERSION` is not changed. Stores made by the previous build open, and their care orders and bag readings read as before.
- **New prompts on old data.** Admissions with bag readings and no matching order get `bag_without_device` until a nurse adds the order. The demo re-seed sets the orders.
- **Rollback.** The previous build's store skips `care_order` rows of an unknown kind (`isCareKind`, `store.ts:1027`), so the new orders are invisible to it, and it rejects `bedpan` and `commode_pan` hints. Re-seed to go back cleanly.
