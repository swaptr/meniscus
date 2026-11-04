# Spec Delta

## MODIFIED Requirements

### Requirement: Hospital ward list
The nurse home (`/n`) SHALL list every ward as a card in its default Wards view, in code order unless "Your wards first" applies. Each card shows the ward name, `<occupied>/<capacity> beds`, the pending count ("All reviewed" when 0), the beds with prompts ("<n> to review", omitted when 0), the last activity, and `In charge: <short name>` or `No nurse in charge`. Last activity is relative: "just now" under a minute, "<n> min ago" under an hour, "<n> h ago" otherwise, or "No entries today".

#### Scenario: Busy ward
- **WHEN** ward 5B has 6 of 6 beds occupied, 3 pending entries, 4 beds with prompts, its last entry 12 minutes ago and Grace Lee in charge
- **THEN** its card reads `Neurology Ward 5B`, `6/6 beds`, `3 pending`, `4 to review`, `12 min ago` and `In charge: Grace L.`

#### Scenario: Quiet ward
- **WHEN** ward HDU has 3 of 4 beds occupied, nothing pending, no prompts, no entries in 24 hours and nobody in charge
- **THEN** its card reads `3/4 beds`, `All reviewed`, `No entries today` and `No nurse in charge`, with no review count

### Requirement: Model accuracy view
The Data quality view SHALL end with a "Model accuracy" section for the ward's last 7 days, from one `GET /api/quality/model?ward=<id>&days=7` sent with the ward summary when the view opens. It shows the outcome chart or the kinds table ("Chart or table"), one class table ("Class table picker"), and the volume error, negatives, kept drafts, meal fluid and top corrections lines. Switching the chart, table or class table sends no request. It makes no model request.

#### Scenario: Two requests
- **WHEN** Anita Thomas opens the Data quality view of 3A (ward id 2), then picks Table and each class table in turn
- **THEN** exactly two requests are sent: `GET /api/wards/2/quality` and `GET /api/quality/model?ward=2&days=7`
- **AND** no `/api/ai` request is sent

#### Scenario: Read kinds
- **WHEN** Table is picked, and the `photo` `sam+spark` row has outcomes `accepted` 20, `edited_at_capture` 2, `corrected_by_nurse` 3, `rejected` 1 and `abandoned` 1, with rates accepted `{ n: 20, of: 26, pct: 76 }`, edited_at_capture `{ n: 2, of: 26, pct: 7 }`, corrected_by_nurse `{ n: 3, of: 26, pct: 11 }` and rejected `{ n: 1, of: 26, pct: 3 }`
- **THEN** the kinds table has a row `Photo (SAM + Spark)` reading `26`, `76% · 20/26`, `7% · 2/26`, `11% · 3/26`, `3% · 1/26` and `1`, under the headers `Read`, `Decided`, `Accepted`, `Edited at capture`, `Corrected by a nurse`, `Rejected` and `Abandoned`

#### Scenario: Type table
- **WHEN** the type table's `urine` row is `{ model: "urine", n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: "stoma", n: 1 }] }`
- **THEN** the "Drink and fluid" table has a row `Urine` reading `6`, `80% · 4/5` and `Stoma 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`

#### Scenario: Volume and negatives
- **WHEN** the volume error is `{ of: 24, mae_ml: 18, within: { n: 20, of: 24, pct: 83 }, no_volume: 1 }`, and the negatives are 2 confirmed, 1 overridden as `water` and 1 read with nothing drafted
- **THEN** the section reads `18 mL mean error · within ±25 mL 83% · 20/24 · 1 with no volume read`
- **AND** it reads `Nothing to chart: 2 confirmed · 1 charted anyway (Drink 1) · 1 read with nothing drafted`

#### Scenario: Meal overridden
- **WHEN** the negatives are 1 confirmed and 1 overridden as `meal`
- **THEN** the section reads `Nothing to chart: 1 confirmed · 1 charted anyway (Meal 1)`

#### Scenario: Mean error withheld
- **WHEN** the volume error is `{ of: 4, mae_ml: null, within: { n: 3, of: 4, pct: null }, no_volume: 0 }`
- **THEN** the volume line reads `— mean error · within ±25 mL — · 3/4`

#### Scenario: No reads
- **WHEN** the summary has no drafts in any kind
- **THEN** the section reads `No AI reads in the last 7 days`, and shows no chart, table, picker or lines

## ADDED Requirements

### Requirement: Chart or table
The Model accuracy section SHALL offer `Chart | Table`, Chart first. Chart shows "Outcome bars". Table shows the kinds table, the chart's table view, under the headers `Read`, `Decided`, `Accepted`, `Edited at capture`, `Corrected by a nurse`, `Rejected` and `Abandoned`, one row per kind with drafts. The choice is kept while the view stays open. Switching sends no request and makes no model request.

#### Scenario: Chart first
- **WHEN** the Data quality view of 3A opens with photo and tray reads in the window
- **THEN** `Chart` is pressed and the outcome bars show, and no kinds table

