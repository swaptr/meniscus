# Spec Delta

## Purpose

How every screen of the web app looks and behaves on a phone and a desktop: layout width, tap targets, input size, contrast, text size, focus, motion, dialogs, peeks, navigation, charts, result messages, choice controls, and how times, dates, confidence and volumes are written. Each rule holds on every route, so a new screen inherits it.

## ADDED Requirements

### Requirement: Fits a phone screen
Every route SHALL fit a 390 px wide viewport, and a 320 px one, with no horizontal page scroll: the document's scroll width equals the viewport width. Content wider than the screen, such as a table, scrolls inside its own region, which is focusable and labelled with a name ending `scrolls sideways`. No route makes a model request to lay itself out.

#### Scenario: Ward dashboard at 390 px
- **WHEN** Anita Thomas opens `/n/w/2` (3A) in a 390 × 844 viewport
- **THEN** `document.documentElement.scrollWidth` is 390, not 513, and the legend lists every prompt kind the ward's bed cards can show, bag prompts included, as rows rather than chips

#### Scenario: Every route at 320 px
- **WHEN** each of `/`, `/a`, `/a/bed/<token>`, `/a/round?ward=2`, `/n`, `/n/w/2`, `/n/w/2?view=quality`, `/n/w/2?view=qr`, `/n/10`, `/n/10/print`, `/d` and `/d/10` opens in a 320 px viewport
- **THEN** each route's scroll width is 320

#### Scenario: Wide table scrolls in place
- **WHEN** the Data quality view of 3A opens at 390 px and its per-recorder table is 560 px wide
- **THEN** the page does not scroll sideways, the table's wrapper does, the wrapper takes keyboard focus, and its accessible name ends `scrolls sideways`

### Requirement: Targets big enough for gloved hands
Every interactive element (button, link, choice chip, segmented option, switch, table sort button, `summary`, pager and breadcrumb link) SHALL have a hit area at least 44 × 44 px, and the main commit of a capture or sign-in screen is at least 52 px tall. A whole-row link or button counts as one target. Text links inside a sentence are exempt when the sentence holds another target of 44 px for the same action.

#### Scenario: Default button
- **WHEN** the bed review `/n/10` shows "Print chart", "Close" in the entry details and the entry log pager
- **THEN** each is at least 44 px tall and 44 px wide

#### Scenario: Entry log row opens its peek
- **WHEN** the entry log on `/n/10` lists an entry at 14:05
- **THEN** the whole row is one button at least 44 px tall that opens the entry's peek, and no separate `Details ›` text button is shown

#### Scenario: Capture commit
- **WHEN** Ravi Kumar reaches the check screen for a drink on `/a/bed/<token>`
- **THEN** "Save" is at least 52 px tall

### Requirement: Inputs that do not zoom
Every text, number, time, date and select control and every textarea SHALL render its text at 17 px (at least 16 px, so iOS Safari does not zoom on focus), be at least 48 px tall, and have a boundary that meets 3:1 against its background.

#### Scenario: Reject reason note
- **WHEN** a nurse opens "Reject…" on a pending entry on `/n/10` and focuses the note field
- **THEN** its computed font size is 17 px, its height is at least 48 px, and its border colour is `#78899a` (3.59:1 on white)

#### Scenario: Entry log filters
- **WHEN** the entry log on `/n/10` shows its category select and time inputs
- **THEN** each has a computed font size of 17 px and a height of at least 48 px

### Requirement: Contrast checked
Every text colour SHALL meet 4.5:1 against each background it is drawn on, and every non-text boundary or mark that carries meaning (input, checkbox, switch track, segmented edge, progress fill against its track, chart line) meets 3:1, as computed with the WCAG 2.2 relative-luminance formula from the theme's colours.

#### Scenario: Output text on its tint
- **WHEN** an `Out` chip draws its text on the output tint `#f5e6f1`
- **THEN** the text colour is `#7d3570`, at 6.68:1, and output marks on white are `#9a4a8a`, at 5.64:1, not the warning-like `#b45309`

#### Scenario: Capture tile hint
- **WHEN** the primary capture tile on `/a/bed/<token>` shows its hint on the accent `#0f766e`
- **THEN** the hint is solid `#ffffff` at 5.47:1, not white at 85% opacity at 4.42:1

