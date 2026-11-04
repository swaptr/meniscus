# Spec Delta

## ADDED Requirements

### Requirement: Ward progress
A round started for a ward SHALL show that ward's beds, each marked visited once its bed card is scanned in the round, making no model request. A card from another ward SHALL still make that bed current and be reported as being on another ward, leaving the grid unchanged.

#### Scenario: Two beds visited
- **WHEN** a round for ward 5B with beds 1–6 scans the cards of bed 4 and then bed 1
- **THEN** beds 1 and 4 are marked visited, beds 2, 3, 5 and 6 are not, and no `/api/ai` request was made

#### Scenario: Card from another ward
- **WHEN** the card of ward 3A bed 2 is scanned during a round for ward 5B
- **THEN** 3A bed 2 becomes current, the photo is reported as `other_ward`, and no 5B bed changes its visited mark
