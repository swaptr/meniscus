# Spec Delta

## ADDED Requirements

### Requirement: Tray overlay
A tray photo with segmentation SHALL be overlaid with each dish region's mask, cell by cell, placed in proportion to the image's own pixel size. Each region is labelled `<index> <name> · <portion>` for each dish in it, from the meal's dishes or, before saving, the form's, and `<index> <name> · <mL> mL` for each drink in it, from the read's `fluids`. Regions nothing names are drawn without a label, and the outline toggle hides them all.

#### Scenario: Rice on a 1000 × 800 photo
- **WHEN** region 1 has box 100,80–400,480 and a 2 × 1 dish mask `gA==` (only the left cell set), on a 1000 × 800 photo, and the meal's dishes name rice in region 1, Half eaten
- **THEN** one mask cell is drawn at left 10%, top 10%, width 15% and height 50%
- **AND** the label `1 rice · Half` is placed at left 10%, top 10%

#### Scenario: A cup and a region nothing names
- **WHEN** region 2 is cited by the fluid tea, 150 mL, and region 3 by no dish or fluid
- **THEN** region 2 is labelled `2 tea · 150 mL`, and region 3 is drawn with no label

#### Scenario: Outline off
- **WHEN** the outline toggle is turned off on that photo
- **THEN** no mask cell and no label is drawn

### Requirement: Tray proof on the bed review
A photo meal with a proof SHALL show it in "What the AI read", above the existing lines: the tray photo with the tray overlay, who took it and when, and its fingerprint; one row per dish with the AI read beside the value saved; and who saved the meal and when. Viewing makes no model request and fetches the photo once with `GET /api/media/<id>`, only when opened. A meal with `proof: null` shows only the existing lines and its photo.

#### Scenario: Lunch proof
- **WHEN** a lunch has a tray photo taken at 13:09 by Ravi Kumar with `sha256` `3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9`, a read of rice in region 1, Half, and dal in region 2, All, and saved values rice All and dal All, by Ravi Kumar at 13:10
- **THEN** "What the AI read" shows, in order:
  - `Tray photo · 13:09 · Ravi K.` with the photo, its overlay and `Photo fingerprint: 3f2a…c9`;
  - the rows `1 rice · Rice · AI Half · saved All` and `2 dal · Dal / lentils · AI All · saved All`;
  - `Saved by Ravi K. · 13:10`
- **AND** opening it sends exactly one request, `GET /api/media/<id>`, and no `/api/ai` request

#### Scenario: Voided lunch
- **WHEN** that lunch is voided, so its photo is deleted, and "What the AI read" is opened
- **THEN** the photo reads `Photo deleted · fingerprint 3f2a…c9` from its proof, and no media request is sent

### Requirement: Media fingerprint shown
Where a kept photo or recording is shown (an entry's photo or voice source, its before/after jug photos, and a meal's tray proof), the app SHALL show `Photo fingerprint: <first 4 hex>…<last 2 hex>`, or `Recording fingerprint: …` for a recording, with the full value as its title, or `Fingerprint not recorded` when its `sha256` is null. It uses the media reference or proof already loaded, with no extra request.

#### Scenario: Photo entry
- **WHEN** a photo entry whose media has `sha256` `3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9` is opened
- **THEN** its source shows `Photo fingerprint: 3f2a…c9`, titled with the full value
- **AND** the only request is `GET /api/media/<id>`

#### Scenario: Older recording
- **WHEN** a voice entry whose media has `sha256: null` is opened
- **THEN** its source shows `Fingerprint not recorded`