#### Scenario: Progress track
- **WHEN** the Care plan section on `/n/10` draws the fluid limit bar at 82%
- **THEN** its track is `#d0dbe0`, and every fill colour (accent `#0f766e`, ok `#137336`, warn text `#855900`, danger `#b91c1c`) meets 3.8:1 or more against it

### Requirement: Text at least 12 px
No text in the web app SHALL render below 12 px, including bed-number and ward-code labels, chart ticks and axis labels, timeline kinds, table headers and stat labels.

#### Scenario: Bed badge label
- **WHEN** the attendant bed picker `/a` and the bed review banner on `/n/10` show bed 5 of 3A
- **THEN** the `3A` label above the number has a computed font size of 12 px or more, never 9, 10 or 11 px

#### Scenario: Chart ticks
- **WHEN** the fluid balance chart on `/n/10` draws its hour ticks
- **THEN** each tick label is 12 px or more

### Requirement: Visible keyboard focus
Every focusable element SHALL show, when focused from the keyboard, a 2 px solid outline in the accent colour `#0f766e` offset 2 px outside it, and no element removes the browser's outline without this one.

#### Scenario: Segmented option
- **WHEN** Anita Thomas presses Tab until the "Data quality" option of the ward view switch on `/n/w/2` is focused
- **THEN** it shows `outline: 2px solid rgb(15, 118, 110)` with `outline-offset: 2px`

#### Scenario: Urine colour chip and capture tile
- **WHEN** a keyboard user focuses the "Amber" urine colour chip on the check screen, and then a capture tile on `/a/bed/<token>`
- **THEN** each shows the same 2 px accent outline offset 2 px

### Requirement: Reduced motion
When the device asks for reduced motion (`prefers-reduced-motion: reduce`), no transition or animation in the web app SHALL take longer than 0 ms, except that the recording indicator keeps a static dot. Otherwise motion animates only opacity, transform and stroke-dashoffset, at 120 ms for controls, 150 ms for dialogs and peeks, and 480 ms for the two signature moments (an approval, a segmented photo), and nothing animates on load, refresh or in lists.

#### Scenario: Switch under reduced motion
- **WHEN** reduced motion is on and Anita Thomas turns on "My beds" on `/n/w/2`
- **THEN** the switch's computed `transition-duration` is `0s`

#### Scenario: Contours under reduced motion
- **WHEN** reduced motion is on and an entry peek opens on a segmented photo
- **THEN** the contours are drawn in their final state at once, with a computed `animation-duration` of `0s`

#### Scenario: Dialog without reduced motion
- **WHEN** reduced motion is off and the bed QR dialog opens on `/n/w/2?view=qr`
- **THEN** its popup animates opacity and transform over 150 ms, and no `height`, `width` or `box-shadow` is transitioned

### Requirement: One dialog layout
Every dialog and sheet SHALL use one layout: a bottom sheet in viewports up to 640 px wide and a centred card from 641 px, with the same backdrop, 16 px padding, a title and description at the top, `Saved in the name of <name and role>.` on any dialog that writes, then an error notice, then the actions, Cancel first and the commit last. Tab keeps focus inside the open dialog, and closing returns it to the control that opened it.

#### Scenario: Bed QR on a phone
- **WHEN** a nurse opens a bed's QR card from `/n/w/2?view=qr` at 390 px
- **THEN** the dialog is anchored to the bottom of the viewport, as the reject dialog is, not centred

#### Scenario: Reason to open another ward
- **WHEN** Anita Thomas opens `/n/w/3` (5B) at 1100 px and the reason dialog appears
- **THEN** it is a centred card with the same backdrop colour and 16 px padding as the reject dialog

#### Scenario: Focus returns
- **WHEN** a nurse opens "Reject…" on a pending entry and presses Escape
- **THEN** the dialog closes and the "Reject…" button has focus

#### Scenario: Focus stays inside past a disabled last button
- **WHEN** Anita Thomas opens "Assign dietitian" before picking a dietitian, so Assign is disabled, and presses Tab 12 times
- **THEN** focus stays inside the dialog after every press, reaching Assign as a focusable button with `aria-disabled="true"`

