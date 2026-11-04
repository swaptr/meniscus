# Spec Delta

## MODIFIED Requirements

### Requirement: Intake and output breakdown
The bed review SHALL show the last 24 hours' approved intake and output as two stacked bars split by category, each segment labelled with its category and mL. Drinks (`water` entries; soup stays under food) are split by drink kind instead, each labelled `<Kind> <mL>`, with drinks without a kind together as `Drink <mL>`. The urine segment is drawn in the colours seen, as in "Urine drawn in its own colour". Its label stays `Urine <mL>`.

#### Scenario: Mixed day
- **WHEN** approved entries are water 500, food 300, IV 1000 and urine 600 mL, none with a drink kind
- **THEN** the intake bar has segments `Drink 500`, food 300 and IV 1000, and the output bar has one segment, urine 600

#### Scenario: Drinks by kind
- **WHEN** approved drinks are tea 200 and 150, water 400, coconut water 200, and one 100 mL drink with no kind
- **THEN** the intake bar's drink segments are `Water 400`, `Tea 350`, `Coconut water 200` and `Drink 100`, largest first, and no request is made

### Requirement: Class table picker
The section SHALL show one class table, chosen with a `Table` select of `Drink and fluid` (first, the type table), `Drink kind`, `Urine colour`, `Container`, `Dish`, `Dish portion` and `Meal portion`. Every rate in it reads as in "Rates shown with their counts". A table with no rows keeps its header row over one cell reading `No <drafts> in the last 7 days`, or for a tray table when tray reads exist, `No reviewed tray meals in the last 7 days`. Picking sends no request, and no model request.

#### Scenario: Dish table
- **WHEN** `Dish` is picked, the `dish_kind` table's `rice` row is `{ model: "rice", n: 6, kept: { n: 4, of: 5, pct: 80 }, corrections: [{ to: "bread", n: 1 }] }`, its `fruit` row has the correction `{ to: "none", n: 1 }`, and its `none` row has n 1 and the correction `{ to: "dairy", n: 1 }`
- **THEN** the table has a row `Rice` reading `6`, `80% · 4/5` and `Bread 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`
- **AND** the `fruit` row's changes read `Removed 1`, and the `none` row is labelled `Not read (added by staff)`

#### Scenario: Drink kind table
- **WHEN** `Drink kind` is picked, and the `drink_kind` table's `tea` row is `{ model: "tea", n: 4, kept: { n: 3, of: 4, pct: null }, corrections: [{ to: "coffee", n: 1 }] }`
- **THEN** the table has a row `Tea` reading `4`, `— · 3/4` and `Coffee 1`, under the headers `Model read`, `Decided`, `Kept` and `Changed to`
- **AND** with no rows, it reads `No drink drafts in the last 7 days`

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

## ADDED Requirements

### Requirement: Drinks named on the bed review
Each entry with a `drink`, in the bed review's log, pending list and entry timeline, SHALL show the kind's icon and label in place of the category, as `<Kind> <mL>` (`Drink` for `other`), with its item after it when that differs from the label ignoring case. Entries without a `drink` show as now. The icon has the kind's label as its accessible name. It makes no request.

#### Scenario: Masala chai in the log
- **WHEN** the log lists an approved 150 mL entry with `drink: tea` and item `masala chai`, and a pending 200 mL entry with `drink: ors` and item `ORS`
- **THEN** the first reads `Tea 150 mL · masala chai` with the tea icon, and the second `ORS 200 mL` with no item after it

#### Scenario: Older drink
- **WHEN** the log lists a 200 mL water entry with `drink: null` and item `cup`
- **THEN** it reads as it does today, with the category label

### Requirement: Meal fluids with their kind
In "What the AI read" on the bed review's meals, each fluid SHALL show its kind's icon and read `<name> · <Kind> · <mL>`, or `<name> · <mL>` when the name is the kind's label ignoring case. It makes no request.

#### Scenario: Lunch with chaas and soup
- **WHEN** a lunch's read has fluids `chaas` (`buttermilk`, 200 mL) and `soup` (`soup`, 150 mL)
- **THEN** "What the AI read" lists `chaas · Buttermilk · 200 mL` and `soup · 150 mL`, each with its kind's icon

### Requirement: Correct a drink's kind
In entry details, Amend on an approved `water` or `food` entry SHALL offer "Drink" to a nurse or matron: a picker of the eleven kinds set to the entry's kind, or unset when it has none. A changed kind is sent as `drink` with the reason, in one request. The timeline shows the change as `drink <from> → <to>`, with `none` for no kind. It makes no model request.

#### Scenario: Tea to coffee
- **WHEN** Anita Thomas (id 4) opens Amend on an approved 150 mL drink with `drink: tea` and item `masala chai`, picks `Coffee` and gives the reason `it was coffee`
- **THEN** saving sends exactly one request, `POST /api/entries/<id>/amend` with `{ drink: "coffee", reason: "it was coffee" }` and `X-Staff-Id: 4`, and no `/api/ai` request
- **AND** after it, the log reads `Coffee 150 mL`, and the timeline line reads `Amended drink Tea → Coffee by Anita Thomas (nurse): it was coffee`, with its time

#### Scenario: Not a drink
- **WHEN** Amend is opened on an approved urine entry
- **THEN** it shows no "Drink" picker
