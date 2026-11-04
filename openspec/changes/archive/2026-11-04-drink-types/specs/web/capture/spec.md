# Spec Delta

## ADDED Requirements

### Requirement: Drink on the check screen
A draft with a `drink` SHALL show on the check screen with the kind's icon and `<Kind> · <mL>` (`Drink` for `other`), its item below when that differs from the label ignoring case, and a `Drink` picker of the eleven kinds set to its kind. Picking another kind sets `drink` and the item to the new label. The by-hand form for `water` offers the same picker, unset. Saving sends `drink` and `item`, and no `/api/ai` request.

#### Scenario: Masala chai photo
- **WHEN** a photo read returns a draft `{ in, water, 150 mL, item: "masala chai", drink: tea }`, and the attendant saves it
- **THEN** the check screen shows the tea icon, `Tea · 150 mL` and `masala chai`, with `Tea` picked
- **AND** saving makes exactly two requests, `POST /api/admissions/<id>/media`, then `POST /api/admissions/<id>/entries` with `drink: "tea"` and `item: "masala chai"`

#### Scenario: Kind changed
- **WHEN** that draft's picker is changed to `Coffee` before saving
- **THEN** the screen shows `Coffee · 150 mL`, and the entry post has `drink: "coffee"` and `item: "Coffee"`

#### Scenario: Coconut water by hand
- **WHEN** the attendant picks Drink by hand, 200 mL, and `Coconut water` in the picker, and saves
- **THEN** the only request is `POST /api/admissions/<id>/entries` with `{ direction: "in", category: "water", volume_ml: 200, drink: "coconut_water", item: "Coconut water", source: "manual" }`

#### Scenario: Output draft
- **WHEN** a photo read returns a urine draft from a urinal
- **THEN** the check screen shows no `Drink` picker, and the entry post has no `drink`
