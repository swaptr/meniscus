# Design: ui-polish

## Context

- **The contract.** It is `apps/web/DESIGN.md` v2 ("Graduated"), which covers:
  - §1 principles;
  - §2 tokens, with contrast and validator results;
  - §3 copy;
  - §4 the shell;
  - §5 recipes;
  - §6 charts;
  - §7 screens;
  - §8 data flows;
  - §9 a11y;
  - §10 bundle;
  - §11 Do/Don't;
  - §12 checklist.

  "§5.22" means that file.
- **The mock.** `/tmp/ui-redesign/mock.html` has screenshots for the ward at 1280 and 390 px, the bed review and the entry peek at 1280 px and as a 390 px sheet, and attendant capture at 390 px. The colour checks are in `/tmp/ui-redesign/contrast.mjs` and `validator-report.txt`.
- **The audit.** `/tmp/ui-audit-2026-11-03/findings.md` lists 47 findings, with file:line as of 2026-11-03. The earlier changes moved lines, so task 1.1 re-greps them.
- **Apply order.** dietitian-care → model-api-guards → meta-wire-types-refresh → patient-devices → drink-types → **ui-polish** → scale-store → postgres-store → read-queue. accuracy-views is archived, so its requirements ("Outcome bars", "Chart or table", "Model accuracy view") are live text. drink-types lands first, so its `drink` field, `lib/drinks.ts` and "Drinks named on the bed review" exist when this change applies (D13). The screens added by scale-store (the ward picker on `/a`) and read-queue (queued reads, `reads_waiting`) come after this change, so they must follow DESIGN.md v2 themselves; this change does not sweep them.
- **Base UI 1.9.0.** Checked in `node_modules/@base-ui/react`:
  - `Popover.Trigger` takes `openOnHover`, `delay` and `closeDelay` (defaults 300/0) and also opens on click and keyboard.
  - `Popover.createHandle()` shares one popup across many triggers with payloads, and `instant: 'trigger-change'` swaps between them.
  - `PreviewCard` opens on hover and focus only, so we do not use it.
  - Also present: `Drawer` (`swipeDirection`, `snapPoints`), `Toast`, `RadioGroup`, `ToggleGroup`, `Switch`, `Dialog` and `AlertDialog`.

  The apply tasks re-read each `.d.ts` before use.
- **Data that already exists:**
  - `AdmissionSummary` has `totals`, `pending`, `alerts`, `hourly{in_ml,out_ml,in_logged}`, `care` (with `intake_target.next_check`), `acuity`, `nutrition` and `devices`.
  - `EntryList` has its entries (media, evidence, `recorded_ml`, `approved_ml`, `confidence`, `created_by`, `reviewed_by`, `reviewed_at`, `amended_at`, `levels`), `care`, `care_history`, `bags` and `nutrition`.
  - `GET /api/media/:id` returns the bytes with `Cache-Control: no-store`.
  - `GET /api/entries/:id/events` returns the full trail.

## Goals / Non-Goals

**Goals**

- Fix every audit finding (1–47) or record it as a non-goal (table below).
- Make the screen dense by default with detail on demand, using the peeks (D3), Next up (D7) and charts (D5) with their text equivalents.
- Draw segmentation contours from real SAM masks with 0 extra model requests (D6).
- Keep one recipe per job and delete the old copies.
- Enforce the rules in CI through tests and measure them at runtime with a local audit script.

**Non-Goals**

- **Dark mode (finding 45).** We keep one light theme with `color-scheme: light`. A dark theme needs its own validated steps for every ramp, the urine colours and the chart chrome. The demo is recorded in light mode.
- **New dependencies.** We add no runtime dependency, chart library, web font or animation library.
- **Upstream changes.** No prompt or SAM request body changes, and no new upstream requests.
- **Spec'd strings.** They are not reworded, except in the MODIFIED blocks listed in D12.

## Decisions

### D1. Tokens (`src/tokens.stylex.ts`)

DESIGN.md §2 is the table, and the main values are below. Every pair is checked by `src/tokens.test.ts` using `src/lib/contrast.ts`.

