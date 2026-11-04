# web/ward Specification

## Purpose
The nurse's ward dashboard and per-bed approval queue, so pending entries get reviewed quickly and alerts are seen.

## Requirements

### Requirement: Beds needing attention first
The ward dashboard SHALL list beds in acuity groups, placing each bed by the higher of its `acuity.level` and `acuity.suggested`: critical, then watch, then stable. Within each group, beds with alerts come first (most alerts first), then beds with pending entries, then the rest, each in bed order.

#### Scenario: Mixed ward
- **WHEN** every bed is `stable` with no suggestion, bed 3 has 2 alerts, bed 5 has 1 alert, bed 2 has 4 pending entries and beds 1, 4, 6 have nothing
- **THEN** the order is 3, 5, 2, 1, 4, 6

#### Scenario: Acuity first
- **WHEN** on a six-bed ward:
  - bed 6 has an acuity order `critical` and nothing else;
  - bed 4 is `stable` with `low_urine_output` and `mismatch` (suggested `critical`);
  - bed 1 has an acuity order `watch` and 3 pending entries;
  - bed 3 is `stable` with `catheter_review` and `drink_consistency_unrecorded`;
  - bed 2 is `stable` with 4 pending entries;
  - bed 5 is `stable` with nothing
- **THEN** the order is 4, 6, 1, 3, 2, 5

### Requirement: Batch approve high confidence
"Approve all high-confidence" SHALL approve exactly the pending entries whose confidence is at least 0.75, one review request each, and leave the others pending.

#### Scenario: Queue of four
- **WHEN** the queue holds pending entries at confidence 0.9, 0.75, 0.6 and none (manual)
- **THEN** two review requests are sent, for the 0.9 and 0.75 entries, each with `action: approve`

### Requirement: Explain on request
The bed screen SHALL request an alert explanation only when the nurse taps Explain, and only when the bed has alerts.

#### Scenario: Tap explain
- **WHEN** a bed with alerts is opened and Explain is tapped once
- **THEN** exactly one `POST /api/ai/explain` request is made with that admission id

### Requirement: Hospital ward list
The nurse home (`/n`) SHALL list every ward as a card in its default Wards view, in code order unless "Your wards first" applies. Each card shows the ward name, `<occupied>/<capacity> beds`, the pending count ("All reviewed" when 0), the beds with prompts ("<n> to review", omitted when 0), the last activity, and `In charge: <short name>` or `No nurse in charge`. Last activity is relative: "just now" under a minute, "<n> min ago" under an hour, "<n> h ago" otherwise, or "No entries today".

#### Scenario: Busy ward
- **WHEN** ward 5B has 6 of 6 beds occupied, 3 pending entries, 4 beds with prompts, its last entry 12 minutes ago and Grace Lee in charge
- **THEN** its card reads `Neurology Ward 5B`, `6/6 beds`, `3 pending`, `4 to review`, `12 min ago` and `In charge: Grace L.`

#### Scenario: Quiet ward
- **WHEN** ward HDU has 3 of 4 beds occupied, nothing pending, no prompts, no entries in 24 hours and nobody in charge
- **THEN** its card reads `3/4 beds`, `All reviewed`, `No entries today` and `No nurse in charge`, with no review count

### Requirement: Ward dashboard per ward
Opening a ward SHALL list only that ward's beds, fetched with one `GET /api/admissions?ward=<id>` request and ordered as in "Beds needing attention first", and load the ward team once per visit with one `GET /api/wards/<id>/team`, which the beds' refresh does not repeat. For a ward outside the signed-in person's wards, neither request is sent before "Reason to open another ward" is met.

#### Scenario: Open ward 5B
- **WHEN** Grace Lee (home ward 5B) is signed in and the dashboard of the ward with id 3 is loaded
- **THEN** exactly two requests are made: `GET /api/admissions?ward=3` and `GET /api/wards/3/team`
- **AND** a later refresh of the beds requests only `GET /api/admissions?ward=3`

### Requirement: Segmentation overlay
An entry's photo with segmentation evidence SHALL be overlaid with the container and the liquid, a surface line at the liquid's top edge, and the labels of both (the liquid named by its drink kind when the entry or draft has one), placed in proportion to the image's own pixel size. With masks (`container_mask`, `fluid_mask`), each is drawn as the contour traced from its mask over its box; without, as its box. A Spark-only read, with no segmentation, has no overlay; `Raw` hides it.

#### Scenario: Boxes on a 1000 × 1000 photo
- **WHEN** the container box is 100,80–400,900 and the liquid box 110,520–390,890 on a 1000 × 1000 photo, with no masks
- **THEN** the overlay is placed as follows:
  - the container outline at left 10%, top 8%, width 30% and height 82%;
  - the liquid area at left 11%, top 52%, width 28% and height 37%;
  - the surface line at 52% from the top

#### Scenario: Contour from a mask
- **WHEN** the same container box has a 2 × 2 `container_mask` `gA==` (only the top-left cell set)
- **THEN** the container is drawn as one closed contour inside left 10%–25% and top 8%–49%, and no container box is drawn

#### Scenario: Labels
- **WHEN** a urine bag photo has fill fraction 0.28 and no `fluid_volume_ml`
- **THEN** the container is labelled `Urine bag` and the liquid `Liquid · 28% full`

#### Scenario: Drink labelled
- **WHEN** a cup photo's entry has `drink: tea`, fill fraction 0.6 and `fluid_volume_ml: 120`
- **THEN** the container is labelled `Cup` and the liquid `Tea · 60% full ≈ 120 mL`
- **AND** with `drink: null`, the liquid reads `Liquid · 60% full ≈ 120 mL`

#### Scenario: Raw hides the overlay
- **WHEN** the cup photo is shown and `Raw` is picked
- **THEN** no container, liquid, surface line or label is drawn

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
- tiles for entries, corrected at approval (its share of entries written `<pct>% · <n>/<of>`, as Model accuracy writes rates), amended, late, rejected and by hand;
- rejections by reason;
- a table per recorder and per reviewer;
- the flagged entries, newest first, each opening its bed;
- the "Model accuracy" section ("Model accuracy view").

It makes no model request.

#### Scenario: Tiles
- **WHEN** the summary totals are `entries 4, corrected 1, amended 0, late 1, rejected 1, manual 1`
- **THEN** the tiles read `Entries 4`, `Corrected at approval 25% · 1/4`, `Amended 0`, `Late 1`, `Rejected 1` and `By hand 1`, with no `mL` on any tile

#### Scenario: Small share
- **WHEN** the summary totals are `entries 70, corrected 1`
- **THEN** the corrected tile reads `Corrected at approval 1% · 1/70`, not `1 · 1%`

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

An attendant on shift saves a missed entry without approving it. Prompts `intake_incomplete`, `logging_gap` and `intake_target_behind` SHALL offer "Add missed entry". None of these makes a model request.

#### Scenario: Missed drink
- **WHEN** at 14:10 nurse 4 adds a missed 200 mL drink that happened at 08:00
- **THEN** exactly two requests are sent, both with `X-Staff-Id: 4`:
  1. `POST /api/admissions/<id>/entries` with `source: manual` and `charted_at` 08:00 today;
  2. `POST /api/entries/<new id>/review` with `action: approve`

  No `/api/ai` request is sent.

#### Scenario: Attendant adds a missed drink
- **WHEN** Ravi Kumar (id 1, attendant) adds a missed 200 mL drink that happened at 08:00
- **THEN** exactly one request is sent: `POST /api/admissions/<id>/entries` with `X-Staff-Id: 1`, `source: manual` and `charted_at` 08:00 today
- **AND** the entry stays pending

#### Scenario: Reject with a reason
- **WHEN** a nurse rejects a pending entry and picks "Duplicate"
- **THEN** the review request body is `{ action: "reject", reason: "duplicate" }`

#### Scenario: Gap prompts offer a missed entry
- **WHEN** a bed has `logging_gap`, `intake_incomplete`, `intake_target_behind` and `low_urine_output` prompts
- **THEN** "Add missed entry" is offered on the first three and not on `low_urine_output`

#### Scenario: Amend needs a reason
- **WHEN** a nurse sets an approved 400 mL entry to 380 mL
- **THEN** saving stays disabled until the reason has at least 3 characters
- **AND** the request body is then `{ volume_ml: 380, reason: "<the reason>" }`

### Requirement: Fluid balance chart
The bed review SHALL plot cumulative approved intake and output over the last 24 hours as two step lines, one step per approved entry, and show the final balance. Pending and rejected entries do not move the lines. They share the hourly bars' time axis, ticked on round hours. While urine is not measured (`devices.urine_measured` false), the output line is labelled `Output (urine not measured)` and the balance is followed by `Urine not measured`, as it leaves urine out.

#### Scenario: Day so far
- **WHEN** the approved entries are water 500 mL 10 h ago, urine 300 mL 6 h ago and water 200 mL 2 h ago, plus a pending 100 mL tea
- **THEN** the intake line steps to 500 and then 700, the output line steps to 300, and the balance reads `+400 mL`

#### Scenario: Urine not measured
- **WHEN** 3A bed 7 has a `{ method: "toilet" }` voiding order and no catheter, and its only approved entries in 24 hours are drinks of 1500 mL and 900 mL
- **THEN** the intake line steps to 1500 and then 2400, the output line, labelled `Output (urine not measured)`, stays at 0, and the balance reads `+2400 mL` followed by `Urine not measured`
- **AND** on a bed on the default urinal with the same entries, neither label is shown

#### Scenario: Round-hour ticks
- **WHEN** the bed review opens at 22:41
- **THEN** the time axis ticks fall on round hours (`00:00`, `04:00`, … `20:00`), not on `16:41`, and the `now` line is at 22:41

### Requirement: Urine output rate against the threshold
The bed review SHALL plot the approved urine rate over the preceding 6 hours, in mL/kg/h, counted as the low-output prompt counts it, at that prompt's window end and each hour before it within the last 24 hours, leaving out hours less than 6 hours after admission. A window ending at a bag reading is captioned `To the <time> bag reading`. It SHALL draw a reference line at 0.5 mL/kg/h and mark the points below it. Without a recorded weight it SHALL show "Weight not recorded" instead of the plot.

#### Scenario: Low rate now
- **WHEN** a 60 kg patient has 120 mL of approved urine in the last 6 hours
- **THEN** the latest point is 0.33 mL/kg/h and is marked below the 0.5 line

#### Scenario: No weight
- **WHEN** the admission has no weight
- **THEN** the chart area reads `Weight not recorded`

#### Scenario: Recent admission
- **WHEN** a 60 kg patient was admitted 8 hours ago
- **THEN** only the 3 latest hourly points are plotted

#### Scenario: Just under the line
- **WHEN** a 60 kg patient has 179 mL of approved urine in the last 6 hours
- **THEN** the latest point reads 0.50 mL/kg/h and is marked below the line, matching the low-output prompt (179 mL is under 0.5 × 60 × 6 = 180 mL)

#### Scenario: Ends at the bag reading
- **WHEN** a 60 kg patient on 3A bed 3, admitted 2 days ago, has a urine bag changed at 0 mL at 00:00 and emptied at 320 mL at 08:00, approved, and the bed review is opened at 14:00
- **THEN** the latest point is at 08:00 and reads 0.67 mL/kg/h, not marked, with the caption `To the 08:00 bag reading`
- **AND** no point is plotted after 08:00, and the point at 07:00 also reads 0.67

#### Scenario: Reading overdue
- **WHEN** the same bed review is opened at 16:00 instead
- **THEN** the latest point is at 16:00, reads 0.00 and is marked below the line, with no caption

#### Scenario: Spread like the prompt
- **WHEN** that emptying is 200 mL instead, and the bed review is opened at 09:00
- **THEN** the latest point is at 08:00, reads 0.42 mL/kg/h and is marked below the line, matching the prompt's 150 mL

### Requirement: Intake and output breakdown
The bed review SHALL show the last 24 hours' approved intake and output as two stacked bars split by category, each segment labelled with its category and mL. Drinks (`water` entries; soup stays under food) are split by drink kind instead, each labelled `<Kind> <mL>`, with drinks without a kind together as `Drink <mL>`. The urine segment is drawn in the colours seen, as in "Urine drawn in its own colour". Its label stays `Urine <mL>`.

#### Scenario: Mixed day
- **WHEN** approved entries are water 500, food 300, IV 1000 and urine 600 mL, none with a drink kind
- **THEN** the intake bar has segments `Drink 500`, food 300 and IV 1000, and the output bar has one segment, urine 600

#### Scenario: Drinks by kind
- **WHEN** approved drinks are tea 200 and 150, water 400, coconut water 200, and one 100 mL drink with no kind
- **THEN** the intake bar's drink segments are `Water 400`, `Tea 350`, `Coconut water 200` and `Drink 100`, largest first, and no request is made

### Requirement: Photo strip
The bed review SHALL keep the capture photos of the last 24 hours behind a `Photos <n>` toggle, closed by default, and only when it is opened show them as thumbnails, at most the 12 newest, newest first, each with its time and volume, fetching each thumbnail then: the labeled copy when one was kept, else the photo. Tapping one opens that entry's peek.

#### Scenario: Three photos
- **WHEN** four entries in the last 24 hours exist and three of them have photos
- **THEN** the toggle reads `Photos 3`, and once opened three thumbnails are shown, newest first

#### Scenario: Many photos
- **WHEN** 15 entries in the last 24 hours have photos and the toggle is opened
- **THEN** the 12 newest are shown

#### Scenario: Closed sends nothing
- **WHEN** the bed review of admission 10 loads with 3 photo entries and the toggle stays closed
- **THEN** no `GET /api/media/<id>` request is made

#### Scenario: Thumbnail of a labeled copy
- **WHEN** the toggle is opened and one photo entry has media 41 and labeled copy 42
- **THEN** its thumbnail is fetched with `GET /api/media/42`, and `GET /api/media/41` is not requested

### Requirement: Ward activity strip
Each bed card on the ward dashboard SHALL show the last 24 hours as 24 mirrored hourly bars on one scale across the ward, intake (`hourly.in_ml`) up and output (`hourly.out_ml`) down from a midline, with a dot under each hour in which intake that is not rejected was logged, the intake the logging-gap prompt counts, so gaps are visible.

#### Scenario: Gap since morning
- **WHEN** a bed's `hourly.in_logged` is non-zero only at indices 5, 9 and 13
- **THEN** exactly hours 5, 9 and 13 have a logged dot and hours 14 to 23 have none

#### Scenario: One scale
- **WHEN** bed 2's largest hour is 400 mL in and bed 5's is 200 mL in, the largest on the ward
- **THEN** bed 5's 200 mL bar is half the height of bed 2's 400 mL bar

### Requirement: Printable daily chart
`/n/<id>/print` SHALL show one row per clock hour for the 24 clock hours ending with the current one, oldest first, giving the hour, approved intake mL, approved output mL and running balance, followed by a totals row, like the paper I&O form. Printing SHALL hide the app chrome. While urine is not measured (`devices.urine_measured` false), the output column is headed `Out (urine not measured)` and the totals row ends `Urine not measured`.

#### Scenario: Two busy hours
- **WHEN** at 14:30 the approved entries are a 300 mL drink at 09:10 and 400 mL urine at 11:45
- **THEN** the first row is `15:00` and the last `14:00`; the `09:00` row reads in 300, out 0, balance +300; the `11:00` row reads in 0, out 400, balance −100; the totals row reads in 300, out 400, balance −100

#### Scenario: Printed with urine not measured
- **WHEN** at 14:30 3A bed 7, with a `{ method: "toilet" }` voiding order and no catheter, has approved drinks of 300 mL at 09:10 and 200 mL at 12:20 and no output
- **THEN** the output column is headed `Out (urine not measured)`, the totals row reads in 500, out 0, balance +500, and ends `Urine not measured`

### Requirement: Intake and output log by shift
The bed review SHALL list entries in 12-hour shifts, newest first: day 08:00–20:00 and night 20:00–08:00, local time. Each shift shows its approved intake and output totals and its pending count. Each entry SHALL show its time, a badge coloured by direction with category and volume, a source badge and a status badge.

#### Scenario: Two shifts
- **WHEN** a bed has, on 2 Nov, an approved 200 mL drink at 09:00, an approved 300 mL urine at 19:30 and a pending 100 mL drink at 21:00
- **THEN** the log shows the 2 Nov night shift first, with in 0, out 0 and 1 pending, then the 2 Nov day shift with in 200 and out 300

