# capture/photo-reading Specification

## Purpose
Turn one photo of a hospital container into a volume reading, a suggested chart entry and a review flag, using a fixed number of model requests.

## Requirements

### Requirement: Grounded reading
In `sam+spark` mode a photo read SHALL make exactly two SAM requests (one for the container, one for the liquid) and then exactly one Spark request whose prompt includes the segmentation geometry.

#### Scenario: Urine bag photo
- **WHEN** a JPEG is read with hint `urine_bag` in `sam+spark` mode
- **THEN** the upstream receives SAM prompts `urine bag` and `liquid` and one Spark request, the Spark prompt contains `Segmentation: container spans`, and the result trace lists `sam:container`, `sam:liquid`, `spark:read`

### Requirement: Spark-only reading
In `spark` mode a photo read SHALL make exactly one Spark request and no SAM requests.

#### Scenario: Spark mode
- **WHEN** a JPEG is read in `spark` mode
- **THEN** exactly one upstream request is made and it is a Spark request

### Requirement: Segmentation failure degrades
When a SAM request fails, the read SHALL still return the Spark reading with `segmentation` null and a warning starting `segmentation unavailable`, without retrying SAM.

#### Scenario: SAM overloaded
- **WHEN** both SAM requests return HTTP 503 and Spark reads 1000 mL
- **THEN** the result has `segmentation: null`, warning `segmentation unavailable: …`, volume 1000, and exactly two SAM requests were made

### Requirement: Empty segmentation warns
When SAM finds no container or no liquid, the result SHALL carry the warnings `segmentation found no container` and `segmentation found no liquid` respectively.

#### Scenario: Nothing segmented
- **WHEN** both SAM requests return empty output
- **THEN** the first two warnings are `segmentation found no container` and `segmentation found no liquid`

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

### Requirement: Review gate
A reading SHALL be flagged `needs_review` when its volume is null, its confidence is below 0.75, no graduation marks are visible, or the segmentation fill fraction differs from volume/capacity by more than 0.3.

#### Scenario: Confident and consistent
- **WHEN** volume 1000 of capacity 2000, confidence 0.9, marks visible, segmentation fill 0.55
- **THEN** there are no review reasons

#### Scenario: Each trigger alone
- **WHEN** confidence is 0.5, or marks are not visible, or volume is null, or volume 1800 of 2000 with segmentation fill 0.2
- **THEN** each case yields exactly one review reason

### Requirement: Fill fraction from segmentation
The segmentation SHALL pick the liquid whose centre lies inside the chosen container and report fill fraction as liquid height over container height, or null when either is missing.

#### Scenario: Half-full jug with liquid elsewhere in the frame
- **WHEN** the container spans y 0–200, a 0.8-confidence liquid spans y 100–200 inside it, and a 0.99-confidence liquid lies outside it
- **THEN** the inside liquid is chosen and the fill fraction is 0.5

#### Scenario: Nothing found
- **WHEN** SAM finds no container and no liquid
- **THEN** container, fluid and fill fraction are all null

### Requirement: Upload validation
`POST /api/ai/read` SHALL reject a non-image upload, or an image over 8 MB, with HTTP 400 `invalid_request` and make no model request.

#### Scenario: Text file uploaded
- **WHEN** the `image` field is a `text/plain` file
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request

#### Scenario: Photo over 8 MB
- **WHEN** the `image` field is a 9 MB JPEG
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request

### Requirement: Urine colour read
The Spark reading SHALL also return two fields, both null unless the fluid is urine:
- `urine_colour`: one of `pale`, `yellow`, `dark`, `orange`, `pink`, `red` or `brown`.
- `urine_rgb`: the urine's colour as seen, as `#rrggbb` in lowercase.

A urine draft SHALL carry both. A `urine_rgb` that is not a 6-digit hex colour SHALL become null and the colour is kept. This adds no request: `sam+spark` mode stays at 3 requests and `spark` mode at 1.

#### Scenario: Dark urine in a bag
- **WHEN** a JPEG is read with hint `urine_bag` in `sam+spark` mode and Spark returns fluid `urine`, 450 mL, `urine_colour` `dark` and `urine_rgb` `#C9952F`
- **THEN** the draft has `urine_colour: dark` and `urine_rgb: "#c9952f"`
- **AND** the upstream received exactly two SAM requests and one Spark request

#### Scenario: Not urine
- **WHEN** Spark returns fluid `water` with `urine_colour` `yellow` and `urine_rgb` `#ecd558`
- **THEN** the reading and the draft have `urine_colour` and `urine_rgb` null

#### Scenario: Not a hex colour
- **WHEN** Spark returns fluid `urine`, `urine_colour` `dark` and `urine_rgb` `amber`
- **THEN** the draft has `urine_colour: dark` and `urine_rgb: null`

