## ADDED Requirements

### Requirement: Bag readings on beds without the bag
A ward-round bag photo reading whose bag is not in its bed's `devices.bags`, from the round's ward list, SHALL show `No catheter on the care plan: saving asks the nurse to review.` (`No stoma`, `No drain` for those bags) and save as any bag reading, "Save all high-confidence" included. It makes no request beyond the round's own: its ward list, one `/api/ai/read` per photo and the saves.

#### Scenario: Default urinal bed
- **WHEN** a 3A round reads urine bags at confidence 0.9 for bed 3 (`devices.bags` `["urine_bag"]`) and bed 5 (`devices.bags` `[]`)
- **THEN** bed 5's reading shows `No catheter on the care plan: saving asks the nurse to review.`, and bed 3's shows no such line
- **AND** "Save all high-confidence" uploads and posts both bag readings, each after its own media upload, and sends no `/api/ai` request

#### Scenario: Stoma bed
- **WHEN** the round reads a stoma bag on 2C bed 3 (`devices.bags` `["stoma_bag"]`), and a drain bag on the same bed
- **THEN** the stoma reading shows no warning, and the drain reading shows `No drain on the care plan: saving asks the nurse to review.`