| Set                | Values                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| neutrals           | `fg` `#13212f`, `muted` `#4d5d6c`, `bg` `#ffffff`, `canvas` `#eaf0f2`, `subtle` `#f4f7f8`, `rail` `#e5ecef`, `border` `#d0dbe0`, `grid` `#e4eaed`, `borderStrong` `#78899a` (3.59 on `bg`)                                                             |
| action             | `accent` `#0f766e` (5.47), `accentStrong` `#0b5c56`, `accentBg` `#e3f1ef`, `onAccent` `#ffffff`                                                                                                                                                        |
| direction          | `intake` `#2a78d6`, `intakeText` `#1a5fb4`, `intakeBg` `#e3eefb`; `output` `#9a4a8a` (mulberry, replacing the warning-like `#b45309`), `outputText` `#7d3570` (6.68 on `outputBg`), `outputBg` `#f5e6f1`                                               |
| status (mark/tint) | danger `#b91c1c`/`#fde8e8`, warn `#b07800` (text `#855900`)/`#fcefc7`, info `#0e5aa7`/`#e1edf9`, pending `#6d28d9`/`#efe9fd`, ok `#137336`/`#e2f5e7`                                                                                                   |
| acuity             | `#13212f`, `#5b6b7a`, `#9aa8b4` (an ordinal ink ramp, not status)                                                                                                                                                                                     |
| ramps              | intake `#86b6ef` `#3987e5` `#1c5cab` `#0d366b`; output `#cf92c2` `#b06aa2` `#86407a` `#5a2452`                                                                                                                                                         |
| scales             | `space` 2/4/8/12/16/20/24/32; `text` 12/13/15/17/22/26/32; `weight` 400/600/700/800; `radius` 4/8/12/pill; `layer`; `motion` `control` 120, `overlay` 150, `signature` 480, all `0ms` under reduced motion; `layout` `tap` 44, `tapGloved` 52, `content` 1080, `board` 1400 |

- **Reduced motion.** Every duration reads `motion.*`, so reduced motion is handled in one place (finding 35).
- **Validator results** (dataviz `validate_palette.js`): the direction, status, ramp, outcome and tray-segment palettes pass. The status palette carries a CVD warning between pending and info (7.7); this is legal because status always carries a glyph and a label.

### D2. Formatting (`src/lib/format.ts`, pure)

```ts
export const LOW_CONFIDENCE = 0.75
export function clock(t: number | Date): string // '14:05', never ICU
export function dayClock(t: number | Date, now: number | Date): string // '14:05' | '3 Nov 14:05'
export function dayMonth(t: number | Date): string // '3 Nov'
export function dayLabel(t: number | Date): string // 'Tue 3 Nov'
export function hourRange(start: number | Date): string // '14:00–15:00'
export function ml(n: number): string // '1200 mL'
export function signedMl(n: number): string // '+120 mL' | '−80 mL' (U+2212) | '0 mL'
export function litres(ml: number): string // '1.5'
export function percent(x: number): string // '82%'
export function rate(r: { n: number; of: number; pct: number | null }): string // '76% · 20/26'
export function ago(t: number, now: number): string // '12 min ago'
export function duration(ms: number): string // '0:42'
export function plural(n: number, one: string, many: string): string
export function confidenceChip(source: string, c: number): { text: string; tone: 'warn' | 'neutral' }
```

- The month and weekday names are fixed English arrays.
- The seven `toLocaleTimeString` copies and the seven `pad` helpers are deleted (finding 22).
- `TimeField` echoes `clock(value)` beside the native input (findings 22 and 41).

### D3. Peeks (`components/peek.tsx`)

- **Primitive.** Base UI `Popover` with `openOnHover delay={400} closeDelay={150}`, not `PreviewCard`, which cannot be tapped.
  - `peek.tsx` builds on the existing `components/popover.tsx` (added by accuracy-views, present in the tree): it gains `delay`, `closeDelay` and handle props, so there is one Popover wrapper, not two. The outcome bars' popup, its one caller today at `delay={150}`, moves to the peek's 400 ms (MODIFIED "Outcome bars"): one hover delay in the app, chosen over 150 ms because a fast dwell on a dense list of rows would fire peeks and photo fetches as the pointer crosses them.
  - Each list has one `Popover.createHandle()`, so 25 rows share one Root and one portal, and each row passes its payload.
  - Up to 640 px wide, and for any peek taller than 60 vh, the same content renders in a `Drawer` sheet with a Close button.