### Requirement: Bedpan and commode reads
A photo read SHALL accept the hints `bedpan` and `commode_pan` and may return either as its container. With hint `bedpan` or `commode_pan`, SAM is prompted `bedpan` or `commode pan`. A reading of either with fluid `urine` or `other` drafts `out` / `urine` with `item` `bedpan` or `commode pan`. A read makes the same requests as any other: exactly two SAM requests and one Spark request in `sam+spark` mode, and exactly one Spark request in `spark` mode.

#### Scenario: Commode pan, grounded
- **WHEN** a JPEG is read with hint `commode_pan` in `sam+spark` mode, and Spark returns container `commode_pan`, fluid `urine`, 250 mL
- **THEN** the upstream receives SAM prompts `commode pan` and `liquid` and one Spark request, and nothing else
- **AND** the draft is `{ direction: out, category: urine, volume_ml: 250, item: "commode pan" }`

#### Scenario: Bedpan, Spark only
- **WHEN** a JPEG is read with hint `bedpan` in `spark` mode, and Spark returns container `bedpan`, fluid `other`, 180 mL
- **THEN** exactly one upstream request is made, a Spark request
- **AND** the draft is `{ direction: out, category: urine, volume_ml: 180, item: "bedpan" }`

#### Scenario: Unknown hint
- **WHEN** a JPEG is sent to `POST /api/ai/read` with hint `commode`
- **THEN** the response is 400 with `error: invalid_request`, and the upstream received no request

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

### Requirement: Masks kept with the segmentation
A photo read's segmentation SHALL carry `container_mask` and `fluid_mask`: the chosen container's and liquid's SAM masks over their boxes, packed as one-bit grids of at most 32 × 32 cells keeping the box's aspect, each cell sampled at its centre, as tray masks are, or null when that element was not found. The read still makes exactly 3 upstream requests in `sam+spark` mode (2 SAM, 1 Spark) and 1 in `spark` mode, which has no segmentation.

#### Scenario: Half-filled container mask
- **WHEN** in `sam+spark` mode the chosen container's mask fills the left half of its box 0,0–200,400
- **THEN** `container_mask` is 16 × 32 cells with the left 8 cells of every row set, held in 88 base64 characters, and exactly 3 upstream requests were made

#### Scenario: No liquid
- **WHEN** SAM finds a container and no liquid
- **THEN** `fluid_mask` is null and `container_mask` is set

#### Scenario: Spark mode
- **WHEN** a JPEG is read in `spark` mode
- **THEN** exactly one upstream request is made and the result has `segmentation: null`

### Requirement: Liquid region quantity
A photo read's segmentation SHALL carry `fluid_volume_ml`, the liquid region's approximate volume: its `fill_fraction` × the reading's `capacity_ml`, rounded to the nearest 10 mL (halves up), or null when the reading has no capacity or SAM found no fill. It is computed from results the read already has, so the read still makes exactly 3 upstream requests in `sam+spark` mode and 1 in `spark` mode, which has no segmentation.

#### Scenario: Urine bag 46% full
- **WHEN** in `sam+spark` mode SAM gives fill fraction 0.463 and Spark reads a capacity of 2000 mL
- **THEN** the segmentation has `fluid_volume_ml: 930` (926 rounded to the nearest 10) and exactly 3 upstream requests were made

#### Scenario: No capacity
- **WHEN** in `sam+spark` mode SAM gives fill fraction 0.4 and the reading has `capacity_ml: null`
- **THEN** the segmentation has `fluid_volume_ml: null` and `fill_fraction: 0.4`

#### Scenario: No liquid found
- **WHEN** in `sam+spark` mode SAM finds a container and no liquid, so `fill_fraction` is null, and the capacity is 1000 mL
- **THEN** the segmentation has `fluid_volume_ml: null`

#### Scenario: Spark mode has no region quantity
- **WHEN** a JPEG is read in `spark` mode
- **THEN** exactly one upstream request is made and the result has `segmentation: null`, so there is no `fluid_volume_ml`

### Requirement: Photo read names its image
`POST /api/ai/read` SHALL return `image_sha256`, the lowercase-hex SHA-256 of the image bytes it read, in every mode, so the read's geometry can be bound to the photo that is kept. It is computed locally from the posted bytes: the read still makes exactly 3 upstream requests in `sam+spark` mode (2 SAM, 1 Spark) and 1 in `spark` mode, and the value is never logged.

#### Scenario: Urine bag read
- **WHEN** a 48,213-byte JPEG is read with hint `urine_bag` in `sam+spark` mode
- **THEN** the result's `image_sha256` is the 64-character lowercase-hex SHA-256 of those 48,213 bytes, and exactly 3 upstream requests were made

#### Scenario: Spark mode
- **WHEN** the same JPEG is read in `spark` mode
- **THEN** the result has `segmentation: null`, the same `image_sha256`, and exactly 1 upstream request was made

#### Scenario: Not in the log
- **WHEN** that read completes
- **THEN** no server log line contains its `image_sha256`