### Requirement: Filter and sort the log
The log SHALL be a table filtered by direction, category, status, source, period and free text over item and notes. Period is "this shift", "last 24 h" or "all". Choosing a column header SHALL sort by that column (time, type, volume, source or status), either way; rows group by shift only when sorted by time. It SHALL show 25 rows per page, the page's range, and how many entries match out of the total.

#### Scenario: Approved output only
- **WHEN** the log holds approved urine 300 mL, pending urine 400 mL, approved drink 200 mL and rejected drain 50 mL, and is filtered to direction out and status approved
- **THEN** only the 300 mL urine is listed and the count reads `1 of 4`

#### Scenario: Largest first
- **WHEN** the same log is sorted by volume, largest first, with no filters
- **THEN** the volumes read 400, 300, 200, 50 with no shift groups

#### Scenario: Pending first
- **WHEN** the same log is sorted by status
- **THEN** the pending 400 mL urine comes first and the rejected 50 mL drain last

#### Scenario: Search
- **WHEN** the log holds drinks with items `coconut water` and `tea` and the search is `coconut`
- **THEN** only the coconut water entry is listed

#### Scenario: Pages
- **WHEN** 30 entries match, sorted newest first
- **THEN** page 1 lists the 25 newest and reads `1–25 of 30`, and page 2 lists the 5 oldest and reads `26–30 of 30`

### Requirement: Meals on the bed review
The bed review SHALL list the last 24 hours' meals, newest first. Each row shows the time, meal, portion eaten as a word (None, A quarter, Half, Three quarters, All) and a four-part bar, the items, the meal's fluid with its entry status, and who recorded it and how. Photo meals SHALL open "What the AI read" with each item's portion, the fluids and the model step. Voided meals SHALL stay listed, struck through, with "Voided: <reason>" and who voided them.

#### Scenario: Lunch from a tray photo
- **WHEN** a lunch at 13:10 was recorded by Ravi Kumar from a tray photo, half eaten, items "rice, dal", 150 mL pending
- **THEN** its row reads `13:10`, `Lunch`, `Half` with 2 of 4 parts filled, `rice, dal`, `+150 mL · pending`, `Tray photo by Ravi K.`

#### Scenario: Breakfast by hand
- **WHEN** a breakfast at 08:05 was entered by hand by Sunita Devi, all eaten, with no fluid
- **THEN** its row reads `08:05`, `Breakfast`, `All` with 4 of 4 parts filled, no fluid, `By hand by Sunita D.`

#### Scenario: What the AI read
- **WHEN** that lunch's read had rice half eaten, dal all eaten, soup 150 mL and a 2140 ms `spark:meal` step
- **THEN** "What the AI read" lists `rice · Half`, `dal · All`, `soup · 150 mL` and `Muse Spark · tray · 2.1 s`

#### Scenario: Voided meal
- **WHEN** a breakfast was voided by Anita Thomas with reason "wrong bed"
- **THEN** its row is struck through and shows `Voided: wrong bed · Anita T.`

### Requirement: Void a meal from the bed review
"Void…" on a meal SHALL ask for a reason of at least 3 characters and send one `POST /api/meals/<id>/void` in the name of the staff member on shift; it is disabled until the reason is long enough.

#### Scenario: Void with a reason
- **WHEN** a nurse on shift (staff 4) voids meal 12 with reason "duplicate photo"
- **THEN** the only request is `POST /api/meals/12/void` with `{ reason: "duplicate photo" }` and `X-Staff-Id: 4`, and a reason of "ab" sends nothing

### Requirement: Urine colour beside urine counts
Wherever urine output is shown, the web app SHALL show an outlined colour swatch and the colour's name:
- each coloured urine entry;
- the admission's `urine_seen` beside the Out total and in the urine rate chart's header.

The swatch is filled with the entry's `urine_rgb`, the colour seen in its photo. It falls back to the name's reference colour only when no photo colour exists. A swatch from a pending entry adds `pending` to the name.

#### Scenario: Bag photographed dark
- **WHEN** bed 1 has a pending urine entry with `urine_colour: dark` and `urine_rgb: "#c9952f"`
- **THEN** its pending card shows a swatch filled `#c9952f` with the text `Dark amber`
- **AND** the bed's Out total shows the same swatch with `Dark amber · pending`

#### Scenario: Named in a note
- **WHEN** an approved urine entry has `urine_colour: red` and `urine_rgb: null`
- **THEN** its log row shows a swatch filled with the reference colour for red and the text `Red`

#### Scenario: No colour
- **WHEN** a urine entry has no `urine_colour` and the admission's `urine_seen` is null
- **THEN** no swatch is shown on the entry or beside the Out total

### Requirement: Urine drawn in its own colour
The bed review SHALL draw urine in the colours seen, not a category colour:
- in the Out bar, one outlined piece per run of same-coloured approved urine entries, in charted order;
- in the rate chart, each point filled with the newest approved urine colour at or before that hour.

Urine with no colour is drawn grey and titled `Colour not recorded`.

#### Scenario: Colour turns dark
- **WHEN** at 17:00, a 60 kg patient admitted 2 days ago has this approved urine in the last 24 hours:
  - 300 mL at 08:00, `pale`, `#f2eaa5`;
  - 400 mL at 12:00, `pale`, `#efe6a0`;
  - 200 mL at 16:00, `dark`, `#c48a24`
- **THEN** the urine part of the Out bar has two pieces:
  - 700 mL filled `#efe6a0`, the newest colour of the run;
  - 200 mL filled `#c48a24`
- **AND** the legend still reads `Urine 900 mL`
- **AND** the rate chart's 13:00 point is filled `#efe6a0` and its 16:00 point `#c48a24`

#### Scenario: No colour recorded
- **WHEN** the only approved urine is 600 mL with no colour
- **THEN** the urine part is one grey piece titled `Colour not recorded`, and the rate points are grey

### Requirement: Source preview
Entry details SHALL show the source by kind:
- **Photo:** a `Labeled | Raw` toggle and a full-screen view.
- **Recording:** play/pause, elapsed/total time, a scrubber, and timed transcript turns (highlighted while playing, tap to seek, amounts marked).
- **Typed note:** quoted.
- **By hand:** `Entered by hand by <name>`.

Media loads with one `GET /api/media/<id>`. A photo meal's "What the AI read" shows its tray photo. Rejecting says if the photo or recording is deleted.

#### Scenario: Recording with turns
- **WHEN** a voice entry with `duration_ms` 4200 and the turns 0–1800 ms `bed 4 had a coconut water` and 1900–4100 ms `200 mL` is opened
- **THEN** it shows `0:00 / 0:04` and the turns `0:00 bed 4 had a coconut water` and `0:01 200 mL`, with `200 mL` marked
- **AND** the playing turn at 2.5 s is the second, and tapping the second turn seeks to 1.9 s

#### Scenario: Photo outline
- **WHEN** a segmented photo entry is opened and `Raw` is picked
- **THEN** the photo shows no container or liquid outline
- **AND** the full-screen view shows the same photo

#### Scenario: By hand
- **WHEN** an entry entered by hand by Anita Thomas is opened
- **THEN** its source reads `Entered by hand by Anita T.`, and no media is requested

#### Scenario: Tray photo
- **WHEN** a photo lunch with a tray photo is shown on the bed review and "What the AI read" is opened
- **THEN** the tray photo is shown with the read

#### Scenario: Reject a photo entry
- **WHEN** a nurse rejects a pending 450 mL urine entry that has its photo
- **THEN** the reject sheet ends with `Its photo is deleted.`
- **AND** the message after rejecting ends with `Its photo was deleted.`

#### Scenario: Reject a recorded entry
- **WHEN** a nurse rejects a pending 200 mL coconut water entry from a recording
- **THEN** the reject sheet and the message after rejecting both end with `Its recording is deleted once no other entry from it remains.`

#### Scenario: Reject a level drop
- **WHEN** a nurse rejects the pending 400 mL entry from a water jug at 1000 mL (08:00) and then 600 mL (12:00)
- **THEN** neither the reject sheet nor the message after rejecting mentions a photo, since both jug photos stay with their levels

#### Scenario: Reject a typed note
- **WHEN** a nurse rejects a pending 200 mL entry from the typed note `tea 200 ml`
- **THEN** neither the reject sheet nor the message after rejecting mentions a photo or recording

### Requirement: Before and after on the entry
The entry details of a level-drop entry SHALL show the before and after photos side by side. Each photo has its outline, volume and time. Between them is the drop, as `<before> mL → <after> mL · −<drop> mL`.

#### Scenario: Jug drop
- **WHEN** the 400 mL entry from a water jug at 1000 mL (08:00) and then 600 mL (12:00) is opened
- **THEN** it shows the 08:00 photo labelled `1000 mL` and the 12:00 photo labelled `600 mL`, with `1000 mL → 600 mL · −400 mL` between them

### Requirement: Your wards first
On the nurse ward list, the app SHALL show the signed-in person's wards under "Your wards" (in the order of their wards, home ward first) above "Other wards" (in code order), leaving out an empty group. A ward dashboard or bed review of a ward outside their wards, once open, shows `You are not on the <ward name> team. Changes are recorded in your name.`

#### Scenario: Grace on shift
- **WHEN** Grace Lee (wards 5B, 3A) is signed in and the ward list loads
- **THEN** "Your wards" lists 5B then 3A, and "Other wards" lists 2C then HDU

#### Scenario: Outside the team
- **WHEN** Mohan Das (wards 5B, 2C) has given a reason and the Renal HDU dashboard opens
- **THEN** it shows `You are not on the Renal HDU team. Changes are recorded in your name.`

#### Scenario: Matron's wards
- **WHEN** Lakshmi Iyer (matron; wards 2C, 3A, 5B, HDU) is signed in and the ward list loads
- **THEN** "Your wards" lists 2C, 3A, 5B and HDU, each card showing its nurse in charge, and there is no "Other wards" group

### Requirement: Nurse in charge on the ward
The ward dashboard SHALL show, from the ward team, the nurse in charge and the current shift's name, or `No nurse in charge this shift`, also once the team's shift ends while the page is open. Only a nurse on the team who is not in charge sees "Take charge"; tapping it sends one `PUT /api/wards/<id>/in-charge` naming that nurse, and the header updates from the response with no other request.

#### Scenario: In charge on 3A
- **WHEN** the 3A dashboard is shown on the day shift with Anita Thomas in charge
- **THEN** it reads `In charge: Anita T. · day shift`

#### Scenario: Take charge
- **WHEN** Grace Lee (id 5) is signed in and taps "Take charge" on 3A (ward id 2)
- **THEN** the only request is `PUT /api/wards/2/in-charge` with `{ staff_id: 5 }` and `X-Staff-Id: 5`
- **AND** the header then reads `In charge: Grace L. · day shift`

#### Scenario: Who sees Take charge
- **WHEN** 3A, with Anita Thomas in charge, is viewed by Ravi Kumar (attendant), Nikhil Bose (HDU team only, after giving a reason), Anita Thomas and Meera Pillai
- **THEN** only Meera Pillai sees "Take charge"

#### Scenario: Shift changes while open
- **WHEN** the 3A team is loaded at 19:50 with Anita Thomas in charge, and the dashboard is still open at 20:01
- **THEN** it reads `No nurse in charge this shift`, and Anita Thomas sees "Take charge"

#### Scenario: Nobody in charge
- **WHEN** 3A has no nurse in charge for the current shift
- **THEN** the dashboard reads `No nurse in charge this shift`

### Requirement: My beds
The ward dashboard SHALL show each bed's nurse for the current shift from the ward team, as `Nurse: <short name>` or `Unassigned`, and give a nurse with beds there this shift a "My beds" filter, on by default, that lists only their beds. For the ward's nurse in charge, it also keeps the ward's other beds with prompts. Counts stay whole-ward. After the team's shift ends, every bed reads `Unassigned` and the filter goes. It makes no request.

#### Scenario: Divya's beds
- **WHEN** the HDU team assigns beds 1 and 2 to Nikhil Bose (in charge) and bed 3 to Divya Kapoor, beds 1 and 3 have prompts, and Divya Kapoor is signed in
- **THEN** "My beds" is on and the list shows bed 3 only, reading `Nurse: Divya K.`
- **AND** turning it off lists all three beds

#### Scenario: In charge keeps prompts
- **WHEN** the same HDU dashboard is opened by Nikhil Bose
- **THEN** "My beds" is on and lists beds 1, 2 and 3, bed 3 for its prompts

#### Scenario: No beds, no filter
- **WHEN** the same HDU dashboard is opened by Lakshmi Iyer (matron) and by Ravi Kumar (attendant, after giving a reason)
- **THEN** both see all three beds with their nurses, and no "My beds" filter

#### Scenario: Shift ends while open
- **WHEN** that team was loaded at 19:50 and the dashboard is still open at 20:01
- **THEN** every bed reads `Unassigned`, and no "My beds" filter is shown

### Requirement: Assign beds from the dashboard
On the ward dashboard, the ward's nurse in charge and the matron who oversees it SHALL get a nurse picker on each bed, listing the team's nurses and `Unassigned`. A change sends one `PUT /api/wards/<id>/assignments` with every bed's assignment, and the beds update from the response with no other request. Nobody else sees the pickers. It makes no model request.

