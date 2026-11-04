# Design

## Context

- `FLUID_KINDS` (`packages/shared/src/index.ts:26`) already covers `water`, `tea`, `juice`, `milk` and `soup`. Spark's reading contract uses it (`apps/server/src/ai/reading.ts:9,40`), but `toDraft` (`apps/server/src/ai/draft.ts:46`) sets `item` to the container's name, and the web renders `CATEGORY_LABEL.water` (`Drink`, `apps/web/src/lib/labels.ts:75`).
- Notes already name drinks in `item` (`coconut water`), with no kind. Trays have `MEAL_FLUID_KINDS` (`index.ts:1327`), a subset of the fluid kinds, and a free-text fluid `name` (≤ 80).
- Thickening is an entry field, `iddsi_level` (charting/entries "Drink consistency on the entry"), and care-plan's `thickened_fluids` prompts read it. A drink's kind and its consistency are independent.
- Read-log rows hold only closed lists (charting/model-accuracy "Read log holds no text"). `ReadOutputSchema` (`apps/server/src/ai/read-log.ts:42`) parses stored JSON with `z.enum(FLUID_KINDS)`, so widening the enum keeps old rows valid.
- Order: … → patient-devices → **drink-types** → deploy-ready → s3-media → ui-polish → labeled-photo-copy → scale-store → postgres-store → read-queue. patient-devices adds `bedpan` and `commode_pan` to `CONTAINER_KINDS` and "bedpans, commode pans" to `READING_SYSTEM`'s container prose. This change keeps both, and its output drafts (`item: "commode pan"`) are unchanged.

## Goals / Non-Goals

**Goals:** one fixed vocabulary of drinks for photos, notes, trays, entries and accuracy tables; the specific name kept on the entry only; the same requests per action.

**Non-Goals:** nutrients per drink; the meal's own fluid entry; the ward-round screen; re-running the eval.

## Decisions

### 1. Shared types (`packages/shared`)

```ts
/** What was drunk, by mouth. Small and fixed so it can be tallied; the specific name lives in the entry's item. */
export const DRINK_KINDS = [
  'water', 'tea', 'coffee', 'milk', 'juice', 'coconut_water',
  'buttermilk',  // lassi, chaas, mattha
  'ors',         // oral rehydration solution
  'supplement',  // nutritional supplement drinks (e.g. "Ensure"-type sip feeds)
  'soup', 'other',
] as const
export type DrinkKind = (typeof DRINK_KINDS)[number]

export const DRINK_LABEL: Record<DrinkKind, string> = {
  water: 'Water', tea: 'Tea', coffee: 'Coffee', milk: 'Milk', juice: 'Juice', coconut_water: 'Coconut water',
  buttermilk: 'Buttermilk', ors: 'ORS', supplement: 'Supplement drink', soup: 'Soup', other: 'Drink',
}
export const DRINK_NAME_MAX = 40

export const FLUID_KINDS = [
  'urine', 'water', 'tea', 'coffee', 'milk', 'juice', 'coconut_water', 'buttermilk', 'ors', 'supplement', 'soup',
  'stoma_output', 'drain_fluid', 'vomit', 'other', 'none',
] as const                                       // + coffee, coconut_water, buttermilk, ors, supplement
export const MEAL_FLUID_KINDS = DRINK_KINDS       // was ['water','tea','juice','milk','soup','other']
export const isDrinkKind = (f: string): f is DrinkKind => (DRINK_KINDS as readonly string[]).includes(f)

interface ContainerReading { /* … */ drink_name: string | null }
interface DraftEntry       { /* … */ drink: DrinkKind | null }
interface EntryInput       { /* … */ drink?: DrinkKind | null }       // water and food only
interface Entry            { /* … */ drink: DrinkKind | null }
interface AmendInput       { /* … */ drink?: DrinkKind | null }
interface EntryEvent       { /* … */ from_drink: DrinkKind | null; to_drink: DrinkKind | null; from_item: string | null; to_item: string | null }
interface ModelQuality     { /* … */ drink_kind: ClassRow[] }
```

`FLUID_KINDS` has `other` as both a drink kind and a fluid kind. A photo's `other` fluid means "liquid not identified". On an intake draft it becomes `drink: other`.

