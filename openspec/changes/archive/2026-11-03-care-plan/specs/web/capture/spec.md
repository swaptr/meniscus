# Spec Delta

## ADDED Requirements

### Requirement: Care orders at the bed
The attendant's bed screen SHALL show the bed's care badges under the patient banner, as on the ward bed card, read-only. They come from its existing load (`GET /api/beds/<token>` and `GET /api/admissions/<id>/entries`), with no extra request.

#### Scenario: Fasting stroke patient
- **WHEN** Ravi Kumar (attendant) opens `/a/bed/<token>` for a bed that is nil by mouth with thickened fluids at level 2
- **THEN** the banner shows `NBM` and `IDDSI 2`, with no control to change them
- **AND** the only requests are `GET /api/beds/<token>` and `GET /api/admissions/<id>/entries`

### Requirement: Nil by mouth warning before saving
While the bed has an active nil-by-mouth order, these screens SHALL warn before saving a water or food draft, or a meal with some portion eaten or some fluid: the capture check screen, the by-hand form, the Meal form and the bed review's "Add missed entry". The warning reads `Nil by mouth since <time>[, until <time>]. Saving records it and asks the nurse to review.`, and the save button reads `Save anyway`. Saving sends the same requests as without the order.

#### Scenario: Drink for a fasting patient
- **WHEN** 2C bed 1 has been nil by mouth since 06:00 with no planned end, and Ravi Kumar enters a 200 mL drink by hand
- **THEN** the form shows `Nil by mouth since 06:00. Saving records it and asks the nurse to review.`, and the save button reads `Save anyway`
- **AND** tapping it sends exactly one request, `POST /api/admissions/<id>/entries`, and no `/api/ai` request

#### Scenario: Planned end
- **WHEN** the bed is nil by mouth since 06:00 until 14:00, and a voice draft of 150 mL tea is checked
- **THEN** the draft shows `Nil by mouth since 06:00, until 14:00. Saving records it and asks the nurse to review.`

#### Scenario: IV or output
- **WHEN** on the same bed a 500 mL IV draft and a 300 mL urine draft are checked
- **THEN** neither shows the warning, and both save buttons read `Save`

#### Scenario: Meal
- **WHEN** on the same bed the Meal form has portion ½, then portion None with no fluid, then portion None with 150 mL tea
- **THEN** the first shows the warning with `Save anyway`, the second does not, and the third shows it again

#### Scenario: Missed entry by a nurse
- **WHEN** Meera Pillai (id 6) adds a missed 200 mL drink on that bed from the bed review
- **THEN** the dialog shows the warning
- **AND** saving sends `POST /api/admissions/<id>/entries`, then `POST /api/entries/<new id>/review` with `action: approve`, as without the order

### Requirement: Drink consistency on the check screen
With an active thickened-fluids order, the capture check screen, the by-hand form and the bed review's "Add missed entry" SHALL offer "Consistency" for a water draft and send the chosen `iddsi_level`. Chips run from `0 Thin` to `4 Extremely thick`, first set to the ordered level. A lower level shows `Thinner than ordered (IDDSI <level> <name>). The nurse is asked to review.` Without the order, nothing is shown or sent. It makes no model request.

#### Scenario: Defaults to the order
- **WHEN** 5B bed 6 has thickened fluids at level 2, and a 200 mL drink entered by hand is saved unchanged
- **THEN** "Consistency" shows `2 Mildly thick` picked
- **AND** the only request is `POST /api/admissions/<id>/entries` with `iddsi_level: 2`

#### Scenario: Thinner than ordered
- **WHEN** on that drink `0 Thin` is picked, and it is saved
- **THEN** the form shows `Thinner than ordered (IDDSI 2 Mildly thick). The nurse is asked to review.`, and saving stays enabled
- **AND** the entry request carries `iddsi_level: 0`

#### Scenario: Thicker
- **WHEN** `3 Moderately thick` is picked instead
- **THEN** no warning is shown, and the entry request carries `iddsi_level: 3`

#### Scenario: Photo draft
- **WHEN** a photo of a cup of water on that bed is read, then saved unchanged
- **THEN** "Consistency" shows `2 Mildly thick` picked, and the entry request carries `iddsi_level: 2`
- **AND** reading it sent one `/api/ai/read` request, and saving sent none

#### Scenario: Type changed
- **WHEN** the drink's type is changed to food, and then back to drink
- **THEN** with food no "Consistency" is shown and the request carries no `iddsi_level`
- **AND** back on drink, `2 Mildly thick` is picked again

#### Scenario: No order
- **WHEN** a 200 mL drink is entered by hand on a bed with no thickened-fluids order
- **THEN** no "Consistency" is shown, and the entry request carries no `iddsi_level`
