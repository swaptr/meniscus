# Spec Delta

## MODIFIED Requirements

### Requirement: Read log holds no text
A stored read SHALL hold only closed-list values (read kind, mode, model ids, container, fluid and meal fluid kinds, entry type, urine colour, dish kind, portion basis, issue codes), numbers, booleans, ids and times. It never holds a transcript, note text, image, image hash, reading basis, appearance, dish or fluid name, mask, box, draft item or notes, or model reply. Nothing about a read is logged beyond the existing model-API lines (path, model, status, timing). This adds no model request.

#### Scenario: Voice note
- **WHEN** a voice note is transcribed as `bed 4 had rice and a coconut water, 200 mL`, and the model drafts item `coconut water`, notes `half the glass, with rice`, `water` 200 mL
- **THEN** no column of the stored read contains `rice`, `coconut`, `bed 4` or `half the glass`
- **AND** no line the server logged contains them
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: Photo read
- **WHEN** a photo read returns reading basis `between the 400 and 500 marks` and appearance `pale yellow, clear`
- **THEN** no column of the stored read contains `between the 400 and 500 marks` or `pale yellow, clear`
- **AND** every string in its stored output is a value of `READ_KINDS`, `CONTAINER_KINDS`, `FLUID_KINDS`, the entry types, `URINE_COLOURS` or `READING_ISSUES`

#### Scenario: Tray read
- **WHEN** a tray photo is read in `sam+spark` mode, and the model names `paneer tikka` (dish kind `curry_vegetables`, region 1, half eaten) and `masala chai` (fluid kind `tea`, 150 mL), with notes `left the roti`
- **THEN** no column of the stored read contains `paneer`, `masala`, `roti`, the read's `image_sha256`, a region box or a mask's bits
- **AND** every string in its stored output is a value of `READ_KINDS`, `DISH_KINDS`, `MEAL_FLUID_KINDS`, `PORTION_BASES` or `MEAL_ISSUES`, and no line the server logged contains `paneer` or `masala`
- **AND** the upstream received exactly 3 requests: two SAM and one Spark

### Requirement: Negative reads
A read SHALL be negative when an issue code is in `NEGATIVE_ISSUES` (`no_container`, `not_a_meal`). A negative read with no draft is `negative_confirmed` at once; its unsaved draft is `open` for 12 h, then `negative_confirmed`; a linked draft is `negative_overridden` while its record stands, and `negative_confirmed` once rejected or voided. Overrides count by type saved, `meal` for a meal. Any other read with no draft is `nothing_drafted`, counted apart from negatives. It makes 0 model requests.

#### Scenario: No container, confirmed
- **WHEN** a photo read returns container `none`, fluid `none`, no volume and the issue `no_container`, so it has no draft
- **THEN** the summary shows it at once as `negative_confirmed` 1

#### Scenario: No container, overridden
- **WHEN** a photo read returns container `none`, fluid `water`, no volume and the issue `no_container`, and the attendant saves its draft as 200 mL water linked to it
- **THEN** the summary shows `negative_overridden` 1, `negative_confirmed` 0, and overrides saved as `water` 1

#### Scenario: Unsaved negative draft
- **WHEN** at 08:00 a photo read returns container `none`, fluid `water`, no volume and the issue `no_container`, and its draft is not saved
- **THEN** at 19:59 the summary shows `open` 1, `negative_confirmed` 0 and `negative_overridden` 0
- **AND** at 20:00 it shows `open` 0 and `negative_confirmed` 1

#### Scenario: Nothing drafted
- **WHEN** a photo read returns container `other`, fluid `other`, 150 mL and no issues, so it has no draft, and a text note gets a reply and no `log_entry` call
- **THEN** the `photo` row and the `text` row each show `nothing_drafted` 1 and `negative_confirmed` 0
- **AND** the negatives show `nothing_drafted` 2, and confirmed and overridden over 0 reads

#### Scenario: Not a meal, confirmed
- **WHEN** a tray read in `spark` mode returns no dishes, no fluid and the issue `not_a_meal`, so it has no draft
- **THEN** the `tray` `spark` row shows `negative_confirmed` 1 at once, and the negatives show confirmed 1 of 1 read
- **AND** the upstream received exactly 1 request for the read