#### Scenario: Nikhil moves bed 2
- **WHEN** Nikhil Bose (id 7, HDU's nurse in charge) is signed in, HDU (ward id 4) has beds 1 and 2 assigned to him and bed 3 to Divya Kapoor (id 8), and he sets bed 2 to Divya Kapoor
- **THEN** the only request is `PUT /api/wards/4/assignments` with bed 1 to staff 7 and beds 2 and 3 to staff 8, and `X-Staff-Id: 7`
- **AND** bed 2 then reads `Nurse: Divya K.`

#### Scenario: Who sees the pickers
- **WHEN** HDU is viewed by Nikhil Bose, Lakshmi Iyer, Divya Kapoor and Ravi Kumar (after giving a reason)
- **THEN** only Nikhil Bose and Lakshmi Iyer see the nurse pickers

### Requirement: Decisions need a nurse
When someone who is not a nurse or matron (an attendant or a dietitian) is signed in, the bed review, entry details and meals SHALL hide Approve, Reject, Amend, the high-confidence batch approval and meal "Void…", and the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.` instead. Nurses and matrons see the buttons as before. It makes no model request.

#### Scenario: Attendant on the bed review
- **WHEN** Ravi Kumar (attendant) is signed in and opens a bed with 2 pending entries and a meal
- **THEN** no approve, reject, amend, batch or void button is shown
- **AND** the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.`

#### Scenario: Nurse or matron
- **WHEN** Anita Thomas (nurse) or Lakshmi Iyer (matron) is signed in
- **THEN** Approve and Reject are shown for each pending entry, and "Void…" for each meal not voided

#### Scenario: Dietitian on the bed review
- **WHEN** Sana Mirza (dietitian) is signed in and opens a bed with 2 pending entries and a meal
- **THEN** no approve, reject, amend, batch or void button is shown
- **AND** the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.`

### Requirement: Reason to open another ward
When the signed-in person opens the dashboard or a bed review of a ward outside their wards, the app SHALL show nothing of the ward but a dialog for a reason (1–200 characters) and their password until one `POST /api/wards/<id>/access` accepts them. The ward then opens without asking again that shift, for that person on this device. Cancel sends nothing and returns to where they were. It makes no model request.

#### Scenario: Reason before HDU opens
- **WHEN** Grace Lee (id 5, wards 5B and 3A) opens Renal HDU (ward id 4) from the ward list
- **THEN** a dialog with a reason and a password field is shown, its "Open ward" button is disabled while either is blank, and no request has been sent
- **AND** after the reason `Covering HDU during break` and the password `grace` are typed and "Open ward" tapped, the requests are `POST /api/wards/4/access` with `{ reason: "Covering HDU during break", password: "grace" }` and `X-Staff-Id: 5`, then `GET /api/admissions?ward=4` and `GET /api/wards/4/team`
- **AND** the dashboard shows `You are not on the Renal HDU team. Changes are recorded in your name.`

#### Scenario: Wrong password at the reason
- **WHEN** Grace Lee types a reason and the password `wrong`, and `POST /api/wards/4/access` answers 401 `invalid_credentials`
- **THEN** the dialog shows `Wrong password`, keeps the reason, empties the password field, and HDU stays closed
- **AND** no grant is kept, and no other request is sent

#### Scenario: Bed review by direct link
- **WHEN** Grace Lee, with no reason given this shift, opens `/n/<HDU bed 1>` at 10:00, and its first load (`GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`) names ward 4
- **THEN** HDU still needs a reason from her, and those two requests are the only ones sent
- **AND** at 10:01, with the reason still not given, no further request has been sent, the bed review's 30-second refresh included

#### Scenario: Asked once a shift
- **WHEN** Grace Lee gave a reason for HDU at 10:15, and at 14:00 opens the HDU dashboard again and then the bed review of HDU bed 2
- **THEN** no reason dialog is shown, and no access request is sent
- **AND** when Meera Pillai signs in on that device at 14:05 and opens HDU, the dialog is shown
- **AND** when Grace Lee opens HDU at 20:05, on the night shift, the dialog is shown again

#### Scenario: Cancel stays put
- **WHEN** Grace Lee came to Renal HDU from the ward list `/n`, and cancels the reason
- **THEN** no request is sent, HDU still needs a reason, and the app goes back one page, to `/n`
- **AND** when she opened HDU by direct link, with no page to go back to, cancelling goes to `/n`

#### Scenario: Own ward or matron
- **WHEN** Grace Lee opens 3A (a ward she covers), and Lakshmi Iyer (matron) opens HDU
- **THEN** no reason dialog is shown, and no access request is sent

### Requirement: Care plan on the bed review
The bed review SHALL show a "Care plan" section:
- each active order except acuity, in the order of `care.orders`;
- progress bars for a fluid limit and an intake target;
- the catheter day and its last review, as `Reviewed today` when it falls in the current chart day (since 08:00);
- under "History", the `CARE_HISTORY_SHOWN` (10) newest orders of `care_history`, with "Show all".

With no such order it reads `No care orders`. It sends no request beyond the bed review's own load.

#### Scenario: Limit and target
- **WHEN** the bed's `care` has:
  - a `{ ml: 1000, scope: "total" }` fluid limit at `ml: 820`, `pending_ml: 200`, `percent: 82` and `left_ml: 180`, since 08:00;
  - a 1600 mL intake target at `ml: 600` and `percent: 37`, with `next_check` 20:00 and 1200 mL
- **THEN** the limit row reads `Fluid limit · 1000 mL total intake`, with a bar at 82% captioned `820 of 1000 mL today since 08:00 · 82% · 180 mL left · incl. 200 mL pending`
- **AND** the target row reads `Intake target · 1600 mL oral intake`, with a bar at 37% captioned `600 of 1600 mL today since 08:00 · 37% · next check 20:00: 1200 mL`

#### Scenario: Limit bar colours
- **WHEN** a fluid limit is at 79%, at 80% and at 100%
- **THEN** its bar is neutral, amber and red respectively, and its caption always gives the percent as text

#### Scenario: Catheter
- **WHEN** the bed's `care` has a urethral catheter inserted on 29 Oct, `day: 6` and `review_due: true`, last reviewed on 2 Nov at 09:10 by Nikhil Bose
- **THEN** its row reads `Urethral catheter · inserted 29 Oct · Catheter day 6` and `Last reviewed 2 Nov 09:10 · Nikhil B.`
- **AND** after a review at 09:10 on 3 Nov by Nikhil Bose, at 10:00 that day it reads `Reviewed today 09:10 · Nikhil B.`
- **AND** a review at 07:30 on 3 Nov, before that chart day began at 08:00, reads at 10:00 `Last reviewed 07:30 · Nikhil B.`, and "Reviewed today" is still offered

#### Scenario: Nil by mouth and thickened fluids
- **WHEN** the bed's `care` has nil by mouth since 06:00 until 14:00, and thickened fluids at level 2
- **THEN** the rows read `Nil by mouth · since 06:00 · until 14:00` and `Thickened fluids · IDDSI 2 Mildly thick`
- **AND** nil by mouth with no `until` reads `Nil by mouth · since 06:00 · no planned end`

#### Scenario: History
- **WHEN** `care_history` holds:
  - nil by mouth until 16:00, from 09:00 today and active, set by Meera Pillai;
  - nil by mouth until 14:00, from 06:00 to 09:00 today, set and ended by Meera Pillai
- **THEN** the History rows read, in order:
  - `Nil by mouth until 16:00 · 09:00–now · set by Meera P.`
  - `Nil by mouth until 14:00 · 06:00–09:00 · set by Meera P. · ended by Meera P.`

#### Scenario: Nothing ordered
- **WHEN** the bed's `care.orders` and `care_history` are empty
- **THEN** the section reads `No care orders` and shows no History

#### Scenario: Acuity in its own row
- **WHEN** the bed's only active order is acuity `critical`, set at 10:00 today by Anita Thomas
- **THEN** the section's order rows read `No care orders`
- **AND** its History row reads `Acuity critical · 10:00–now · set by Anita T.`

#### Scenario: No extra request
- **WHEN** the bed review of a bed with all five kinds of order is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

### Requirement: Change care orders from the bed review
On the bed review, a nurse or matron SHALL be able to:
- add an order of a kind other than acuity that is not active;
- change or end an active order other than acuity (acuity is changed on its own row);
- record the catheter's "Reviewed today".

Diets follow "Diet order from the bed review", and a dietitian may do these for diets only. Each sends one request, then reloads the bed review. Attendants see the section without these actions. The forms load on first use. It makes no model request.

#### Scenario: Add a fluid limit
- **WHEN** Nikhil Bose (id 7) adds a fluid limit on HDU bed 3 (admission 21), sets 1000 mL and "Total intake", and saves
- **THEN** the requests are, in order:
  1. `PUT /api/admissions/21/care/fluid_limit` with `{ ml: 1000, scope: "total" }` and `X-Staff-Id: 7`;
  2. `GET /api/admissions/21/entries` and `GET /api/admissions/21/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Form defaults
- **WHEN** each kind's form is opened on a bed with no orders
- **THEN** the forms start as follows:
  - fluid limit at 1500 mL and "Total intake", stepping by 50 mL between 500 and 3000 mL;
  - intake target at 1600 mL;
  - nil by mouth with "No planned end";
  - catheter "Urethral", inserted today;
  - thickened fluids with no level picked, and Save disabled until one is;
  - diet with no type picked, `IDDSI 7 Regular` and no target, and Save disabled until a type is picked;
  - stoma, drain and urine collection as in "Output devices on the care plan"
- **AND** on a bed with an active 1500 mL fluid limit, the intake target form starts at 1500 mL, the lower of 1600 mL and the limit

#### Scenario: Planned end of nil by mouth
- **WHEN** at 10:00 Meera Pillai sets nil by mouth on 2C bed 1 with "Until" 14:00, and at 22:00 another nurse sets it on another bed with "Until" 07:00
- **THEN** the first request's `until` is 14:00 today and the second's 07:00 tomorrow, local time

#### Scenario: Catheter insertion date
- **WHEN** a catheter is set with "Inserted" 29 Oct
- **THEN** the request's `inserted_at` is 00:00 on 29 Oct, local time

#### Scenario: End an order
- **WHEN** Meera Pillai ends nil by mouth on 2C bed 1 and confirms `End nil by mouth?`
- **THEN** the requests are `DELETE /api/admissions/<id>/care/nil_by_mouth`, then the reload
- **AND** ending a catheter asks `Catheter removed?` instead

#### Scenario: Reviewed today
- **WHEN** Nikhil Bose taps "Reviewed today" on HDU bed 1 (admission 19)
- **THEN** the requests are `POST /api/admissions/19/care/catheter/review`, then the reload
- **AND** when it answers 409 `already_reviewed`, the screen shows `Already reviewed today` and sends nothing more

#### Scenario: Target above the limit
- **WHEN** the bed has a 1500 mL fluid limit, and a nurse sets an intake target of 1600 mL
- **THEN** the form shows `Above the fluid limit of 1500 mL`, Save is disabled, and no request is sent
- **AND** a fluid limit set below an active 1600 mL target shows `Below the intake target of 1600 mL`

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens the bed review of a bed with orders
- **THEN** the Care plan section lists the orders and their progress, with no control to add, change or end an order and no "Reviewed today"

#### Scenario: Acuity not offered here
- **WHEN** Anita Thomas (nurse) opens the add-order control on a bed whose only active order is acuity `watch`
- **THEN** it offers nil by mouth, thickened fluids, fluid limit, intake target, catheter, stoma, drain, urine collection and diet, and not acuity

#### Scenario: Dietitian offered diet only
- **WHEN** Sana Mirza (dietitian) opens the add-order control on the same bed
- **THEN** it offers only diet

### Requirement: Care badges on bed cards
Each ward dashboard bed card SHALL show one badge per active order other than acuity (its own chip: "Acuity on bed cards"), diet ("Diet badges on bed cards") and stoma, drain and voiding orders ("Device badges on bed cards"), in the order of `care.orders`:
- `NBM`;
- `IDDSI <level>`;
- `Limit <litres> L · <percent>%`;
- `Target <counted mL>/<target mL> mL`;
- `Catheter day <n>`.

They come from the beds' existing load, so the dashboard sends no extra request.

#### Scenario: Every kind
- **WHEN** a bed's `care` has nil by mouth, thickened fluids at level 2, a 1500 mL limit at 82%, a 1600 mL target with 900 mL counted, and a catheter on day 6
- **THEN** its card shows, in order, `NBM`, `IDDSI 2`, `Limit 1.5 L · 82%`, `Target 900/1600 mL` and `Catheter day 6`

#### Scenario: Litres
- **WHEN** one bed has a 1000 mL limit at 82%, and another a 1250 mL limit at 40%
- **THEN** their badges read `Limit 1 L · 82%` and `Limit 1.25 L · 40%`

#### Scenario: No extra request
- **WHEN** Grace Lee opens the dashboard of ward 5B (id 3), whose beds have orders
- **THEN** exactly two requests are made: `GET /api/admissions?ward=3` and `GET /api/wards/3/team`

#### Scenario: Acuity is not a care badge
- **WHEN** a bed's `care.orders` holds acuity `critical` and nil by mouth
- **THEN** its only care badge is `NBM`, and its acuity shows as the `Critical` chip

#### Scenario: Diet has its own badges
- **WHEN** a bed's `care.orders` holds thickened fluids at level 2 and the diet `{ type: "low_salt", texture: 5 }`
- **THEN** its care badges read `IDDSI 2`, then `Low salt diet` and `Food IDDSI 5`, the diet's two from "Diet badges on bed cards", and no other badge

### Requirement: Care prompt colours
The web app SHALL colour care prompts like the existing ones, so a bed's status follows its worst prompt:
- red (`Review now`): `nil_by_mouth_intake`, `drink_too_thin` and `fluid_limit_reached`;
- amber (`Review`): `fluid_limit_near`, `nil_by_mouth_overdue`, `intake_target_behind` and `drink_consistency_unrecorded`;
- blue (`Check`): `catheter_review`.

Each prompt chip shows its label, never colour alone.

#### Scenario: Worst prompt wins
- **WHEN** one bed's only prompt is `catheter_review`, a second has `catheter_review` and `fluid_limit_near`, a third `catheter_review` and `drink_too_thin`, and a fourth only `drink_consistency_unrecorded`
- **THEN** their status chips read `Check`, `Review`, `Review now` and `Review`, on the ward dashboard and on the bed review alike

#### Scenario: Labels
- **WHEN** a bed raises each care prompt
- **THEN** the chips read:
  - `Intake while NBM` for `nil_by_mouth_intake`;
  - `Drink too thin` for `drink_too_thin`;
  - `Consistency not recorded` for `drink_consistency_unrecorded`;
  - `Fluid limit reached` for `fluid_limit_reached`;
  - `Near fluid limit` for `fluid_limit_near`;
  - `NBM past planned end` for `nil_by_mouth_overdue`;
  - `Behind intake target` for `intake_target_behind`;
  - `Catheter review` for `catheter_review`

### Requirement: Care flags on entries and meals
On the bed review, pending cards, log rows and entry details SHALL badge:
- an entry in the `entry_ids` of `nil_by_mouth_intake` as `During NBM`;
- one in the `entry_ids` of `drink_too_thin` as `Thinner than ordered`, and of `drink_consistency_unrecorded` as `Consistency not recorded`;
- every drink with a level as `IDDSI <level>`.

Meals in `meal_ids` are badged `During NBM`. Approving and rejecting stay as before.

#### Scenario: Drink while fasting
- **WHEN** a pending 150 mL water entry is in the `entry_ids` of `nil_by_mouth_intake`, and Anita Thomas (nurse) opens the bed
- **THEN** its pending card shows `During NBM`, with Approve and Reject

#### Scenario: Thin drink
- **WHEN** `drink_too_thin` lists an approved water entry at `iddsi_level: 0`, `drink_consistency_unrecorded` lists a jug-drop entry with no level, and the log also holds a level-2 drink that neither lists
- **THEN** the first row shows `IDDSI 0` and `Thinner than ordered`, the second `Consistency not recorded`, and the third `IDDSI 2` only

#### Scenario: Lunch while fasting
- **WHEN** a lunch is in the `meal_ids` of `nil_by_mouth_intake`
- **THEN** its row on the bed review's meals shows `During NBM`

### Requirement: Correct a drink's consistency
In entry details, Amend on an approved drink SHALL offer "Consistency" to a nurse or matron: chips `0 Thin` to `4 Extremely thick`, set to the drink's level, or none picked when it has none. A changed level is sent as `iddsi_level` with the reason, in one request. Other types offer no "Consistency". The timeline shows the change as `consistency <from> → IDDSI <to>`, with `none` for no level. It makes no model request.

#### Scenario: Record a jug drink's level
- **WHEN** Anita Thomas (id 4) opens Amend on an approved 400 mL jug-drop drink with no level, picks `2 Mildly thick` and gives the reason `checked the cup`
- **THEN** "Consistency" first shows no chip picked
- **AND** saving sends exactly one request, `POST /api/entries/<id>/amend` with `{ iddsi_level: 2, reason: "checked the cup" }` and `X-Staff-Id: 4`, and no `/api/ai` request

#### Scenario: Timeline
- **WHEN** that drink's `amended` event has `from_iddsi: null` and `to_iddsi: 2`, at 15:00 by Anita Thomas (nurse)
- **THEN** its timeline line reads `15:00 · Amended consistency none → IDDSI 2 by Anita Thomas (nurse): checked the cup`
- **AND** an event from `0` to `2` reads `consistency IDDSI 0 → IDDSI 2`

#### Scenario: Not a drink
- **WHEN** Amend is opened on an approved urine entry, and a level-2 drink is amended to food with the reason `it was soup`
- **THEN** the urine entry's Amend shows no "Consistency"
- **AND** the food request is `{ category: "food", reason: "it was soup" }`, with no `iddsi_level`

### Requirement: Bag periods on the bed review
The bed review SHALL show a "Bags" section from `bags`, each bag's newest period first. A period has a header such as `08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h` (`· — mL/h` when a known start has no rate), then each reading's time, event, level and rise, its photo and after-emptying photo, who saved it, `Late` and any fall. It sends no request beyond the bed review's own load, and is not shown for a bed with no bag reading.

#### Scenario: Closed period
- **WHEN** a urine bag was emptied at 08:00, checked at 150 mL at 10:00 and at 260 mL at 11:00, and emptied at 380 mL at 12:00
- **THEN** that period's header reads `08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h`
- **AND** its rows read `10:00 · Check · 150 mL · +150 mL`, `11:00 · Check · 260 mL · +110 mL` and `12:00 · Emptied · 380 mL · +120 mL`

#### Scenario: Open period and unknown start
- **WHEN** after that emptying the bag is checked at 150 mL at 13:00, and the 08:00 emptying at 600 mL was its first reading
- **THEN** the newest header reads `Since 12:00: 150 mL so far (1 reading)`
- **AND** the oldest reads `Until 08:00: 600 mL (1 reading, emptied 08:00)`, with no rate

#### Scenario: Fall
- **WHEN** a check at 150 mL at 12:00 fell from 500 mL at 09:00
- **THEN** its row reads `12:00 · Check · 150 mL · +150 mL · Level fell from 500 mL`

#### Scenario: Late reading already charted
- **WHEN** a check at 260 mL charted for 10:00 was saved at 11:30 between readings at 09:00 and 11:00, and charted nothing
- **THEN** its row reads `10:00 · Check · 260 mL · +110 mL · Late · 90 min · charted with 11:00`

#### Scenario: Proof
- **WHEN** Ravi Kumar's 08:00 emptying has an after-emptying photo and 30 mL left in the bag
- **THEN** its row shows two thumbnails, `Before emptying` and `After emptying`, with `Left in bag 30 mL` and `by Ravi K.`

#### Scenario: No extra request
- **WHEN** the bed review of a bed with bag readings is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

#### Scenario: Too short to rate
- **WHEN** a urine bag emptied at 08:00 is emptied at 450 mL at 08:10, and that period's `rate_ml_h` is null
- **THEN** its header reads `08:00 → 08:10: 450 mL (1 reading, emptied 08:10) · — mL/h`

### Requirement: Add a missed emptying
For a nurse or matron, the `bag_level_fell` prompt SHALL offer "Add missed emptying": a time of day strictly between the fall's two readings, within the last 24 hours and after admission, taken on the date that puts it there, and the bag's level when emptied, starting at the fall's `fell_from_ml` and refused below it. Saving sends the reading only, so its entry waits for review like any other. Attendants are not offered it. It makes no model request.

#### Scenario: Nurse adds it
- **WHEN** at 13:00 Anita Thomas (id 4) adds the missed emptying for a fall from 500 mL at 09:00 to 150 mL at 12:00, at 10:30 and 550 mL
- **THEN** exactly one request is sent before the bed review reloads: `POST /api/admissions/<id>/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 550, source: "manual", charted_at: <10:30 today> }` and `X-Staff-Id: 4`
- **AND** no `/api/ai` request is sent, and the new 50 mL entry shows as pending with Approve and Reject

#### Scenario: Floor at the residual
- **WHEN** the fall is from the 30 mL left after an 08:00 emptying to 20 mL at 09:00, and Anita Thomas opens "Add missed emptying"
- **THEN** the level starts at 30 mL

#### Scenario: Level not known
- **WHEN** Anita Thomas leaves the level at 500 mL and saves
- **THEN** exactly one request is sent before the reload, the bag reading, and after the reload the prompt is gone

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens 2C bed 6 with that fall
- **THEN** its `Bag level fell` prompt is shown without "Add missed emptying"

#### Scenario: Refused on the device
- **WHEN** "Less" is tapped at 500 mL, or the time is set to 09:00 or 12:00
- **THEN** the level stays at 500 mL with "Less" disabled, or the form shows `Between 09:00 and 12:00` with "Add emptying" disabled, and nothing is sent

#### Scenario: Across midnight
- **WHEN** at 03:00 a nurse adds a missed emptying for a fall from 500 mL at 22:00 to 150 mL at 02:00, first at 23:30 and then at 00:30
- **THEN** the first request has `charted_at` 23:30 yesterday, and the second 00:30 today, local time

#### Scenario: Older than a day
- **WHEN** at 10:00 on 3 Nov a nurse adds a missed emptying for a fall from 400 mL at 08:00 on 1 Nov to 150 mL at 09:00 on 3 Nov, at 09:30
- **THEN** the form shows `Between 2 Nov 10:00 and 09:00`, and nothing is sent
- **AND** at 08:30 the request has `charted_at` 08:30 on 3 Nov

### Requirement: Bag prompt colours
The web app SHALL colour bag prompts like the others, so a bed's status follows its worst prompt: red (`Review now`) for `bag_reading_overdue`, and amber (`Review`) for `bag_reading_due`, `bag_level_fell` and `bag_nearly_full`. Their chips read `Bag reading overdue`, `Bag reading due`, `Bag level fell` and `Bag nearly full`. Entries in the `entry_ids` of `bag_level_fell` are badged `Bag level fell`.

#### Scenario: Worst prompt wins
- **WHEN** one bed's only prompt is `bag_reading_due`, a second has `bag_reading_overdue`, a third has `catheter_review` and `bag_level_fell`, and a fourth has only `bag_nearly_full`
- **THEN** their status chips read `Review`, `Review now`, `Review` and `Review`, on the ward dashboard and on the bed review alike
- **AND** the fourth bed's prompt chip reads `Bag nearly full`

#### Scenario: Flagged entry
- **WHEN** a pending 150 mL urine entry is in the `entry_ids` of `bag_level_fell`, and Anita Thomas opens the bed
- **THEN** its pending card shows `Bag level fell`, with Approve and Reject

### Requirement: Bag reading on the entry
Entry details of an entry charted from a bag reading SHALL show the previous and this reading's photos, each with its level, event and time, and between them `<baseline> mL → <level> mL · +<rise> mL`, the baseline labelled `emptied <time>` after an emptying, or `<previous> mL → <level> mL · level fell` after a fall. The timeline says `Saved <mL> mL, the rise since <time>`, or what a late reading added when its entry differs from its rise. It makes no model request.

#### Scenario: Rise since a check
- **WHEN** the 110 mL entry from checks at 150 mL (10:00) and 260 mL (11:00) is opened
- **THEN** it shows photos labelled `150 mL · Check · 10:00` and `260 mL · Check · 11:00`, with `150 mL → 260 mL · +110 mL` between them
- **AND** its timeline reads `Saved 110 mL, the rise since 10:00`

#### Scenario: After an emptying
- **WHEN** the 150 mL entry of a check at 10:00, after an emptying at 600 mL at 08:00, is opened
- **THEN** it reads `0 mL (emptied 08:00) → 150 mL · +150 mL`

#### Scenario: First reading
- **WHEN** the 600 mL entry of a bag's first reading, an emptying at 08:00, is opened
- **THEN** it shows that one photo, `0 mL → 600 mL · +600 mL`, and the timeline reads `Saved 600 mL, the first reading of this bag`

#### Scenario: Fall
- **WHEN** the 150 mL entry of a check at 150 mL at 12:00, after a check at 500 mL at 09:00, is opened
- **THEN** it reads `500 mL → 150 mL · level fell`, and the timeline reads `Saved 150 mL, the whole level, as it fell since 09:00`

#### Scenario: Late emptying
- **WHEN** the 260 mL entry of a late emptying at 260 mL charted for 10:00, after a check at 150 mL at 09:00, is opened
- **THEN** it reads `150 mL → 260 mL · +110 mL`, and the timeline reads `Saved 260 mL, what this late reading adds to the bag's charted total`

#### Scenario: Reject a bag entry
- **WHEN** a nurse rejects the pending 110 mL entry
- **THEN** neither the reject sheet nor the message after rejecting mentions a photo, since both bag photos stay with their readings

### Requirement: Tray overlay
A tray photo with segmentation SHALL be overlaid with each dish region's contour from its dish mask, and its food from its food mask, in proportion to the image's pixels. Each region is labelled `<index> <name> · <portion>` per dish in it, from the meal's dishes or, before saving, the form's, and `<index> <name> · <Kind> · <mL> mL` per drink in it, from the read's `fluids`, without `<Kind> · ` when it equals the name ignoring case. Unnamed regions are unlabelled; `Raw` hides all.

#### Scenario: Rice on a 1000 × 800 photo
- **WHEN** region 1 has box 100,80–400,480 and a 2 × 1 dish mask `gA==` (only the left cell set), on a 1000 × 800 photo, and the meal's dishes name rice in region 1, Half eaten
- **THEN** one closed contour is drawn inside left 10%–25% and top 10%–60%
- **AND** the label `1 rice · Half` is placed at left 10%, top 10%

#### Scenario: A cup and a region nothing names
- **WHEN** region 2 is cited by the fluid tea, 150 mL, and region 3 by no dish or fluid
- **THEN** region 2 is labelled `2 tea · 150 mL`, and region 3 is drawn with no label

#### Scenario: Drink kind on a region
- **WHEN** region 4 is cited by the fluid `chaas` of kind `buttermilk`, 200 mL
- **THEN** region 4 is labelled `4 chaas · Buttermilk · 200 mL`

#### Scenario: Outline off
- **WHEN** `Raw` is picked on that photo
- **THEN** no contour and no label is drawn, and the bare photo is shown

#### Scenario: Kept tray copy
- **WHEN** a saved lunch's tray proof has `labeled_media.id: 43`
- **THEN** `Labeled` shows that copy with `1 rice · Half` drawn in and no live overlay over it, and `Raw` shows the tray photo with no contour or label

### Requirement: Tray proof on the bed review
A photo meal with a proof SHALL show it in "What the AI read", above the existing lines: the tray photo with the tray overlay, who took it and when, and its fingerprint, paired with any served tray ("Served tray in the proof"); one row per dish with the AI read beside the value saved; and who saved the meal and when. Viewing makes no model request and fetches each photo once with `GET /api/media/<id>`, only when opened. A meal with `proof: null` shows only the existing lines and its photo.

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

### Requirement: Model accuracy view
The Data quality view SHALL end with a "Model accuracy" section for the ward's last 7 days, from one `GET /api/quality/model?ward=<id>&days=7` sent with the ward summary when the view opens. It shows the outcome chart or the kinds table ("Chart or table"), one class table ("Class table picker"), and the volume error, negatives, kept drafts, meal fluid and top corrections lines. Switching the chart, table or class table sends no request. It makes no model request.

#### Scenario: Two requests
- **WHEN** Anita Thomas opens the Data quality view of 3A (ward id 2), then picks Table and each class table in turn
- **THEN** exactly two requests are sent: `GET /api/wards/2/quality` and `GET /api/quality/model?ward=2&days=7`
- **AND** no `/api/ai` request is sent

#### Scenario: Read kinds
- **WHEN** Table is picked, and the `photo` `sam+spark` row has outcomes `accepted` 20, `edited_at_capture` 2, `corrected_by_nurse` 3, `rejected` 1 and `abandoned` 1, with rates accepted `{ n: 20, of: 26, pct: 76 }`, edited_at_capture `{ n: 2, of: 26, pct: 7 }`, corrected_by_nurse `{ n: 3, of: 26, pct: 11 }` and rejected `{ n: 1, of: 26, pct: 3 }`
- **THEN** the kinds table has a row `Photo (SAM + Spark)` reading `26`, `76% · 20/26`, `7% · 2/26`, `11% · 3/26`, `3% · 1/26` and `1`, under the headers `Read`, `Decided`, `Accepted`, `Edited at capture`, `Corrected by a nurse`, `Rejected` and `Abandoned`

#### Scenario: Type table
- **WHEN** the type table's `urine` row is `{ model: "urine", n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: "stoma", n: 1 }] }`
- **THEN** the "Drink and fluid" table has a row `Urine` reading `6`, `80% · 4/5` and `Stoma 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`

#### Scenario: Volume and negatives
- **WHEN** the volume error is `{ of: 24, mae_ml: 18, within: { n: 20, of: 24, pct: 83 }, no_volume: 1 }`, and the negatives are 2 confirmed, 1 overridden as `water` and 1 read with nothing drafted
- **THEN** the section reads `18 mL mean error · within ±25 mL 83% · 20/24 · 1 with no volume read`
- **AND** it reads `Nothing to chart: 2 confirmed · 1 charted anyway (Drink 1) · 1 read with nothing drafted`

#### Scenario: Meal overridden
- **WHEN** the negatives are 1 confirmed and 1 overridden as `meal`
- **THEN** the section reads `Nothing to chart: 1 confirmed · 1 charted anyway (Meal 1)`

#### Scenario: Mean error withheld
- **WHEN** the volume error is `{ of: 4, mae_ml: null, within: { n: 3, of: 4, pct: null }, no_volume: 0 }`
- **THEN** the volume line reads `— mean error · within ±25 mL — · 3/4`

#### Scenario: No reads
- **WHEN** the summary has no drafts in any kind
- **THEN** the section reads `No AI reads in the last 7 days`, and shows no chart, table, picker or lines

### Requirement: Rates shown with their counts
The Model accuracy section SHALL write every rate it shows as `<pct>% · <n>/<of>`, and as `— · <n>/<of>` when the summary withholds its percentage, so a small count is never shown as a percentage alone. It makes no model request.

#### Scenario: Withheld below the minimum
- **WHEN** one rate is `{ n: 4, of: 4, pct: null }` and another `{ n: 23, of: 25, pct: 92 }`
- **THEN** they read `— · 4/4` and `92% · 23/25`

### Requirement: Nutrition on the bed review
The bed review SHALL show a "Nutrition" section from the bed's `nutrition`:
- `Dietitian: <name> · assigned <time> by <name>`, else `Dietitian: ward dietitians`, or `No dietitian covers <ward name>`;
- the latest referral: reason, who made it and when, its acknowledgement or its close (outcome, next review), and any note;
- the meals of the last 24 h as "Meals on the bed review" lists them, with their dishes.

It sends no request beyond the bed review's own load, and no model request.

#### Scenario: Acknowledged referral
- **WHEN** at 15:00 on 3 Nov the bed's `nutrition` has `dietitian_available: true` and a `poor_intake` referral made at 14:05 by Anita Thomas and acknowledged at 14:30 by Sana Mirza
- **THEN** the section reads `Dietitian: ward dietitians` and `Referred 14:05 by Anita T. · Poor intake · Acknowledged 14:30 · Sana M.`

#### Scenario: Closed with an outcome
- **WHEN** at 10:00 on 3 Nov the latest referral, `weight_loss` with the note `Lost weight at home`, was made at 09:00 on 1 Nov by Meera Pillai and closed at 17:00 on 1 Nov by Sana Mirza with `supplements_started` and `next_review: "2026-11-05"`
- **THEN** the section reads `Referred 1 Nov 09:00 by Meera P. · Weight loss` and `Closed 1 Nov 17:00 by Sana M. · Supplements started · next review 5 Nov`
- **AND** the note reads `Lost weight at home`

#### Scenario: No dietitian
- **WHEN** a bed on Medical Ward 3A has `nutrition: { dietitian_available: false, dietitian: null, referral: null }`
- **THEN** the section reads `No dietitian covers Medical Ward 3A`

#### Scenario: Assigned dietitian
- **WHEN** at 15:00 on 3 Nov the bed's `nutrition.dietitian` is Sana Mirza, assigned at 14:40 by Anita Thomas
- **THEN** the section reads `Dietitian: Sana M. · assigned 14:40 by Anita T.`
- **AND** with that assignment made at 09:00 on 2 Nov, it reads `Dietitian: Sana M. · assigned 2 Nov 09:00 by Anita T.`

#### Scenario: Meals in the section
- **WHEN** Sana Mirza opens a bed with a lunch at 13:10 today from a tray photo, half eaten, items "rice, dal", and the dishes rice (All) and dal (Half)
- **THEN** the Nutrition section lists the lunch as `13:10`, `Lunch`, `Half` with 2 of 4 parts filled and `rice, dal`, and under it the dishes `rice · All` and `dal · Half`
- **AND** no tray photo is loaded until "Show tray" is tapped

#### Scenario: No extra request
- **WHEN** the bed review of a bed with an acknowledged referral, an assigned dietitian and 3 meals with dishes is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

### Requirement: Referral actions on the bed review
In the Nutrition section, a dietitian SHALL be offered "Acknowledge" on an open referral and "Close…" on an open or acknowledged one, with an outcome (Diet changed, Supplements started, Monitoring, No action needed) and an optional next review date from today to 28 days on. Each sends one request, then reloads the bed review. Others see the referral without these actions. It makes no model request.

#### Scenario: Acknowledge
- **WHEN** Sana Mirza (id 11) taps "Acknowledge" on the open referral 5 of admission 11
- **THEN** the requests are, in order:
  1. `POST /api/referrals/5/acknowledge` with `X-Staff-Id: 11`;
  2. `GET /api/admissions/11/entries` and `GET /api/admissions/11/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Close
- **WHEN** on 3 Nov Sana Mirza taps "Close…" on referral 5, picks "Supplements started" and the next review 6 Nov, and confirms
- **THEN** the date picker allows 3 Nov to 1 Dec, and confirming is disabled until an outcome is picked
- **AND** the requests are `POST /api/referrals/5/close` with `{ outcome: "supplements_started", next_review: "2026-11-06" }`, then the reload
- **AND** with no date picked, the body is `{ outcome: "supplements_started" }`

#### Scenario: Nurse looks
- **WHEN** Anita Thomas (nurse) or Lakshmi Iyer (matron) opens a bed with an open referral
- **THEN** the referral is shown with no "Acknowledge" or "Close…"

### Requirement: Refer to dietitian
A nurse or matron SHALL be offered "Refer to dietitian" on a `poor_meal_intake` prompt and in the Nutrition section when `dietitian_available` is true and no referral is open or acknowledged. It asks for a reason (Poor intake, Weight loss, Swallowing, Diet query, Other) and an optional note of up to 200 characters, then sends one `POST /api/admissions/<id>/referrals` and reloads the bed review. It makes no model request.

#### Scenario: Anita refers
- **WHEN** Anita Thomas (id 4) taps "Refer to dietitian" on the `poor_meal_intake` prompt of 3A bed 6 (admission 11), picks "Poor intake" and sends
- **THEN** the requests are, in order:
  1. `POST /api/admissions/11/referrals` with `{ reason: "poor_intake" }` and `X-Staff-Id: 4`;
  2. `GET /api/admissions/11/entries` and `GET /api/admissions/11/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Reason and note
- **WHEN** the dialog is open
- **THEN** "Send" is disabled until a reason is picked, and while the note is over 200 characters
- **AND** with "Other" and the note `Asks for vegetarian meals`, the body is `{ reason: "other", note: "Asks for vegetarian meals" }`, and an empty note is left out of the body

#### Scenario: No dietitian available
- **WHEN** a bed has a `poor_meal_intake` prompt and `dietitian_available: false`, and Anita Thomas opens it
- **THEN** the prompt reads `Poor meal intake` with the status `Review`, and neither it nor the Nutrition section offers "Refer to dietitian"

#### Scenario: Who may refer
- **WHEN** a bed with `dietitian_available: true` and no referral is opened by Ravi Kumar (attendant), by Sana Mirza (dietitian), and by Lakshmi Iyer (matron)
- **THEN** only Lakshmi Iyer is offered "Refer to dietitian"

#### Scenario: Already referred
- **WHEN** the bed's latest referral is open or acknowledged
- **THEN** "Refer to dietitian" is not offered
- **AND** when it is closed, it is offered again

### Requirement: Nutrition on bed cards
Each ward dashboard bed card SHALL show `Referred to dietitian` while the bed's referral is open or acknowledged, with ` · <short name>` of the dietitian who acknowledged it. A `poor_meal_intake` prompt reads `Poor meal intake`, amber (`Review`). None of it adds a request, and it makes no model request.

#### Scenario: Referral chip
- **WHEN** one bed has an open referral, a second a referral acknowledged by Sana Mirza, and a third only a closed referral
- **THEN** the first shows `Referred to dietitian`, the second `Referred to dietitian · Sana M.`, and the third no referral chip

#### Scenario: Prompt colour
- **WHEN** a bed's only prompt is `poor_meal_intake`
- **THEN** its prompt chip reads `Poor meal intake` and its status chip `Review`, in amber, on the dashboard and on the bed review

#### Scenario: No extra request
- **WHEN** Anita Thomas opens the 3A dashboard (ward id 2), whose beds have referrals
- **THEN** exactly two requests are made: `GET /api/admissions?ward=2` and `GET /api/wards/2/team`

### Requirement: Acuity on bed cards
Each ward dashboard bed card SHALL show its acuity level as a labelled chip and, when `suggested` is set, a separate `Suggested <level> · Review` chip naming its reasons. The dashboard's All, Critical, Watch and Stable filter shows only the beds placed in that group ("Beds needing attention first"), and changing it sends no request. None of it makes a model request.

#### Scenario: Chips
- **WHEN** the ward of "Acuity first" is open
- **THEN** bed 4 shows `Stable` and `Suggested critical · Review` naming `Low output`, bed 6 shows `Critical`, bed 1 shows `Watch`, and beds 2, 3 and 5 show `Stable` with no suggestion chip

#### Scenario: Critical filter
- **WHEN** the ward of "Acuity first" is open and the nurse picks Critical, then All
- **THEN** only beds 4 and 6 are shown, then all six again in the order 4, 6, 1, 3, 2, 5
- **AND** no request was sent when the filter changed

### Requirement: Set or confirm acuity on the bed review
The bed review SHALL show the bed's acuity and its source (`Order` or `Ward default`) to everyone, with its suggestion, and the controls only to a nurse or matron: set a level with one `PUT /api/admissions/:id/care/acuity`, confirm a suggestion with one such PUT, or return to the ward default with one `DELETE` of that order. Nothing is set without a tap. It makes no model request.

#### Scenario: Confirm a suggestion
- **WHEN** Anita Thomas (nurse) opens 3A bed 2, which is `stable` from the ward default with `suggested: critical` for low urine output, and taps Confirm
- **THEN** before the tap the review shows `Stable · Ward default` and `Suggested critical: Low output. Review`, and no PUT was sent on opening
- **AND** the tap sends exactly one `PUT /api/admissions/<3A bed 2>/care/acuity` with `{ level: "critical" }` and no `/api/ai` request
- **AND** after the reload the review shows `Critical · Order`

#### Scenario: Set Watch
- **WHEN** Anita Thomas (nurse) picks Watch and saves on 3A bed 4, which is `stable` from the ward default with no suggestion
- **THEN** exactly one `PUT /api/admissions/<3A bed 4>/care/acuity` with `{ level: "watch" }` is sent, then the reload
- **AND** no `/api/ai` request is sent, so it makes 0 model requests
- **AND** after the reload the review shows `Watch · Order`

#### Scenario: Back to the ward default
- **WHEN** Anita Thomas picks "Ward default" and saves on 3A bed 2, which has an acuity order `critical`
- **THEN** exactly one `DELETE /api/admissions/<3A bed 2>/care/acuity` is sent, and after the reload the review shows `Stable · Ward default`

#### Scenario: Attendant sees it read-only
- **WHEN** Ravi Kumar (attendant) opens 3A bed 2 while it is `stable` from the ward default with `suggested: critical`
- **THEN** he sees `Stable · Ward default` and the suggestion, with no Confirm and no level control

### Requirement: Served tray in the proof
When a meal's proof has `served`, "What the AI read" SHALL show the served photo and the tray photo as a before and after pair, each with its overlay, who took it and when, and its fingerprint, with a stat line between them giving each measured dish's served and left coverage and portion eaten. A measured dish's row reads `measured <portion>` before the AI's. A deleted served photo reads `Served tray deleted · fingerprint …` from the proof. Viewing makes no model request.

#### Scenario: Compared lunch
- **WHEN** a lunch has the tray photo 42 taken at 13:30 and the served photo 41 taken at 12:40, both by Ravi Kumar, the served photo with `sha256` `9b1c4d2e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a10e2`, and a compared read of rice in region 1 (`basis: measured`, portion 50, `model_portion` 25, served coverage 0.8, coverage 0.4) and dal in region 2 (`basis: model`, All), saved as rice Half and dal All
- **THEN** "What the AI read" shows the before photo `Served tray · 12:40 · Ravi K.` with the served photo, its overlay and `Photo fingerprint: 9b1c…e2`, then the stat line `1 rice · 80% served · 40% left · Half eaten`, then the after photo with the tray photo's lines
- **AND** the rows read `1 rice · Rice · measured Half · AI A quarter · saved Half` and `2 dal · Dal / lentils · AI All · saved All`
- **AND** opening it sends exactly two requests, `GET /api/media/42` and `GET /api/media/41`, and no `/api/ai` request

#### Scenario: Voided compared lunch
- **WHEN** that lunch is voided and "What the AI read" is opened
- **THEN** the served photo reads `Served tray deleted · fingerprint 9b1c…e2` from its proof, and no media request is sent

### Requirement: Amend a meal from the bed review
For a signed-in nurse or matron, each meal not voided SHALL offer "Amend…": its portion chips, and its dish rows (name, kind and portion chips, with add and remove) or, with no dishes, its items, and a reason. Save is disabled until something changed and the reason has at least 3 characters. It sends one `POST /api/meals/<id>/amend` with what changed and the reason, then reloads the bed's meals. An amended meal's row reads `Amended <time> · <who> · <reason>`.

#### Scenario: Rice finished after all
- **WHEN** Anita Thomas (nurse) opens bed 1, whose lunch 12 has the dishes `1 rice` (Half) and `2 dal` (All) and portion ¾, taps "Amend…", taps All on rice, types `tray rechecked` and saves at 14:30
- **THEN** the requests are, in order, `POST /api/meals/12/amend` with `{ dishes: [{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }, { index: 2, name: "dal", dish_kind: "dal_lentils", portion: 100 }], reason: "tray rechecked" }`, then `GET /api/admissions/1/meals`
- **AND** no `/api/ai` request is made, and the lunch's row reads `Amended 14:30 · Anita T. · tray rechecked`

#### Scenario: Nothing to save yet
- **WHEN** the dialog is opened and the reason `ab` is typed, or a reason of `checked` is typed with nothing changed
- **THEN** Save is disabled and nothing is sent

#### Scenario: Portion of a meal by hand
- **WHEN** a nurse amends a breakfast by hand with items `toast` and no dishes to ¼ with reason `half the toast left`
- **THEN** the dialog shows the items field and no dish rows, and the only amend request has `{ portion: 25, reason: "half the toast left" }`

#### Scenario: Not offered
- **WHEN** Ravi Kumar (attendant) or Sana Mirza (dietitian) is signed in, or a nurse views a voided meal
- **THEN** no "Amend…" is shown for it

#### Scenario: Voided meanwhile
- **WHEN** the amend answers 409 with `error: voided`
- **THEN** the dialog reads `This meal was voided. Nothing was changed.`, and nothing is resent

### Requirement: Bag reading interval on the care plan
The bed review's catheter row SHALL read `Bag reading every <h> h` (from `bags`), adding ` · Ward default` unless the order sets it; its History row adds `, bag reading every <h> h` when set. A nurse or matron's catheter form offers "Bag reading every": `Ward default (<h> h)`, 1, 2, 4, 6, 8 or 12 h, starting at the order's. Saving PUTs the order's type, insertion time and `measure_every_h` (null for the default when changing an order; a new order left at the default sends none), then reloads.

#### Scenario: Set by the order
- **WHEN** 3A bed 5's catheter `{ type: "urethral", inserted_at: <29 Oct> }` has `measure_every_h: 2`, and its bed review is opened on 3 Nov
- **THEN** its catheter row reads `Urethral catheter · inserted 29 Oct · Catheter day 6` and `Bag reading every 2 h`

#### Scenario: Default
- **WHEN** HDU bed 1's catheter has `measure_every_h: null`
- **THEN** its catheter row reads `Bag reading every 1 h · Ward default`

#### Scenario: Change it
- **WHEN** at 09:05 on 3 Nov Nikhil Bose (id 7) opens the catheter form on HDU bed 1 (admission 19), whose catheter is `{ type: "urethral", inserted_at: <00:00 on 29 Oct> }` and whose review is due, picks "4 h" and saves
- **THEN** the requests are, in order:
  1. `PUT /api/admissions/19/care/catheter` with `{ type: "urethral", inserted_at: <00:00 on 29 Oct>, measure_every_h: 4 }` and `X-Staff-Id: 7`;
  2. `GET /api/admissions/19/entries` and `GET /api/admissions/19/meals`
- **AND** after the reload the row reads `Bag reading every 4 h`, "Reviewed today" is still offered, and no `/api/ai` request was sent

#### Scenario: Back to the default
- **WHEN** on that form `Ward default (1 h)` is picked and saved
- **THEN** the PUT has `measure_every_h: null`

#### Scenario: Form defaults
- **WHEN** a new catheter form is opened on 3A bed 4 and on HDU bed 3, neither with a catheter
- **THEN** "Bag reading every" starts at `Ward default (4 h)` on 3A bed 4 and `Ward default (1 h)` on HDU bed 3

#### Scenario: History
- **WHEN** Nikhil Bose's 4-hour order replaced the default one at 09:05 on 3 Nov
- **THEN** the History rows read `Urethral catheter inserted 29 Oct, bag reading every 4 h · 09:05–now · set by Nikhil B.`, then the replaced order's row, with no interval and `ended by Nikhil B.`

### Requirement: Missed emptying already recorded
When the "Add missed emptying" post answers 409 `duplicate_reading`, the form SHALL show `Same as the reading at <time>: emptied at <level> mL.` with "Save anyway" and "Cancel", and send nothing more until one is tapped. "Save anyway" resends the same reading once with `confirm_duplicate_of` that reading's id, then reloads the bed review; "Cancel" sends no post and reloads it. It makes no model request.

#### Scenario: Added by someone else
- **WHEN** at 13:00 Anita Thomas opens "Add missed emptying" for 2C bed 6's fall from 500 mL at 09:00 to 150 mL at 12:00, Meera Pillai meanwhile adds an emptying at 550 mL at 10:30, and Anita saves 550 mL at 10:32
- **THEN** the post answers 409 with `duplicate_of` `{ id: 214, event: "emptied", volume_ml: 550, created_at: <10:30> }`, and the form shows `Same as the reading at 10:30: emptied at 550 mL.` with "Save anyway" and "Cancel"
- **AND** exactly one request was sent, that post, and no `/api/ai` request

#### Scenario: Cancel
- **WHEN** "Cancel" is tapped
- **THEN** the only requests that follow are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

#### Scenario: Save anyway
- **WHEN** "Save anyway" is tapped instead
- **THEN** exactly one `POST /api/admissions/<id>/bag-readings` is sent, with `{ container: "urine_bag", event: "emptied", volume_ml: 550, source: "manual", charted_at: <10:32 today>, confirm_duplicate_of: 214 }`, then the reload

### Requirement: Readings saved anyway
A bag reading with `confirmed_duplicate_of` SHALL end its bed-review row with `Saved anyway · same as <time>`, the time of the reading it repeats. It sends no request beyond the bed review's own load.

#### Scenario: Repeat emptying
- **WHEN** a urine bag was checked at 260 mL at 10:00 and emptied at 380 mL at 11:00, and Ravi Kumar's emptying at 380 mL at 11:02 was saved anyway as a repeat of it
- **THEN** its row reads `11:02 · Emptied · 380 mL · +380 mL · Saved anyway · same as 11:00`
- **AND** the 11:00 row reads `11:00 · Emptied · 380 mL · +120 mL`, with nothing added

### Requirement: Chart or table
The Model accuracy section SHALL offer `Chart | Table`, Chart first. Chart shows "Outcome bars". Table shows the kinds table, the chart's table view, under the headers `Read`, `Decided`, `Accepted`, `Edited at capture`, `Corrected by a nurse`, `Rejected` and `Abandoned`, one row per kind with drafts. The choice is kept while the view stays open. Switching sends no request and makes no model request.

#### Scenario: Chart first
- **WHEN** the Data quality view of 3A opens with photo and tray reads in the window
- **THEN** `Chart` is pressed and the outcome bars show, and no kinds table

#### Scenario: Tray row
- **WHEN** Table is picked, and the `tray` `sam+spark` row has 12 decided drafts with accepted `{ n: 8, of: 12, pct: 66 }`, edited_at_capture `{ n: 1, of: 12, pct: 8 }`, corrected_by_nurse `{ n: 2, of: 12, pct: 16 }`, rejected `{ n: 1, of: 12, pct: 8 }` and 0 abandoned, and the `photo` `spark` row has no drafts
- **THEN** the kinds table has a row `Tray (SAM + Spark)` reading `12`, `66% · 8/12`, `8% · 1/12`, `16% · 2/12`, `8% · 1/12` and `0`
- **AND** it has no `Photo (Spark only)` row

### Requirement: Outcome bars
The Chart view SHALL draw each read kind with `MIN_N` or more decided drafts as a panel: its label and `<rate> accepted` over one bar split by share into accepted, edited at capture, corrected by a nurse and rejected, in that order, under a legend naming the four. A tap, click, Enter or 400 ms hover on a panel opens a popup listing them as `<Outcome> <rate>`. A kind with under `MIN_N` decided drafts, and one draft or more, reads `Too few to chart · <n> decided`. It makes no request.

#### Scenario: Photo bar
- **WHEN** the `photo` `sam+spark` row has 20 accepted, 2 edited at capture, 3 corrected by a nurse and 1 rejected of 26 decided drafts
- **THEN** its bar is labelled `Photo (SAM + Spark)` and `76% · 20/26 accepted`, with segments 76.92%, 7.69%, 11.54% and 3.85% wide, in that order
- **AND** its panel's popup lists `Accepted 76% · 20/26`, `Edited at capture 7% · 2/26`, `Corrected by a nurse 11% · 3/26` and `Rejected 3% · 1/26`, taken from that row's rates

#### Scenario: Too few to chart
- **WHEN** the `text` row has 4 decided drafts, the `photo` `spark` row has 2 pending drafts and none decided, and the `voice` row has no drafts
- **THEN** the chart shows `Typed note` with `Too few to chart · 4 decided` and `Photo (Spark only)` with `Too few to chart · 0 decided`, each with no bar
- **AND** it does not list `Voice note`

#### Scenario: Legend and an empty segment
- **WHEN** the `tray` `sam+spark` row has 9 accepted and 3 corrected by a nurse of 12 decided drafts
- **THEN** the legend reads `Accepted`, `Edited at capture`, `Corrected by a nurse` and `Rejected`, in that order
- **AND** the tray bar has two segments, 75% and 25% wide

#### Scenario: Opened by a tap
- **WHEN** at 390 px the `Photo (SAM + Spark)` panel is tapped, and then the page is tapped outside it
- **THEN** the first tap opens the popup with the four lines of "Photo bar", and the second tap closes it
- **AND** at 1100 px, resting the mouse on the panel for 400 ms, or pressing Enter on the focused panel, opens the same popup, and Escape closes it
- **AND** a mouse resting under 400 ms, or Tab focus alone, opens nothing

#### Scenario: Panels
- **WHEN** 4 kinds have a bar and the view is 1100 px wide
- **THEN** the panels sit 3 to a row, each with its label and rate above its bar
- **AND** at 390 px they sit one per row, label above bar, and the page does not scroll sideways

### Requirement: Outcome colours
The bars SHALL colour accepted `#2a78d6`, edited at capture `#eb6834`, corrected by a nurse `#1baf7a` and rejected `#eda100`, in the legend's order. None is a status colour (`ok`, `warn`, `danger`, `pending`), so a bar never reads as a prompt. Every segment is named by the legend and its row's popup, and labels and values use the text colours, never a segment's colour. It makes no request.

#### Scenario: Hues
- **WHEN** the chart is drawn with all four outcomes
- **THEN** the legend's swatches are `#2a78d6`, `#eb6834`, `#1baf7a` and `#eda100`, in order
- **AND** none of them is `#15803d`, `#a15c07`, `#b91c1c` or `#6d28d9`, and the label `76% · 20/26 accepted` is drawn in `#0f172a`

### Requirement: Class table picker
The section SHALL show one class table, chosen with a `Table` select of `Drink and fluid` (first, the type table), `Drink kind`, `Urine colour`, `Container`, `Dish`, `Dish portion` and `Meal portion`. Every rate in it reads as in "Rates shown with their counts". A table with no rows keeps its header row over one cell reading `No <drafts> in the last 7 days`, or for a tray table when tray reads exist, `No reviewed tray meals in the last 7 days`. Picking sends no request, and no model request.

#### Scenario: Dish table
- **WHEN** `Dish` is picked, the `dish_kind` table's `rice` row is `{ model: "rice", n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: "bread", n: 1 }] }`, its `fruit` row has the correction `{ to: "none", n: 1 }`, and its `none` row has n 1 and the correction `{ to: "dairy", n: 1 }`
- **THEN** the table has a row `Rice` reading `6`, `80% · 4/5` and `Bread 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`
- **AND** the `fruit` row's changes read `Removed 1`, and the `none` row is labelled `Not read (added by staff)`

#### Scenario: Drink kind table
- **WHEN** `Drink kind` is picked, and the `drink_kind` table's `tea` row is `{ model: "tea", n: 4, kept: { n: 3, of: 4, pct: null }, corrections: [{ to: "coffee", n: 1 }] }`
- **THEN** the table has a row `Tea` reading `4`, `— · 3/4` and `Coffee 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`
- **AND** with no rows, it reads `No drink drafts in the last 7 days`

#### Scenario: Portion table
- **WHEN** `Dish portion` is picked, and `dish_portion` is over 5 pairs with `exact` `{ n: 2, of: 5, pct: 40 }`, `within_quarter` `{ n: 3, of: 5, pct: 60 }` and `quarters_off` `[2, 1, 1, 0, 1]`
- **THEN** the table reads `Same portion 2`, `1 quarter off 1`, `2 quarters off 1`, `3 quarters off 0` and `4 quarters off 1`
- **AND** above it, `Same 40% · 2/5 · within a quarter 60% · 3/5`

#### Scenario: Container table
- **WHEN** `Container` is picked, and the `urinal` row has 6 reads, 6 decided, accepted `{ n: 5, of: 6, pct: 83 }`, corrected `{ n: 1, of: 6, pct: 16 }`, rejected `{ n: 0, of: 6, pct: 0 }` and 6 of 6 volumes within tolerance
- **THEN** the table has a row `Urinal` reading `6`, `6`, `83% · 5/6`, `16% · 1/6`, `0% · 0/6` and `100% · 6/6`, under the headers `Container read`, `Reads`, `Decided`, `Accepted`, `Corrected`, `Rejected` and `Within ±25 mL`

#### Scenario: Empty tables
- **WHEN** the window has no tray reads and no urine drafts, and `Dish`, `Dish portion`, `Meal portion` and `Urine colour` are picked in turn
- **THEN** each keeps its header row, over one cell reading `No tray reads in the last 7 days` for the first three and `No urine colour drafts in the last 7 days` for the last

#### Scenario: Tray reads not yet reviewed
- **WHEN** the window's only tray reads are one never saved and one whose lunch's 150 mL entry is pending, and `Dish`, `Dish portion` and `Meal portion` are picked in turn
- **THEN** each keeps its header row, over one cell reading `No reviewed tray meals in the last 7 days`

### Requirement: Kept drafts, meal fluid and top corrections
The section SHALL read `Drafts kept <rate> · not kept <rate> (<r> rejected, <a> abandoned)`, with `, <t> retaken` before the `)` when above 0. When a tray read is in the window, it reads `Fluid with meals: ` and the meal fluid error as the volume line without its `with no volume read` part, then ` · <k> added by staff` and ` · <m> removed` when above 0. It reads `Most changed: ` and up to 5 corrections as `<From> → <To> <n>`, joined by ` · `, or `Most changed: none`. It makes no request.

#### Scenario: Kept drafts
- **WHEN** `positives` is kept `{ n: 46, of: 50, pct: 92 }`, not kept `{ n: 4, of: 50, pct: 8 }`, rejected 3, abandoned 1 and retaken 0
- **THEN** the section reads `Drafts kept 92% · 46/50 · not kept 8% · 4/50 (3 rejected, 1 abandoned)`

#### Scenario: Retaken drafts
- **WHEN** `positives` is kept `{ n: 46, of: 50, pct: 92 }`, not kept `{ n: 4, of: 50, pct: 8 }`, rejected 3, abandoned 1 and retaken 2
- **THEN** the section reads `Drafts kept 92% · 46/50 · not kept 8% · 4/50 (3 rejected, 1 abandoned, 2 retaken)`

#### Scenario: Fluid with meals
- **WHEN** `meal_fluid` is `{ volume: { of: 6, mae_ml: 20, within: { n: 5, of: 6, pct: 83 }, no_volume: 1 }, removed: 1 }`
- **THEN** the section reads `Fluid with meals: 20 mL mean error · within ±25 mL 83% · 5/6 · 1 added by staff · 1 removed`

#### Scenario: Most changed
- **WHEN** `top_corrections` is type `water` → `food` 3, urine colour `dark` → `red` 2, dish kind `rice` → `bread` 2, type `urine` → `stoma` 1 and urine colour `yellow` → `dark` 1
- **THEN** the section reads `Most changed: Drink → Food 3 · Urine dark → red 2 · Rice → Bread 2 · Urine → Stoma 1 · Urine yellow → dark 1`

#### Scenario: Nothing changed
- **WHEN** `top_corrections` is `[]` and no tray read is in the window
- **THEN** the section reads `Most changed: none`, and has no `Fluid with meals` line

### Requirement: Hospital model accuracy view
The nurse home SHALL offer `Wards | Model accuracy` under its census header. Model accuracy (`/n?view=model`) replaces the ward cards with the Model accuracy section for the whole hospital, subtitled `All wards · Last 7 days`, from one `GET /api/quality/model?days=7` sent when it opens. Wards (`/n`, the default) shows the cards and sends no quality request, and any other `view` reads as Wards. It makes no model request.

#### Scenario: Open the model view
- **WHEN** Anita Thomas opens `/n?view=model`
- **THEN** the requests are `GET /api/wards` and `GET /api/quality/model?days=7`, with no `ward` parameter, and no `/api/ai` request
- **AND** the page shows `Hospital census`, `Model accuracy` pressed, the section titled `Model accuracy` and subtitled `All wards · Last 7 days`, with its chart, picker and lines, and no ward card

#### Scenario: Back to wards
- **WHEN** on `/n?view=model`, `Wards` is tapped
- **THEN** the address is `/n`, the ward cards show, and no further `/api/quality/model` request is sent

#### Scenario: Unknown view
- **WHEN** `/n?view=x` is opened
- **THEN** it shows the ward cards with `Wards` pressed, and sends no `/api/quality/model` request

### Requirement: Dishes in the Nutrition section
Each meal in the Nutrition section SHALL list its `dishes` in order, as `<name> · <portion word>` beside the dish kind's label. A dish that a meal amendment changed, added or removed is marked with who did it and when, and a changed one with what it was. A meal whose tray photo is kept offers "Show tray": one `GET /api/media/<id>`, then the photo with the tray overlay. Nothing else is fetched, and it makes no model request.

#### Scenario: Lunch dishes
- **WHEN** a lunch has the dishes `{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }` and `{ index: 2, name: "dal", dish_kind: "dal_lentils", portion: 50 }`, and a breakfast by hand has none
- **THEN** the lunch lists `rice · All` labelled `Rice`, then `dal · Half` labelled `Dal / lentils`
- **AND** the breakfast lists no dishes, only its items as before

#### Scenario: Amended dishes
- **WHEN** a lunch was saved at 13:10 with the dishes `{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }`, `{ index: 2, name: "dal", dish_kind: "dal_lentils", portion: 100 }`, `{ index: 3, name: "papad", dish_kind: "snack", portion: 50 }` and `{ index: 4, name: "roti", dish_kind: "bread", portion: 75 }`
- **AND** at 14:10 Anita Thomas amended them to `{ index: 1, name: "jeera rice", dish_kind: "rice", portion: 100 }`, `{ index: 2, name: "dal", dish_kind: "dal_lentils", portion: 50 }`, `{ index: 4, name: "roti", dish_kind: "bread", portion: 75 }` and `{ index: 0, name: "curd", dish_kind: "dairy", portion: 100 }`
- **THEN** the dal reads `dal · Half` with `Amended 14:10 by Anita T. · was All`
- **AND** the rice reads `jeera rice · All` with `Amended 14:10 by Anita T. · was rice`
- **AND** the curd reads `curd · All` with `Added 14:10 by Anita T.`, and the papad is struck through with `Removed 14:10 by Anita T.`
- **AND** the roti reads `roti · Three quarters` with no mark

#### Scenario: Two dishes in one region
- **WHEN** a lunch was saved at 13:10 with the dishes `{ index: 1, name: "rice", dish_kind: "rice", portion: 50 }` and `{ index: 1, name: "dal", dish_kind: "dal_lentils", portion: 50 }`
- **AND** at 14:10 Anita Thomas amended them to `{ index: 1, name: "rice", dish_kind: "rice", portion: 50 }` and `{ index: 1, name: "sambar", dish_kind: "dal_lentils", portion: 50 }`
- **THEN** the rice reads `rice · Half` with no mark
- **AND** the sambar reads `sambar · Half` with `Amended 14:10 by Anita T. · was dal`, and no dish is marked added or removed

#### Scenario: Show tray
- **WHEN** the tray photo of the lunch in "Lunch dishes" is media 31, with segmentation regions 1 and 2, and "Show tray" is tapped, then hidden and shown again
- **THEN** exactly one request is sent, `GET /api/media/31`, and no `/api/ai` request
- **AND** the photo is drawn with the tray overlay, region 1 labelled `1 rice · All` and region 2 `2 dal · Half`

#### Scenario: No photo kept
- **WHEN** a lunch was voided, so its tray photo is deleted, and a breakfast was entered by hand
- **THEN** neither offers "Show tray"

### Requirement: Assign a dietitian from the bed review
In the Nutrition section, a nurse or matron whose `wards` include the bed's ward, and any dietitian, SHALL be offered "Assign dietitian…" ("Change…" once one is assigned) and, when one is assigned, "Hand back…". The dialog loads `GET /api/staff` once and lists the dietitians, those covering the ward first. Each action sends one request, then reloads the bed review. Others see the line without these actions. It makes no model request.

#### Scenario: Anita assigns Sana
- **WHEN** Anita Thomas (id 4, `wards` 3A, 5B) taps "Assign dietitian…" on 3A bed 6 (admission 11), picks Sana Mirza and taps "Assign"
- **THEN** the requests are, in order:
  1. `GET /api/staff`;
  2. `PUT /api/admissions/11/dietitian` with `{ staff_id: 11 }` and `X-Staff-Id: 4`;
  3. `GET /api/admissions/11/entries` and `GET /api/admissions/11/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Dietitians covering the ward first
- **WHEN** the roster has Sana Mirza (`wards` 2C, 3A, 5B, HDU) and Joel Mathew (`wards` 3A), and the dialog is opened for HDU bed 3
- **THEN** it lists `Sana Mirza · covers Renal HDU`, then `Joel Mathew`, and nobody who is not a dietitian
- **AND** "Assign" is disabled until one is picked

#### Scenario: Hand back
- **WHEN** 3A bed 6 is assigned to Sana Mirza, and Anita Thomas taps "Hand back…" and confirms `Hand back to the ward dietitians?`
- **THEN** the requests are `DELETE /api/admissions/11/dietitian`, then the reload
- **AND** when it answers 409 `no_dietitian`, the section shows `No dietitian covers Medical Ward 3A to take the referral.` and nothing more is sent

#### Scenario: Who is offered
- **WHEN** 3A bed 6 is opened by Ravi Kumar (attendant), Grace Lee (nurse, `wards` 5B, 3A), Lakshmi Iyer (matron) and Sana Mirza (dietitian), and HDU bed 3 by Grace Lee after giving a reason
- **THEN** Grace Lee, Lakshmi Iyer and Sana Mirza are offered "Assign dietitian…" on 3A bed 6, and Ravi Kumar is not
- **AND** Grace Lee is not offered it on HDU bed 3, and everyone sees the dietitian line

### Requirement: Diet order on the care plan
The care plan SHALL show an active diet order as `Diet · <type> · IDDSI <level> <name>`, followed by ` · <kcal> kcal` and ` · <protein> g protein` when set, and each diet History row as `Diet <type in lower case>, IDDSI <level>`, with the same targets, then its span and who set and ended it, as other History rows do. It sends no request beyond the bed review's own load.

#### Scenario: Renal diet
- **WHEN** the bed's `care.orders` holds the diet `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }`
- **THEN** its row reads `Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein`

#### Scenario: Soft diet
- **WHEN** the bed's diet is `{ type: "regular", texture: 6, kcal: null, protein_g: null }`
- **THEN** its row reads `Diet · Regular · IDDSI 6 Soft & bite-sized`

#### Scenario: History
- **WHEN** `care_history` holds a renal diet with 1800 kcal and 60 g protein at texture 6 from 11:00 today, active, set by Divya Kapoor, and the same at texture 7 from 10:00 to 11:00, set by Sana Mirza and ended by Divya Kapoor
- **THEN** the History rows read, in order:
  - `Diet renal, IDDSI 6, 1800 kcal, 60 g protein · 11:00–now · set by Divya K.`
  - `Diet renal, IDDSI 7, 1800 kcal, 60 g protein · 10:00–11:00 · set by Sana M. · ended by Divya K.`

### Requirement: Diet order from the bed review
A nurse, matron or dietitian SHALL be able to add, change or end the diet order from the care plan, picking a type and a texture (IDDSI 7 Regular by default). Only a dietitian may set or remove the energy (800–4000 kcal) and protein (20–200 g) targets; others see them read-only and send them back unchanged, and are offered "End…" only when no target is set. Each sends one request, then reloads. A dietitian gets no other care-plan control. It makes no model request.

#### Scenario: Sana sets a renal diet
- **WHEN** Sana Mirza (id 11) adds a diet on HDU bed 3 (admission 21), picks "Renal", keeps "IDDSI 7 Regular", sets 1800 kcal and 60 g protein, and saves
- **THEN** the requests are, in order:
  1. `PUT /api/admissions/21/care/diet` with `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }` and `X-Staff-Id: 11`;
  2. `GET /api/admissions/21/entries` and `GET /api/admissions/21/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Divya changes the texture
