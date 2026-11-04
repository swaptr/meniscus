# Proposal

## Why

Fluid balance charts sit next to a food chart on most wards: what was served, how much of it the patient ate, and the soup, dal or milk that came with the tray. Meniscus charts only fluids, so the attendant keeps food on paper, and the fluid in a meal is guessed or missed. A photo of the tray at collection is the moment the information exists; Muse Spark can read it in one call, and the attendant confirms it like any other draft.

## What Changes

- **Meals.** A meal record per admission: meal (breakfast, lunch, dinner, snack), portion eaten (none, a quarter, half, three quarters, all), the items, and the fluid served with it in mL. It is attributed (`X-Staff-Id`), may be charted late (`charted_at`, the entry rules), and keeps how it was captured (by hand or tray photo) with the AI read and its trace.
- **Meal fluid joins the fluid chart.** A meal with fluid creates a pending `food` intake entry for that volume, so it counts in the 24 h totals only after a nurse approves it, like any other entry.
- **Voiding a meal.** A wrong meal (wrong bed, duplicate) is voided with a reason, never deleted; it stays visible, struck through, with who voided it. A pending linked fluid entry is rejected with it.
- **Tray reading.** `POST /api/ai/meal` reads a tray photo with Muse Spark (vision, strict JSON schema, `store: false`) into a draft: items with how much of each was eaten, the overall portion, the fluids with mL, a confidence and issues. Low confidence or issues ask for a check.
- **Capture screen.** "Take photo" no longer offers the meal tray container (that read costs 3 requests and only finds soup). A fourth tile, "Meal": meal preselected by the time of day, "Photo of the tray" (one request) or by hand, portion chips, items, optional fluid mL, and "When did it happen?". Saving makes no model request.
- **Bed review.** A "Meals, 24 h" section: time, meal, portion eaten as a word and a four-part bar, items, the meal's fluid and its entry's status, who recorded it and how, "What the AI read" for photo meals, and "Void…".

Model requests per user action: tray photo read 0 → 1 (Muse Spark only, no SAM). Saving, listing and voiding meals: 0. Every other action is unchanged.

Changed shapes:
- New types and constants in `packages/shared`: `MEAL_KINDS`, `MealKind`, `PORTIONS`, `Portion`, `MEAL_ISSUES`, `MealIssue`, `MEAL_SOURCES`, `MealSource`, `MAX_MEAL_ITEMS`, `MealReading`, `MealDraft`, `MealReadResult`, `MealEvidence`, `MealInput`, `Meal`, `VoidMealInput`.
- New endpoints: `POST /api/admissions/:id/meals`, `GET /api/admissions/:id/meals`, `POST /api/meals/:id/void`, `POST /api/ai/meal`.
- Not breaking: no existing type or response changes. Meal fluid entries are ordinary `Entry` rows (`category: 'food'`).

### Out of scope

- Nutrition advice, calorie or protein counts, diet plans, and any alert or prompt about eating. This is charting; nurses decide what it means.
- Voice notes for meals, and meals in the ward round.
- Before-and-after tray photos; the read assumes a standard serving.
- Keeping the tray photo. The read and its trace are kept; the image is not.
- Meals on the print sheet, the ward dashboard and the data quality view.
- Amending a meal; void it and record it again.
