# Spec Delta

## ADDED Requirements

### Requirement: Bag periods on the bed review
The bed review SHALL show a "Bags" section from `bags`, each bag's newest period first. A period has a header such as `08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h`, then each reading's time, event, level and rise, its photo and after-emptying photo, who saved it, `Late` and any fall. It sends no request beyond the bed review's own load, and is not shown for a bed with no bag reading.

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
The web app SHALL colour bag prompts like the others, so a bed's status follows its worst prompt: red (`Review now`) for `bag_reading_overdue`, and amber (`Review`) for `bag_reading_due` and `bag_level_fell`. Their chips read `Bag reading overdue`, `Bag reading due` and `Bag level fell`. Entries in the `entry_ids` of `bag_level_fell` are badged `Bag level fell`.

#### Scenario: Worst prompt wins
- **WHEN** one bed's only prompt is `bag_reading_due`, a second has `bag_reading_overdue`, and a third has `catheter_review` and `bag_level_fell`
- **THEN** their status chips read `Review`, `Review now` and `Review`, on the ward dashboard and on the bed review alike

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
