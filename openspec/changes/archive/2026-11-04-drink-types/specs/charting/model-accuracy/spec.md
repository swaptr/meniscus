# Spec Delta

## MODIFIED Requirements

### Requirement: Read log holds no text
A stored read SHALL hold only closed-list values (read kind, mode, model ids, container, fluid, drink and meal fluid kinds, entry type, urine colour, dish kind, portion basis, issue codes), numbers, booleans, ids and times. It never holds a transcript, note text, image, image hash, reading basis, appearance, dish, fluid or drink name, mask, box, draft item or notes, or model reply. The only log lines about a read are the model-API lines (path, model, status, timing). This adds no model request.

#### Scenario: Voice note
- **WHEN** a voice note is transcribed as `bed 4 had rice and a kokum sherbet, 200 mL`, and the model drafts item `kokum sherbet`, notes `half the glass, with rice`, `water` 200 mL, drink `other`
- **THEN** no column of the stored read contains `rice`, `kokum`, `sherbet`, `bed 4` or `half the glass`
- **AND** no line the server logged contains them
- **AND** the upstream received exactly one speech-to-text request and one Spark request

#### Scenario: Photo read
- **WHEN** a photo read returns reading basis `between the 400 and 500 marks`, appearance `pale yellow, clear` and `drink_name` `masala chai`
- **THEN** no column of the stored read contains `between the 400 and 500 marks`, `pale yellow, clear` or `masala`
- **AND** every string in its stored output is a value of `READ_KINDS`, `CONTAINER_KINDS`, `FLUID_KINDS`, `DRINK_KINDS`, the entry types, `URINE_COLOURS` or `READING_ISSUES`

#### Scenario: Tray read
- **WHEN** a tray photo is read in `sam+spark` mode, and the model names `paneer tikka` (dish kind `curry_vegetables`, region 1, half eaten) and `masala chai` (fluid kind `tea`, 150 mL), with notes `left the roti`
- **THEN** no column of the stored read contains `paneer`, `masala`, `roti`, the read's `image_sha256`, a region box or a mask's bits
- **AND** every string in its stored output is a value of `READ_KINDS`, `DISH_KINDS`, `MEAL_FLUID_KINDS`, `PORTION_BASES` or `MEAL_ISSUES`, and no line the server logged contains `paneer` or `masala`
- **AND** the upstream received exactly 3 requests: two SAM and one Spark

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
- **WHEN** a tray record is labelled `rice` 0, a dish with `dish_kind: pizza` and `portion_eaten_pct: 0`, `bread` with `portion_eaten_pct: 30`, and a fluid of kind `kombucha` with `volume_ml_estimate: 150`, and is read as `rice` 0, `other` 25 and `bread` 50, with `other` 150 mL
- **THEN** the `pizza` dish counts as `other` and pairs with the read `other`: the dish kind table's `other` row has 1 of 1 kept, and that pair is 1 quarter apart
- **AND** the fluid counts as `other`, kept, and within tolerance
- **AND** the `bread` dish counts in the dish kind table and in no portion pair

## ADDED Requirements

### Requirement: Drink kind in the read log
Each draft a stored photo, text or voice read holds SHALL also hold its `drink`: the draft's drink kind, or null when it has none. A tray read's fluids keep their `fluid_kind`, as now. Reads stored before this change, whose drafts have no `drink`, read as null. Requests are unchanged: photo 3 (1 in `spark` mode), text 1, voice 2, tray 3 (5 when compared, 1 in `spark` mode).

#### Scenario: Photo of coffee
- **WHEN** a JPEG is read in `sam+spark` mode and Spark returns container `cup`, fluid `coffee`, `drink_name` `filter coffee`, 150 mL
- **THEN** the stored read's output has fluid `coffee` and a draft of type `water`, 150 mL and `drink: coffee`
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Voice note with two drafts
- **WHEN** a voice note's model calls `log_entry` for `water` 200 mL with drink `tea`, and `urine` 300 mL
- **THEN** the stored read has 2 drafts: `water` 200 mL with `drink: tea`, and `urine` 300 mL with `drink: null`
- **AND** the upstream received exactly one speech-to-text request and one Spark request

### Requirement: Drink kind table
The summary SHALL hold a `drink_kind` table over settled photo, text and voice drafts with a drink kind and an entry: one row per drafted kind, with its drafts, the kept rate against the entry's final `drink`, and the kinds it was changed to, most first, as the type table does. A final entry with no drink counts as `none`. A change of kind alone leaves the draft's outcome unchanged; this table measures it. Rows follow `DRINK_KINDS` order; an empty window is `[]`. It makes 0 model requests.

#### Scenario: Tea that was coffee
- **WHEN** in 3A, four photo drafts read `tea`: three are approved as `tea`, and one is approved and then amended to `coffee`
- **THEN** `drink_kind` has a `tea` row with `n: 4`, kept `{ n: 3, of: 4, pct: null }` and corrections `[{ to: "coffee", n: 1 }]`
- **AND** all four drafts count as `accepted` in the photo `sam+spark` row
- **AND** the upstream received no request

#### Scenario: Changed away from a drink
- **WHEN** a text draft of `water` 200 mL with `drink: juice` is saved, and a nurse amends the entry to `iv`
- **THEN** the `juice` row has kept `{ n: 0, of: 1, pct: null }` and corrections `[{ to: "none", n: 1 }]`

#### Scenario: A saved jug level is not counted
- **WHEN** a photo of a water jug drafts `water` 500 mL with `drink: water`, and it is saved as a jug level, and one photo draft read `tea` is approved as `tea`
- **THEN** `drink_kind` has only the `tea` row, with `n: 1` and kept `{ n: 1, of: 1, pct: null }`

### Requirement: Drink kinds in the lab evals
The photo eval's fluid table and the tray eval's fluid kind table SHALL have a row for each drink kind their labels or reads name, `coffee`, `coconut_water`, `buttermilk`, `ors` and `supplement` included. A label outside the kinds stays unscored in the photo eval and `other` in the tray eval. Plans are unchanged: 3 requests a photo or tray (1 in `spark` mode), and none is sent without approval.

#### Scenario: Coffee labelled
- **WHEN** a labelled photo run has 2 photos with `expected_fluid: coffee`, one read `coffee` and one read `tea`, and a tray with `expected_fluids` `[{ fluid_kind: "coconut_water", volume_ml_estimate: 200 }]` read as `coconut_water` 200 mL
- **THEN** the photo report's fluid table has a `coffee` row with 1 of 2 kept and the change `tea 1`, and the tray report's fluid kinds have a `coconut_water` row with 1 of 1 kept

#### Scenario: Plan
- **WHEN** a folder of 10 labelled photos, 4 of them labelled `ors`, is planned in `sam+spark` mode without approval
- **THEN** the plan is 30 model requests, and none is sent