#### Scenario: Not a meal, charted anyway
- **WHEN** a tray read returns rice (half eaten) with the issue `not_a_meal`, and the attendant saves the lunch linked to it, and later a nurse voids a second such lunch with reason `not a meal`
- **THEN** the first counts as `negative_overridden` with overrides saved as `meal` 1
- **AND** the second counts as `negative_confirmed`

#### Scenario: Tray with nothing drafted
- **WHEN** a tray read returns no dishes, no fluid and only the issue `tray_empty_unclear`
- **THEN** the `tray` row shows `nothing_drafted` 1 and `negative_confirmed` 0

### Requirement: Unsaved drafts
A draft with no link that is not `retaken` ("Retaken tray reads") SHALL be `open` while its read is less than `READ_ABANDON_HOURS` (12 h) old, the draft of a negative read included. From then on it is `abandoned`, or `negative_confirmed` for a negative read. Open drafts count in no rate and in no negative count. This makes 0 model requests.

#### Scenario: Never saved
- **WHEN** a photo read at 08:00 drafts 450 mL urine and nothing is saved
- **THEN** at 19:59 the summary shows `open` 1 and `abandoned` 0
- **AND** at 20:00 it shows `open` 0 and `abandoned` 1

#### Scenario: One draft of two saved
- **WHEN** a voice read at 08:00 drafts 200 mL tea and 300 mL urine, and only the tea is saved and approved unchanged
- **THEN** at 20:00 the `voice` row shows `accepted` 1 and `abandoned` 1

### Requirement: Model accuracy summary
`GET /api/quality/model` SHALL summarise the drafts of reads made in the last `days` (1 to `QUALITY_MAX_DAYS`, default 7) for the ward `ward=<id>`, or else the whole hospital: each read kind and mode with its outcome rates, the type, urine colour and dish kind tables, the container rows, meal and dish portion agreement, meal fluid, the volume error, the negatives, the positive drafts not kept, the top corrections and the reads with nothing drafted. It makes 0 model requests and needs no session.

#### Scenario: Window and errors
- **WHEN** it is requested with `days` 0, 31 and `x`, and with `ward=999`
- **THEN** the first three are 400 with `error: invalid_request`, and the last is 404 with `error: not_found`
- **AND** without `days`, the response has `days: 7` and `since` 7 days before now

#### Scenario: No session
- **WHEN** `GET /api/quality/model?ward=2` is sent with the device token and no session
- **THEN** the response is 200, and the upstream received no request

#### Scenario: Ward and hospital
- **WHEN** one read is linked from a 3A bed and one from a 5B bed
- **THEN** `?ward=2` (3A) counts the first only, and the request without `ward` counts both

#### Scenario: Kinds always listed
- **WHEN** the window holds only text reads
- **THEN** `kinds` still lists, in order, `photo` `sam+spark`, `photo` `spark`, `text`, `voice`, `tray` `sam+spark` and `tray` `spark`, the others with 0 drafts
- **AND** `containers` and `top_corrections` are `[]`, `dish_portion.of` and `meal_portion.of` are 0, and `meal_fluid.volume.of` is 0

#### Scenario: No names
- **WHEN** Ravi Kumar and Anita Thomas read and save drafts for 3A beds 1 and 2, including a tray lunch whose read names the dish `paneer tikka` (`curry_vegetables`), and the 3A summary is requested
- **THEN** the body has no `bed`, `patient` or `mrn` field, and contains neither staff name nor either patient's name
- **AND** the body does not contain `paneer`

#### Scenario: Rates per outcome
- **WHEN** the 3A `photo` `sam+spark` drafts end 20 accepted, 2 edited at capture, 3 corrected by a nurse and 1 rejected
- **THEN** that `kinds` row has accepted `{ n: 20, of: 26, pct: 76 }`, edited_at_capture `{ n: 2, of: 26, pct: 7 }`, corrected_by_nurse `{ n: 3, of: 26, pct: 11 }`, corrected `{ n: 5, of: 26, pct: 19 }` and rejected `{ n: 1, of: 26, pct: 3 }`