### Requirement: Results in one toast
The result of an action the user just took SHALL appear in one toast fixed above the tab bar (viewport bottom on desktop), one at a time, a new result replacing the shown one: a success announced politely for 6 s, a failure (such as the server unreachable) assertively until dismissed. A refusal the server answers about what was sent (403, 409, 422) stays inline in the dialog, form or section that sent it. No screen has another result area.

#### Scenario: Saved on a long page
- **WHEN** Ravi Kumar, scrolled to the bottom of `/a/bed/<token>`, saves a 200 mL drink
- **THEN** a toast reading `Saved 200 mL drink. Waiting for nurse approval.` is visible in the viewport, in a polite live region, and it is gone 6 s later

#### Scenario: One at a time
- **WHEN** Anita Thomas approves an entry on `/n/10` and, within 6 s, rejects another
- **THEN** only the rejection's toast is shown

#### Scenario: Failure stays
- **WHEN** saving fails with the server unreachable
- **THEN** the toast holds the failure text in an assertive live region and is still shown after 10 s, until it is dismissed

#### Scenario: Errors stay inline
- **WHEN** a voice note is answered 422 `audio_too_long`, a referral 409 `no_dietitian`, and a diet save 403 `forbidden` because a dietitian changed the targets
- **THEN** `Recording over 10 minutes. Record a shorter note.` shows on the capture screen ("Recording too long"), `No dietitian covers Medical Ward 3A to take the referral.` in the Nutrition section, and `Only a dietitian can change energy and protein targets.` in the diet form, each inline, and no toast is shown

### Requirement: One choice chip
Every pick-one or pick-several choice in a form (meal, portion, IDDSI level, urine colour, reject reason, category, bag event, referral reason, diet type) SHALL use one chip: at least 48 px tall, the same corner radius and boundary, exposed as a radio in a radio group (or a pressed toggle for several), and selected shown as the accent fill `#0f766e` with white text. A selected chip never takes a status colour.

#### Scenario: Reject reason
- **WHEN** a nurse picks "Wrong volume" in the reject dialog
- **THEN** that chip has `aria-checked="true"`, an accent fill and white text, not a red tint

#### Scenario: Urine colour
- **WHEN** Ravi Kumar picks "Dark amber" on the check screen
- **THEN** that chip has the accent fill and white text, with the colour swatch still shown inside it

#### Scenario: Bag event
- **WHEN** the bag check screen offers its event
- **THEN** "Emptied after photo" and "Bag changed" are chips in one radio group, so picking one unpicks the other, with no switch beside them

### Requirement: Times and dates written one way
The web app SHALL write every clock time as 24-hour `HH:MM` and every date day first with a fixed English month and no year (`3 Nov`, or `Tue 3 Nov` with the weekday), whatever the device's locale. A native time input that may show 12-hour text has the chosen time echoed beside it in `HH:MM`.

#### Scenario: US locale
- **WHEN** the device locale is `en-US` and an entry was charted on 3 November at 21:38
- **THEN** the entry log shows `21:38`, not `9:38 PM`, and its shift heading reads `Tue 3 Nov`, not `Tue, Nov 3`

#### Scenario: Not today
- **WHEN** at 08:10 on 4 November a care order shows when it was set, at 22:05 on 3 November
- **THEN** it reads `3 Nov 22:05`

#### Scenario: Time input echo
- **WHEN** Ravi Kumar sets "When" to 21:38 in a late entry by hand on an `en-US` device
- **THEN** `21:38` is shown beside the input

### Requirement: Confidence written one way
The web app SHALL write a model's confidence as a chip `<source> · <percent>%` (`Photo · 82%`), with no other wording, and draw it in the warn tone when it is below 75%, the same threshold everywhere.

#### Scenario: Meal read
- **WHEN** a meal read from a tray photo has confidence 0.82
- **THEN** the meal row reads `Photo · 82%`, not `82% confident`

#### Scenario: Low on the round
- **WHEN** a ward round reading has confidence 0.62
- **THEN** its chip reads `Photo · 62%` in the warn tone, and a reading at 0.75 reads `Photo · 75%` in the neutral tone

### Requirement: Units on every volume
Every volume the web app shows SHALL carry `mL` after a normal space, while a count or a percentage carries no unit.

