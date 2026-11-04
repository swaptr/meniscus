# Spec Delta

## ADDED Requirements

### Requirement: Segmentation overlay
An entry's photo with segmentation evidence SHALL be overlaid with the container outline, the liquid area and a surface line at the liquid's top edge. Each SHALL be placed in proportion to the image's own pixel size.

#### Scenario: Boxes on a 1000 × 1000 photo
- **WHEN** the container box is 100,80–400,900 and the liquid box 110,520–390,890 on a 1000 × 1000 photo
- **THEN** the overlay is placed as follows:
  - the container outline at left 10%, top 8%, width 30% and height 82%;
  - the liquid area at left 11%, top 52%, width 28% and height 37%;
  - the surface line at 52% from the top

### Requirement: Reading versus segmentation
For photo evidence with a read volume, a capacity and a SAM fill, the evidence view SHALL show the AI reading, the SAM fill and the volume it implies. It SHALL show "agree" when the reading's fill and SAM's fill are within 30 percentage points, the same tolerance that sends a read to review, and "check photo" otherwise.

#### Scenario: Agree
- **WHEN** the reading is 450 mL of 2000 mL and the SAM fill is 0.25
- **THEN** the view shows `AI read 450 mL of 2000 mL`, `SAM fill 25% ≈ 500 mL` and `agree`

#### Scenario: Disagree
- **WHEN** the reading is 450 mL of 2000 mL and the SAM fill is 0.7
- **THEN** the view shows `SAM fill 70% ≈ 1400 mL` and `check photo`

### Requirement: Transcript amounts highlighted
The evidence view SHALL show a voice or typed note's text with every amount followed by a unit (mL, ml, L, cup or cups, glass or glasses) marked.

#### Scenario: Coconut water
- **WHEN** the transcript is `bed 4 had coconut water, 200 mL and 2 cups of tea`
- **THEN** exactly `200 mL` and `2 cups` are marked