**Why this list.** Water, tea, coffee, milk and juice are universal. Coconut water, buttermilk/lassi and ORS are routine on Indian wards and appear in our notes and the tray dataset. Supplement drinks matter to dietitians. Soup is already a fluid kind and charts as `food`. Rejected alternatives:
- **Thickened**: it is a consistency, not a drink, and already has `iddsi_level`.
- **Kanji, sherbet, lemonade, soft drinks**: rare enough to go to `other` with a name. The kind's purpose is tallying, and the name says the rest.
- **Free-text kinds**: they cannot be tallied and could carry patient text into the read log.

### 2. Drink name (`apps/server/src/ai/text.ts`, `reading.ts`)

- The JSON schema adds `drink_name: { type: ['string','null'], description: 'The specific drink, 1–4 words, e.g. "masala chai", "filter coffee", "chaas". Null if not a drink or not identifiable.' }` and makes it required.
- `drinkName(raw, fluid, container)` runs in the zod `.transform`:
  1. remove characters below U+0020 (except whitespace) and U+007F–U+009F;
  2. replace each `\s+` with one space and trim;
  3. slice to `DRINK_NAME_MAX` code units and trim again;
  4. return null when the result is empty, null-like (the `nullableText` list), `!isDrinkKind(fluid)`, or the reading's category (fluid, else container, as in §4) is an output: urine, stoma, drain or vomit. `other` is a drink kind, so the category check is what nulls `drink_name` for fluid `other` in a `stoma_bag`, `drain_bag` or `urinal` (proposal: null for anything that is not a drink).

  Case is kept as given.
- **Why on the reading, not only the draft.** The reading is kept as photo evidence (charting/photo-evidence), so a nurse sees what the model named. The read log takes only `fluid` from it, as it already does.
- **Read-log rule.** The read log stores `fluid` and the draft's `drink`, both closed lists, and never `drink_name` or `item`. MODIFIED "Read log holds no text" names drink kinds as allowed and drink names as never stored. Its Voice note scenario moves from `coconut water` to `kokum sherbet`, because the kind `coconut_water` now legitimately contains `coconut`. The scenario's intent is unchanged: no note words in the row.

### 3. Prompt (`READING_SYSTEM`, `apps/server/src/ai/reading.ts:66`)

Step 1 becomes: `1. Identify the container and the liquid. For a drink, pick the nearest fluid kind (water, tea, coffee, milk, juice, coconut water, buttermilk or lassi, ORS, supplement drink, soup) and give drink_name, the specific drink if you can tell (e.g. "masala chai"); otherwise null.` The rest of the prompt is unchanged, including patient-devices' container list. `MEAL_SYSTEM` step 5's list becomes `(soup, milk, tea, coffee, juice, buttermilk, coconut water, ORS, supplement drinks)`, with `name` described as 1–4 words. `NOTE_SYSTEM`'s drink sentence becomes: `Drinks are category "water" with drink set to the nearest kind (tea, coffee, coconut water, ORS, buttermilk…); meals and soup are "food" (drink "soup" for soup, else "none").` No request is added, and the counts in `ai.test.ts` stay at 3/1, 1, 2 and 3/5/1.

### 4. Draft (`apps/server/src/ai/draft.ts`)

`FLUID_CATEGORY` gains `coffee`, `coconut_water`, `buttermilk`, `ors` and `supplement`, all mapped to `water`. Then:

```ts
const intake = !OUTPUT_CATEGORIES.has(category)
const drink: DrinkKind | null = !intake ? null
  : isDrinkKind(r.fluid) ? r.fluid
  : category === 'water' ? 'other' : null          // e.g. fluid none/other in a cup
const item = intake
  ? (r.drink_name ?? (drink && drink !== 'other' ? DRINK_LABEL[drink] : null))
  : (r.container === 'other' || r.container === 'none' ? null : r.container.replace(/_/g, ' '))
```

`food_tray` has no category today, so a food draft only comes from `soup`. Notes apply the same rule after the tool call (`notes.ts`): `water` gets `drink ?? 'other'`, `food` gets it only when it is a kind, and anything else gets null. The tool's `drink` enum is `[...DRINK_KINDS, 'none']`, and `none` maps to null.

### 5. Tray fluids (`apps/server/src/ai/meal.ts`)

`fluid_kind` uses `MEAL_FLUID_KINDS` (= `DRINK_KINDS`). `toMealReading` runs each fluid name through `drinkName`, falling back to `DRINK_LABEL[kind]`. Dish names keep `MEAL_BOUNDS.name` (80). The evidence route (`routes/evidence.ts:155`) keeps accepting names up to 80 characters, so meals stored earlier still validate.

### 5a. Photo evidence (`apps/server/src/routes/evidence.ts:38-55`)

