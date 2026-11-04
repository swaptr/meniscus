# Spec Delta

## ADDED Requirements

### Requirement: Entry timeline
Opening an entry from the log or a pending card SHALL show its timeline in plain language, oldest first:
1. Who captured it and how, with the charted time if it was late.
2. Each model step of its read.
3. The volume saved, and whether it differs from the AI's.
4. The review.
5. Every amendment, with who made it and why.

A pending entry SHALL end with "Waiting for approval". Opening an entry makes no model request.

#### Scenario: Corrected photo entry
- **WHEN** a urine photo entry:
  - was recorded at 10:42 by Ravi Kumar (attendant);
  - has evidence with trace `sam:container`, `sam:liquid` and `spark:read`, a urine bag reading of 450 mL of 2000 mL and SAM fill 0.25;
  - was saved as 430 mL;
  - was approved as 400 mL at 10:52 by Anita Thomas (nurse)
- **THEN** the timeline reads, in order:
  - `10:42 · Photo by Ravi Kumar (attendant)`
  - `SAM 3.1 outlined the urine bag`
  - `SAM 3.1 found the liquid, 25% full`
  - `Muse Spark read 450 mL of 2000 mL`
  - `SAM and Spark agree`
  - `Saved 430 mL, changed from the AI's 450 mL`
  - `10:52 · Corrected 430 → 400 mL by Anita Thomas (nurse)`

#### Scenario: Pending voice note
- **WHEN** a voice entry:
  - was recorded at 09:05 by Sunita Devi (attendant);
  - has the transcript `bed 4 had coconut water 200 mL`, `draft_ml` 200 and trace `asr`, `spark:note`;
  - was saved as 200 mL and is pending
- **THEN** the timeline reads:
  - `09:05 · Voice note by Sunita Devi (attendant)`
  - `Speech-to-text heard: “bed 4 had coconut water 200 mL”`
  - `Muse Spark drafted 200 mL`
  - `Saved 200 mL`
  - `Waiting for approval`

#### Scenario: Jug level
- **WHEN** a 400 mL intake entry:
  - was recorded at 13:10 with no staff;
  - has evidence of a water jug read as 600 mL, with trace `spark:read` only;
  - was approved unchanged at 13:20 by Grace Lee (nurse)
- **THEN** the timeline reads:
  - `13:10 · Photo by staff not recorded`
  - `Muse Spark read the water jug level 600 mL`
  - `Saved 400 mL, the drop since the last level`
  - `13:20 · Approved by Grace Lee (nurse)`

#### Scenario: Late entry, amended
- **WHEN** a manual 200 mL drink:
  - was charted for 08:00 and recorded at 14:10 by Anita Thomas (nurse);
  - was approved at 14:10 by Anita Thomas;
  - was amended to 250 mL at 15:00 by Grace Lee (nurse) with reason `jug re-measured`
- **THEN** the timeline reads:
  - `14:10 · Entered by hand by Anita Thomas (nurse), charted for 08:00 (6 h late)`
  - `Saved 200 mL`
  - `14:10 · Approved by Anita Thomas (nurse)`
  - `15:00 · Amended 200 → 250 mL by Grace Lee (nurse): jug re-measured`

#### Scenario: Rejected duplicate
- **WHEN** a photo entry with no evidence was recorded at 11:00 by Ravi Kumar, then rejected at 11:05 by Anita Thomas with reason `duplicate` and note `same bag twice`
- **THEN** the timeline ends with `11:05 · Rejected by Anita Thomas (nurse): Duplicate (same bag twice)`

#### Scenario: Rejected without a reason
- **WHEN** an entry saved before reasons were kept was rejected at 11:05 with no staff and no reason
- **THEN** the timeline ends with `11:05 · Rejected by staff not recorded`

### Requirement: Flagged records highlighted
The log, pending cards and entry details SHALL badge entries that were:
- corrected at approval: `Corrected 430 → 400 mL`;
- amended: `Amended`;
- recorded late: `Late · 6 h` in whole hours rounded down, or minutes under 2 hours, e.g. `Late · 70 min`;
- rejected: `Rejected: Duplicate`, or `Rejected` with no reason;
- entered by hand: `By hand`.

The log SHALL offer a "Flagged only" filter that lists corrected, amended, late or rejected entries.

#### Scenario: Badges
- **WHEN** a manual entry recorded as 430 mL was approved as 400 mL and saved 6 h 10 min after its charted time
- **THEN** its badges read `Corrected 430 → 400 mL`, `Late · 6 h` and `By hand`

#### Scenario: Flagged only
- **WHEN** the log holds a corrected entry, an entry approved unchanged, a rejected entry and an on-time entry entered by hand, and "Flagged only" is on
- **THEN** only the corrected and rejected entries are listed and the count reads `2 of 4`

### Requirement: Data quality view
The ward dashboard SHALL have a "Data quality" view of its last 7 days, from the ward quality summary. It shows:
- tiles for entries, corrected at approval (with its share of entries), amended, late, rejected and by hand;
- rejections by reason;
- a table per recorder and per reviewer;
- the flagged entries, newest first, each opening its bed.

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

### Requirement: Resolve from the bed review
The bed review SHALL let a nurse:
- amend an approved entry's volume or type, with a reason of at least 3 characters;
- reject a pending entry with a reason chosen from the list;
- add a missed entry with the time it happened, saved and then approved in their name.

The `intake_incomplete` and `logging_gap` prompts SHALL offer "Add missed entry". None of these makes a model request.

#### Scenario: Missed drink
- **WHEN** at 14:10 nurse 4 adds a missed 200 mL drink that happened at 08:00
- **THEN** exactly two requests are sent, both with `X-Staff-Id: 4`:
  1. `POST /api/admissions/<id>/entries` with `source: manual` and `charted_at` 08:00 today;
  2. `POST /api/entries/<new id>/review` with `action: approve`

  No `/api/ai` request is sent.

#### Scenario: Reject with a reason
- **WHEN** a nurse rejects a pending entry and picks "Duplicate"
- **THEN** the review request body is `{ action: "reject", reason: "duplicate" }`

#### Scenario: Gap prompts offer a missed entry
- **WHEN** a bed has `logging_gap`, `intake_incomplete` and `low_urine_output` prompts
- **THEN** "Add missed entry" is offered on the first two and not on `low_urine_output`

#### Scenario: Amend needs a reason
- **WHEN** a nurse sets an approved 400 mL entry to 380 mL
- **THEN** saving stays disabled until the reason has at least 3 characters, and the request body is then `{ volume_ml: 380, reason: "<the reason>" }`