#### Scenario: Tray row
- **WHEN** Table is picked, and the `tray` `sam+spark` row has 12 decided drafts with accepted `{ n: 8, of: 12, pct: 66 }`, edited_at_capture `{ n: 1, of: 12, pct: 8 }`, corrected_by_nurse `{ n: 2, of: 12, pct: 16 }`, rejected `{ n: 1, of: 12, pct: 8 }` and 0 abandoned, and the `photo` `spark` row has no drafts
- **THEN** the kinds table has a row `Tray (SAM + Spark)` reading `12`, `66% · 8/12`, `8% · 1/12`, `16% · 2/12`, `8% · 1/12` and `0`
- **AND** it has no `Photo (Spark only)` row

### Requirement: Outcome bars
The Chart view SHALL draw a horizontal bar per read kind with `MIN_N` or more decided drafts, split by share into accepted, edited at capture, corrected by a nurse and rejected, in that order, beside its label and `<rate> accepted`, under a legend naming the four in order. A tap, click, hover or Enter on a bar's row opens a popup listing them as `<Outcome> <rate>`. A kind with fewer than `MIN_N` decided drafts, and at least one draft, reads `Too few to chart · <n> decided`. It makes no request.

#### Scenario: Photo bar
- **WHEN** the `photo` `sam+spark` row has 20 accepted, 2 edited at capture, 3 corrected by a nurse and 1 rejected of 26 decided drafts
- **THEN** its bar is labelled `Photo (SAM + Spark)` and `76% · 20/26 accepted`, with segments 76.92%, 7.69%, 11.54% and 3.85% wide, in that order
- **AND** its row's popup lists `Accepted 76% · 20/26`, `Edited at capture 7% · 2/26`, `Corrected by a nurse 11% · 3/26` and `Rejected 3% · 1/26`, taken from that row's rates

#### Scenario: Too few to chart
- **WHEN** the `text` row has 4 decided drafts, the `photo` `spark` row has 2 pending drafts and none decided, and the `voice` row has no drafts
- **THEN** the chart shows `Typed note` with `Too few to chart · 4 decided` and `Photo (Spark only)` with `Too few to chart · 0 decided`, each with no bar
- **AND** it does not list `Voice note`

#### Scenario: Legend and an empty segment
- **WHEN** the `tray` `sam+spark` row has 9 accepted and 3 corrected by a nurse of 12 decided drafts
- **THEN** the legend reads `Accepted`, `Edited at capture`, `Corrected by a nurse` and `Rejected`, in that order
- **AND** the tray bar has two segments, 75% and 25% wide

#### Scenario: Opened by a tap
- **WHEN** at 390 px the `Photo (SAM + Spark)` row is tapped, and then the page is tapped outside it
- **THEN** the first tap opens the popup with the four lines of "Photo bar", and the second tap closes it
- **AND** at 1100 px, hovering the row with the mouse, or pressing Enter on the focused row, opens the same popup, and Escape closes it

### Requirement: Outcome colours
The bars SHALL colour accepted `#2a78d6`, edited at capture `#eb6834`, corrected by a nurse `#1baf7a` and rejected `#eda100`, in the legend's order. None is a status colour (`ok`, `warn`, `danger`, `pending`), so a bar never reads as a prompt. Every segment is named by the legend and its row's popup, and labels and values use the text colours, never a segment's colour. It makes no request.

#### Scenario: Hues
- **WHEN** the chart is drawn with all four outcomes
- **THEN** the legend's swatches are `#2a78d6`, `#eb6834`, `#1baf7a` and `#eda100`, in order
- **AND** none of them is `#15803d`, `#a15c07`, `#b91c1c` or `#6d28d9`, and the label `76% · 20/26 accepted` is drawn in `#0f172a`

### Requirement: Class table picker
The section SHALL show one class table, chosen with a `Table` select of `Drink and fluid` (first, the type table), `Urine colour`, `Container`, `Dish`, `Dish portion` and `Meal portion`. Every rate in it reads as in "Rates shown with their counts". A table with no rows keeps its header row over one cell reading `No <drafts> in the last 7 days`, or for a tray table when tray reads exist, `No reviewed tray meals in the last 7 days`. Picking sends no request and makes no model request.

#### Scenario: Dish table
- **WHEN** `Dish` is picked, the `dish_kind` table's `rice` row is `{ model: "rice", n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: "bread", n: 1 }] }`, its `fruit` row has the correction `{ to: "none", n: 1 }`, and its `none` row has n 1 and the correction `{ to: "dairy", n: 1 }`
- **THEN** the table has a row `Rice` reading `6`, `80% · 4/5` and `Bread 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`
- **AND** the `fruit` row's changes read `Removed 1`, and the `none` row is labelled `Not read (added by staff)`

#### Scenario: Portion table
- **WHEN** `Dish portion` is picked, and `dish_portion` is over 5 pairs with `exact` `{ n: 2, of: 5, pct: 40 }`, `within_quarter` `{ n: 3, of: 5, pct: 60 }` and `quarters_off` `[2, 1, 1, 0, 1]`
- **THEN** the table reads `Same portion 2`, `1 quarter off 1`, `2 quarters off 1`, `3 quarters off 0` and `4 quarters off 1`
- **AND** above it, `Same 40% · 2/5 · within a quarter 60% · 3/5`

