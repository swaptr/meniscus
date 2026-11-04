# Spec Delta

## ADDED Requirements

### Requirement: Fluid balance chart
The bed review SHALL plot cumulative approved intake and output over the last 24 hours as two step lines, one step per approved entry, and show the final balance. Pending and rejected entries SHALL NOT move the lines.

#### Scenario: Day so far
- **WHEN** the approved entries are water 500 mL 10 h ago, urine 300 mL 6 h ago and water 200 mL 2 h ago, plus a pending 100 mL tea
- **THEN** the intake line steps to 500 and then 700, the output line steps to 300, and the balance reads `+400 mL`

### Requirement: Urine output rate against the threshold
The bed review SHALL plot the approved urine rate over the preceding 6 hours, in mL/kg/h, at each hour of the last 24 hours, leaving out hours less than 6 hours after admission. It SHALL draw a reference line at 0.5 mL/kg/h and mark the points below it. Without a recorded weight it SHALL show "Weight not recorded" instead of the plot.

#### Scenario: Low rate now
- **WHEN** a 60 kg patient has 120 mL of approved urine in the last 6 hours
- **THEN** the latest point is 0.33 mL/kg/h and is marked below the 0.5 line

#### Scenario: No weight
- **WHEN** the admission has no weight
- **THEN** the chart area reads `Weight not recorded`

#### Scenario: Recent admission
- **WHEN** a 60 kg patient was admitted 8 hours ago
- **THEN** only the 3 latest hourly points are plotted

#### Scenario: Just under the line
- **WHEN** a 60 kg patient has 179 mL of approved urine in the last 6 hours
- **THEN** the latest point reads 0.50 mL/kg/h and is marked below the line, matching the low-output prompt (179 mL is under 0.5 × 60 × 6 = 180 mL)

### Requirement: Intake and output breakdown
The bed review SHALL show the last 24 hours' approved intake and output as two stacked bars split by category, each segment labelled with its category and mL.

#### Scenario: Mixed day
- **WHEN** approved entries are water 500, food 300, IV 1000 and urine 600 mL
- **THEN** the intake bar has segments water 500, food 300 and IV 1000, and the output bar has one segment, urine 600

### Requirement: Photo strip
The bed review SHALL show the capture photos of the last 24 hours as thumbnails, at most the 12 newest, newest first, each with its time and volume. Tapping one SHALL open that entry's details.

#### Scenario: Three photos
- **WHEN** four entries in the last 24 hours exist and three of them have photos
- **THEN** three thumbnails are shown, newest first

#### Scenario: Many photos
- **WHEN** 15 entries in the last 24 hours have photos
- **THEN** the 12 newest are shown

### Requirement: Ward activity strip
Each bed card on the ward dashboard SHALL show a 24-cell strip of the last 24 hours. A cell SHALL be marked when intake that is not rejected was logged in that hour, the intake the logging-gap prompt counts, so gaps are visible.

#### Scenario: Gap since morning
- **WHEN** a bed's `hourly.in_logged` is non-zero only at indices 5, 9 and 13
- **THEN** exactly cells 5, 9 and 13 are marked and cells 14 to 23 are empty

### Requirement: Printable daily chart
`/n/<id>/print` SHALL show one row per clock hour for the 24 clock hours ending with the current one, oldest first, giving the hour, approved intake mL, approved output mL and running balance, followed by a totals row, like the paper I&O form. Printing SHALL hide the app chrome.

#### Scenario: Two busy hours
- **WHEN** at 14:30 the approved entries are a 300 mL drink at 09:10 and 400 mL urine at 11:45
- **THEN** the first row is `15:00` and the last `14:00`; the `09:00` row reads in 300, out 0, balance +300; the `11:00` row reads in 0, out 400, balance −100; the totals row reads in 300, out 400, balance −100

### Requirement: Intake and output log by shift
The bed review SHALL list entries in 12-hour shifts, newest first: day 08:00–20:00 and night 20:00–08:00, local time. Each shift shows its approved intake and output totals and its pending count. Each entry SHALL show its time, a badge coloured by direction with category and volume, a source badge and a status badge.

#### Scenario: Two shifts
- **WHEN** a bed has, on 2 Nov, an approved 200 mL drink at 09:00, an approved 300 mL urine at 19:30 and a pending 100 mL drink at 21:00
- **THEN** the log shows the 2 Nov night shift first, with in 0, out 0 and 1 pending, then the 2 Nov day shift with in 200 and out 300

### Requirement: Filter and sort the log
The log SHALL be a table filtered by direction, category, status, source, period and free text over item and notes. Period is "this shift", "last 24 h" or "all". Choosing a column header SHALL sort by that column (time, type, volume, source or status), either way; rows group by shift only when sorted by time. It SHALL show 25 rows per page, the page's range, and how many entries match out of the total.

#### Scenario: Approved output only
- **WHEN** the log holds approved urine 300 mL, pending urine 400 mL, approved drink 200 mL and rejected drain 50 mL, and is filtered to direction out and status approved
- **THEN** only the 300 mL urine is listed and the count reads `1 of 4`

#### Scenario: Largest first
- **WHEN** the same log is sorted by volume, largest first, with no filters
- **THEN** the volumes read 400, 300, 200, 50 with no shift groups

#### Scenario: Pending first
- **WHEN** the same log is sorted by status
- **THEN** the pending 400 mL urine comes first and the rejected 50 mL drain last

#### Scenario: Search
- **WHEN** the log holds drinks with items `coconut water` and `tea` and the search is `coconut`
- **THEN** only the coconut water entry is listed

#### Scenario: Pages
- **WHEN** 30 entries match, sorted newest first
- **THEN** page 1 lists the 25 newest and reads `1–25 of 30`, and page 2 lists the 5 oldest and reads `26–30 of 30`
