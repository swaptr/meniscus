# Design

## Context

What exists today:
- **Reading.** The Spark reading (`apps/server/src/ai/reading.ts`) returns a free-text `appearance`, and `toDraft` (`ai/draft.ts`) copies it into the draft's `notes`.
- **Sampled colour.** The phone samples the liquid box's mean colour into `evidence.colour`, which only "What the AI read" shows.
- **Notes.** The `log_entry` tool (`ai/notes.ts`) has free-text `notes`.
- **Alerts.** `chart/alerts.ts:8` runs the regex `blood|bloody|dark|cloudy|red|brown|clots` over item and notes.
- **Web.** There is no urine-only total. Urine shows up in:
  - the rate chart (`charts.tsx:106`) and the Out bar's urine segment (`charts.tsx:218`);
  - entry rows (`entry-log.tsx:297`), entry details (`entry-details.tsx:78`), pending cards (`n/$id.tsx:301`), the recent list (`a/bed.$token.tsx:602`), photo strip captions (`bed-charts.tsx:67`) and resolve dialogs (`resolve.tsx:92,155`);
  - the Out totals (`ui.tsx:82` `TotalsRow`, `n/w.$ward.tsx:167`);
  - the check screens (`a/bed.$token.tsx:504-552`, `a/round.tsx:213`).

## Types (`packages/shared`)

```ts
export const URINE_COLOURS = ['pale', 'yellow', 'dark', 'orange', 'pink', 'red', 'brown'] as const
export type UrineColour = (typeof URINE_COLOURS)[number]
/** Fill for a colour name when no photo colour exists (notes, corrections, by hand). Display only, not calibrated. */
export const URINE_REFERENCE: Record<UrineColour, string> = {
  pale: '#f2eaa5', yellow: '#e9cf4f', dark: '#c48a24', orange: '#de7a26', pink: '#e7a1a9', red: '#b3242e', brown: '#5c3317',
}
export const HEX_COLOUR = /^#[0-9a-f]{6}$/

export interface UrineSeen {
  colour: UrineColour
  rgb: string | null
  charted_at: string
  status: 'pending' | 'approved'
}

// ContainerReading: + urine_colour?: UrineColour | null; urine_rgb?: string | null
// DraftEntry:      + urine_colour?: UrineColour | null; urine_rgb?: string | null
// EntryInput:      + urine_colour?: UrineColour | null; urine_rgb?: string | null
// Entry:           + urine_colour: UrineColour | null; urine_rgb: string | null
// AmendInput:      + urine_colour?: UrineColour
// AdmissionSummary and EntriesResponse (GET /admissions/:id/entries): + urine_seen: UrineSeen | null
```

The new fields on inputs, drafts and readings are optional. Older fixtures and clients keep type-checking, and the server always returns them on `Entry`.

## Decisions

**Wire contract: a `'none'` sentinel instead of a nullable enum.**
- `READING_JSON_SCHEMA` gains two required properties:
  - `urine_colour: { type: 'string', enum: [...URINE_COLOURS, 'none'] }`;
  - `urine_rgb: { type: ['string', 'null'] }`, whose description is "urine only: the liquid's colour as seen, #rrggbb; ignore the container's tint where you can".
- `LOG_ENTRY_TOOL.parameters` gains `urine_colour`, the same enum with `'none'`. It joins the tool's `required` list, because strict mode needs every property listed.
- Why the sentinel:
  - Our schemas already use `['string','null']` types, but none use a nullable `enum`. A plain `enum` is the safer strict-mode subset.
  - `pattern` is not used either. The server checks the hex itself.
- zod uses `.default('none')`, so the fake model replies in older tests parse unchanged.
- `normaliseUrine(fluidOrCategory, colour, rgb)` (in `ai/text.ts`) returns `{ urine_colour, urine_rgb }`:
  - both null unless the fluid (for a reading) or the category (for a note) is urine;
  - `'none'` becomes null;
  - rgb is trimmed and lowercased, and dropped unless it matches `HEX_COLOUR`.
- The reading pipeline applies it after parsing, so the reading in `CaptureReadResult` is already normalised.
- `toDraft` copies both fields when the category is urine. `notes` keeps `appearance` as it is today.

**Prompt lines.** The reading prompt gets one line: "If the liquid is urine, set urine_colour to the nearest name (pale = pale straw, dark = dark amber) and urine_rgb to its colour as seen; otherwise none and null. Describe, do not diagnose." The note prompt gets one line: "Set urine_colour only when the note states the urine's colour."

Neither adds a request. The pipelines are untouched apart from the normalisation.

**Store.**
- `entry` gains `urine_colour TEXT` and `urine_rgb TEXT`, in the fresh DDL and through `migrate()` (`ALTER TABLE ADD COLUMN`, the same pattern as `reject_reason`). Being nullable, they need no backfill.
- `addEntry` writes both. `toEntry` maps them, returning null when absent.
- **`amend`:**
  - `colour = input.urine_colour ?? cur.urine_colour`, then:
    - if the result is not urine, both colour fields are cleared;
    - if the colour changed, `urine_rgb` becomes null.
  - It changes something when the volume, category or colour differs.
  - A `urine_colour` on a non-urine result is `invalid`.
  - The event payload gains `from_colour` and `to_colour` when they differ.
- `urineSeen(admissionId, since)` is one prepared statement: category urine, colour not null, status pending or approved, `created_at >= since`, ordered by `created_at` then `id`, both descending, `LIMIT 1`. Admission summaries and `entries()` include it, with `since` = now − 24 h, matching the totals.

**Evidence (`routes/evidence.ts`).** The web spreads the whole reading into the photo evidence, and the evidence `Reading` schema is strict. It gains `urine_colour: z.enum(URINE_COLOURS).nullable().optional()` and `urine_rgb: z.string().regex(HEX_COLOUR).nullable().optional()`. Without them, every photo save would get a 400.

