# Proposal

## Why

A photo of a cup of tea is charted as `Drink 200 mL` with item `cup`. Spark already says the liquid is tea (`fluid: tea`), but the draft's `item` is the container's name, so what was drunk never reaches the chart. There is no `coffee`, and no ORS, buttermilk or lassi, coconut water or supplement drink, all of which Indian and general wards serve. Voice and typed notes already chart `coconut water`, so the chart reads differently depending on how a drink was captured. Nurses and dietitians want to see what was drunk, and the recorded demo should show it.

## What Changes

- **One drink vocabulary** (`packages/shared`). `DRINK_KINDS`: `water`, `tea`, `coffee`, `milk`, `juice`, `coconut_water`, `buttermilk` (also lassi and chaas), `ors`, `supplement` (nutritional supplement drinks), `soup` and `other`. It is fixed, small and safe to tally. `DRINK_LABEL` gives each one a display label (`Tea`, `Coconut water`, `ORS`, `Supplement drink`, `Drink` for `other`). `FLUID_KINDS` is these kinds plus the output and empty kinds. `MEAL_FLUID_KINDS` becomes `DRINK_KINDS`. Thickened drinks are not a kind: their consistency stays `iddsi_level` (charting/entries "Drink consistency on the entry"), so a thickened tea is `tea` at IDDSI 2.
- **Photo read names the drink** (`capture/photo-reading`). Spark returns `fluid` from the larger list, plus `drink_name`: the specific drink it sees (`masala chai`), or null. The name is trimmed, cleaned, cut to 40 characters, and null for anything that is not a drink. The prompt names the drinks. patient-devices' wording (bedpans, commode pans) is kept.
- **The draft's item is the drink** (MODIFIED **Draft entry from reading**). An intake draft gets `drink` (the kind) and `item` (the name, else the kind's label, e.g. `Tea`), never the container. Output drafts keep their container item (`urine bag`, `commode pan`) and have `drink: null`. The container stays in the photo evidence. Photo evidence accepts the reading's `drink_name` (MODIFIED charting/photo-evidence **Read evidence stored with the entry**), so a save carrying it is not rejected.
- **Notes and trays use the same kinds** (`capture/notes`, `capture/meal-reading`). `log_entry` gains `drink`. Tray fluids take `fluid_kind` from `DRINK_KINDS`, and their names follow the drink-name rules.
- **Entries keep the kind** (`charting/entries`, `charting/audit`). An entry has an optional `drink` on `water` and `food` entries. A nurse or matron can amend it, A new kind renames the item to the kind's label, and the `amended` event records `from_drink`, `to_drink`, `from_item` and `to_item`.
- **Accuracy** (`charting/model-accuracy`). Read-log drafts keep the drink kind, never the name (MODIFIED **Read log holds no text**). The summary gains a `drink_kind` table. The photo and tray evals count every new kind.
- **UI** (`web/capture`, `web/ward`):
  - the check screen shows the kind's icon and `Tea · 200 mL`, then the name, with a drink picker, which the by-hand form also has;
  - the bed review's log, pending list and timeline show `Tea 200 mL` and the name;
  - the intake bar splits drinks by kind (MODIFIED **Intake and output breakdown**);
  - "What the AI read" on meals shows each fluid's kind;
  - Amend can change the kind;
  - the Model accuracy `Table` select gains `Drink kind` (MODIFIED **Class table picker**).
- **Demo** (`scripts/demo-history.ts`, fictional). Drinks vary across tea, coffee, water, juice, coconut water, ORS and buttermilk, each with its `drink`. Photo evidence reads the matching `fluid`. Every existing guard row is unchanged, and the guard gains drink rows.
- **Schema.** `entry.drink` and `entry_event.from_drink` / `to_drink` / `from_item` / `to_item` are new columns, so `STORE_SCHEMA_VERSION` goes from 6 (dietitian-care) to 7. Later changes are renumbered after it: s3-media 7 → 8, labeled-photo-copy 8 → 9, scale-store 9 → 10, postgres-store's importer accepts 10, read-queue's SQLite version stays 10.

### Upstream model requests per user action (before → after)