### Requirement: Tray eval report
The tray eval report SHALL pair read and true dishes by `dish_kind`, then in order, never by name. Per mode it gives a dish kind table by true kind, dish portions in quarters by `basis`, meal portion in quarters, fluid kinds and mL within `VOLUME_TOLERANCE_ML`, and expected outcomes against drafted, flagged or refused. Fluid `none` is no fluid, a portion outside `PORTIONS` or null mL is unscored, unknown kinds are `other`, and rates follow "Small numbers withheld". It makes no model request.

#### Scenario: Dishes paired by kind
- **WHEN** a tray labelled rice (`rice`, 0) and dal (`dal_lentils`, 0) is read as `dal_lentils` 0 named `sambar` and `rice` 25
- **THEN** its pairs are `rice`/`rice`, 1 quarter apart, and `dal_lentils`/`dal_lentils`, 0 quarters apart

#### Scenario: Portions by basis
- **WHEN** a compared read returns rice 50 with `basis: measured` and `curry_vegetables` 25 with `basis: model`, and its labels are rice 50 and `curry_vegetables` 0
- **THEN** the `measured` row reads exact `— · 1/1` and the `model` row reads exact `— · 0/1`, within one quarter `— · 1/1`

#### Scenario: Unscored values
- **WHEN** a tray record has a dish with `portion_eaten_pct: null` and a fluid of kind `none` with `volume_ml_estimate: 200`
- **THEN** that dish counts in the dish kind table and in no portion pair, and the tray has no fluid truth
- **AND** for a tray record whose only fluid is `soup` with `volume_ml_estimate: null`, read as soup 150 mL, the soup counts in the fluid kind table and in no mL pair

#### Scenario: Tray outcomes
- **WHEN** a tray run reads `hard-041` with the issue `not_a_meal` and no draft, and a `positive` tray with no dish and no fluid
- **THEN** both count as refused: the `negative` row reads `1 | 0 | 0 | 1 | — · 1/1` and the `positive` row `1 | 0 | 0 | 1 | — · 0/1`

#### Scenario: Left-over dishes paired in order
- **WHEN** a lab tray labelled `rice` 0 and `curry_vegetables` 0 is read as `rice` 0 and `bread` 25
- **THEN** its dish pairs are `rice`/`rice`, 0 quarters apart, and `bread`/`curry_vegetables`, 1 quarter apart
- **AND** the dish kind table, by true kind, has `rice` 1 of 1 kept and `curry_vegetables` 0 of 1 kept, read as `bread` 1

#### Scenario: Same tolerance and floors
- **WHEN** lab trays with a fluid truth of 150 mL are read as 175 and 176 mL, and 3 of 7 `model`-basis dish pairs are exact
- **THEN** the first fluid is within tolerance and the second is not, as in the ward
- **AND** the `model` row's exact rate reads `42% · 3/7`

#### Scenario: Out-of-vocabulary values
- **WHEN** a tray record is labelled `rice` 0, a dish with `dish_kind: pizza` and `portion_eaten_pct: 0`, `bread` with `portion_eaten_pct: 30`, and a fluid of kind `coffee` with `volume_ml_estimate: 150`, and is read as `rice` 0, `other` 25 and `bread` 50, with `other` 150 mL
- **THEN** the `pizza` dish counts as `other` and pairs with the read `other`: the dish kind table's `other` row has 1 of 1 kept, and that pair is 1 quarter apart
- **AND** the fluid counts as `other`, kept, and within tolerance
- **AND** the `bread` dish counts in the dish kind table and in no portion pair

## ADDED Requirements

### Requirement: Tray reads are logged
Each `POST /api/ai/meal` answering 200 SHALL store one `tray` read and return its id as `read_id`. It holds mode, model ids, staff, `admission_id` if given, time, confidence, issues, `needs_review`, whether a served photo was found, 1 draft if the draft has a dish or fluid mL (else 0), each dish's region, `dish_kind`, portion and basis, each fluid's region, `fluid_kind` and mL, and the draft's portion, fluid mL and dishes. Requests stay 3 (5 with a served photo) in `sam+spark`, 1 in `spark`.

