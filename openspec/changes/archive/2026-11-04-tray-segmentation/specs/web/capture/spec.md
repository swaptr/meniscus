# Spec Delta

## ADDED Requirements

### Requirement: Dishes on the meal form
After a tray read with dishes, the Meal form SHALL show the tray photo with its dish outlines, as in "Tray overlay", and one row per dish in place of the items field: its region number, an editable name, a kind and portion chips. Saving sends the edited `dishes`, their names joined by ", " as `items`, and the read unchanged as evidence, and makes no `/api/ai` request. If the tray photo upload fails, the meal is posted without evidence.

#### Scenario: Rice was finished
- **WHEN** a tray read drafts dishes `1 rice` (kind Rice, Half) and `2 dal` (kind Dal / lentils, All), and the attendant taps All on rice, renames dal to `sambar`, then saves
- **THEN** the meal post has `dishes: [{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }, { index: 2, name: "sambar", dish_kind: "dal_lentils", portion: 100 }]` and `items: "rice, sambar"`
- **AND** its evidence's reading still has rice at portion 50 and the name `dal`, and its `image_sha256` is the read's
- **AND** saving sent `POST /api/admissions/<id>/media` and `POST /api/admissions/<id>/meals`, and no `/api/ai` request

#### Scenario: Read with no dishes
- **WHEN** a tray read returns no dishes
- **THEN** the form shows the items field, as for a meal by hand, and no dish rows

#### Scenario: Tray photo not kept
- **WHEN** a tray read drafts dishes `1 rice` and `2 dal`, and on saving `POST /api/admissions/<id>/media` answers 500
- **THEN** the meal post has those dishes, no `media_id` and no `evidence`
- **AND** the save result warns that the photo was not kept
