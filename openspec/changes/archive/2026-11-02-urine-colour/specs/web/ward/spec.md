# Spec Delta

## ADDED Requirements

### Requirement: Urine colour beside urine counts
Wherever urine output is shown, the web app SHALL show an outlined colour swatch and the colour's name:
- each coloured urine entry;
- the admission's `urine_seen` beside the Out total and in the urine rate chart's header.

The swatch is filled with the entry's `urine_rgb`, the colour seen in its photo. It falls back to the name's reference colour only when no photo colour exists. A swatch from a pending entry adds `pending` to the name.

#### Scenario: Bag photographed dark
- **WHEN** bed 1 has a pending urine entry with `urine_colour: dark` and `urine_rgb: "#c9952f"`
- **THEN** its pending card shows a swatch filled `#c9952f` with the text `Dark amber`
- **AND** the bed's Out total shows the same swatch with `Dark amber · pending`

#### Scenario: Named in a note
- **WHEN** an approved urine entry has `urine_colour: red` and `urine_rgb: null`
- **THEN** its log row shows a swatch filled with the reference colour for red and the text `Red`

#### Scenario: No colour
- **WHEN** a urine entry has no `urine_colour` and the admission's `urine_seen` is null
- **THEN** no swatch is shown on the entry or beside the Out total

### Requirement: Urine drawn in its own colour
The bed review SHALL draw urine in the colours seen, not a category colour:
- in the Out bar, one outlined piece per run of same-coloured approved urine entries, in charted order;
- in the rate chart, each point filled with the newest approved urine colour at or before that hour.

Urine with no colour is drawn grey and titled `Colour not recorded`.

#### Scenario: Colour turns dark
- **WHEN** at 17:00, a 60 kg patient admitted 2 days ago has this approved urine in the last 24 hours:
  - 300 mL at 08:00, `pale`, `#f2eaa5`;
  - 400 mL at 12:00, `pale`, `#efe6a0`;
  - 200 mL at 16:00, `dark`, `#c48a24`
- **THEN** the urine part of the Out bar has two pieces:
  - 700 mL filled `#efe6a0`, the newest colour of the run;
  - 200 mL filled `#c48a24`
- **AND** the legend still reads `Urine 900 mL`
- **AND** the rate chart's 13:00 point is filled `#efe6a0` and its 16:00 point `#c48a24`

#### Scenario: No colour recorded
- **WHEN** the only approved urine is 600 mL with no colour
- **THEN** the urine part is one grey piece titled `Colour not recorded`, and the rate points are grey

## MODIFIED Requirements

### Requirement: Intake and output breakdown
The bed review SHALL show the last 24 hours' approved intake and output as two stacked bars split by category, each segment labelled with its category and mL. The urine segment SHALL be drawn in the colours seen, as in "Urine drawn in its own colour". Its label stays `Urine <mL>`.

#### Scenario: Mixed day
- **WHEN** approved entries are water 500, food 300, IV 1000 and urine 600 mL
- **THEN** the intake bar has segments water 500, food 300 and IV 1000, and the output bar has one segment, urine 600
