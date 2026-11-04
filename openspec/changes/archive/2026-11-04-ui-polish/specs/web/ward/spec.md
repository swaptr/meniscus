# Spec Delta

## MODIFIED Requirements

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

### Requirement: Ward activity strip
Each bed card on the ward dashboard SHALL show the last 24 hours as 24 mirrored hourly bars on one scale across the ward, intake (`hourly.in_ml`) up and output (`hourly.out_ml`) down from a midline, with a dot under each hour in which intake that is not rejected was logged, the intake the logging-gap prompt counts, so gaps are visible.

#### Scenario: Gap since morning
- **WHEN** a bed's `hourly.in_logged` is non-zero only at indices 5, 9 and 13
- **THEN** exactly hours 5, 9 and 13 have a logged dot and hours 14 to 23 have none

#### Scenario: One scale
- **WHEN** bed 2's largest hour is 400 mL in and bed 5's is 200 mL in, the largest on the ward
- **THEN** bed 5's 200 mL bar is half the height of bed 2's 400 mL bar

### Requirement: Photo strip
The bed review SHALL keep the capture photos of the last 24 hours behind a `Photos <n>` toggle, closed by default, and only when it is opened show them as thumbnails, at most the 12 newest, newest first, each with its time and volume, fetching each thumbnail then. Tapping one opens that entry's peek.

#### Scenario: Three photos
- **WHEN** four entries in the last 24 hours exist and three of them have photos
- **THEN** the toggle reads `Photos 3`, and once opened three thumbnails are shown, newest first

#### Scenario: Many photos
- **WHEN** 15 entries in the last 24 hours have photos and the toggle is opened
- **THEN** the 12 newest are shown

#### Scenario: Closed sends nothing
- **WHEN** the bed review of admission 10 loads with 3 photo entries and the toggle stays closed
- **THEN** no `GET /api/media/<id>` request is made

### Requirement: Segmentation overlay
An entry's photo with segmentation evidence SHALL be overlaid with the container and the liquid, a surface line at the liquid's top edge, and the labels of both (the liquid named by its drink kind when the entry or draft has one), placed in proportion to the image's own pixel size. With masks (`container_mask`, `fluid_mask`), each is drawn as the contour traced from its mask over its box; without, as its box. A Spark-only read, with no segmentation, has no overlay.

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

### Requirement: Tray overlay
A tray photo with segmentation SHALL be overlaid with each dish region's contour from its dish mask, and its food from its food mask, in proportion to the image's pixels. Each region is labelled `<index> <name> · <portion>` per dish in it, from the meal's dishes or, before saving, the form's, and `<index> <name> · <Kind> · <mL> mL` per drink in it, from the read's `fluids`, without `<Kind> · ` when it equals the name ignoring case. Unnamed regions are unlabelled; the outline toggle hides all.

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
- **WHEN** the outline toggle is turned off on that photo
- **THEN** no contour and no label is drawn

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

## ADDED Requirements

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
Wherever a container photo's segmentation overlay is drawn (the check screen, the entry peek, the entry details, the bed review's photo strip and any printed photo), the container region SHALL be labelled with its container name and the liquid region `<Liquid or drink kind> · <fill %> full ≈ <fluid_volume_ml> mL`, or without ` ≈ … mL` when `fluid_volume_ml` is null or absent. The labeled view is drawn over the raw photo from the stored masks and makes no request.

#### Scenario: Urine bag with a volume
- **WHEN** the check screen shows a urine bag read with fill fraction 0.463 and `fluid_volume_ml: 930`
- **THEN** the container region is labelled `Urine bag` and the liquid region `Liquid · 46% full ≈ 930 mL`
- **AND** the same entry's peek, after saving, shows the same two labels

#### Scenario: No capacity
- **WHEN** an entry's photo evidence has fill fraction 0.46 and `fluid_volume_ml: null`
- **THEN** the liquid region is labelled `Liquid · 46% full`, with no mL

#### Scenario: Spark-only read
- **WHEN** an entry read in `spark` mode, with `segmentation: null`, is peeked
- **THEN** its photo has no region labels and no request beyond the photo's own `GET /api/media/<id>` is made

### Requirement: Entry peek fetches its photo on open
An entry peek for an entry with a photo SHALL fetch it with exactly one `GET /api/media/<id>` (the entry's `media.id`, or a level drop's `levels.after.media.id`) the first time it opens, reuse it on later opens while cached (24 most recent) and in the entry details, and cancel it when closed before it arrives. Lists never prefetch photos, and opening a peek makes 0 model requests.

#### Scenario: First and second open
- **WHEN** the peek of a photo entry with media 41 is opened, closed and opened again, then its `Details` is opened
- **THEN** exactly one `GET /api/media/41` was made and no `/api/ai` request

#### Scenario: Closed early
- **WHEN** the peek is closed before media 41 arrives and opened again later
- **THEN** the first request was aborted and one more `GET /api/media/41` was made

#### Scenario: No photo
- **WHEN** a typed-note entry's peek opens
- **THEN** no media request is made

### Requirement: Read drawn on the peek photo
An entry peek's photo of a container SHALL show the segmentation overlay and, beside it, a scale from 0 to the container's capacity marking the AI's volume, the saved volume and, when approved, the approved volume, each labelled, so a correction is seen against the photo. Without a reading or capacity there is no scale.

#### Scenario: Corrected bag
- **WHEN** the urine bag entry read 450 mL of 2000 mL, saved 430 mL and approved 375 mL is peeked
- **THEN** the scale runs 0 to 2000 mL with marks labelled `AI read 450`, `Saved 430` and `Approved 375`

#### Scenario: Spark only
- **WHEN** an entry read in `spark` mode with no segmentation is peeked
- **THEN** its photo has no overlay, and the scale still marks the AI's volume

### Requirement: Segments revealed on first open
The first time a segmented photo is shown in a peek or on the check screen, its overlay SHALL be revealed once in 480 ms: the area outside the container dims, the container contour traces, then the liquid or dish contours 80 ms apart, then the labels. Later opens, other screens and reduced motion show the final state at once.

#### Scenario: Peek opened twice
- **WHEN** a nurse opens the 10:42 urine bag entry's peek, closes it and opens it again
- **THEN** the contours trace on the first open only

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
