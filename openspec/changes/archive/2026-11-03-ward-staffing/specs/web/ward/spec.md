# Spec Delta

## MODIFIED Requirements

### Requirement: Hospital ward list
The nurse home (`/n`) SHALL list every ward as a card, in code order unless "Your wards first" applies. Each card shows the ward name, `<occupied>/<capacity> beds`, the pending count ("All reviewed" when 0), the beds with prompts ("<n> to review", omitted when 0), the last activity, and `In charge: <short name>` or `No nurse in charge`. Last activity is relative: "just now" under a minute, "<n> min ago" under an hour, "<n> h ago" otherwise, or "No entries today".

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

### Requirement: Resolve from the bed review
The bed review SHALL let a nurse:
- amend an approved entry's volume or type, with a reason of at least 3 characters;
- reject a pending entry with a reason chosen from the list;
- add a missed entry with the time it happened, saved and then approved in their name.

An attendant on shift saves a missed entry without approving it. The `intake_incomplete` and `logging_gap` prompts SHALL offer "Add missed entry". None of these makes a model request.

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
- **WHEN** a bed has `logging_gap`, `intake_incomplete` and `low_urine_output` prompts
- **THEN** "Add missed entry" is offered on the first two and not on `low_urine_output`

#### Scenario: Amend needs a reason
- **WHEN** a nurse sets an approved 400 mL entry to 380 mL
- **THEN** saving stays disabled until the reason has at least 3 characters
- **AND** the request body is then `{ volume_ml: 380, reason: "<the reason>" }`

## ADDED Requirements

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
When an attendant is signed in, the bed review, entry details and meals SHALL hide Approve, Reject, Amend, the high-confidence batch approval and meal "Void…", and the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.` instead. Nurses and matrons see the buttons as before.

#### Scenario: Attendant on the bed review
- **WHEN** Ravi Kumar (attendant) is signed in and opens a bed with 2 pending entries and a meal
- **THEN** no approve, reject, amend, batch or void button is shown
- **AND** the review section reads `Only a nurse can approve or change entries. Ask the nurse in charge.`

#### Scenario: Nurse or matron
- **WHEN** Anita Thomas (nurse) or Lakshmi Iyer (matron) is signed in
- **THEN** Approve and Reject are shown for each pending entry, and "Void…" for each meal not voided

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