The photo evidence `Reading` validator is `.strict()`, so a save carrying the new reading field would get a 400. It gains `drink_name: z.string().max(DRINK_NAME_MAX).nullable().optional()`. `optional()` keeps evidence stored before this change (no field) valid, and the 40-character cap matches the reading's own bound. MODIFIED charting/photo-evidence "Read evidence stored with the entry" names the field and adds the `Masala chai photo`, `Evidence without a drink name` and `Drink name too long` scenarios.

### 6. Storage (`apps/server/src/store/store.ts`): schema version 6 → 7

- `entry.drink TEXT` (nullable) and `entry_event.from_drink TEXT`, `to_drink TEXT`, `from_item TEXT`, `to_item TEXT`. An amend to a new kind sets `entry.item` to `DRINK_LABEL[kind]` and records the old and new item, so an entry never reads `Coffee · masala chai`; the amend body takes no `item`. There is no CHECK, as with `iddsi_level` and `care_order.kind`: the route validates against `DRINK_KINDS`.
- Read-log JSON draft facts gain `drink`. `DraftFactsSchema` gets `drink: z.enum(DRINK_KINDS).nullable().default(null)`, so rows stored without it still parse. They do not change the schema.
- **Why not reach "no schema"?** Totals by kind and the `drink_kind` accuracy table need the kind for manual and note entries, which have no photo evidence. It also has to survive an amendment. Rejected alternatives:
  - deriving the kind from `item`: `masala chai` is not `tea` by string match;
  - storing it inside `evidence` JSON: manual entries have no evidence, and amendments would have to rewrite evidence.
- **Bump.** dietitian-care takes 5 → 6, and patient-devices, ui-polish, model-api-guards and meta-wire-types-refresh add no schema. This change takes 6 → 7, stopping if the live value is not 6. Later changes, version lines only:
  - The later changes were renumbered after it: s3-media 7 → 8, labeled-photo-copy 8 → 9, scale-store 9 → 10, postgres-store's importer accepts 10, read-queue's SQLite version stays 10 (the infra reconcile, after this change was applied).

  postgres-store ports `SCHEMA` table by table into `schema.sql`, so it carries the three columns when it is applied in order. Its parity check catches a miss.
- `RuleEntry` (scale-store) does not need `drink`.

### 7. Accuracy (`apps/server/src/chart/model-accuracy.ts`, `scoring.ts`, `lab.ts`, `tray-lab.ts`)

- `drink_kind` table: `tallyClasses` over settled photo, text and voice drafts whose logged `drink` is not null. `model` is the drafted kind and `final` is the entry's final `drink ?? 'none'`. Rows follow `DRINK_KINDS` order, with `rate()` and `MIN_N` as for every table.
- The lab photo eval's fluid table already tallies over `FLUID_KINDS`, and the tray eval's over `MEAL_FLUID_KINDS`. Both gain the rows through the enum. `labelOf` keeps nulling unknown labels, and tray-lab keeps mapping them to `other`. `lab/synth.ts`' `expected_fluid` enum widens with `FLUID_KINDS`.
- **Stale eval baseline.** README's results table is still a placeholder (`README.md:214`), so no committed baseline exists. Any local `eval-*.md` predates both the patient-devices prompt change and this one, so it is stale for every photo and tray read, not only the new kinds. The tray dataset's labels that predate the new kinds can call coffee or coconut water `other`, so a correct `coffee` read scores as a miss until they are relabelled. Re-running the eval needs the user's approval and is not part of this change.

### 8. Web (`apps/web`)

- `lib/drinks.ts` (new):
  - `DRINK_ICON: Record<DrinkKind, LucideIcon>`: `water` GlassWater, `tea` Leaf, `coffee` Coffee, `milk` Milk, `juice` Citrus, `coconut_water` TreePalm, `buttermilk` Blend, `ors` Droplets, `supplement` CupSoda, `soup` Soup, `other` Droplet. All are present in `lucide-react` 1.66.0's `dist/lucide-react.d.ts`.
  - `drinkTitle(entry)` gives `{ label, name }`, where `name` is null when it equals the label ignoring case.
  - `drinkTotals(entries)` gives `[{ kind: DrinkKind | null, ml }]`, largest first, over approved `water` entries only (soup stays under food). Entries without a kind are grouped as `kind: null`.
  - `<DrinkLabel>` renders the icon (`aria-label` = the label), the label and the volume.

  ui-polish reuses all of these.