**Route validation (`routes/chart.ts`).**
- `EntryBody` gets `urine_colour: z.enum(URINE_COLOURS).nullable().optional()` and `urine_rgb: z.string().regex(HEX_COLOUR).nullable().optional()`, plus refines:
  - colour fields require category `urine` (path `urine_colour`);
  - `urine_rgb` requires `urine_colour` (path `urine_rgb`).
- `AmendBody` gets `urine_colour: z.enum(URINE_COLOURS).optional()`.

**Alerts (`chart/alerts.ts`).**
- The appearance rule runs after `low_urine_output`. It reads that alert's presence and builds a set of words for each pending or approved output entry in the last 24 hours:
  - the colour names `pink`, `red` and `brown`;
  - regex matches of `blood|bloody|red|brown|clots?` in the item or notes;
  - `dark`, from the colour or the word, only when the admission also has a low output alert.
  - The word list is `blood|bloody|pink|red|brown|clots?`.
- `cloudy` is gone. Message: `${words.join(', ')} noted on N output entr(y|ies). Review.`

**Web.**
- `lib/urine.ts` (DOM-free):
  - `URINE_LABEL`: pale → `Pale straw`, dark → `Dark amber`, and so on;
  - `swatchOf(colour, rgb)` returns `{ fill, label }`, with fill = rgb ?? `URINE_REFERENCE[colour]`;
  - `entrySwatch(e)` returns a swatch, or null unless the entry is urine with a colour;
  - `seenSwatch(s)` returns the swatch with `label + ' · pending'` when the entry is pending;
  - `withColour(draft, c)` returns `{ ...draft, urine_colour: c, urine_rgb: null }`;
  - `colourFields(draft)` returns `{}` unless the draft is urine with a colour.
- `toEntryInput` spreads `colourFields(p.draft)`. Changing the type to non-urine needs no special case, because `colourFields` checks the category.
- `components/urine-swatch.tsx`:
  - `UrineSwatch({ fill, label })` is a 12 px circle with a 1 px `colors.borderStrong` outline and a dynamic StyleX fill (same as `evidence.tsx:208`), followed by the label in text ink, never in the swatch colour;
  - `aria-hidden` on the circle; the text carries the meaning.
- `components/urine-colour-picker.tsx`: `UrineColourPicker({ value, onChange })`.
  - A radio group of seven chips, each a swatch plus a label, at least 44 px high, wrapping in a grid.
  - It is lazy-free, because it is small.
- **Wiring:**
  - `TotalsRow` gets an optional `urine` prop (`UrineSeen | null`) and renders the swatch under Out.
  - The ward `BedCard`, the bed review totals and the `RateChart` header (`Latest colour`) take `urine_seen`.
  - The entry row, details title, pending card, recent list, photo strip caption and resolve dialogs use `entrySwatch`.
  - The capture check screen, the round reading card and the by-hand form show the swatch and the picker when the draft category is urine.
- **Charts in the urine's own colour** (the user asked for the colour actually seen, not a default):
  - A new `urineRuns(entries, now)` in `lib/charts.ts` returns `{ fill, label, ml }[]`. `breakdown()` is unchanged, so its existing tests stay exact. Approved urine in the last 24 hours, in charted order, is grouped into consecutive runs with the same `urine_colour`.
  - A run's fill is the newest `urine_rgb` in the run, else `URINE_REFERENCE[colour]`, else the neutral grey `NO_COLOUR` labelled `Colour not recorded`.
  - `StackBars` draws the urine segment as these pieces. Each piece has a 1 px `colors.borderStrong` outline and the usual 2 px surface gap, so pale straw shows on the light track.
  - The legend swatch shows the newest run's fill. The legend text stays `Urine <mL>`, in text ink.
  - `urineRate()` gives each `RatePoint` a `fill`: the newest coloured approved urine at or before that hour, else grey.
  - `RateChart` fills its dots with it, with a 1.5 px ink stroke. The connecting line becomes neutral `textMuted`.
  - Points below the threshold keep their shape encoding, a hollow diamond with a red stroke, now filled with the urine colour.
- **Colour rules** (dataviz):
  - A literal observed colour is the data, so it doesn't follow the categorical palette. Identity stays readable from text labels, and status from shape and the red stroke.
  - Every coloured mark has an outline and a text label, so it never relies on colour alone or on contrast with the surface.

## Risks / Trade-offs

- [The photo colour depends on lighting, white balance and bag tint] → Show the name next to the swatch, give staff the chips to correct it, and have the swatch's title say "as photographed". Alerts use the confirmed name, not the hex.
- [Model invents a colour for non-urine] → Normalisation nulls it unless the fluid is urine.
- [Fewer appearance alerts (dark and cloudy no longer alert alone)] → This follows the evidence: colour is a poor hydration measure in older adults, and cloudy urine alone is not a sign of infection. Dark urine still alerts together with low output. Documented in the README.
- [The model's colour and `evidence.colour` (pixel mean) can disagree] → The pixel mean stays in "What the AI read" for comparison. The entry uses the model's colour, because the model can discount the bag and background, which the box mean cannot.

## Migration Plan

`migrate()` adds two nullable columns. Older entries have no colour and show no swatch. Rollback: older builds ignore the extra columns.

Apply order with the changes in flight: this change first, because it is small and touches no media or staff tables. Then `capture-sources`, then `ward-staffing`.
- Both `capture-sources` and this change edit `shared/index.ts` (`Entry`, `DraftEntry`), `store.ts` (`migrate`, `toEntry`), `entry-details.tsx` and `demo-history.ts`. The edits are additive, so rebase by hand.
