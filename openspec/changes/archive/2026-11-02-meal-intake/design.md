# Design

## Context

Fluid entries, attribution (`X-Staff-Id`), late charting (`charted_at`) and entry history exist (`charting/entries`, `charting/audit`). Photo reads go through `createAi().readCapture` (SAM ×2 + Spark). A food tray is not a graduated container, so SAM's fill fraction says nothing about how much was eaten; the tray read is Spark only. Meals are a separate record so the fluid chart keeps one meaning (volumes a nurse approved), and the meal's fluid joins it the same way every other capture does: as a pending entry.

## Types (`packages/shared`)

```ts
export const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealKind = (typeof MEAL_KINDS)[number]
/** Percent of the serving eaten. */
export const PORTIONS = [0, 25, 50, 75, 100] as const
export type Portion = (typeof PORTIONS)[number]
export const MEAL_ISSUES = ['not_a_meal', 'blurred', 'partly_hidden', 'tray_empty_unclear'] as const
export type MealIssue = (typeof MEAL_ISSUES)[number]
export const MEAL_SOURCES = ['manual', 'photo'] as const
export type MealSource = (typeof MEAL_SOURCES)[number]

/** Muse Spark's read of a tray photo (strict JSON schema). */
export interface MealReading {
  items: { name: string; portion: Portion }[]
  portion: Portion
  fluids: { name: string; volume_ml: number }[]
  confidence: number
  issues: MealIssue[]
  notes: string | null
}
export interface MealDraft {
  portion: Portion
  /** Item names joined by ", "; "" when none. */
  items: string
  /** Sum of the fluids; null when none. */
  fluid_ml: number | null
}
export interface MealReadResult {
  reading: MealReading
  draft: MealDraft
  needs_review: boolean
  trace: CallTrace[]
  ms: number
}
/** Kept with a photo meal; the image itself is not kept. */
export interface MealEvidence {
  reading: MealReading
  trace: CallTrace[]
}
export interface MealInput {
  meal: MealKind
  portion: Portion
  items?: string | null
  fluid_ml?: number | null
  source: MealSource
  confidence?: number | null
  evidence?: MealEvidence | null
  charted_at?: string
}
export interface Meal {
  id: number
  admission_id: number
  meal: MealKind
  portion: Portion
  items: string | null
  fluid_ml: number | null
  source: MealSource
  confidence: number | null
  evidence: MealEvidence | null
  /** Charted time. */
  created_at: string
  recorded_at: string
  late: boolean
  created_by: StaffRef | null
  entry_id: number | null
  entry_status: EntryStatus | null
  voided_at: string | null
  voided_by: StaffRef | null
  void_reason: string | null
}
export interface VoidMealInput {
  reason: string
}
```

No existing type changes.

## Server