#### Scenario: Tray read
- **WHEN** signed in as Ravi Kumar (id 1), a tray photo is posted to `/api/ai/meal` in `sam+spark` mode with the `admission_id` of 3A bed 1, and the model reads rice (`rice`, region 1, half eaten), dal (`dal_lentils`, region 0, all eaten) and soup (`soup`, region 2, 150 mL), overall half eaten, confidence 0.82 and no issues
- **THEN** the response is 200 with a `read_id`, and the stored read with that id has:
  - kind `tray`, mode `sam+spark`, models `sam-3.1` and `muse-spark-1.3`, staff 1, that admission, served photo false;
  - confidence 0.82, issues `[]`, `needs_review: false`, 1 draft;
  - dishes `{ index: 1, dish_kind: rice, portion: 50, basis: model }` and `{ index: 0, dish_kind: dal_lentils, portion: 100, basis: model }`, and the fluid `{ index: 2, fluid_kind: soup, volume_ml: 150 }`;
  - a draft of portion 50, fluid 150 mL and dishes `rice` 50 and `dal_lentils` 100
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Spark-only tray read
- **WHEN** a tray photo is posted to `/api/ai/meal` in `spark` mode
- **THEN** the stored read has kind `tray`, mode `spark` and models `muse-spark-1.3` only
- **AND** the upstream received exactly one request

#### Scenario: Served photo compared
- **WHEN** a photo of 3A bed 1's tray was uploaded at 12:40 with `served_meal: lunch`, and at 13:30 the collected tray, with one dish region, is read in `sam+spark` mode with that bed's `admission_id` and `meal: lunch`, and its one dish is measured
- **THEN** the stored read has served photo true, and its dish has basis `measured`
- **AND** the upstream received exactly 5 requests: four SAM and one Spark

#### Scenario: No draft
- **WHEN** a tray read in `spark` mode returns no dishes, no fluid, the issue `not_a_meal` and confidence 0.3
- **THEN** the response is 200 with a `read_id`, and the stored read with that id has issues `not_a_meal`, 0 drafts and no draft values
- **AND** the upstream received exactly 1 request

#### Scenario: Failed tray read
- **WHEN** Spark answers 429 during a tray read in `spark` mode
- **THEN** the response is 429 with no `read_id`, no read is stored, and the upstream received exactly 1 request

#### Scenario: Refused by the budget
- **WHEN**, with a cap of 120, a 30 % reserve and 84 requests in use, a tray photo is posted to `/api/ai/meal` with the `admission_id` of 3A bed 4 (`stable`)
- **THEN** the response is 429 with `error: request_budget_exceeded` and no `read_id`, no read is stored, and the upstream received no request

### Requirement: Link a meal to its read
`POST /api/admissions/:id/meals` SHALL accept `read_id` on a `photo` meal and store the link (the meal, not its fluid entry) in the meal's transaction. The "Link checks" apply: the read exists, is by the signed-in staff member, names that admission, is under `READ_ABANDON_HOURS` old, is a `tray` read with a draft, and is unlinked, else `already linked`. A failed check, or `read_id` on a manual meal, gets 400 at `read_id` and stores nothing. It makes 0 model requests.

#### Scenario: Lunch linked
- **WHEN** signed in as Ravi Kumar, a tray read for 3A bed 1 returns `read_id` 61, its photo is uploaded, and a photo lunch with 150 mL, that `media_id`, its evidence and `read_id: 61` is posted for 3A bed 1
- **THEN** the response is 201, and read 61 is linked to that meal, not to its pending 150 mL entry
- **AND** the upstream received no request for the upload or the post

#### Scenario: Refused meal links
- **WHEN** each of these is posted for 3A bed 1, read 61 being unlinked:
  - a photo lunch with `read_id: 61`, signed in as Sunita Devi (id 2);
  - a photo lunch with the `read_id` of Ravi Kumar's tray read for 3A bed 2;
  - a photo lunch with the `read_id` of Ravi Kumar's photo read of a `cup` for 3A bed 1;
  - a photo lunch with the `read_id` of Ravi Kumar's `not_a_meal` tray read with no draft;
  - a `manual` lunch with `read_id: 61`;
  - a urine entry with `source: photo` and `read_id: 61`;
  - a photo lunch with `read_id: 61`, 12 hours after read 61