| Action | Before | After |
|---|---|---|
| Photo read (`sam+spark` / `spark`) | 3 / 1 | 3 / 1 (same calls; the reply has more kinds and `drink_name`) |
| Text note / voice note | 1 / 2 | 1 / 2 (the `log_entry` tool gains `drink`) |
| Tray read (`sam+spark` / compared with a served photo / `spark`) | 3 / 5 / 1 | 3 / 5 / 1 |
| Saving, amending, the summary, the views, the eval report | 0 | 0 |
| Lab eval plan | 3 / 1 a photo or tray | unchanged; nothing is sent without approval |

### Changed shapes (`packages/shared`)

- New: `DRINK_KINDS` / `DrinkKind`, `DRINK_LABEL`, `DRINK_NAME_MAX` (40).
- **BREAKING**: `FLUID_KINDS` / `FluidKind` gain `coffee`, `coconut_water`, `buttermilk`, `ors` and `supplement`. The web's exhaustive fluid maps must add them.
- **BREAKING**: `MEAL_FLUID_KINDS` becomes `DRINK_KINDS`, so it gains `coffee`, `coconut_water`, `buttermilk`, `ors` and `supplement`.
- **BREAKING**: `ContainerReading` gains `drink_name: string | null`. `DraftEntry` gains `drink: DrinkKind | null`.
- `EntryInput` gains `drink?: DrinkKind | null`. `Entry` gains `drink: DrinkKind | null` (**BREAKING** for web fixtures). The amend body gains `drink`, and the entry event gains `from_drink` / `to_drink` / `from_item` / `to_item`.
- `ModelQuality` gains `drink_kind: ClassRow[]`. The stored read's draft facts gain `drink`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `capture/photo-reading`: drink kinds and `drink_name` in the reading, their bounds, and the draft's item and `drink`.
- `capture/notes`: `drink` on `log_entry`.
- `capture/meal-reading`: tray fluids use the drink kinds and the drink-name rules.
- `charting/entries`: `drink` on the entry.
- `charting/audit`: amending a drink's kind.
- `charting/model-accuracy`: the drink kind in the read log, the `drink_kind` table and the evals.
- `charting/photo-evidence`: photo evidence accepts the reading's optional `drink_name` (≤ 40), and older evidence without it still validates.
- `web/capture`: the drink on the check screen and the by-hand form.
- `web/ward`: drinks named on the bed review, the breakdown by kind, meal fluid kinds, amending the kind, and the class table.

## Out of scope

- The meal's own fluid entry (charting/meals "Meal fluid becomes a pending entry") keeps `drink: null` and its `<Meal>: <items>` item. A tray can hold several drinks, and the meal post carries no fluid kinds.
- The ward-round check screen, the printable chart, the dietitian worklist and `top_corrections` do not show drink kinds.
- ui-polish's entry peek, dense rows, timeline hover and metric peeks. They come after this change, and the follow-ups are listed in design.md §9.
- Calories or nutrients per drink, or any judgement about a drink's suitability. Thickened-fluid prompts are unchanged.
- Re-running the eval. That sends requests and needs the user's approval.

## Impact

- `packages/shared/src/index.ts`; `apps/server/src/ai/{reading,draft,notes,meal,read-log}.ts`; `apps/server/src/routes/{entries,evidence}.ts` and the amend route; `apps/server/src/store/store.ts` (`SCHEMA` and the version); `apps/server/src/chart/{model-accuracy,scoring,lab,tray-lab}.ts`; `apps/server/src/lab/synth.ts`; `apps/server/scripts/demo-history.ts`.
- `apps/web/src/lib/{labels,meals,model-accuracy}.ts`, a new `lib/drinks.ts`, capture and bed review components, and `routes/n/index.tsx`.
- Version lines only in `openspec/changes/scale-store/{proposal,design,tasks}.md`, `openspec/changes/postgres-store/{proposal,design}.md` and `openspec/changes/read-queue/design.md`.
- No new dependencies, env vars or model calls. The icons are in `lucide-react` 1.66.0 (checked in `dist/lucide-react.d.ts`).