- **WHEN** HDU bed 3 has Sana Mirza's renal diet with 1800 kcal and 60 g protein, and Divya Kapoor (id 8) taps "Change…", picks "IDDSI 6 Soft & bite-sized" and saves
- **THEN** the form shows `1800 kcal · 60 g protein · set by a dietitian`, with no control to change them
- **AND** the request is `PUT /api/admissions/21/care/diet` with `{ type: "renal", texture: 6, kcal: 1800, protein_g: 60 }`, then the reload

#### Scenario: Form defaults
- **WHEN** the diet form is opened on a bed with no diet order
- **THEN** no type is picked and Save is disabled until one is, the texture is "IDDSI 7 Regular", and there is no target
- **AND** for a dietitian, "Add energy target" starts at 1800 kcal, stepping by 50 between 800 and 4000, and "Add protein target" at 60 g, stepping by 5 between 20 and 200, and either can be removed again
- **AND** with no target set, the body has only `type` and `texture`

#### Scenario: Ending
- **WHEN** Divya Kapoor opens HDU bed 3 with the targeted renal diet, Grace Lee opens 5B bed 6 with `{ type: "regular", texture: 6 }`, and Sana Mirza opens HDU bed 3
- **THEN** Divya Kapoor is offered no "End…", and the row reads `Only a dietitian can end a diet with targets.`
- **AND** Grace Lee's "End…" asks `End diet?` and sends `DELETE /api/admissions/<5B bed 6>/care/diet`, then the reload
- **AND** Sana Mirza is offered "End…"