**Storage (`store/store.ts`).** New STRICT table, created by `SCHEMA` (no migration needed: `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS meal (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admission(id),
  meal TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  portion INTEGER NOT NULL CHECK (portion IN (0,25,50,75,100)),
  items TEXT, fluid_ml INTEGER CHECK (fluid_ml > 0), source TEXT NOT NULL CHECK (source IN ('manual','photo')),
  confidence REAL, evidence TEXT,
  created_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES staff(id),
  entry_id INTEGER REFERENCES entry(id),
  voided_at INTEGER, voided_by INTEGER REFERENCES staff(id), void_reason TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS meal_admission_created ON meal(admission_id, created_at);
```

- `addMeal(admissionId, input, staffId)` in one transaction: when `fluid_ml` is set, it inserts the fluid entry through the existing `insertEntry` (so it gets its `recorded` event and attribution), then the meal with `entry_id`. Entry: `direction 'in'`, `category 'food'`, `item` `"Lunch: rice, dal"` sliced to 200 characters, `source` the meal's source, `confidence: null` (a volume guessed from bowl sizes must never be batch-approved), `evidence: null`, charted at the meal's time.
- `meals(admissionId)` joins staff (recorder, voider) and the entry's status; charted in the last 24 h, newest first.
- `voidMeal(mealId, reason, staffId)` returns `{ ok: true, meal } | { ok: false, error: 'not_found' | 'already_voided' }`. In one transaction it rejects a pending linked entry with `reviewIn(entryId, 'reject', { reason: 'other', note: reason, staffId })`: the body of `review` moved into an in-transaction helper (like `insertEntry`) that `review` wraps in `tx`, since SQLite cannot nest `BEGIN`.

**Routes (`routes/chart.ts`).** `POST /admissions/:id/meals` (staffHeader, `MealBody` zod: enums, portion literal union, items trimmed ≤ 200, fluid 1–`MAX_ENTRY_ML`, confidence 0–1, evidence validated by a `MealEvidenceSchema` with bounded arrays and strings; `charted_at` uses the entry range check), `GET /admissions/:id/meals`, `POST /meals/:id/void` (staffHeader, reason trimmed 3–200).

**AI (`ai/meal.ts`, domain).** The model answers with string enums only (`none | quarter | half | three_quarters | all`, as `ai/reading.ts` does; integer enums in strict schemas are not relied on), parsed by a lenient `MealModelSchema` and mapped to percents. `clampMealReading` then trims it to the evidence bounds (≤ 20 items, ≤ 10 fluids, names ≤ 80, notes ≤ 300, mL 0–5000), so `MealReadingSchema` (strict, bounded, used to validate evidence on `POST /meals`) always accepts what the server returned. `MEAL_JSON_SCHEMA` (strict), `MEAL_SYSTEM` prompt: read only what is visible; portion eaten per item assuming a standard hospital serving; fluids as served-and-drunk volumes in mL with typical bowl/cup sizes; report issues; never comment on nutrition. Pure `toMealDraft(reading)` and `mealNeedsReview(reading)` (confidence < `AUTO_CONFIRM_CONFIDENCE` or any issue). `createAi().readMeal({ image, mime, signal })` makes one `responses.generateObject` call with `model: MODELS.spark`, the image as `input_image` (detail high) and `traceOf('spark:meal', r)`. The Meta client already sends `store: false`.

**Route (`routes/ai.ts`).** `POST /ai/meal` with `validate('form', z.object({ image: ImageFile }))` and the existing error mapping, so bad uploads are 400 before any request and upstream errors map as for `/ai/read`.

## Web

- **`lib/meals.ts`** (pure): `defaultMeal(date)`, `PORTION_LABEL`, `MEAL_LABEL`, `toMealInput(form, read?)`, `mealRow(meal)` → `{ time, meal, portion, parts, items, fluid, by, voided }` strings for the row, `voidBody(reason)` → body or null.
- **`lib/api.ts`**: `addMeal`, `meals`, `voidMeal` (staff header on the changes), `readMeal(photo, signal)` (one `/ai/meal`).
- **Capture (`routes/a/bed.$token.tsx` + `components/meal-form.tsx`)**: a fourth tile "Meal" opens the form in place (phase `meal`). The tray photo reuses `shrinkPhoto`; the read is cancellable like the others. "When" reuses `chartedAt`. `needs_review` shows "Check the tray: …" from `mealReviewText(read)`. The "Take photo" tile's hint drops "meal tray", and `food_tray` leaves its container picker, so trays go through the 1-request meal read instead of the 3-request container read.
- **Bed review (`components/meals.tsx`)**: "Meals, 24 h" section after the charts; rows from `mealRow`; "What the AI read" disclosure for photo meals (items with portions and the trace via the existing step labels plus `'spark:meal': 'Muse Spark · tray'`); `VoidMealDialog` (reuses `sheet.styles.ts`). One `GET /meals` with the bed's entries load and on change; no polling beyond the bed's existing refresh.

## Decisions

- Tray read is Spark only (1 request): SAM's container/liquid boxes don't measure food eaten.
- Meal fluid is a pending entry, not a meal-side total, so totals, prompts, charts and the print sheet need no change and a nurse still approves every volume.
- Void, not delete or amend: keeps the record and who changed it, matching `charting/audit`.
- Portion as five steps: the paper food chart's resolution; finer numbers would be false precision from one photo.

## Risks

- [Portion read from one after-photo is a guess] → confidence and issues gate a check, and the attendant confirms every draft.
- [Model invents fluids] → fluids are optional, shown in the draft before saving, and become a pending entry a nurse approves.
- [Bundle] → the meal form and the void dialog load lazily.
