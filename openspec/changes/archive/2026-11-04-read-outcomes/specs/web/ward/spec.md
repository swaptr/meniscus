# Spec Delta

## MODIFIED Requirements

### Requirement: Data quality view
The ward dashboard SHALL have a "Data quality" view of its last 7 days, from the ward quality summary. It shows:
- tiles for entries, corrected at approval (with its share of entries), amended, late, rejected and by hand;
- rejections by reason;
- a table per recorder and per reviewer;
- the flagged entries, newest first, each opening its bed;
- the "Model accuracy" section ("Model accuracy view").

It makes no model request.

#### Scenario: Tiles
- **WHEN** the summary totals are `entries 4, corrected 1, amended 0, late 1, rejected 1, manual 1`
- **THEN** the tiles read `Entries 4`, `Corrected at approval 1 · 25%`, `Amended 0`, `Late 1`, `Rejected 1` and `By hand 1`

#### Scenario: Quiet week
- **WHEN** the summary has no entries
- **THEN** the corrected tile reads `Corrected at approval 0`, with no share, and the flagged list reads `Nothing flagged in the last 7 days`

#### Scenario: Flagged entry opens its bed
- **WHEN** a flagged entry belongs to admission 16
- **THEN** its row links to `/n/16`

## ADDED Requirements

### Requirement: Model accuracy view
The Data quality view SHALL end with a "Model accuracy" section for the ward's last 7 days, from one `GET /api/quality/model?ward=<id>&days=7` sent with the ward summary when the view opens. It shows, as tables and text only: a table of read kinds, the "Drink and fluid" type table, the volume error line and the negatives line. It makes no model request.

#### Scenario: Two requests
- **WHEN** Anita Thomas opens the Data quality view of 3A (ward id 2)
- **THEN** exactly two requests are sent: `GET /api/wards/2/quality` and `GET /api/quality/model?ward=2&days=7`
- **AND** no `/api/ai` request is sent

#### Scenario: Read kinds
- **WHEN** the `photo` `sam+spark` row has outcomes `accepted` 20, `edited_at_capture` 2, `corrected_by_nurse` 3, `rejected` 1 and `abandoned` 1, with rates accepted `{ n: 20, of: 26, pct: 76 }`, corrected `{ n: 5, of: 26, pct: 19 }` and rejected `{ n: 1, of: 26, pct: 3 }`
- **THEN** the kinds table has a row `Photo (SAM + Spark)` reading `26`, `76% · 20/26`, `19% · 5/26`, `3% · 1/26` and `1`, under the headers `Read`, `Decided`, `Accepted`, `Corrected`, `Rejected` and `Abandoned`

#### Scenario: Type table
- **WHEN** the type table's `urine` row is `{ model: "urine", n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: "stoma", n: 1 }] }`
- **THEN** the "Drink and fluid" table has a row `Urine` reading `6`, `80% · 4/5` and `Stoma 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`

#### Scenario: Volume and negatives
- **WHEN** the volume error is `{ of: 24, mae_ml: 18, within: { n: 20, of: 24, pct: 83 }, no_volume: 1 }`, and the negatives are 2 confirmed, 1 overridden as `water` and 1 read with nothing drafted
- **THEN** the section reads `18 mL mean error · within ±25 mL 83% · 20/24 · 1 with no volume read`
- **AND** it reads `Nothing to chart: 2 confirmed · 1 charted anyway (Drink 1) · 1 read with nothing drafted`

#### Scenario: Mean error withheld
- **WHEN** the volume error is `{ of: 4, mae_ml: null, within: { n: 3, of: 4, pct: null }, no_volume: 0 }`
- **THEN** the volume line reads `— mean error · within ±25 mL — · 3/4`

#### Scenario: No reads
- **WHEN** the summary has no drafts in any kind
- **THEN** the section reads `No AI reads in the last 7 days`, and shows no tables

### Requirement: Rates shown with their counts
The Model accuracy section SHALL write every rate it shows as `<pct>% · <n>/<of>`, and as `— · <n>/<of>` when the summary withholds its percentage, so a small count is never shown as a percentage alone. It makes no model request.

#### Scenario: Withheld below the minimum
- **WHEN** one rate is `{ n: 4, of: 4, pct: null }` and another `{ n: 23, of: 25, pct: 92 }`
- **THEN** they read `— · 4/4` and `92% · 23/25`
