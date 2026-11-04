# Spec Delta

## ADDED Requirements

### Requirement: Meal capture
The capture screen SHALL offer "Meal": the meal preselected by local time (breakfast 05:00–10:29, lunch 10:30–14:59, snack 15:00–17:59, otherwise dinner), portion chips None, ¼, ½, ¾ and All, items, optional fluid mL and "When did it happen?". "Photo of the tray" SHALL make exactly one `/api/ai/meal` request and fill the form from its draft; when the read needs review it SHALL say "Check the tray" with the reasons. Saving SHALL post the meal and make no `/api/ai` request.

#### Scenario: Lunch by hand
- **WHEN** at 13:10 the attendant opens Meal, picks ½, types "rice, dal" and sets 150 mL, then saves
- **THEN** the only request is `POST /api/admissions/<id>/meals` with `{ meal: "lunch", portion: 50, items: "rice, dal", fluid_ml: 150, source: "manual" }`

#### Scenario: Tray photo
- **WHEN** the attendant takes a tray photo whose draft is `{ portion: 75, items: "idli, sambar", fluid_ml: 100 }` with confidence 0.8, then saves
- **THEN** exactly one `/api/ai/meal` request was made, and the save posts `portion: 75`, `items: "idli, sambar"`, `fluid_ml: 100`, `source: "photo"`, `confidence: 0.8` and the read's evidence

#### Scenario: Tray needs a check
- **WHEN** the tray read returns confidence 0.6 with issue `partly_hidden`
- **THEN** the form shows `Check the tray: low confidence (0.60), partly hidden`

#### Scenario: Meal by time of day
- **WHEN** Meal is opened at 07:45, 15:30 and 21:00
- **THEN** breakfast, snack and dinner are preselected
