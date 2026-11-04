# Proposal

## Why

Nurses chart urine colour using a fixed set of words: pale, yellow, dark amber, pink, red, brown.
- **Colour is a review trigger.** Visible blood, cola-coloured urine and clots call for review. Colour alone is a weak measure of hydration: a Cochrane review found it misses many dehydrated older people. Cloudy urine alone does not mean infection in people over 65.
- **What Meniscus has today:**
  - a free-text `appearance` string from the photo read;
  - a colour sampled from the photo on the phone, shown only in the read evidence;
  - an appearance alert that matches the words dark and cloudy, which over-alerts.
- **What is missing:** no screen that counts urine shows what the urine looked like.

## What Changes

- **The photo read returns the colour.**
  - The existing Spark reading also returns `urine_colour`, one of seven names (`pale`, `yellow`, `dark`, `orange`, `pink`, `red`, `brown`), and `urine_rgb`, the urine's colour as seen, as `#rrggbb`.
  - Both are null for anything but urine, and the urine draft carries them.
  - Same requests: 3 per photo, or 1 in Spark-only mode.
- **Notes give the name only.** When a typed or spoken note states the urine colour, its urine entry gets the nearest `urine_colour` and no `urine_rgb`. Same requests: text 1, voice 2.
- **Entries store the colour.**
  - Urine entries accept, store and return `urine_colour` and `urine_rgb`. Any other entry is refused.
  - Amending an approved entry can correct the colour. The correction clears `urine_rgb` and is recorded in the audit trail.
- **Latest colour on the counts.** The ward list and the bed chart return `urine_seen`: the newest pending or approved coloured urine entry in the last 24 hours.
- **Alerts follow the evidence.**
  - Pink, red or brown urine, or notes that mention blood, red, brown or clots, raise the `appearance` review prompt.
  - Dark urine raises it only together with low urine output.
  - Cloudy alone no longer raises it.
- **Charts in the urine's own colour.**
  - The bed review's Out bar draws urine in the colours actually seen, one outlined piece per run of same-coloured entries, instead of the fixed orange category colour.
  - The urine rate chart fills each hourly point with the colour seen by that hour.
  - Urine with no recorded colour is grey.
- **The colour is shown wherever urine is counted.**
  - A swatch filled with `urine_rgb` sits beside every urine count. When there is no `urine_rgb`, the swatch uses a reference colour for the name.
  - The swatch is always labelled with the name and outlined, so pale colours still show on white.
  - The places it appears:
    - the ward list and dashboard bed rows;
    - the bed review totals, urine rate chart and breakdown;
    - urine entries in the log and timeline;
    - the capture and round check screens. Staff confirm or change the colour there with seven labelled chips before saving.
  - The by-hand form for urine offers the same chips, which are optional.

### Out of scope

- Colour in the nurse's amend dialog and the missed-entry form. The amend API accepts a colour; the UI for it comes later.
- Clarity and clots as structured fields. They stay in the free-text notes and in the alert words.
- Catheter haematuria grading scales.
- Colour calibration. The colour is as photographed and is labelled that way; ward lighting changes it.
- Colour for stoma, drain or vomit output.
- Any diagnosis. Colour only raises a "Review" prompt.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `capture/photo-reading`: adds **Urine colour read**.
- `capture/notes`: adds **Urine colour from a note**.
- `charting/entries`: adds **Urine colour on the entry**, including photo evidence that carries the colour, and **Latest urine colour**.
- `charting/audit`: **Amend an approved entry** can now correct the urine colour.
- `charting/alerts`: **Appearance notes** now uses the colour, needs low output before alerting on dark urine, and drops cloudy.
- `web/ward`: adds **Urine colour beside urine counts** and **Urine drawn in its own colour**. **Intake and output breakdown** now draws the urine segment in the colours seen.
- `web/capture`: adds **Urine colour on the check screen**.

## Impact

- `packages/shared`:
  - new `URINE_COLOURS`, `UrineColour`, `URINE_REFERENCE` (a reference hex for each name) and `UrineSeen`;
  - `ContainerReading`, `Entry`, `EntryInput`, `NoteEntry` and `AmendInput` gain the colour fields;
  - `AdmissionSummary` and the entries response gain `urine_seen`.
  - `EntryEvent` gains `from_colour` and `to_colour`, returned by `GET /api/entries/:id/events`.
  - Photo evidence: its `reading` accepts the two colour fields.

  **BREAKING** for the web, which reads these shapes.
- `apps/server`:
  - `ai/reading.ts` and `ai/notes.ts`: schema fields and prompt lines;
  - `ai/draft.ts`: carries the colour into the draft;
  - store: two `entry` columns, a migration and `urine_seen`;
  - `routes/chart.ts`: validation;
  - `chart/alerts.ts`;
  - demo history: colours on its urine entries.
- `apps/web`:
  - new `components/urine-swatch.tsx` and `lib/urine.ts`;
  - changes to the ward list, dashboard, bed charts, entry rows, the capture and round check screens and the attendant's by-hand form.
- Model requests per action are unchanged. No new dependencies.
