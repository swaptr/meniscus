# Spec Delta

## MODIFIED Requirements

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

### Requirement: Bag prompt colours
The web app SHALL colour bag prompts like the others, so a bed's status follows its worst prompt: red (`Review now`) for `bag_reading_overdue`, and amber (`Review`) for `bag_reading_due`, `bag_level_fell` and `bag_nearly_full`. Their chips read `Bag reading overdue`, `Bag reading due`, `Bag level fell` and `Bag nearly full`. Entries in the `entry_ids` of `bag_level_fell` are badged `Bag level fell`.

#### Scenario: Worst prompt wins
- **WHEN** one bed's only prompt is `bag_reading_due`, a second has `bag_reading_overdue`, a third has `catheter_review` and `bag_level_fell`, and a fourth has only `bag_nearly_full`
- **THEN** their status chips read `Review`, `Review now`, `Review` and `Review`, on the ward dashboard and on the bed review alike
- **AND** the fourth bed's prompt chip reads `Bag nearly full`

#### Scenario: Flagged entry
- **WHEN** a pending 150 mL urine entry is in the `entry_ids` of `bag_level_fell`, and Anita Thomas opens the bed
- **THEN** its pending card shows `Bag level fell`, with Approve and Reject

## ADDED Requirements

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