- Capture: the check screen and the by-hand form use a `DrinkPicker`. It is a Base UI `Select`, because 11 values exceed DESIGN.md's 2–8 rule for ChoiceChips, and it is 48 px tall. A change sets `item` to the new kind's label.
- Bed review:
  - `entry-log.tsx`, the pending list and `timeline.tsx` use `DrinkLabel`;
  - `bed-charts.tsx`' breakdown splits drinks by `drinkTotals`;
  - `meals.tsx` "What the AI read" uses the icon and the `<name> · <Kind>` rule;
  - `entry-details.tsx` Amend gains the `Drink` picker beside "Consistency";
  - `lib/history.ts` renders `drink <From> → <To>`.
- Data quality: `lib/model-view.ts` adds `Drink kind` after `Drink and fluid` in the `Table` select, with the empty text `No drink drafts in the last 7 days`.

### 9. ui-polish follow-ups (it comes after this change, and another agent is editing it now, so nothing in it is changed here)

ui-polish must render the drink wherever it shows an entry's category:
- **Entry peek**: the head reads `10:42 · Tea 150 mL` with the tea icon, then the name (`masala chai`) when it differs from the label.
- **Dense entry rows**: `▲ Tea 150 mL` in place of `▲ Water 150 mL` for entries with a `drink`. Its "Rejected" scenario's `100 mL tea` becomes an entry with `drink: tea`.
- **Balance timeline hover**: each listed entry uses `DrinkLabel`. The hour readout may add `Drinks: Tea 200 · Water 100` from `drinkTotals` over the hour.
- **Metric peeks on stats**: the bed's `In` peek breaks its drink share down by kind (`Tea 350 mL`, `Water 400 mL`, `Drink 100 mL`), using `drinkTotals`, with share bars. Its "Bed intake" scenario's `Water 1000 mL` becomes the kinds of those entries.
- **Segmentation and tray overlays**: the drink contour's label can read the kind (`Tea`) instead of the container.
- **Charts have a text equivalent**: the breakdown's table lists the drink kinds as rows.
- **DESIGN.md**: add the drink icon set (§8) and `DrinkLabel` to the component table.
- **charting/photo-evidence**: ui-polish's MODIFIED "Read evidence stored with the entry" must keep this change's `drink_name` wording and its three scenarios (§5a) alongside its masks.

## Risks / Trade-offs

- **[Spark picks a near kind wrongly, e.g. black tea as coffee]** The kind is a draft: the check screen shows it with a picker, nurses can amend it, and the `drink_kind` table measures it.
- **[`other` with no name reads `Drink 120 mL`]** This is the same as today. The photo is in the evidence.
- **[A name could carry stray text]** It is ≤ 40 characters, cleaned, only on the entry (as note items already are), never in the read log or the server logs.
- **[Older entries have `drink: null`]** They render as today and group under `Drink` in totals. A fresh store (schema 7) re-seeds the demo with kinds.
- **[Schema bump]** A store file at version 6 fails to open with charting/entries "Store schema version"'s message. Delete `DATA_DIR` or re-seed it.
- **[Tray labels predate the kinds]** Covered in §7.

## Migration Plan

1. Apply after patient-devices, with `STORE_SCHEMA_VERSION` at 6. Bump it to 7. There is no upgrade step.
2. Re-seed with `scripts/demo-history.ts` (§10).
3. Rollback: the previous build refuses a version-7 file, so re-seed. Stored reads with a `drink` field fail the previous build's `.strict()` draft facts. They are in the same file and go with it.

### 10. Demo seed (`apps/server/scripts/demo-history.ts`)

- Drinks are spread across beds (fictional):
  - 3A-4: `tea`, `coffee` and `coconut_water`;
  - 3A-1: `juice` (orange juice);
  - 2C-1 and HDU-2: `ors`;
  - 3A-6: `buttermilk` (chaas);
  - HDU-3: `supplement`;
  - the remaining beds: `water` and `tea`.
- Every `water` row gets `drink`, and the items name the drink (`masala chai`, `filter coffee`, `ORS`, `chaas`). Volumes, times, statuses and `iddsi` values are unchanged, so prompts are unchanged.
- `drinkOf` maps items to the new fluid kinds (`coconut` → `coconut_water` and so on) and sets the evidence `drink_name`. Its "read as water" comment goes, because `coconut_water` is now a drink kind.
- The guard adds:
  - every seeded `water` entry has a non-null `drink`;
  - at least six distinct kinds among them;
  - every photo drink entry's evidence `fluid` equals its `drink`.

  Every existing guard row (the read mix, prompts per bed, poor intake, 2C-2's meal fluids) stays as it is.