- **THEN** each response is 400 with `error: invalid_request` and an issue at `read_id`, no meal or entry is stored, and the upstream received no request

#### Scenario: Bedless tray read
- **WHEN** Ravi Kumar reads a tray without `admission_id` and gets `read_id` 62, and then posts a photo lunch for 3A bed 1 with `read_id: 62`
- **THEN** the response is 400 with `error: invalid_request` and an issue at `read_id`, and no meal is stored

#### Scenario: Empty tray read
- **WHEN** Ravi Kumar's tray read for 3A bed 1 returns `read_id` 63 with the issue `not_a_meal`, no dishes and no fluid, and he posts a photo lunch for 3A bed 1 with that photo's `media_id` and no `read_id`
- **THEN** the response is 201, read 63 has no link, and the summary still counts it as `negative_confirmed`
- **AND** the upstream received no request for the post

#### Scenario: Meal posted again
- **WHEN** the lunch linked to read 61 is posted a second time with `read_id: 61`
- **THEN** the response is 400 with the issue `{ path: "read_id", message: "already linked" }`
- **AND** the bed holds one lunch and one 150 mL entry

### Requirement: Outcome of a saved meal
A draft linked to a meal SHALL get one outcome, derived on request, the first that applies: `rejected` when the meal is voided; `pending` while its fluid entry is unreviewed; `corrected_by_nurse` when a nurse amended its dish kinds or portions, or its fluid entry was rejected, approved at another volume or amended in volume; `edited_at_capture` when saved with another portion, fluid mL or set of dish kinds and portions than drafted; else `accepted`. It makes 0 model requests.

#### Scenario: Accepted lunch
- **WHEN** a 3A tray read drafts portion 50, `rice` 50, `dal_lentils` 100 and 150 mL, the lunch is saved unchanged linked to it, and its 150 mL entry is approved unchanged
- **THEN** `GET /api/quality/model?ward=2` shows the `tray` `sam+spark` row with `accepted` 1 and every other outcome 0

#### Scenario: No fluid
- **WHEN** a tray read drafts portion 75 and `roti` as `bread` 75 with no fluid, and the dinner is saved unchanged linked to it
- **THEN** the `tray` row shows `accepted` 1 at once, with no entry to wait for

#### Scenario: Edited at capture
- **WHEN** a tray read drafts `rice` 50 and `dal_lentils` 100, and the attendant saves the lunch with rice at 75, and its fluid entry is approved unchanged
- **THEN** the `tray` row shows `edited_at_capture` 1

#### Scenario: Amended by a nurse
- **WHEN** a lunch is saved unchanged from its read with portion 50 and its fluid approved, and a nurse then amends the meal's portion to 25 with reason `tray returned fuller` through `POST /api/meals/:id/amend`
- **THEN** the `tray` row shows `corrected_by_nurse` 1

#### Scenario: Renamed only
- **WHEN** a lunch is saved unchanged from its read with portion 50, `rice` 50 and `dal_lentils` 100 and its fluid approved, and a nurse then amends only its items to `jeera rice, dal` and its `rice` dish's name to `jeera rice`, kinds and portions unchanged, through `POST /api/meals/:id/amend`
- **THEN** the `tray` row shows `accepted` 1 and `corrected_by_nurse` 0

#### Scenario: Fluid entry rejected
- **WHEN** a lunch is saved unchanged from its read with 150 mL, and a nurse rejects its 150 mL entry as `duplicate` while the meal stands
- **THEN** the `tray` row shows `corrected_by_nurse` 1 and `rejected` 0, and the meal fluid counts 1 `removed`

#### Scenario: Voided and pending
- **WHEN** one linked lunch is voided with reason `wrong bed`, and another linked lunch's 150 mL entry is not yet reviewed
- **THEN** the `tray` row shows `rejected` 1 and `pending` 1

### Requirement: Retaken tray reads
An unlinked `tray` read with a draft SHALL be `retaken` once the same staff member makes a later `tray` read for the same `admission_id` at most `READ_RETAKE_MINUTES` (10) after it, whatever its meal. `retaken` applies before `open`, `abandoned` and `negative_confirmed`, and counts in no decided count, no rate, neither kept nor not kept, and no negative count. A read with no `admission_id` is never `retaken`. It is derived on request and makes 0 model requests.