#### Scenario: Dietitian's care plan
- **WHEN** Sana Mirza opens HDU bed 1, which has a catheter and no diet order
- **THEN** the care plan offers her only "Add diet": no other kind to add, no "Change…" or "End…" on the catheter, and no "Reviewed today"

#### Scenario: Targets changed meanwhile
- **WHEN** Divya Kapoor's save answers 403 `forbidden`, because a dietitian changed the targets after her form opened
- **THEN** the form shows `Only a dietitian can change energy and protein targets.`, and the bed review reloads

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens HDU bed 3
- **THEN** the diet row is listed, with no control to add, change or end it

### Requirement: Diet badges on bed cards
Each ward dashboard bed card SHALL show an active diet order as care badges, in the order of `care.orders`: `<type> diet`, left out for a regular diet with a texture below 7, then `Food IDDSI <level>` when the texture is below 7. They come from the beds' existing load, so the dashboard sends no extra request, and they make no model request.

#### Scenario: Renal and soft
- **WHEN** HDU bed 3 has `{ type: "renal", texture: 7, kcal: 1800, protein_g: 60 }` and a 1000 mL limit at 82%, 5B bed 6 has thickened fluids at level 2 and `{ type: "regular", texture: 6 }`, 2C bed 2 has `{ type: "regular", texture: 7 }`, and 3A bed 4 has `{ type: "low_salt", texture: 5 }`
- **THEN** HDU bed 3's badges read `Limit 1 L · 82%` then `Renal diet`
- **AND** 5B bed 6's read `IDDSI 2` then `Food IDDSI 6`
- **AND** 2C bed 2's read `Regular diet`, and 3A bed 4's `Low salt diet` then `Food IDDSI 5`

