# Spec Delta

## MODIFIED Requirements

### Requirement: Tray proof stored with the meal
Saving a `photo` meal with evidence SHALL store a proof the server builds: the tray photo's media id, SHA-256, who uploaded it and when, the same for its served photo as `served` (else null), and the portion, items, fluid mL and dishes as saved, with who saved the meal and when. The meal returns it as `proof`, null for any other meal. No request changes the proof or the evidence afterwards, the database refuses any UPDATE of either, and voiding deletes only the bytes of both photos.

#### Scenario: Lunch proof
- **WHEN** Ravi Kumar (id 1) uploads bed 1's tray photo at 13:09, and saves the lunch from its read at 13:10 with portion 75, items `rice, dal`, 150 mL and dishes rice 100 and dal 50
- **THEN** the meal's `proof.photo` holds that media id, the `sha256` the upload returned, `captured_by` Ravi Kumar and `captured_at` 13:09
- **AND** `proof.confirmed` is portion 75, items `rice, dal`, `fluid_ml: 150` and those two dishes, with `confirmed_by` Ravi Kumar at 13:10
- **AND** `proof.served` is null

#### Scenario: Proof outlives a void
- **WHEN** that lunch is voided with reason `wrong bed`
- **THEN** `GET /api/media/<id>` for its photo returns 404, and the meal returns `media: null`
- **AND** its `proof` and `evidence` are byte-identical to when it was saved, and `proof.photo.sha256` still holds the fingerprint

#### Scenario: Database refuses changes
- **WHEN** `UPDATE meniscus.meal SET evidence = '{}'` and then `UPDATE meniscus.meal SET proof = NULL` are run on that lunch's row as the server's own database role
- **THEN** each statement fails with SQLSTATE `P0001`, and the lunch still returns the same `evidence` and `proof`

#### Scenario: Meal by hand
- **WHEN** a `manual` breakfast is posted
- **THEN** it returns `proof: null`

### Requirement: Meal amendment history
Each meal amendment SHALL be kept with the meal's portion, items and dishes before and after, its reason, who made it and when, and returned by every meal read as the meal's `amendments`, oldest first. The database refuses any UPDATE or DELETE of a kept amendment, and voiding the meal keeps them. It makes no model request.

#### Scenario: Two amendments
- **WHEN** that lunch is amended at 14:30 by Anita Thomas (rice 50 → 100, reason `tray rechecked`) and at 15:10 by Lakshmi Iyer (portion 75 → 100, reason `patient finished it`)
- **THEN** its `amendments` hold, in that order:
  - `{ at: 14:30, by: Anita Thomas, reason: "tray rechecked" }`, with `before` portion 75, items `rice, dal`, dishes rice 50 and dal 100, and `after` the same with rice 100;
  - `{ at: 15:10, by: Lakshmi Iyer, reason: "patient finished it" }`, with `before` portion 75 and `after` portion 100, both with dishes rice 100 and dal 100
- **AND** its `amended_at` is 15:10

#### Scenario: Database refuses changes
- **WHEN** `UPDATE meniscus.meal_event SET reason = 'x'` and then `DELETE FROM meniscus.meal_event` are run as the server's own database role
- **THEN** each statement fails with SQLSTATE `P0001`, and the lunch still returns the same two amendments

#### Scenario: Kept after a void
- **WHEN** that lunch is voided with reason `wrong bed`
- **THEN** it still returns both amendments, with `voided_at` set