#### Scenario: Container table
- **WHEN** `Container` is picked, and the `urinal` row has 6 reads, 6 decided, accepted `{ n: 5, of: 6, pct: 83 }`, corrected `{ n: 1, of: 6, pct: 16 }`, rejected `{ n: 0, of: 6, pct: 0 }` and 6 of 6 volumes within tolerance
- **THEN** the table has a row `Urinal` reading `6`, `6`, `83% · 5/6`, `16% · 1/6`, `0% · 0/6` and `100% · 6/6`, under the headers `Container read`, `Reads`, `Decided`, `Accepted`, `Corrected`, `Rejected` and `Within ±25 mL`

#### Scenario: Empty tables
- **WHEN** the window has no tray reads and no urine drafts, and `Dish`, `Dish portion`, `Meal portion` and `Urine colour` are picked in turn
- **THEN** each keeps its header row, over one cell reading `No tray reads in the last 7 days` for the first three and `No urine colour drafts in the last 7 days` for the last

#### Scenario: Tray reads not yet reviewed
- **WHEN** the window's only tray reads are one never saved and one whose lunch's 150 mL entry is pending, and `Dish`, `Dish portion` and `Meal portion` are picked in turn
- **THEN** each keeps its header row, over one cell reading `No reviewed tray meals in the last 7 days`

### Requirement: Kept drafts, meal fluid and top corrections
The section SHALL read `Drafts kept <rate> · not kept <rate> (<r> rejected, <a> abandoned)`, with `, <t> retaken` before the `)` when above 0. When a tray read is in the window, it reads `Fluid with meals: ` and the meal fluid error as the volume line without its `with no volume read` part, then ` · <k> added by staff` and ` · <m> removed` when above 0. It reads `Most changed: ` and up to 5 corrections as `<From> → <To> <n>`, joined by ` · `, or `Most changed: none`. It makes no request.

#### Scenario: Kept drafts
- **WHEN** `positives` is kept `{ n: 46, of: 50, pct: 92 }`, not kept `{ n: 4, of: 50, pct: 8 }`, rejected 3, abandoned 1 and retaken 0
- **THEN** the section reads `Drafts kept 92% · 46/50 · not kept 8% · 4/50 (3 rejected, 1 abandoned)`

#### Scenario: Retaken drafts
- **WHEN** `positives` is kept `{ n: 46, of: 50, pct: 92 }`, not kept `{ n: 4, of: 50, pct: 8 }`, rejected 3, abandoned 1 and retaken 2
- **THEN** the section reads `Drafts kept 92% · 46/50 · not kept 8% · 4/50 (3 rejected, 1 abandoned, 2 retaken)`

#### Scenario: Fluid with meals
- **WHEN** `meal_fluid` is `{ volume: { of: 6, mae_ml: 20, within: { n: 5, of: 6, pct: 83 }, no_volume: 1 }, removed: 1 }`
- **THEN** the section reads `Fluid with meals: 20 mL mean error · within ±25 mL 83% · 5/6 · 1 added by staff · 1 removed`

#### Scenario: Most changed
- **WHEN** `top_corrections` is type `water` → `food` 3, urine colour `dark` → `red` 2, dish kind `rice` → `bread` 2, type `urine` → `stoma` 1 and urine colour `yellow` → `dark` 1
- **THEN** the section reads `Most changed: Drink → Food 3 · Urine dark → red 2 · Rice → Bread 2 · Urine → Stoma 1 · Urine yellow → dark 1`

#### Scenario: Nothing changed
- **WHEN** `top_corrections` is `[]` and no tray read is in the window
- **THEN** the section reads `Most changed: none`, and has no `Fluid with meals` line

### Requirement: Hospital model accuracy view
The nurse home SHALL offer `Wards | Model accuracy` under its census header. Model accuracy (`/n?view=model`) replaces the ward cards with the Model accuracy section for the whole hospital, subtitled `All wards · Last 7 days`, from one `GET /api/quality/model?days=7` sent when it opens. Wards (`/n`, the default) shows the cards and sends no quality request, and any other `view` reads as Wards. It makes no model request.

#### Scenario: Open the model view
- **WHEN** Anita Thomas opens `/n?view=model`
- **THEN** the requests are `GET /api/wards` and `GET /api/quality/model?days=7`, with no `ward` parameter, and no `/api/ai` request
- **AND** the page shows `Hospital census`, `Model accuracy` pressed, the section titled `Model accuracy` and subtitled `All wards · Last 7 days`, with its chart, picker and lines, and no ward card

#### Scenario: Back to wards
- **WHEN** on `/n?view=model`, `Wards` is tapped
- **THEN** the address is `/n`, the ward cards show, and no further `/api/quality/model` request is sent

#### Scenario: Unknown view
- **WHEN** `/n?view=x` is opened
- **THEN** it shows the ward cards with `Wards` pressed, and sends no `/api/quality/model` request