- **Focus alone never opens a peek.** A Tab sweep must not fetch 25 photos. Enter or Space opens it pinned and moves focus inside. Escape closes it and returns focus. These rules live in `lib/peek.ts` and are tested with fake timers.
- **Content is lazy.** There is one chunk per peek kind: `entry-peek`, `bed-peek` and `metric-peek`.
- **Entry peek data** comes from the loaded `Entry`, with 0 requests:
  - the AI read is `evidence.reading.volume_ml`;
  - saved is `recorded_ml`;
  - approved is `approved_ml`;
  - the trail is built from `created_by`, `recorded_at`, `reviewed_by`, `reviewed_at` and `amended_at`.

  The full timeline stays in the entry details, which fetch the events as today.
- **Bed and metric peek data** comes from `AdmissionSummary`, `EntryList` and `WardQuality`, with 0 requests.
- **Actions are never only in a peek.** Pending rows keep `Reject…` and `Approve`. A bed tile is a link, and its peek has its own 44 px button, a sibling of the tile's link in the DOM, never nested inside it (no interactive content inside an `<a>`).

### D4. Shell, sidebar, quick jump

- **`lib/snapshot.ts`.** A module-level store with a subscribe hook.
  - Routes write to it after their own loads: `/n` writes the wards' `pending` and `beds_with_alerts`, and `/n/w/$ward` writes its beds and the time.
  - The sidebar, quick jump and Next up read from it. None of them fetches.
  - This keeps "Ward dashboard per ward" at exactly two requests.
- **`lib/nav.ts`.** `sections(staff, route, snapshot)` and `bottomItems(staff)` are pure.
- **Drawer and quick jump are lazy chunks.** The quick jump matcher (`lib/jump.ts`) filters by ward code, bed number or patient name, and `isTypingTarget` skips the shortcut while focus is in a text field.

### D5. Charts (hand-built SVG, `components/charts/*`)

- **BalanceTimeline.** One time axis with round-hour ticks (`roundHourTicks`) and three bands:
  - an alert lane;
  - the cumulative approved step lines with the gap between them shaded, plus the dashed intake counted since 08:00, drawn against the limit band (80–100%) and rule, or against the target rule with marks at `INTAKE_TARGET_CHECKS`;
  - mirrored hourly bars, with pending drawn as outlined segments.

  It never uses two y-scales: different magnitudes go in separate panels on the shared x axis. The readout is driven by the pointer, a tap, or Left and Right on a focusable chart. The `Table` toggle and the accessible name come from `lib/chart-text.ts`.
- **Approval.** The chart redraws from the approved list. The segment fills and the line grows using `motion.signature` (signature 1). Under reduced motion it is drawn at once.
- **Ward and bed bars.** `MirroredBars` uses one scale per ward (`scaleShared`), with logged dots from `in_logged` and warn dashes under gaps of 3 h or more.
- **Gauge.** Shows the level against capacity, with a tick at 80% (`BAG_NEARLY_FULL`). A fill in the warn tone uses `warnText`.
- **Text equivalents.** Every chart has a name stating its latest value against its scale, plus a table.

### D6. Segmentation masks and contours

- **Server.**
  - `segmentation.ts` already decodes each SAM mask to a raster (`decodeMaskToRaster`) to pick the container and the liquid.
  - `pipeline.ts` now packs the chosen two with the existing `packMask(box, bit)` from `ai/tray.ts`: at most 32 cells a side, aspect kept, each cell sampled at its centre.
  - The masks go into `Segmentation.container_mask` and `fluid_mask` as `MaskBits | null`, over the existing `container` and `fluid` boxes. A separate `{ box, mask }` pair would duplicate the box.
  - The SAM request bodies are unchanged, and the counts stay 3 (`sam+spark`) and 1 (`spark`, with no segmentation).
