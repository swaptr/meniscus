# Spec Delta

## ADDED Requirements

### Requirement: Tray fluids share the drink kinds
Each fluid of a tray read SHALL have a `fluid_kind` from the drink kinds (`water`, `tea`, `coffee`, `milk`, `juice`, `coconut_water`, `buttermilk`, `ors`, `supplement`, `soup`, `other`), and a name cleaned and cut as capture/photo-reading's "Drink name bounds" says, an empty name becoming the kind's label. The tray prompt names these drinks. Requests are unchanged: exactly 3 in `sam+spark` mode, 5 when compared with a served photo, and 1 in `spark` mode.

#### Scenario: Chaas with lunch
- **WHEN** a tray is read in `sam+spark` mode, the segmentation has region 2, a glass, and the model reads `chaas` of kind `buttermilk` in region 2, 200 mL
- **THEN** the reading's `fluids` is `[{ index: 2, name: "chaas", fluid_kind: "buttermilk", volume_ml: 200 }]`
- **AND** the Spark request's JSON schema lists `coffee`, `coconut_water`, `buttermilk`, `ors` and `supplement` in `fluid_kind`
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Coffee, Spark only
- **WHEN** a tray is read in `spark` mode and the model reads a fluid named `"  "` of kind `coffee`, 150 mL, and one named with 60 characters of kind `juice`
- **THEN** the first fluid's name is `Coffee`, and the second's is at most 40 characters long
- **AND** exactly one upstream request is made, a Spark request