#### Scenario: No extra request
- **WHEN** Grace Lee opens the dashboard of ward 5B (id 3), whose beds have diet orders
- **THEN** exactly two requests are made: `GET /api/admissions?ward=3` and `GET /api/wards/3/team`

### Requirement: Output devices on the care plan
The bed review's care plan SHALL show each active stoma, drain and voiding order as a row, `Ileostomy · stoma bag`, `Chest drain` or `Commode for urine` (`· not measured` for toilet and pads), and let a nurse or matron add, change or end each with its own form, in one request then a reload. The forms offer each value, starting at none picked, Save disabled until one is, except voiding at `Urinal`. Attendants see the rows only. It makes no model request.

#### Scenario: Rows
- **WHEN** a bed's `care.orders` holds a catheter, a `{ type: "ileostomy" }` stoma, a `{ site: "chest" }` drain and a `{ method: "toilet" }` voiding order
- **THEN** after the catheter row the rows read, in order, `Ileostomy · stoma bag`, `Chest drain` and `Toilet for urine · not measured`
- **AND** the History rows read like `Ileostomy · 09:00–now · set by Meera P.`

#### Scenario: Add a commode order
- **WHEN** Anita Thomas (id 4) adds "Urine collection" on 3A bed 4 (admission 9), picks `Commode`, and saves
- **THEN** the requests are, in order, `PUT /api/admissions/9/care/voiding` with `{ method: "commode" }` and `X-Staff-Id: 4`, then `GET /api/admissions/9/entries` and `GET /api/admissions/9/meals`
- **AND** no `/api/ai` request is sent