- **Validation.**
  - `routes/evidence.ts` reuses the tray `MaskBits` Zod schema (at most 32 × 32, exactly ⌈w·h/8⌉ bytes) in the photo segmentation's `.strict()` object.
  - The largest pair of masks is 2 × 172 base64 characters, inside `smallJson`'s 16 KB. `"fluid_volume_ml":10000,` adds at most 24 bytes, so the limit still holds with masks, volume, a full trace and a 2000-character transcript cap that applies to note evidence only.
  - Old evidence without masks still parses and round-trips unchanged: both fields are optional in stored evidence, and absent stays absent.
- **Web (`lib/contour.ts`, pure).**
  - `unpack(MaskBits)` produces a grid.
  - `contours(grid)` runs marching squares on cell corners: each boundary edge between a set and an unset cell is emitted with the set cell on its left, then the edges are joined into closed loops. Holes become loops drawn with `fill-rule: evenodd`. At saddle corners the two diagonals are split so loops stay simple.
  - `smooth(loop)` makes two Chaikin passes. Every point stays inside the hull of the original loop, which the tests check.
  - `toPath(loops, box, image)` returns an SVG path in percent of the image's pixel size.
  - Tests cover a 1-cell mask (4 corners), an empty mask (none), a ring (outer plus hole), two blobs, and round trips with `packMask` fixtures.
- **SegmentOverlay layers.**
  - a dim (`fg` at 42%) outside the container;
  - a halo (`bg`, 6 px at 55%) and a 2 px contour per element: container white, liquid `intake` or `output` by the container's direction, dish `#1baf7a`, drink `#2a78d6`, food filled `#eda100` at 28%;
  - the fill line;
  - HTML labels.

  Evidence without masks falls back to boxes. Spark-only reads get no overlay.
- **Region quantities.**
  - `liquidVolumeMl(fill, capacity)` in `packages/shared` (pure) returns `Math.round(fill × capacity / 10) × 10`, or null when either is null: 0.463 × 2000 = 926 → 930; 0.125 × 1000 = 125 → 130 (halves up); 0.4 × null → null.
  - `pipeline.ts` sets `segmentation.fluid_volume_ml` from SAM's `fill_fraction` and Spark's `capacity_ml` after both calls return, so the counts stay 3 and 1. Spark-only reads have `segmentation: null` and no volume.
  - `routes/evidence.ts` accepts `fluid_volume_ml` as optional, and rejects any value other than `liquidVolumeMl` of the evidence's own fill and capacity, so a stored volume always agrees with the stored fill and reading. The capture sends the read's evidence unchanged, so the check never fires on our own client.
  - `lib/overlay.ts` labels the container from `CONTAINER_LABEL`, sentence case (`Urine bag`), and the liquid `<Liquid or drink kind> · <round(fill × 100)>% full ≈ <mL> mL`, dropping ` ≈ <mL> mL` when the volume is null or absent (evidence saved before this change). One label function serves the check screen, entry peek, entry details, photo strip and full-screen viewer. The print page draws no photos ("Printable daily chart"); any photo it shows later uses the same `SegmentOverlay`.
  - The volume is the region's share of the capacity, not a reading of the marks; the label says `≈`, and the nurse still approves the reading's `volume_ml`.
- **One stored image.** The raw photo (`POST /api/entries/:id/photo`, `charting/media`) stays the only stored image. The labeled view is SVG and HTML drawn at render time from the stored masks, boxes, fill and volume; no labeled or annotated media copy is made, stored or served, so rejecting an entry still drops the one photo and its evidence.
- **Reveal (signature 2).** Uses `lib/reveal.ts`:
  - A first-show set per media id ensures it plays once per session.
  - The `stroke-dashoffset` trace runs container first, then the liquid or dishes 80 ms apart, then the labels, 480 ms in total.
  - Under reduced motion the schedule is empty.

### D7. Next up (`lib/next-up.ts`, pure)

- **Groups, in rank order:**
  1. `bag_reading_overdue` and red prompts;
  2. amber prompts and bags whose `bag_levels.due_at` is within 30 min or past;
  3. intake target checks within 60 min with less than `next_check.ml` counted;
  4. pending entries, one item per bed, most first;
  5. blue prompts.