#### Scenario: Ward list tiles
- **WHEN** the ward list `/n` shows 3A with 7 beds and 3 entries waiting
- **THEN** its figures read `7` and `3` with no `mL`, while its intake figure reads `1200 mL`

#### Scenario: Balance
- **WHEN** a bed's totals are 1500 mL in and 900 mL out
- **THEN** the balance reads `+600 mL`

### Requirement: Ward status from its beds
Each ward card on the ward list SHALL take its colour and label from the ward summary's `worst_tone` (its beds' worst open prompt, the same status rule as bed cards), else `Pending` when it has pending entries, else `On track`, never a fixed warning colour. It needs no request beyond `GET /api/wards`.

#### Scenario: Quiet ward
- **WHEN** every bed of 2C has no prompt and nothing pending
- **THEN** the 2C card has no warning edge and reads `On track`

#### Scenario: Ward with a red prompt
- **WHEN** one bed of HDU has a `Review now` prompt, so HDU's summary has `worst_tone: "danger"`
- **THEN** the HDU card has the danger edge and reads `Review now`, and only `GET /api/wards` was requested

### Requirement: No blank media boxes
A photo thumbnail that has not loaded, or failed, SHALL show a no-photo icon centred in its box, and a route that is not found or fails shows an icon and title that name that state, never the camera icon.

#### Scenario: Peek photo loading
- **WHEN** an entry peek on `/n/10` is waiting for its photo
- **THEN** the photo box shows the no-photo icon at the photo's aspect ratio, not an empty grey box

#### Scenario: Photo strip loading
- **WHEN** the opened photo strip on `/n/10` is waiting for a thumbnail
- **THEN** that box shows the no-photo icon, not an empty grey box

#### Scenario: Not found
- **WHEN** someone opens `/nope`
- **THEN** the screen reads `Page not found` with a not-found icon, not the camera icon

### Requirement: Peeks open by hover, tap and keyboard
Every peek (a floating card of detail about one row, tile, chart mark or figure) SHALL open 400 ms after a fine pointer rests on its trigger, at once on a tap, click, Enter or Space, and close 150 ms after the pointer leaves trigger and peek, on Escape (focus back to the trigger) or on a tap outside. Focus alone never opens one, one is open at a time, and up to 640 px wide it opens as a bottom sheet with a Close button.

#### Scenario: Hover dwell
- **WHEN** a mouse rests on the 14:05 entry row on `/n/10` for 400 ms
- **THEN** its peek opens, and a pointer that crosses five rows without resting opens none

#### Scenario: Tap on a phone
- **WHEN** a nurse taps the 14:05 entry row at 390 px
- **THEN** its peek opens as a bottom sheet with a Close button

#### Scenario: Keyboard
- **WHEN** a keyboard user Tabs to the 14:05 row, presses Enter, then Escape
- **THEN** the peek opens with focus inside it, then closes with focus back on the row
- **AND** tabbing past 25 rows without Enter opens no peek

### Requirement: Actions never only in a peek
Approve, Reject…, Save, Amend…, every destructive action and every link to a screen SHALL also be reachable without opening a peek, on the row or screen the peek belongs to, so nothing needs hover or a second surface.

#### Scenario: Pending row
- **WHEN** a pending 200 mL water entry is listed on `/n/10`
- **THEN** its row shows `Reject…` and `Approve` buttons, each at least 44 px, with no peek open

#### Scenario: Bed tile
- **WHEN** a bed tile on `/n/w/2` has a peek
- **THEN** the tile itself is a link to `/n/<admission id>`, and the peek opens from the tile's own 44 px `About bed 4` button, a sibling of that link, not inside it

### Requirement: Sidebar sections and links
From 768 px wide, every staff screen SHALL show a sidebar with headed sections, each shown only when it has a link: Capture (`Bed picker`, `Ward round`), Wards (one link per ward of the signed-in staff, then `All wards`), This ward (on a ward or bed: up to 6 beds needing review, `Data quality`, `QR cards`), Insights (`Model accuracy`) and Nutrition (`Worklist`, dietitians). The current page is marked `aria-current="page"`. It sends no request of its own.

