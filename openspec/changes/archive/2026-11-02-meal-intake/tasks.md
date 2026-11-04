# Tasks

## 1. Shared types

- [x] 1.1 Add `MEAL_KINDS`, `PORTIONS`, `MEAL_ISSUES`, `MEAL_SOURCES` and the `MealReading`, `MealDraft`, `MealReadResult`, `MealEvidence`, `MealInput`, `Meal` and `VoidMealInput` types to `packages/shared`. Verify: `pnpm typecheck`.

## 2. Server

- [x] 2.1 `meal` table, `addMeal`, `meals`, `voidMeal` in the store, and the three routes. Tests in `apps/server/src/meals.test.ts`, each asserting 0 upstream requests:
  - [charting/meals] Record a meal: "Lunch by hand", "Invalid meals", "Unknown admission".
  - [charting/meals] Meal fluid becomes a pending entry: "Soup with dinner", "Long items".
  - [charting/meals] Meals of the last day: "Two meals".
  - [charting/meals] Void a meal: "Wrong bed", "Fluid already approved", "Void refused".
- [x] 2.2 `ai/meal.ts` (schema, prompt, `toMealDraft`, `mealNeedsReview`), `readMeal` in the pipeline and `POST /ai/meal`. Tests in `apps/server/src/meal-reading.test.ts` with the fake upstream:
  - [capture/meal-reading] Tray reading: "Half-eaten lunch" (exactly 1 request, `store: false` in its body), "Not a meal".
  - [capture/meal-reading] Tray review gate: "Issue at high confidence", "At the threshold".
  - [capture/meal-reading] Tray read fits a saved meal: "Long read".
  - [capture/meal-reading] Tray upload validation: "Text file as a tray".
- [x] 2.3 Demo history: a few fictional meals per bed (by hand and tray photo with synthetic read evidence), one with soup, one voided. Verify against a temp `DATA_DIR`.

## 3. Web

- [x] 3.1 `lib/meals.ts` and the api methods. Tests in `apps/web/src/lib/meals.test.ts`; request scenarios go through `createApi` with a fake fetch and assert the exact requests (as `resolve.test.ts` does):
  - [web/capture] Meal capture: "Lunch by hand", "Tray photo", "Tray needs a check", "Meal by time of day".
  - [web/ward] Meals on the bed review: "Lunch from a tray photo", "Breakfast by hand", "What the AI read", "Voided meal".
  - [web/ward] Void a meal from the bed review: "Void with a reason".
- [x] 3.2 Capture screen for [web/capture] Meal capture: Meal tile and `components/meal-form.tsx`; drop `food_tray` from the photo hint. Verify in the browser at 390 px (by hand; no live tray read).
- [x] 3.3 Bed review for [web/ward] Meals on the bed review and [web/ward] Void a meal from the bed review: `components/meals.tsx` with "What the AI read" and the void dialog. Verify at 390 and 1100 px.

## 4. Docs and verification

- [x] 4.1 README (screens, models table: tray read 1 request) and AGENTS.md request counts (meal photo 1).
- [x] 4.2 Bundle check: each route under 100 KB gzipped.
- [x] 4.3 `pnpm verify` passes (format, lint, typecheck, tests, specs, traces).
