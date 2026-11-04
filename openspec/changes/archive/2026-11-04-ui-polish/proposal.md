# Proposal: ui-polish

## Why

Meniscus works, but it reads as a stack of generic cards: a section for each kind of information, photos and evidence always on screen, and a nurse who scans cards to find the next job. On top of that, the 2026-11-03 audit (`/tmp/ui-audit-2026-11-03/findings.md`, 47 findings) found failures on phones: sideways scroll at 390 px, iPhone zoom on 15 px inputs, about 50 targets under 44 px, contrast fails, 9 px text, six chip recipes, three dialog layouts and seven time formatters. We want a demo that surprises its audience and a product that looks commercial-grade: dense by default, detail on demand, every number drawn against its scale, and SAM's segmentation shown on the photo as it really was.

## What Changes

- **Direction "Graduated"** (`apps/web/DESIGN.md` v2): saline and ink neutrals, a teal action colour, intake blue and output mulberry for direction, status tones used only with a glyph and a label, and an ink ramp for acuity. Contrast is computed and every chart palette is validated. The mock is `/tmp/ui-redesign/mock.html`.
- **Density by role.** Staff homes (`/n`, `/n/w/$ward`, `/d`) open on a ranked **Next up** list and dense boards. Patient screens (`/n/$id`, `/d/$id`) hold everything one tap away, with hover cards for depth. Attendant screens (`/a/*`) stay simple: one task, at most 4 control groups, and 52 px commits.
- **Peeks.** Hover with a 400 ms delay, tap or Enter opens a card about a row, tile, chart mark or figure. Escape closes it. On phones it is a sheet. The **entry peek** shows the photo, fetched only on open, with its contours. It also shows the AI read against the saved and approved volumes, the confidence and mode, and the trail. Bed peeks and metric peeks open from data already loaded. Approve, Reject… and Save are never only in a peek.
- **Graphics**:
  - a 24 h **balance timeline** with an alert lane, cumulative lines, a limit band and target checks, outlined pending bars that fill when approved, and an hour readout with a table view;
  - mirrored hourly bars on bed tiles and ward rows;
  - bag gauges;
  - shift bars in the log;
  - model-accuracy small multiples.

  Every chart has a text equivalent.
- **Navigation.** A sidebar with sections (Capture, Wards, This ward, Insights, Nutrition) and counts taken from the page's own load. A bottom bar and a More drawer on phones. A quick jump on `/` or Ctrl+K. None of them sends a request.
- **Segmentation highlights.** Photo segmentation keeps the container and liquid masks, packed at `MASK_GRID` as tray masks are. The web traces their contours with marching squares and draws a dimmed surround, a halo, tinted outlines, the fill line and labels. It falls back to boxes for older evidence and draws nothing for Spark-only reads. The first time a photo is shown, its segments trace in (the second signature moment; the first is the approval pouring into the timeline). Both respect reduced motion.
- **Drink kinds** (from drink-types, which applies first): the entry peek (`10:42 · Tea 150 mL` and the name), dense rows (`▲ Tea 150 mL`), the timeline readout, the bed's `In` peek split by kind, overlay labels and the breakdown's table show the drink with its Lucide icon. Drinks share one intake-family shade and differ by icon and label, never by hue (DESIGN.md §2.1).
- **The audit's 47 findings** are fixed through tokens, `lib/format.ts`, one recipe per job (Button, ChoiceChips rebuilt from `components/choice-chips.tsx`, Sheet, Toast, Peek, DenseRow, TableScroll), a static design test, a contrast test and a local screenshot audit.

## Capabilities

### New Capabilities

- `web/interface`: app-wide rules for every screen: layout, targets, inputs, contrast, text size, focus, motion, dialogs, peeks, navigation, chart text equivalents, toasts, choice chips, attendant simplicity, and how times, confidence and volumes are written.

### Modified Capabilities

