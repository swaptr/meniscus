# Spec Delta

## ADDED Requirements

### Requirement: Tray eval labels from the dataset
Given `--tray-labels <manifest.jsonl>`, the eval SHALL read as a tray each photo whose file name ends with the `id` of a `record_type: original` record that has `expected_items`, labelled from its `expected_items`, `meal_portion_eaten`, `expected_fluids` and `expected_outcome`. Augmented records and other photos are skipped at no request. Each tray costs 3 requests (1 in `spark` mode), and none is sent without approval. With `--container-labels` or `--no-hint` it exits 2 and sends nothing.

#### Scenario: Tray labels
- **WHEN** a folder holding `other-0-tray-002.jpg`, `other-0-hard-041.jpg`, `urine_bag-1700-ubag-001.jpg` and `tray-002__blur_gauss_strong.jpg` is planned with `--tray-labels` and a manifest holding:
  - `tray-002` (`record_type: original`): `expected_items` peas (`curry_vegetables`, 0), mashed potato (`curry_vegetables`, 0) and meat with gravy (`meat_fish_egg`, 0), `meal_portion_eaten: 0`, `expected_fluids: []`, `expected_outcome: positive`;
  - `hard-041` (`record_type: original`): `expected_items: []`, `expected_outcome: negative`, `expected_issues: ["not_a_meal"]`;
  - `ubag-001` (`record_type: original`), with no `expected_items`;
  - `tray-002__blur_gauss_strong` (`record_type: augmented`), with the same `expected_items`, `expected_outcome: positive` and `expected_outcome_after: degraded`
- **THEN** the plan counts 2 trays, 6 model requests in `sam+spark` mode and 2 in `spark` mode, and none is sent
- **AND** it reads `2 photos without tray labels, skipped`
- **AND** `tray-002` is labelled with 3 dishes eaten 0 %, a meal portion of 0 and no fluid truth, and `hard-041` is a negative sample with no dish

#### Scenario: Flags that do not apply to trays
- **WHEN** the eval is run with `--tray-labels manifest.jsonl --container-labels manifest.jsonl`, and with `--tray-labels manifest.jsonl --no-hint`
- **THEN** each exits with status 2, plans nothing and sends no request

### Requirement: Tray eval report
The tray eval report SHALL pair read and true dishes by `dish_kind`, then in list order, never by name. Per mode it gives a dish kind table by true kind, dish portions in quarters split by `basis`, the meal portion in quarters, fluid kinds and mL within `VOLUME_TOLERANCE_ML`, and each expected outcome against drafted, flagged or refused. A fluid of kind `none` is no fluid, a null portion or `volume_ml_estimate` is not scored, and rates follow "Small numbers withheld". It makes no model request.

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

### Requirement: Synthetic trays in the tray eval
A synthetic photo SHALL be read as a tray when read-outcomes' sidecar rule scores it and its sidecar's `labels.truth` has `expected_items`: dishes and fluids from `labels.truth.expected_items` and `expected_fluids`, the meal portion from `labels.meal_portion_eaten` and the outcome from `labels.expected_outcome`, each unscored when absent. Real and synthetic trays are reported in separate sections under the same rules. Each costs 3 requests (1 in `spark` mode), none without approval.

#### Scenario: Synthetic labels
- **WHEN** `synth-gen-tray-02.png` has a verified sidecar (`label_status: verified`, `verified_by: "dev-1"`) with labels `{ meal_portion_eaten: 75, truth: { expected_items: [{ dish_kind: "rice", portion_eaten_pct: 75 }], expected_fluids: [] } }` and no `expected_outcome`, and is planned with `--tray-labels`
- **THEN** it is planned as one tray at 3 requests in `sam+spark` mode, labelled with one rice dish at 75, a meal portion of 75 and no fluid truth
- **AND** it counts in no outcome row

#### Scenario: Real and synthetic apart
- **WHEN** a run reads `other-0-tray-002.jpg` and `synth-gen-tray-02.png`, each with one dish read as its true kind
- **THEN** the report has a real section and a synthetic section, and each dish kind table counts exactly 1 tray

### Requirement: Served and collected pairs in the tray eval
In `sam+spark` mode, a scored synthetic tray whose sidecar has `pair_role: after` SHALL be read with its before as the served photo, at exactly 5 requests (3 when either size is unreadable). The before is the folder photo whose sidecar has the same `pair_id` and `pair_role: before`, else the file of the record its first `source_ids` names, beside the manifest. It is labelled as a synthetic tray, and pairs are reported apart. In `spark` mode, or with no before, it is read alone at 1 or 3.

#### Scenario: Pair planned
- **WHEN** a folder holding `tray-001.jpg` and `synth-gen-tray-01.png`, whose sidecar has `synthetic: true`, `label_status: verified`, `verified_by: "dev-1"`, `source_ids: ["tray-001"]` and labels `{ pair_id: "pair-tray-001", pair_role: "after", truth: { expected_items: [{ dish_kind: "bread", portion_eaten_pct: 100 }] } }`, is planned with `--tray-labels` and a manifest whose `tray-001` has `file: images/food_tray/tray-001.jpg`
- **THEN** the plan is 8 model requests in `sam+spark` mode (3 for `tray-001`, 5 for the pair) and 2 in `spark` mode, and none is sent
- **AND** the pair's served photo is `images/food_tray/tray-001.jpg` beside the manifest

#### Scenario: Pair read
- **WHEN** that pair is read with approval against a fake upstream
- **THEN** the upstream received exactly 5 requests, in order: SAM `dish` and SAM `food` with the after photo, SAM `dish` and SAM `food` with the before photo, then one Spark request with the after photo only
- **AND** the report has a `Pairs (served and collected)` section with 1 pair, scored with the after photo's labels

#### Scenario: Before not found
- **WHEN** the same sidecar names `source_ids: ["tray-999"]`, which no record has, and no folder photo shares its `pair_id`
- **THEN** it is planned as a tray alone at 3 requests in `sam+spark` mode, and the plan reads `1 pair without its before, read alone`