- **One item per bed and action.** The highest group wins: a bag that is `bag_reading_overdue` and past its `due_at` is one `Bag reading` item in group 1, not a second in group 2.
- **Ties** go by due time (undated last), then acuity, then bed number. Alerts carry no time, so ties never invent one.
- **Size.** At most 5 items, or 3 below 1100 px followed by `<n> more next up`.
- **The head** shows counts by action.
- **On `/n`** there is one item per ward from `GET /api/wards`. **On `/d`** the items are unacknowledged referrals from the worklist, oldest first.

### D8. Media cache (`lib/media-cache.ts`)

- The first open of a peek sends one `GET /api/media/<id>`.
- The blob is downscaled to 320 px (`createImageBitmap(blob, { resizeWidth })`, falling back to a full bitmap drawn to the canvas once) and stored as an object URL.
- The cache is an LRU of 24 that revokes object URLs on eviction. It is shared with the entry details and the source viewer.
- Closing a peek before the photo arrives aborts the request (`AbortController`), and the next open sends it again.
- Nothing prefetches: no list, focus, render or reconnect triggers a fetch.
- The photo strip moves behind `Photos <n>` and fetches only when opened.

### D9. Bundle

- **Shell ≤ 120 KB gzip** (about 117 KB before this change). It holds the sidebar, the bottom bar, the Toast manager and the trigger halves of Peek.
- **Lazy chunks:** the drawer, quick jump, each peek body, each dialog, and the below-the-fold sections of `/n/$id`: log, meals, bags, nutrition, source viewer and tray proof. Their imports start in the route loader, and each `Suspense` fallback reserves the section's height.
- **Each route ≤ 50 KB on top of the shell.** Measured in tasks 1.3 and 8.3.
- **Fallback if the shell reaches 120 KB.** Task 1.3 measures the shell before and after; at 120 KB or more, all three apply:
  - the sidebar body (sections, links, pips) is a lazy chunk behind a fixed-width rail placeholder of the same size, so nothing shifts;
  - the Peek trigger in the shell is a tiny inline hook (open reason, dwell timer, `aria-expanded`) and the `Popover` content chunk loads on first open;
  - the Toast viewport is lazy-loaded on the first `flash()`.

### D10. Enforcement

- **`src/design.test.ts`** reads the source as text. It fails on:
  - font sizes under 12 px or raw px font sizes;
  - raw weights;
  - hex colours outside `tokens.stylex.ts` and `lib/hues.ts`;
  - raw radius, padding, gap or margin values outside `design-allow.ts`;
  - `zIndex` literals;
  - durations not taken from `motion.*`;
  - transitions on `height`, `width` or `box-shadow`;
  - `outline: 'none'` without `ui.focus`;
  - `size="sm"` or `size="md"`;
  - `ui.input`;
  - `toLocaleTimeString`, `toLocaleDateString` or `padStart(2`;
  - glyph-only icons;
  - `(required)`;
  - straight quotes in JSX text;
  - `textTransform: 'uppercase'`.

  Each rule's test title cites its requirement.
- **`src/tokens.test.ts`** checks the contrast pairs from D1.
- **`apps/web/scripts/ui-audit.mjs`** is local and not run in CI. It loads `playwright-core` from the `PLAYWRIGHT_CORE` path. It mocks or aborts every `/api/ai/*` request in the browser and counts them. It measures scroll width, targets, inputs, text, the focus ring, reduced motion and the open and close behaviour of peeks.
- **The test server** runs with `MODEL_API_BASE_URL=http://127.0.0.1:9/v1 MODEL_API_KEY=fake` on a seeded temporary `DATA_DIR`, started through `pnpm exec tsx`. It is never started with `pnpm dev`, `start` or `demo`, because those load `.env`.

### D11. New fields and endpoints