#### Scenario: Lunch read twice
- **WHEN** Ravi Kumar reads 3A bed 1's lunch tray in `sam+spark` mode, with no served photo, at 12:00 (read 70) and again at 12:04 (read 71), each drafting rice half eaten, and then saves the lunch linked to read 71
- **THEN** read 70 is `retaken` at 12:05, and still `retaken` at 00:05 the next day
- **AND** at 00:05 the next day the `tray` `sam+spark` row shows `abandoned` 0 and `retaken` 1
- **AND** the upstream received exactly 3 requests for each read, and none for the save or the summary

#### Scenario: Not a retake
- **WHEN** Ravi Kumar's lunch tray read 70 for 3A bed 1 at 12:00, drafting rice half eaten, is never saved, and on a fresh store each time it is followed by one of:
  - Sunita Devi's tray read for 3A bed 1 at 12:04;
  - Ravi Kumar's tray read for 3A bed 1 at 12:11;
  - Ravi Kumar's tray read for 3A bed 2 at 12:04
- **THEN** in each case read 70 is `open` at 12:15, and `abandoned` at 00:05 the next day

#### Scenario: No bed
- **WHEN** Ravi Kumar reads a tray without `admission_id` at 12:00 and again at 12:03, each drafting rice half eaten, and saves neither
- **THEN** at 12:05 both reads are `open`, and the `tray` rows show `retaken` 0

#### Scenario: Negative draft retaken
- **WHEN** at 12:00 Ravi Kumar's tray read for 3A bed 2 returns rice (half eaten) with the issue `not_a_meal`, and at 12:03 he reads the tray again, with no issues, and saves the lunch linked to that second read
- **THEN** at 00:05 the next day the first read is `retaken`, not `negative_confirmed`, and the negatives show confirmed and overridden over 0 reads

### Requirement: Dish scoring
Each settled meal's drafted dishes SHALL be paired with its final dishes: each drafted dish with the first unpaired final dish of the same `dish_kind`, then the rest in order. The `dish_kind` table counts, per drafted kind, the pairs kept and the kinds staff changed to, `none` for a dish removed; a dish staff added counts under model `none`. Dish names are never compared. It makes 0 model requests.

#### Scenario: Kind changed
- **WHEN** a settled meal drafted `rice` 50 and `dal_lentils` 100, and was saved with `bread` 50 and `dal_lentils` 100
- **THEN** the `dish_kind` table's `dal_lentils` row has 1 of 1 kept, and its `rice` row 0 of 1 kept with the correction `bread` 1

#### Scenario: Removed and added
- **WHEN** one settled meal drafted `rice`, `dal_lentils` and `fruit` and was saved with `rice` and `dal_lentils`, and another drafted `rice` and was saved with `rice` and `dairy`
- **THEN** the `fruit` row has 0 of 1 kept with the correction `none` 1
- **AND** the `none` row has n 1 with the correction `dairy` 1, and the `rice` row 2 of 2 kept

#### Scenario: Same kind twice
- **WHEN** a settled meal drafted `rice` 100 then `rice` 25, and was saved with `rice` 25 only
- **THEN** the `rice` row has 1 of 2 kept with the correction `none` 1
- **AND** the dish portion pair is drafted 100 against saved 25

### Requirement: Portion agreement
Portions SHALL be compared in quarters (25 points), for each settled meal's drafted and final portion and for each dish pair, a pair with an unknown portion left out. For meals and for dishes the summary gives the pairs, those `exact`, those within one quarter, and the count at 0, 1, 2, 3 and 4 quarters apart. It makes 0 model requests.

#### Scenario: Quarters
- **WHEN** settled dish pairs (drafted, final) are 50/50, 50/75, 100/50, 0/100 and 25/25
- **THEN** `dish_portion` is over 5 pairs, `exact` `{ n: 2, of: 5, pct: 40 }`, `within_quarter` `{ n: 3, of: 5, pct: 60 }` and `quarters_off` `[2, 1, 1, 0, 1]`