#### Scenario: Nurse on 3A
- **WHEN** Anita Thomas, a nurse on 3A and 5B, opens `/n/w/2` at 1280 px
- **THEN** the sidebar shows the sections Capture, Wards, This ward and Insights in that order, Wards lists `3A`, `5B` and `All wards`, and no Nutrition section is shown

#### Scenario: Counts from the page's own load
- **WHEN** `/n/w/2` loads with 3 beds needing review and 8 pending entries
- **THEN** This ward lists those 3 beds in "Beds needing attention first" order, the 3A link shows `8` pending, and exactly two requests were made: `GET /api/admissions?ward=2` and `GET /api/wards/2/team`

#### Scenario: Not yet loaded
- **WHEN** Anita Thomas opens `/a` first
- **THEN** the ward links show no counts and the Wards heading has no `as of` time

### Requirement: Navigation on phones
Below 768 px wide, staff screens SHALL show a bottom bar of `Capture`, `Wards`, `Nutrition` (dietitians only) and `More`, each at least 44 px, and `More` opens the sidebar's sections in a drawer from the left that closes on a link, Escape, a tap outside or a swipe. It sends no request.

#### Scenario: More drawer
- **WHEN** Anita Thomas taps `More` on `/n/10` at 390 px and then `Data quality`
- **THEN** the drawer shows the same sections as the sidebar, then closes and `/n/w/2?view=quality` opens

#### Scenario: Attendant
- **WHEN** Ravi Kumar, an attendant, opens `/a` at 390 px
- **THEN** no bottom bar is shown

### Requirement: Quick jump
From 768 px wide, `/` or Ctrl+K (Cmd+K on a Mac) outside a text field, or the app bar's `Jump to` button, SHALL open a search dialog listing the signed-in staff's wards and the beds already loaded, filtered by ward code, bed number or patient name as one types. Arrow keys move, Enter opens and Escape closes, returning focus. It sends no request.

#### Scenario: Find a bed
- **WHEN** Anita Thomas has loaded `/n/w/2`, presses `/` and types `mwa`
- **THEN** the list shows `3A bed 5 · Joseph Mwangi · Review`, Enter opens `/n/<his admission id>`, and no request was sent while searching

#### Scenario: Typing in a field
- **WHEN** focus is in the reject note field and `/` is typed
- **THEN** a `/` is typed and no dialog opens

### Requirement: Charts have a text equivalent
Every chart SHALL have an equivalent in text: an accessible name that states its latest value against its limit or target, and a `Table` view (or a visually hidden table) listing every value it plots, with the same numbers and units. Every chart mark that a peek describes is also reachable by keyboard.

#### Scenario: Ward strip
- **WHEN** a bed tile on `/n/w/2` draws its 24-hour bars
- **THEN** its strip has an accessible name like `Last 24 hours: in 1400 mL, out 900 mL, no intake logged since 13:00`

#### Scenario: Accuracy small multiples
- **WHEN** the Model accuracy view shows one small chart per kind
- **THEN** its `Table` toggle lists each kind's accepted, edited, corrected and rejected counts and shares

#### Scenario: Breakdown by drink kind
- **WHEN** the bed review's intake and output breakdown has approved drinks with `drink: tea` 200 and 150 mL, `drink: water` 400 mL, `drink: coconut_water` 200 mL and `drink: null` 100 mL, and urine 600 mL
- **THEN** its table lists the intake rows `Water 400 mL`, `Tea 350 mL`, `Coconut water 200 mL` and `Drink 100 mL`, in that order, and the output row `Urine 600 mL`

### Requirement: Attendant screens stay simple
Every attendant screen (`/a`, `/a/bed/<token>`, `/a/round`) SHALL show one task at a time with at most 4 groups of controls before the commit, no chart, and no information reachable only in a peek, with its commit at least 52 px tall and the full width of a 390 px screen less the page padding.

#### Scenario: Check screen
- **WHEN** Ravi Kumar reaches the check screen for a 450 mL urine bag reading at 390 px
- **THEN** it shows the outlined photo, the volume stepper, the bag event chips, the colour chips and `Save 450 mL reading`, at least 52 px tall, and no chart or peek trigger

#### Scenario: Bed picker
- **WHEN** Ravi Kumar opens `/a`
- **THEN** each bed is one target at least 52 px tall and no ward statistics are shown