- `web/ward`:
  - MODIFIED:
    - "Care badges on bed cards";
    - "Data quality view";
    - "Fluid balance chart";
    - "Ward activity strip";
    - "Photo strip" (behind a toggle);
    - "Segmentation overlay" (contours; the liquid named by its drink kind, labelled `<Liquid> · <fill %> full`);
    - "Tray overlay" (contours; drinks labelled with their kind);
    - "Outcome bars" (accuracy-views, now live: one panel per kind, the popup on the 400 ms Peek, replacing its 150 ms delay).
  - ADDED:
    - "Ward dashboard views" (an unknown `view` reads as Beds);
    - the entry peek and its photo fetch;
    - the read on the peek photo;
    - the segment reveal;
    - "Region quantities on the labeled photo" (`Urine bag`, `Liquid · 46% full ≈ 930 mL` on every container photo);
    - dense rows (and the entry peek, timeline readout and metric peeks) naming the drink kind;
    - shift bars;
    - timeline hover, text, care orders and approval;
    - bed tiles, bed peek and board;
    - metric peeks;
    - ward cards;
    - Next up on the ward dashboard and the nurse home.
- `web/dietitian`: ADDED "Next up on the worklist".
- `charting/bag-periods`: ADDED "Bag levels on the bed list" (`bag_levels` on `GET /api/admissions` items).
- `charting/wards`: MODIFIED "Ward summary" (`hourly` and `worst_tone` on `GET /api/wards` items; `worst_tone` is the worst open prompt on any bed, so `/n` can colour each ward from its single load).
- `capture/photo-reading`: ADDED "Masks kept with the segmentation" (`container_mask`, `fluid_mask`) and "Liquid region quantity" (`fluid_volume_ml`: fill × capacity to the nearest 10 mL, null without either).
- `charting/photo-evidence`: ADDED "Segmentation masks in stored evidence" (masks accepted, validated and returned) and "Liquid region volume in stored evidence" (`fluid_volume_ml` accepted only when it matches the evidence's fill and capacity). "Read evidence stored with the entry" is left to drink-types, which modifies it for `drink_name`.

## Upstream model requests

None change (0 new). A photo read still makes 3 requests (2 SAM, 1 Spark), or 1 in Spark-only mode. The masks come from the SAM responses the read already receives, and `fluid_volume_ml` from the fill and capacity it already has. Peeks, contours, Next up, the sidebar and quick jump make 0 model requests. The only new HTTP request is one `GET /api/media/<id>` when an entry peek with a photo first opens, which is our own server.

## Out of scope

- **Dark mode.** Decided as a non-goal (DESIGN.md §2.1); `color-scheme: light`.
- **New runtime dependencies, chart libraries, web fonts and animation libraries.** Charts are hand-built SVG.
- **Changes to the model prompts or to the SAM request bodies.**

## Impact

- `apps/web/src/**` (tokens, lib, components, every route), `apps/web/DESIGN.md`, new `apps/web/scripts/ui-audit.mjs`.
- `apps/server`:
  - `src/ai/segmentation.ts` and `pipeline.ts` (pack the masks);
  - `src/routes/evidence.ts` (validate the masks);
  - the admissions list (`bag_levels`);
  - the wards list (`hourly`, `worst_tone`).
- `packages/shared`: `Segmentation.container_mask`, `fluid_mask` and `fluid_volume_ml`, `BagLevel` and `AdmissionSummary.bag_levels`, `WardSummary.hourly` and `WardSummary.worst_tone`, and `ALERT_TONE` moved here from the web. These response shapes change, but only additively: every new field is optional for older clients, which ignore it, so none is BREAKING (`openspec/config.yaml` marks a changed shape the web consumes BREAKING; an added optional field changes no existing one).
- Stored evidence grows by at most 2 × 172 base64 characters and one `fluid_volume_ml` per photo entry, well inside the 16 KB JSON body limit. The raw photo stays the only stored image; the labeled view is drawn from the masks.