#### Scenario: Form defaults
- **WHEN** the stoma, drain and urine collection forms are opened on a bed with no orders
- **THEN** the stoma form offers `Colostomy` and `Ileostomy` and the drain form `Abdominal`, `Chest`, `Pelvic` and `Wound`, each with none picked and Save disabled
- **AND** the urine collection form offers `Urinal`, `Bedpan`, `Commode`, `Toilet (not measured)` and `Pads (not measured)`, with `Urinal` picked

#### Scenario: End an order
- **WHEN** Meera Pillai ends 2C bed 2's drain and confirms `Drain removed?`
- **THEN** the requests are `DELETE /api/admissions/<id>/care/drain`, then the reload
- **AND** ending a stoma asks `End the stoma order?`, and ending urine collection `Back to the urinal default?`

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens the bed review of 2C bed 3, with its ileostomy
- **THEN** the row `Ileostomy · stoma bag` is shown, with no control to add, change or end it

### Requirement: Device badges on bed cards
Each ward dashboard bed card SHALL show, among its care badges in the order of `care.orders`, `Stoma` for a stoma order, `Drain` for a drain order, and for a voiding order its method: `Urinal`, `Bedpan`, `Commode`, `Toilet` or `Pads`. A bed on the default urinal shows no voiding badge. They come from the beds' existing load, so the dashboard sends no extra request.

#### Scenario: Every device
- **WHEN** a bed's `care.orders` holds a catheter on day 2, an ileostomy, an abdominal drain and a `{ method: "commode" }` voiding order
- **THEN** its card shows, in order, `Catheter day 2`, `Stoma`, `Drain` and `Commode`

#### Scenario: Default urinal
- **WHEN** a bed has no orders, so `devices.urine_from` is `default`
- **THEN** its card shows no care badge

#### Scenario: No extra request
- **WHEN** Meera Pillai opens the dashboard of ward 2C (id 1), whose beds have device orders
- **THEN** exactly two requests are made: `GET /api/admissions?ward=1` and `GET /api/wards/1/team`

#### Scenario: Urine not measured
- **WHEN** a bed's `care.orders` holds a `{ method: "toilet" }` voiding order and no catheter
- **THEN** its card shows the badge `Toilet`, and under the balance the note `Urine not measured`
- **AND** a bed on the default urinal shows no note

### Requirement: Urine rate not drawn when not measured
While urine is not measured (`devices.urine_measured` false), the bed review's urine output rate chart SHALL show `Urine not measured` instead of the plot, with no rate, reference line or caption, ahead of the weight check in "Urine output rate against the threshold". It makes no request.

#### Scenario: Urine not measured
- **WHEN** 3A bed 7 (60 kg, admitted 2 days ago) has a `{ method: "toilet" }` voiding order, no catheter and no urine in 24 h
- **THEN** the chart area reads `Urine not measured`, with no point, no 0.5 line and nothing marked below
- **AND** a bed on the default urinal with the same entries has its latest point at 0.00, marked below the line

### Requirement: Bag without a device on the bed review
The web app SHALL colour `bag_without_device` amber (`Review`), with the chip `Bag not on care plan`. On the bed review, for a nurse or matron, each such prompt offers "Add catheter", "Add stoma" or "Add drain" for its bag, opening that care-plan form; saving it sends one `PUT` and reloads the bed review. Attendants see the prompt without the action. None of it makes a model request.

#### Scenario: Colour
- **WHEN** one bed's only prompt is `bag_without_device`
- **THEN** its status chip reads `Review` on the ward dashboard and the bed review, and its prompt chip `Bag not on care plan`

#### Scenario: Add the catheter
- **WHEN** Anita Thomas (id 4) opens 3A bed 5 (admission 10), whose prompt is `Urine bag reading at 10:30, but no catheter is on the care plan. Review.`, taps "Add catheter", keeps the defaults and saves
- **THEN** the requests are `PUT /api/admissions/10/care/catheter` with `type: "urethral"` and `X-Staff-Id: 4`, then `GET /api/admissions/10/entries` and `GET /api/admissions/10/meals`
- **AND** after the reload the prompt is gone, and no `/api/ai` request was sent

#### Scenario: Drain
- **WHEN** a bed's prompts are `bag_without_device` for its stoma bag and for its drain bag
- **THEN** the first offers "Add stoma" and the second "Add drain"

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens 3A bed 5's bed review
- **THEN** the prompt is shown with no "Add catheter"

### Requirement: Drinks named on the bed review
Each entry with a `drink`, in the bed review's log, pending list and entry timeline, SHALL show the kind's icon and label in place of the category, as `<Kind> <mL>` (`Drink` for `other`), with its item after it when that differs from the label ignoring case. Entries without a `drink` show as now. The icon has the kind's label as its accessible name. It makes no request.

#### Scenario: Masala chai in the log
- **WHEN** the log lists an approved 150 mL entry with `drink: tea` and item `masala chai`, and a pending 200 mL entry with `drink: ors` and item `ORS`
- **THEN** the first reads `Tea 150 mL · masala chai` with the tea icon, and the second `ORS 200 mL` with no item after it

#### Scenario: Older drink
- **WHEN** the log lists a 200 mL water entry with `drink: null` and item `cup`
- **THEN** it reads as it does today, with the category label

### Requirement: Meal fluids with their kind
In "What the AI read" on the bed review's meals, each fluid SHALL show its kind's icon and read `<name> · <Kind> · <mL>`, or `<name> · <mL>` when the name is the kind's label ignoring case. It makes no request.

#### Scenario: Lunch with chaas and soup
- **WHEN** a lunch's read has fluids `chaas` (`buttermilk`, 200 mL) and `soup` (`soup`, 150 mL)
- **THEN** "What the AI read" lists `chaas · Buttermilk · 200 mL` and `soup · 150 mL`, each with its kind's icon

### Requirement: Correct a drink's kind
In entry details, Amend on an approved `water` or `food` entry SHALL offer "Drink" to a nurse or matron: a picker of the eleven kinds set to the entry's kind, or unset when it has none. A changed kind is sent as `drink` with the reason, in one request. The timeline shows the change as `drink <from> → <to>`, with `none` for no kind. It makes no model request.

#### Scenario: Tea to coffee
- **WHEN** Anita Thomas (id 4) opens Amend on an approved 150 mL drink with `drink: tea` and item `masala chai`, picks `Coffee` and gives the reason `it was coffee`
- **THEN** saving sends exactly one request, `POST /api/entries/<id>/amend` with `{ drink: "coffee", reason: "it was coffee" }` and `X-Staff-Id: 4`, and no `/api/ai` request
- **AND** after it, the log reads `Coffee 150 mL`, and the timeline line reads `Amended drink Tea → Coffee by Anita Thomas (nurse): it was coffee`, with its time

#### Scenario: Not a drink
- **WHEN** Amend is opened on an approved urine entry
- **THEN** it shows no "Drink" picker

### Requirement: Ward dashboard views
The ward dashboard SHALL offer `Beds | Data quality | QR cards`, Beds being `/n/w/<id>` (the default), Data quality `?view=quality` and QR cards `?view=qr`, and read any other `view` as Beds, with `Beds` pressed and the beds shown. Switching views makes no model request.

#### Scenario: Unknown view
- **WHEN** Anita Thomas opens `/n/w/2?view=x`
- **THEN** `Beds` is pressed and the beds are shown
- **AND** exactly two requests are made: `GET /api/admissions?ward=2` and `GET /api/wards/2/team`

#### Scenario: Data quality by address
- **WHEN** `/n/w/2?view=quality` is opened
- **THEN** `Data quality` is pressed and the Data quality view is shown

