# Spec Delta

## MODIFIED Requirements

### Requirement: Draft entry from reading
A reading SHALL map to a draft entry whose category comes from the liquid (falling back to the container type), with `out` direction for urine, stoma, drain and vomit, `in` otherwise, and no draft when neither identifies a category. An output draft's `item` is its container and its `drink` null. An intake draft's `drink` is the liquid's drink kind (`other` when the liquid is not one, null on food that is not a drink), and its `item` the drink name, else the kind's label; never the container.

#### Scenario: Urine bag
- **WHEN** the reading is container `urine_bag`, fluid `urine`, 450 mL, appearance `pale yellow, clear`
- **THEN** the draft is `{direction: out, category: urine, volume_ml: 450, item: "urine bag", notes: "pale yellow, clear", drink: null}`

#### Scenario: Tea in a cup
- **WHEN** the reading is container `cup`, fluid `tea`, `drink_name` null, 200 mL
- **THEN** the draft is `{direction: in, category: water, volume_ml: 200, item: "Tea", drink: tea}`

#### Scenario: Masala chai
- **WHEN** the reading is container `cup`, fluid `tea`, `drink_name` `masala chai`, 150 mL
- **THEN** the draft has `category: water`, `item: "masala chai"` and `drink: tea`, and no field of the draft holds `cup`

#### Scenario: Soup in a cup
- **WHEN** the reading is container `cup`, fluid `soup`, `drink_name` null, 180 mL
- **THEN** the draft has `direction: in`, `category: food`, `item: "Soup"` and `drink: soup`

#### Scenario: Unnamed liquid in a cup
- **WHEN** the reading is container `cup`, fluid `other`, `drink_name` null, 120 mL
- **THEN** the draft has `category: water`, `drink: other` and `item: null`

#### Scenario: Unknown liquid in a stoma bag
- **WHEN** the reading is container `stoma_bag`, fluid `other`
- **THEN** the draft category is `stoma`, its `item` is `stoma bag` and its `drink` null

#### Scenario: Nothing chartable
- **WHEN** the reading is container `none`, fluid `none`
- **THEN** there is no draft

## ADDED Requirements

### Requirement: Drink identified in the reading
The Spark reading SHALL return `fluid` as one of `urine`, `water`, `tea`, `coffee`, `milk`, `juice`, `coconut_water`, `buttermilk`, `ors`, `supplement`, `soup`, `stoma_output`, `drain_fluid`, `vomit`, `other` or `none`, and `drink_name`: the specific drink seen, such as `masala chai`, or null. The reading prompt names these drinks. This adds no request: `sam+spark` mode stays at exactly two SAM requests and one Spark request, and `spark` mode at exactly one Spark request.

#### Scenario: Filter coffee, grounded
- **WHEN** a JPEG is read with hint `cup` in `sam+spark` mode, and Spark returns container `cup`, fluid `coffee`, `drink_name` `filter coffee`, 150 mL
- **THEN** the reading has `fluid: coffee` and `drink_name: "filter coffee"`, and the draft has `drink: coffee` and `item: "filter coffee"`
- **AND** the Spark request's JSON schema lists `coffee`, `coconut_water`, `buttermilk`, `ors` and `supplement` in its `fluid` enum and requires `drink_name` as a string or null, and its instructions name coffee, ORS, buttermilk, coconut water and supplement drinks
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: ORS, Spark only
- **WHEN** a JPEG is read in `spark` mode, and Spark returns container `water_bottle`, fluid `ors`, `drink_name` null, 300 mL
- **THEN** the draft has `category: water`, `drink: ors` and `item: "ORS"`
- **AND** exactly one upstream request is made, a Spark request

### Requirement: Drink name bounds
A reading's `drink_name` SHALL have control characters removed, each whitespace run made one space, be trimmed, cut to 40 characters and trimmed again. It is null when empty or null-like (`null`, `n/a`, `none`), when the fluid is not a drink kind, or when the category is an output (urine, stoma, drain, vomit), even with fluid `other`. Only the reading and its draft's `item` carry it. It adds no request: `sam+spark` mode stays at 3 requests and `spark` mode at 1.

#### Scenario: Cleaned
- **WHEN** Spark returns fluid `tea` with `drink_name` `"  masala\n\tchai "`
- **THEN** the reading's `drink_name` and the draft's `item` are `masala chai`

#### Scenario: Too long
- **WHEN** Spark returns fluid `juice` with the 60-character `drink_name` `sweet lime juice with a little rock salt and sugar, less ice`
- **THEN** the reading's `drink_name` and the draft's `item` are the 40-character `sweet lime juice with a little rock salt`

#### Scenario: Not a drink
- **WHEN** Spark returns container `urinal`, fluid `urine` with `drink_name` `pale`; in a second read container `stoma_bag`, fluid `other` with `drink_name` `brown liquid`; and in a third read fluid `water` with `drink_name` ` N/A `
- **THEN** all three readings have `drink_name: null`, the first draft's `item` is `urinal`, the second's `item` is `stoma bag`, and the third's `item` is `Water`