#### Scenario: Meal portion after an amend
- **WHEN** one settled lunch was drafted at portion 50, saved at 50, and amended by a nurse to 25
- **THEN** `meal_portion` is over 1 pair with `exact` `{ n: 0, of: 1, pct: null }`, `within_quarter` `{ n: 1, of: 1, pct: null }` and `quarters_off` `[0, 1, 0, 0, 0]`

### Requirement: Fluid with a meal
Each settled meal's drafted fluid mL SHALL be scored against its fluid entry's final volume, or none when it has no entry or that entry is rejected, within `VOLUME_TOLERANCE_ML` inclusive. This is `meal_fluid` and the tray rows' volume error, never the summary's top-level volume. A fluid staff added counts in `no_volume`, a drafted fluid with no final one in `removed`. It makes 0 model requests.

#### Scenario: Soup kept and re-volumed
- **WHEN** one settled lunch drafted 150 mL and its entry was approved at 150 mL, and another drafted 150 mL and its entry was approved at 120 mL
- **THEN** `meal_fluid.volume` is over 2 meals with 1 of 2 within tolerance, and the second counts as `corrected_by_nurse`
- **AND** the summary's top-level `volume` counts neither

#### Scenario: Added and removed
- **WHEN** one settled tray read drafted no fluid and the attendant saved its dinner with 200 mL, and another drafted 150 mL and its saved entry was rejected
- **THEN** `meal_fluid` has `volume.of` 0, `volume.no_volume` 1 and `removed` 1

### Requirement: Outcomes per container
The summary SHALL list one row per container the photo reads named, both modes together: the reads, the decided drafts, the accepted, corrected and rejected rates over them, and their volume error, most reads first, then in container order. A row says what staff did with drafts of a container the model read; it is not container truth. It makes 0 model requests.

#### Scenario: Two containers
- **WHEN** in 3A, 6 photo reads of a `urinal` were decided (5 accepted, 1 corrected by a nurse) and 2 of a `water_jug` (2 accepted)
- **THEN** `containers` lists `urinal` first, with 6 reads, accepted `{ n: 5, of: 6, pct: 83 }` and corrected `{ n: 1, of: 6, pct: 16 }`
- **AND** then `water_jug`, with 2 reads and accepted `{ n: 2, of: 2, pct: null }`

#### Scenario: No container read
- **WHEN** one photo read returned container `none` with the issue `no_container` and no draft
- **THEN** `containers` has a `none` row with 1 read and 0 decided drafts

### Requirement: Top corrections
The summary SHALL list the `TOP_CORRECTIONS` (5) most frequent changes across the type, urine colour and dish kind tables, each with its table, the model's class, what staff kept and the count: most first, then in that table order, then by the model's class and the kept class. It makes 0 model requests.

#### Scenario: Six changes
- **WHEN** the corrections are type `water` → `food` 3, urine colour `dark` → `red` 2, dish kind `rice` → `bread` 2, type `urine` → `stoma` 1, urine colour `yellow` → `dark` 1 and dish kind `fruit` → `none` 1
- **THEN** `top_corrections` lists, in order, `water` → `food` 3, `dark` → `red` 2, `rice` → `bread` 2, `urine` → `stoma` 1 and `yellow` → `dark` 1, and not `fruit` → `none`

### Requirement: Positive drafts not kept
The summary SHALL count the drafts of reads that are not negative, across every kind, as kept (`accepted`, `edited_at_capture`, `corrected_by_nurse`) or not kept (`rejected`, `abandoned`), each as a rate over both, with the rejected, abandoned and retaken counts. `pending`, `open` and `retaken` drafts count in neither. It makes 0 model requests.

#### Scenario: Kept and not kept
- **WHEN** non-negative drafts end 40 accepted, 4 edited at capture, 2 corrected by a nurse, 3 rejected, 1 abandoned, 2 retaken and 2 pending
- **THEN** `positives` is kept `{ n: 46, of: 50, pct: 92 }`, not kept `{ n: 4, of: 50, pct: 8 }`, rejected 3, abandoned 1 and retaken 2

#### Scenario: Negatives left out
- **WHEN** the window holds one `no_container` read confirmed and one overridden, and nothing else
- **THEN** `positives` is kept `{ n: 0, of: 0, pct: null }` and not kept `{ n: 0, of: 0, pct: null }`