### Requirement: Entry peek
Every entry row on the bed review (log, pending list, timeline photo mark) SHALL have a peek holding its time, drink kind and icon (else category), volume, item (if not the kind's label), status, source, confidence chip, read mode, the AI's volume against the saved and approved volumes, who recorded and reviewed it and any amendment, from the loaded entry, and `Details`, which opens the entry details. A pending entry's peek also has `Reject…` and `Approve`. Opening it makes no model request.

#### Scenario: Corrected photo entry
- **WHEN** a urine bag entry, read 450 mL in `sam+spark` mode at 0.88, saved at 430 mL by Ravi Kumar at 10:42 and approved at 375 mL by Anita Thomas at 11:05, is peeked
- **THEN** the peek reads `10:42 · Urine 375 mL`, `Photo · 88%`, `SAM + Spark`, `AI read 450 mL · Saved 430 mL · Approved 375 mL`, `Recorded 10:42 by Ravi K.` and `Approved 11:05 by Anita T.`

#### Scenario: Voice entry
- **WHEN** a voice entry with the fictional transcript `Drank 200 mL of tea` is peeked
- **THEN** the peek quotes `“Drank 200 mL of tea”`, no audio is fetched, and `Details` opens its player

#### Scenario: Drink kind in the head
- **WHEN** a 150 mL photo entry recorded at 10:42 with `drink: tea` and item `masala chai` is peeked
- **THEN** its head reads `10:42 · Tea 150 mL` with the tea icon, then `masala chai`
- **AND** a 200 mL entry with `drink: ors` and item `ORS` reads `ORS 200 mL` with no item after it

### Requirement: Region quantities on the labeled photo
Wherever a container photo's segmentation overlay is drawn, live or into a labeled copy, the container region SHALL be labelled with its container name and the liquid region `<Liquid or drink kind> · <fill %> full ≈ <fluid_volume_ml> mL`, or without ` ≈ … mL` when `fluid_volume_ml` is null or absent. A labeled copy keeps the labels as drawn at capture; the live overlay is drawn from the stored masks with no request.

#### Scenario: Urine bag with a volume
- **WHEN** the check screen shows a urine bag read with fill fraction 0.463 and `fluid_volume_ml: 930`
- **THEN** the container region is labelled `Urine bag` and the liquid region `Liquid · 46% full ≈ 930 mL`
- **AND** the labeled copy saved with it, shown in the entry's peek, has the same two labels drawn in

#### Scenario: No capacity
- **WHEN** an entry's photo evidence has fill fraction 0.46 and `fluid_volume_ml: null`
- **THEN** the liquid region is labelled `Liquid · 46% full`, with no mL

#### Scenario: Spark-only read
- **WHEN** an entry read in `spark` mode, with `segmentation: null`, is peeked
- **THEN** it shows the raw photo with no region labels under `No labeled copy · Spark-only read, no regions`, and no request beyond the photo's own `GET /api/media/<id>` is made

### Requirement: Entry peek fetches its photo on open
An entry peek for an entry with a photo SHALL fetch the view shown with exactly one `GET /api/media/<id>` (the labeled copy's id when there is one, else the photo's: the entry's or a level drop's `levels.after`) the first time it opens, reuse it on later opens while cached (24 most recent) and in the entry details, and cancel it when closed before it arrives. Lists never prefetch photos, and opening a peek makes 0 model requests.

#### Scenario: First and second open
- **WHEN** the peek of a photo entry with media 41 and no labeled copy is opened, closed and opened again, then its `Details` is opened
- **THEN** exactly one `GET /api/media/41` was made and no `/api/ai` request

#### Scenario: Labeled copy first
- **WHEN** the peek of a photo entry with media 41 and labeled copy 42 is opened, and then `Raw` is picked
- **THEN** `GET /api/media/42` was made on opening, and `GET /api/media/41` only when `Raw` was picked

#### Scenario: Closed early
- **WHEN** the peek is closed before media 41 arrives and opened again later
- **THEN** the first request was aborted and one more `GET /api/media/41` was made

#### Scenario: No photo
- **WHEN** a typed-note entry's peek opens
- **THEN** no media request is made

### Requirement: Read drawn on the peek photo
An entry peek's photo of a container SHALL show the segmentation overlay, or the labeled copy when one was kept, and, beside it, a scale from 0 to the container's capacity marking the AI's volume, the saved volume and, when approved, the approved volume, each labelled, so a correction is seen against the photo. `Raw` hides the overlay, not the scale. Without a reading or capacity there is no scale.

#### Scenario: Corrected bag
- **WHEN** the urine bag entry read 450 mL of 2000 mL, saved 430 mL and approved 375 mL is peeked
- **THEN** the scale runs 0 to 2000 mL with marks labelled `AI read 450`, `Saved 430` and `Approved 375`

#### Scenario: Spark only
- **WHEN** an entry read in `spark` mode with no segmentation is peeked
- **THEN** its photo has no overlay, and the scale still marks the AI's volume

#### Scenario: Corrected bag with its copy
- **WHEN** that urine bag entry has a labeled copy, and `Raw` is picked in its peek
- **THEN** `Labeled` showed the copy beside the scale, and `Raw` shows the bare photo with the same three marks on the scale

### Requirement: Segments revealed on first open
The first time a segmented photo's live overlay is shown, on the check screen or in a peek of an entry with no labeled copy, it SHALL be revealed once in 480 ms: the area outside the container dims, the container contour traces, then the liquid or dish contours 80 ms apart, then the labels. A labeled copy, later opens, other screens and reduced motion show the final state at once.

#### Scenario: Peek opened twice
- **WHEN** a nurse opens the 10:42 urine bag entry's peek, closes it and opens it again
- **THEN** the contours trace on the first open only

#### Scenario: Peek with a labeled copy
- **WHEN** a nurse opens the peek of an entry whose labeled copy was kept
- **THEN** the copy is shown at once, with no trace

### Requirement: Dense entry rows
Every entry row in the bed review's log and pending list SHALL be one line at least 44 px tall: time, a direction glyph with the drink kind (else category) and volume, the source and confidence chip, the status chip, and who recorded it, with notes, evidence and photos left to its peek. Rejected and voided entries are struck through and say so in words.

#### Scenario: One line
- **WHEN** the log lists an approved 200 mL entry with `drink: water` by Ravi Kumar at 14:05 at 1280 px
- **THEN** its row is one line under 56 px tall reading `14:05`, `▲ Water 200 mL`, `By hand`, `Approved` and `Ravi K.`, with no thumbnail

#### Scenario: Rejected
- **WHEN** a rejected 100 mL entry with `drink: tea` is listed
- **THEN** it reads `▲ Tea 100 mL`, its volume is struck through and its status reads `Rejected`

#### Scenario: Drink kind
- **WHEN** a pending 150 mL entry with `drink: tea` and item `masala chai`, and an approved 200 mL `water` entry with `drink: null`, are listed
- **THEN** the first reads `▲ Tea 150 mL` with the tea icon and `masala chai`, and the second `▲ Drink 200 mL`

### Requirement: Shift totals drawn in the log
Each shift heading in the entry log SHALL draw its approved intake and output as two bars on one scale for the whole log, with the totals and pending count in text beside them.

#### Scenario: Two shifts
- **WHEN** the day shift has 200 mL in and 300 mL out, and the night shift 0 in, 0 out and 1 pending, the largest total in the log being 300 mL
- **THEN** the day heading's output bar is full width, its intake bar two thirds of it, it reads `In 200 mL · Out 300 mL`, and the night heading reads `In 0 mL · Out 0 mL · 1 pending`

### Requirement: Balance timeline hover
Pointing at, tapping or arrowing along the bed review's fluid balance chart SHALL show a readout for that hour: its approved intake and output, its pending volume, the cumulative balance at its end and the entries in it, each by its drink kind (else category) and opening its entry peek. Left and Right move an hour when the chart has focus, and Escape hides the readout.

#### Scenario: Hour readout
- **WHEN** a nurse points at 14:00–15:00, which holds an approved 200 mL entry with `drink: water` and a pending 100 mL one with `drink: tea`, with the balance at +600 mL by 15:00
- **THEN** the readout reads `14:00–15:00`, `In 200 mL`, `Out 0 mL`, `Pending 100 mL` and `Balance +600 mL`, and lists `Water 200 mL` and `Tea 100 mL`, each with its icon

#### Scenario: Keyboard
- **WHEN** the chart has focus at 14:00 and Right is pressed
- **THEN** the readout moves to 15:00–16:00

### Requirement: Balance timeline text equivalent
The fluid balance chart SHALL have an accessible name stating the 24-hour intake, output and balance against any fluid limit, ending `, urine not measured` while urine is not measured (`devices.urine_measured` false), and a `Table` toggle listing each hour's approved intake, output, pending volume and running balance, in the same numbers.

#### Scenario: Name
- **WHEN** a bed has 1400 mL in, 900 mL out and a 1500 mL fluid limit
- **THEN** the chart's name reads `Fluid balance, last 24 hours: in 1400 mL, out 900 mL, balance +500 mL, limit 1500 mL, 93% used`
- **AND** for 3A bed 7, on a `{ method: "toilet" }` voiding order with no catheter, 2400 mL in and 0 mL out, it reads `Fluid balance, last 24 hours: in 2400 mL, out 0 mL, balance +2400 mL, urine not measured`

#### Scenario: Table
- **WHEN** the `Table` toggle is on
- **THEN** a table of 24 rows, one per hour, newest last, replaces the chart with the hourly values

### Requirement: Care orders on the timeline
When a bed has a fluid limit or intake target, the fluid balance chart SHALL draw the intake counted since the chart day began (08:00) as a dashed line against it: a limit as a band from 80% to 100% of the limit and a rule at the limit, a target as a rule at the target with a mark at each check time. Review prompts are marked on an alert lane above the lines at the hour they apply to.

#### Scenario: Limit
- **WHEN** a bed has a 1500 mL limit and 1230 mL counted since 08:00
- **THEN** the chart draws the band from 1200 to 1500 mL, the rule at 1500 mL labelled `Limit 1500 mL`, and the counted line ending at 1230 mL inside the band

#### Scenario: Target checks
- **WHEN** a bed has a 1600 mL intake target
- **THEN** the chart draws the rule at 1600 mL and marks at 14:00 (800 mL) and 20:00 (1200 mL)

### Requirement: Approval shown on the timeline
Pending entries SHALL be drawn on the hourly bars as outlined segments that move no line, and when an entry is approved on the bed review the chart redraws from the approved list: its segment fills and the lines step to include it, animated in 480 ms unless reduced motion is on.

#### Scenario: Approve a drink
- **WHEN** a pending 200 mL water at 14:05 is approved at 200 mL
- **THEN** its 14:00 segment changes from outlined to filled and the intake line steps up by 200 mL at 14:05

### Requirement: Bed tile encodings
Each bed on the ward dashboard SHALL be one tile or row showing: an edge and status chip in the bed's worst prompt tone; the bed badge; the acuity mark with its word; the 24-hour bars; the 24-hour balance against any limit, followed by `Urine not measured` while urine is not measured; a gauge per bag from `bag_levels` with its fill percent and `Due` or `Overdue`; the pending count; and the referral chip. It is a link to the bed, from the beds' existing load.

#### Scenario: Busy bed
- **WHEN** at 22:05, bed 4 of 3A is `watch`, has `low_urine_output`, 2 pending entries, a urine bag at 1680 of 2000 mL due at 22:20, and a +600 mL balance with no limit
- **THEN** its tile has the danger edge and `Review now`, the `Watch` mark, `+600 mL`, a bag gauge reading `84%` and `Due`, and `◷ 2`
- **AND** at 22:21 the same gauge reads `Overdue`

#### Scenario: Urine not measured on the tile
- **WHEN** 3A bed 7 has a `{ method: "toilet" }` voiding order, no catheter and a +2400 mL balance
- **THEN** its tile reads `+2400 mL` followed by `Urine not measured`

#### Scenario: No extra request
- **WHEN** Grace Lee opens the dashboard of ward 5B (id 3)
- **THEN** exactly two requests are made: `GET /api/admissions?ward=3` and `GET /api/wards/3/team`

### Requirement: Bed peek on the ward dashboard
Each bed tile SHALL have a peek, opened from its own 44 px button, holding the bed's prompts in words, its in, out and balance against any limit (with `Urine not measured` while urine is not measured), each bag's level against capacity with when it is due, its care orders and its pending count, from the beds' existing load, with links to the bed and its waiting list. It sends no request.

#### Scenario: Peek
- **WHEN** a nurse opens bed 4's peek
- **THEN** it lists `Low urine output: review`, `In 1400 mL · Out 800 mL · Balance +600 mL`, `Urine bag 1680/2000 mL · due 22:20`, and `2 waiting for approval`
- **AND** no request is made
- **AND** on 3A bed 7, whose urine is not measured, the balance line reads `In 2400 mL · Out 0 mL · Balance +2400 mL · Urine not measured`

### Requirement: Ward board on wide screens
From 1100 px wide, the ward dashboard SHALL show beds as a board of one row per bed with aligned columns (bed, acuity, status, last 24 hours, balance, bags, pending, care), in "Beds needing attention first" order, with each column's header naming it; narrower, as tiles of the same content.

#### Scenario: Board
- **WHEN** Anita Thomas opens `/n/w/2` at 1280 px with 7 beds
- **THEN** 7 rows are shown under the headers `Bed`, `Acuity`, `Status`, `Last 24 h`, `Balance`, `Bags`, `Pending` and `Care`

#### Scenario: Phone
- **WHEN** the same ward opens at 390 px
- **THEN** 7 tiles are shown, one per row, and the page does not scroll sideways

### Requirement: Metric peeks on stats
Each figure in the ward head, the bed review's banner (in, out, balance, pending) and the Data quality tiles SHALL open a peek breaking it down, from data already loaded: by bed for a ward figure, by category and source for a bed's in and out, drinks by drink kind, by hour for the balance, by recorder for a quality tile. It sends no request.

#### Scenario: Bed intake
- **WHEN** a nurse opens the `In 1250 mL` peek on `/n/10`, whose approved intake is drinks with `drink: tea` 200 and 150 mL, `drink: water` 400 mL and `drink: null` 100 mL, and 400 mL IV
- **THEN** the peek lists `Water 400 mL`, `Tea 350 mL` and `Drink 100 mL`, largest first and each with its icon, then `IV 400 mL`, each with its share bar, and no request is made

#### Scenario: Ward pending
- **WHEN** a nurse opens the ward head's `8 pending` peek
- **THEN** it lists each bed with pending entries and its count, each linking to the bed

### Requirement: Ward cards drawn
Each ward on the nurse home `/n` SHALL show its last 24 hours as mirrored hourly bars from the ward summary's `hourly`, beside its occupied beds of capacity, pending count and beds to review, from the single `GET /api/wards`.

#### Scenario: 3A
- **WHEN** 3A has 6 of 6 beds occupied, 3 pending and 2 beds to review
- **THEN** its row reads `6/6 beds`, `3 pending` and `2 to review` beside its 24 bars, and only `GET /api/wards` was requested

### Requirement: Next up on the ward dashboard
The ward dashboard SHALL open with Next up: at most 5 actions (3 below 1100 px, then `<n> more next up`), one per bed and action in its highest group, ranked: overdue bag readings and red prompts; amber prompts and bags due within 30 min or past; intake target checks due within 60 min and behind; pending entries, most first; blue prompts. Ties: due time (undated last), acuity, bed. Items name the bed, action and when and link to the bed; the head counts them by action. It sends no request.

#### Scenario: Ranked
- **WHEN** on a ward of stable beds, bed 6 has `bag_reading_overdue` and its bag's `due_at` is past, bed 4 `low_urine_output`, bed 2 a bag due in 12 min, and bed 1 3 pending entries
- **THEN** Next up lists 4 items: bed 6 `Bag reading` (once, in the first group), bed 4 `Low output`, bed 2 `Bag reading`, then bed 1 `Approve 3 entries`

#### Scenario: Nothing due
- **WHEN** no bed has a prompt, a due bag or a pending entry
- **THEN** Next up reads `Nothing due. 0 waiting for approval.`

#### Scenario: Phone
- **WHEN** 5 items are due at 390 px
- **THEN** 3 are shown, then `2 more next up`, and at 1280 px all 5 are shown

### Requirement: Next up on the nurse home
The nurse home `/n` SHALL open with a Next up list of the staff member's wards that have beds to review or pending entries, wards with beds to review first, then by pending count, each reading `<code> · <n> to review · <n> pending` and linking to its dashboard, from the single `GET /api/wards`.

#### Scenario: Two wards
- **WHEN** 3A has 2 beds to review and 8 pending, and 5B 0 to review and 3 pending
- **THEN** Next up lists `3A · 2 to review · 8 pending`, then `5B · 0 to review · 3 pending`

### Requirement: Raw and labeled views of a kept photo
Where a kept photo is shown (entry peek, entry details, jug before and after photos, tray proof, a bag reading's photo viewer), the app SHALL offer `Labeled | Raw`, Labeled first: the labeled copy, else the live overlay captioned `Labeled copy not kept · drawn from the read`, else the photo under `No labeled copy · Spark-only read, no regions`. Raw shows the photo alone. Each view fetches its media once when first shown, with 0 model requests; the photo strip shows copies.

#### Scenario: Copy shown first
- **WHEN** a peek opens for an entry with media 41 and labeled copy 42, whose `sha256` begins `7c1e` and ends `d4`
- **THEN** `Labeled` is pressed, the copy is shown, `Labeled copy fingerprint: 7c1e…d4` is shown under it, and exactly one request, `GET /api/media/42`, was made

#### Scenario: Raw picked
- **WHEN** `Raw` is then picked, and then `Labeled` again
- **THEN** one `GET /api/media/41` was made in all, the raw photo has no outline or label, and the copy is not fetched again

#### Scenario: Copy not kept
- **WHEN** a segmented entry with `labeled_media: null` is peeked
- **THEN** `Labeled` shows the raw photo with the live overlay and `Labeled copy not kept · drawn from the read`, after one `GET /api/media/<photo>`

#### Scenario: Spark-only read
- **WHEN** an entry read in `spark` mode is peeked
- **THEN** `Labeled` shows the raw photo under `No labeled copy · Spark-only read, no regions`, and no other media is requested

#### Scenario: Tray proof
- **WHEN** a lunch's tray proof is opened, its meal having `labeled_media.id: 43`
- **THEN** `Labeled` is pressed and `GET /api/media/43` is the only request

#### Scenario: Bag reading photo
- **WHEN** on the bed review a 08:00 emptying has media 70 and labeled copy 72, and its `Before emptying` tile, a camera icon with that label, is tapped
- **THEN** the viewer opens with `Labeled` pressed on copy 72 and `Labeled copy fingerprint: …`, after one `GET /api/media/72`; nothing was fetched before the tap

### Requirement: Photos on the printed chart
`/n/<id>/print` SHALL follow the hourly table with `Photos`: the photo entries and photo meals of the same 24 hours, newest first, at most 12, each with its time, what was charted and its labeled copy, else its raw photo under `No labeled copy`. Each is fetched once with `GET /api/media/<id>`, and printing waits until they have loaded or failed. It makes no model request. With no photos the section is not shown.

#### Scenario: Two photos
- **WHEN** at 14:30 the bed has a 09:10 urine bag entry of 380 mL with labeled copy 42 and a 12:40 lunch with labeled copy 45
- **THEN** `Photos` lists `12:40 · Lunch` with copy 45, then `09:10 · Urine 380 mL` with copy 42
- **AND** exactly two media requests were made, `GET /api/media/45` and `GET /api/media/42`, and no `/api/ai` request

#### Scenario: Spark-only photo
- **WHEN** a 10:00 cup entry read in `spark` mode, with raw photo 46 and no copy, is in those 24 hours
- **THEN** it is listed with photo 46 under `No labeled copy`

#### Scenario: No photos
- **WHEN** the bed's only entries in those 24 hours are typed notes
- **THEN** no `Photos` section is shown and no media request is made