| Field                                                                                       | Where                                     | Capability                                                     | Cost                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| `bag_levels: BagLevel[]` (`container`, `level_ml`, `capacity_ml`, `read_at`, `due_at`)      | `GET /api/admissions` items               | charting/bag-periods "Bag levels on the bed list"              | from stored readings; 0 model requests  |
| `hourly: { in_ml: number[]; out_ml: number[] }`                                             | `GET /api/wards` items                    | charting/wards "Ward summary" (MODIFIED)                       | summed from admissions; 0               |
| `worst_tone: 'danger' \| 'warn' \| 'info' \| null`                                          | `GET /api/wards` items                    | charting/wards "Ward summary" (MODIFIED)                       | from the beds' alerts already computed; 0 |
| `segmentation.container_mask`, `segmentation.fluid_mask` (`MaskBits \| null`)               | photo read result, stored photo evidence  | capture/photo-reading (ADDED), charting/photo-evidence (ADDED) | from SAM responses already received; 0 new |
| `segmentation.fluid_volume_ml` (`number \| null`, optional)                                  | photo read result, stored photo evidence  | capture/photo-reading "Liquid region quantity", charting/photo-evidence "Liquid region volume in stored evidence" | fill × capacity from results the read already has; 0 new |

- There is no new endpoint. The entry peek uses the existing `GET /api/media/:id`.
- In `packages/shared`, `BagLevel`, `AdmissionSummary.bag_levels`, `WardSummary.hourly`, `WardSummary.worst_tone` and the three `Segmentation` fields are additive and non-breaking: optional for older clients, which ignore them.
- `worst_tone` needs the prompt tone on the server, so `ALERT_TONE` (`Record<Alert['kind'], 'danger' | 'warn' | 'info'>`) moves from `apps/web/src/lib/labels.ts` to `packages/shared`, and web imports it from there. `/n`'s ward status (interface "Ward status from its beds") reads it, as `/n` loads only `GET /api/wards`.
- `due_at` follows "Urine bag reading due": the later of the newest urine-bag reading and the catheter start, plus the reading interval. It is null without a catheter order and for stoma and drain bags.

### D12. MODIFIED blocks and their sources

| Requirement                                    | Copied from (latest text in apply order)          | This change's edit                                                     |
| ---------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| web/ward "Care badges on bed cards"            | dietitian-care delta                              | `Target <counted mL>/<target mL> mL`                                   |
| web/ward "Data quality view"                   | live spec                                         | corrected share `<pct>% · <n>/<of>`; "Small share"                      |
| web/ward "Fluid balance chart"                 | patient-devices delta                             | shared hour axis with round-hour ticks; "Round-hour ticks"             |
| web/ward "Ward activity strip"                 | live spec                                         | mirrored bars on one ward scale with logged dots; "One scale"          |
| web/ward "Photo strip"                         | live spec                                         | behind `Photos <n>`, fetched on open; tap opens the peek; "Closed sends nothing" |
| web/ward "Segmentation overlay"                | live spec                                         | contours from masks, boxes fallback, labels, none for Spark-only       |
| web/ward "Tray overlay"                        | live spec                                         | contours traced from dish masks instead of cells (same geometry)       |
| charting/wards "Ward summary"                  | live spec                                         | `hourly`, `worst_tone`; "Hourly sums", "Worst prompt tone"            |
| web/ward "Outcome bars"                        | live spec (accuracy-views, archived)              | one panel per kind, label and rate above the bar; the popup on the 400 ms Peek, focus alone never opens it; "Panels" |

accuracy-views is archived, so "Outcome bars" copies the live spec; no other MODIFIED block here had accuracy-views as its source, and the live text of "Data quality view" already holds accuracy-views' "Model accuracy" line. charting/photo-evidence "Read evidence stored with the entry" was a MODIFIED block here; drink-types now modifies it (`drink_name` and three scenarios) and applies first, and the merged body with the masks clause ran past 500 characters, so the masks moved to the ADDED "Segmentation masks in stored evidence" and that requirement keeps drink-types' text. drink-types also modifies "Intake and output breakdown" and "Class table picker"; this change modifies none of the three, so their drink-types text stands, and the breakdown's drink-kind table is a scenario of web/interface "Charts have a text equivalent". No later change (scale-store, postgres-store, read-queue) modifies these requirements. Task 1.2 re-copies each block at apply time from the source this table lists: the live spec once that change (dietitian-care, patient-devices, drink-types) is archived, otherwise that change's delta, so an applied but unarchived change's clauses are kept.

### D13. Drink kinds (from drink-types §9)

- **Reuse, do not re-map.** drink-types adds `DRINK_KINDS`, `DRINK_LABEL` (`packages/shared`), `entry.drink`, `reading.drink_name` and `apps/web/src/lib/drinks.ts` (`DRINK_ICON`, `drinkTitle`, `drinkTotals`, `<DrinkLabel>`). This change restyles `<DrinkLabel>` to DESIGN.md §5.24 and uses it wherever an entry's category shows:
  - entry peek head: `10:42 · Tea 150 mL` with the icon, then the item (`masala chai`) when `drinkTitle` gives a name;
  - dense rows: `▲ Tea 150 mL`; an entry with `drink: null` keeps its category label (`▲ Drink 200 mL` for `water`);
  - timeline readout: each listed entry through `<DrinkLabel>`; the optional `Drinks:` hour line is not added (the readout already has the hour's totals);
  - the bed's `In` metric peek: drinks by kind from `drinkTotals`, largest first, then the other categories, each with a share bar;
  - overlays: a container's liquid reads `<Kind> <pct>%` when the entry or draft has a `drink` (else `Liquid <pct>%`); a tray drink reads `<index> <name> · <Kind> · <mL> mL`, without the kind when the name is its label, as drink-types' "Meal fluids with their kind";
  - text equivalents: the breakdown's `Table` lists drink kinds as rows, in the bar's order.
- **Colour.** Drink kinds are told apart by icon and label, never by hue (DESIGN.md §2.1 "Drink kinds"): every drink mark uses the one intake-family shade, so the 11 kinds add no palette and the direction and category checks stand.
- **Icons** (lucide-react 1.66.0, each `declare const` checked in `apps/web/node_modules/lucide-react/dist/lucide-react.d.ts`): `water` GlassWater, `tea` Leaf, `coffee` Coffee, `milk` Milk, `juice` Citrus, `coconut_water` TreePalm, `buttermilk` Blend, `ors` Droplets, `supplement` CupSoda, `soup` Soup, `other` Droplet.
- **Requests.** None: every drink comes from the loaded `Entry` or evidence.

## Finding → fix

| #   | Fix                                                                            | Where                                                 |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 1   | Legend as rows, including bag kinds                                            | task 4.10; "Fits a phone screen"                      |
| 2   | `f.input` everywhere, `ui.input` deleted                                       | 4.4; "Inputs that do not zoom"                        |
| 3   | `touch` default, `sm`/`md` removed, rows as one target, 44 px links            | 4.2, 4.9; "Targets big enough for gloved hands"       |
| 4   | Mulberry output, `onAccent` hint, `borderStrong`, track on `border`            | D1; "Contrast checked"                                |
| 5   | `text.xs` floor                                                                | D1, 4.3, 5.1; "Text at least 12 px"                   |
| 6   | `ui.focus` on every interactive element                                        | 4.1; "Visible keyboard focus"                         |
| 7   | `ChoiceChips` rebuilt from `components/choice-chips.tsx`                       | 4.5; "One choice chip"                                |
| 8   | `Sheet`                                                                        | 4.6; "One dialog layout"                              |
| 9   | `BedBadge`                                                                     | 4.3                                                   |
| 10  | `StatChip unit`                                                                | 4.3; "Units on every volume"                          |
| 11  | `ui.overline` in sentence case                                                 | 4.1                                                   |
| 12  | `wardTone`, `ENTRY_STATUS_TONE`, meals `ok`                                    | 2.5; "Ward status from its beds"                      |
| 13  | `ui.table` + `TableScroll`                                                     | 4.1, 4.10                                             |
| 14  | `weight` vars                                                                  | D1, group 7                                           |
| 15  | Pending as dense rows without inner bars                                       | 4.9; "Dense entry rows"                               |
| 16  | `Section`, `Banner`, board rows                                                | 4.1, 7.4, 7.5                                         |
| 17  | Banner actions `touch`                                                         | 4.2                                                   |
| 18  | One `Switch`; bag event one radio group                                        | 4.5                                                   |
| 19  | Effect line `md`/400                                                           | 4.5, 7.2                                              |
| 20  | `Notice` icons and `role`                                                      | 4.1                                                   |
| 21  | `Toast`                                                                        | 4.7; "Results in one toast"                           |
| 22  | `lib/format.ts`, `TimeField` echo                                              | D2; "Times and dates written one way"                 |
| 23  | `confidenceChip`                                                               | D2; "Confidence written one way"                      |
| 24  | Label maps for enums                                                           | 2.5                                                   |
| 25  | `By hand` only                                                                 | 2.5                                                   |
| 26  | `Target … mL`; balance against the limit                                       | MODIFIED "Care badges on bed cards"; D5               |
| 27  | `rate()` on the corrected tile                                                 | MODIFIED "Data quality view"                          |
| 28  | Lucide icons for glyphs                                                        | 4.5, 4.10                                             |
| 29  | Icon sizes 14/16/20/24                                                         | 4.10                                                  |
| 30  | `BrandMark`                                                                    | 3.5                                                   |
| 31  | Raw colours → tokens                                                           | D1, group 7                                           |
| 32  | Raw radii → `radius.*`                                                         | D1, group 7                                           |
| 33  | Raw spacing → `space.*`                                                        | D1, group 7                                           |
| 34  | Off-scale type → `text.*`                                                      | D1, group 7                                           |
| 35  | `motion` vars, opacity/transform/dashoffset only                               | D1, 4.6, 4.13; "Reduced motion"                       |
| 36  | One label/hint/error set                                                       | 4.4                                                   |
| 37  | `(required)` removed                                                           | 4.4                                                   |
| 38  | Curly quotes                                                                   | group 7                                               |
| 39  | `NoPhotoIcon` placeholders, meaning icons on 404/error                         | 3.5, 4.10; "No blank media boxes"                     |
| 40  | Round-hour ticks; volumes in `fg`, direction by glyph                          | 5.1, 4.9                                              |
| 41  | `Segmented` 44 px beside a 48 px `TimeField`                                   | 4.4, 4.5                                              |
| 42  | Place-naming app-bar titles                                                    | 3.2                                                   |
| 43  | Break-the-glass names the ward                                                 | 7.4                                                   |
| 44  | Downscaled thumbs and peek photos                                              | D8, 7.2                                               |
| 45  | **Non-goal: dark mode.** `color-scheme: light`                                 | Non-Goals                                             |
| 46  | `Pending` bed status label                                                     | 2.5                                                   |
| 47  | Balance tone from the overload rule (none while urine is not measured)         | 2.5                                                   |
| new | `space.xs`, `radius.sm` in tray overlay and proof                              | D1                                                    |
| new | Ward legend overflow, bag prompts                                              | 4.10                                                  |
| new | `/n/$id` chunk near its budget                                                 | D9                                                    |
| new | Generic card layout, always-visible photos (the redesign brief)                | D3, D5, D7; "Dense entry rows", "Photo strip"         |

Every finding has a fix except 45, which is a recorded non-goal.

## Risks / Trade-offs

- **Peeks hide information from touch users.** Every peek opens on tap. Actions never live only in a peek. On phones, peeks become sheets.
- **Hovering a list fetches many photos.** The 400 ms dwell, no opening on focus, abort on close and no prefetch together cap this at one request per deliberate open.
- **Contours look wrong on coarse masks.** At 32 cells the Chaikin smoothing reads well (see the mock), and the halo and labels carry identity. The box fallback stays.
- **Mask bytes in stored evidence.** At most 344 characters per entry. Postgres and the SQLite store keep evidence as JSON already.
- **Next up disagrees with "Beds needing attention first".** Next up ranks actions and the board ranks beds. Both are visible and both are spec'd.
- **Shell budget.** About 117 KB plus about 4 KB for the sidebar, Toast and Peek triggers would be over 120 KB. D9's fallback lazy-loads the sidebar body, keeps the peek trigger to an inline hook with its content chunk loaded on first open, and lazy-loads the Toast viewport; task 1.3 measures before and after.
- **Signature motion distracts.** Each plays once per item, triggered by the user's action, and is off under reduced motion.

## Migration Plan

- **Shipping.** The web and server ship together.
- **Additive fields.** Every field is additive, so older clients ignore them, and old evidence without masks renders as boxes.
- **Rollback.** Revert the commit. The stored masks are harmless extra JSON.
