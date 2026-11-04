# Meniscus web: design contract (v2, "Graduated")

Every UI change in `apps/web` follows this file. Each rule names the token, component or helper to use, so a reviewer
can check a diff against it line by line. When this file and the code disagree, this file wins and the code is a
finding. The `ui-polish` change (`openspec/changes/ui-polish/`) builds v2. Changes that apply after it (scale-store,
postgres-store, read-queue) use only the recipes below.

Strings quoted in a spec (`openspec/specs/**`, `openspec/changes/*/specs/**`) are binding copy. This file never
overrides a spec'd string. To change one, change the spec.

Baselines: the v1 audit of 2026-11-03 (`/tmp/ui-audit-2026-11-03/findings.md`, 47 findings), and the v2 mock
(`/tmp/ui-redesign/mock.html`, screenshots `mock-1280.png`, `mock-1280-ward.png`, `mock-390-ward.png`,
`mock-390-bed.png`, `mock-390-capture.png`). The quality bar is a polished commercial clinical product: every state is
designed, every number is formatted, every edge case has copy, and nothing looks like a prototype. Palette validation output: `/tmp/ui-redesign/validator-report.txt`.

---

## 1. Direction and principles

**Graduated.** Meniscus borrows the look of the things ward staff measure with: the jug, the urine bag and the paper fluid
chart. Every figure sits on its own scale, so a volume is drawn against its limit, capacity, target or threshold. The
whole ward reads as one chart on a shared 24-hour rail, and detail (the photo, the read, the history) opens in a
peek, only when someone asks for it.

The palette is cool and quiet: saline grey-blue surfaces, ink text, theatre teal for actions, saline blue for intake and
mulberry for output. Status colours never double as data colours.

1. **Next action first.** Every nurse and dietitian home opens on what needs doing next, in order (overdue, then due
   soon, then waiting), with counts by action. Everything else on the screen supports that list.
2. **Dense for staff, simple for attendants** (2.6 "Density by role"). Dashboards are dense; the bed review holds a lot
   but every item is one tap away; attendant capture screens are large and few-choice.
3. **Detail on demand.** Photos, evidence, model reads, history and per-metric breakdowns live in peeks (5.1) and sheets
   (5.2), fetched when opened. A screen never shows a photo gallery or a card per fact.
4. **Every number on its scale.** A volume with a limit, capacity, target or threshold is drawn against it: a gauge
   (5.12), a rule on a chart (6), or `<value>/<of> mL`. A bare number needs a reason.
5. **One rail of time.** Anything over the last 24 h uses the same hour rail: round-hour ticks, oldest left, `now` at the
   right edge as a dashed ink line. Bed tiles, board rows, the balance timeline and shift sparklines line up.
6. **A charting aid, not a diagnostic device.** Prompts ask for review ("Review", "Check"). A nurse approves every
   entry. Never write "abnormal", "diagnosis", "danger" or "risk" in UI copy.
7. **Gloved hands, small phones, bad light.** Phone first (390 px). Every target is 44 px or more, and the main commit on
   a capture screen is 52 px. Density comes from layout and type, never from smaller targets.
8. **Never colour alone.** Every tone has a text label and an icon or glyph. Every chart has a text equivalent.
9. **Required actions are never hidden behind hover.** Approve and Reject… stay on the row. A peek is a shortcut, never
   the only path.
10. **One way to do each thing.** Use the recipe in section 5. When none fits, add one here in the same change.
11. **Low-end Android first.** No web fonts, no blur, no chart library, no new runtime dependency. Lazy-load what first
    paint does not need. Peek content is a lazy chunk.
12. **Show what the models saw.** A segmented photo is shown with SAM's own mask outlines (5.22), not boxes, so a nurse
    can judge the read at a glance.

---

## 2. Tokens (`src/tokens.stylex.ts`)

Style only with tokens. Raw values are allowed only for `0`, `1px` borders, `100%`, and the geometry of data marks
(SVG coordinates, bar gaps, tick lengths). Every other literal is a finding. `src/tokens.test.ts` checks every pair in
2.1 with `src/lib/contrast.ts` (WCAG 2.2 relative luminance).

### 2.1 Colour

All ratios are WCAG 2.2 contrast, computed (`/tmp/ui-redesign/contrast.mjs`). Text needs 4.5:1. Non-text marks and
boundaries that carry meaning need 3:1.

**Neutrals: saline and ink**

| Token          | Hex       | Use for                                                                      | Checked pairs                                        |
| -------------- | --------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `fg` (ink)     | `#13212f` | body text, titles, values, the balance line, `now` line, tooltip fill        | 16.33 on `bg`, 14.18 on `canvas`, 13.66 on `rail`    |
| `muted`        | `#4d5d6c` | meta lines, hints, axis ticks, idle icons                                    | 6.78 `bg`, 5.89 `canvas`, 6.30 `subtle`, 5.67 `rail` |
| `bg`           | `#ffffff` | sheets, peeks, dialogs, inputs, chart surfaces                               |                                                      |
| `canvas`       | `#eaf0f2` | page background ("saline"), app bar                                          |                                                      |
| `subtle`       | `#f4f7f8` | hover and current-row fill, shift header rows, inset panels, segmented track |                                                      |
| `rail`         | `#e5ecef` | sidebar background                                                           |                                                      |
| `border`       | `#d0dbe0` | sheet borders, dividers, progress and gauge tracks, chart midlines           |                                                      |
| `grid`         | `#e4eaed` | chart gridlines, row dividers inside a sheet, empty gauge steps              | recessive by design (not a meaningful mark)          |
| `borderStrong` | `#78899a` | input, choice-chip, switch-off, segmented and gauge outlines, chart axes     | 3.59 `bg`, 3.12 `canvas`, 3.34 `subtle`              |

**Action**

| Token          | Hex       | Use for                                                         | Checked pairs                                                            |
| -------------- | --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `accent`       | `#0f766e` | primary buttons, links, focus ring, selected choice, brand mark | 5.47 `bg`, 4.76 `canvas`, 4.58 `rail`, 4.72 `accentBg`; 3.88 on `border` |
| `accentStrong` | `#0b5c56` | hover and pressed accent fills                                  | `onAccent` 7.84                                                          |
| `accentBg`     | `#e3f1ef` | selected toggle-button fill, current sidebar link               | `fg` 14.07                                                               |
| `onAccent`     | `#ffffff` | text and icons on accent, solid only (never at reduced opacity) | 5.47 on `accent`                                                         |

**Direction (data identity; never status)**

| Token        | Hex       | Use for                                                       | Checked pairs                           |
| ------------ | --------- | ------------------------------------------------------------- | --------------------------------------- |
| `intake`     | `#2a78d6` | intake marks: bars, lines, swatches, the ▲ glyph              | 4.42 `bg`, 4.10 `subtle`, 3.13 `border` |
| `intakeText` | `#1a5fb4` | `In` chip text                                                | 5.36 on `intakeBg`, 6.29 `bg`           |
| `intakeBg`   | `#e3eefb` | `In` chip fill, positive balance gap fill                     |                                         |
| `output`     | `#9a4a8a` | output marks ("mulberry"): bars, lines, swatches, the ▼ glyph | 5.64 `bg`, 5.24 `subtle`, 4.00 `border` |
| `outputText` | `#7d3570` | `Out` chip text                                               | 6.68 on `outputBg`, 8.03 `bg`           |
| `outputBg`   | `#f5e6f1` | `Out` chip fill, negative balance gap fill                    |                                         |

Why mulberry: the v1 output amber (`#b45309`) sat 8.9 ΔE from the warning amber and 4.9 ΔE (deutan) from danger red,
so output bars read as warnings. Mulberry clears warn, danger, pending and intake (validator, below). It also keeps the
direction colour apart from urine, which is drawn in the colours seen ("Urine drawn in its own colour").

**Status (state; always with icon and label)**

| Tone      | Mark      | Text on tint | Tint      | Glyph (Lucide)  | Checked pairs                                                             |
| --------- | --------- | ------------ | --------- | --------------- | ------------------------------------------------------------------------- |
| `danger`  | `#b91c1c` | `#b91c1c`    | `#fde8e8` | `OctagonAlert`  | 5.51 on tint, 6.47 `bg`, 4.59 on `border`                                 |
| `warn`    | `#b07800` | `#855900`    | `#fcefc7` | `TriangleAlert` | text 5.34 on tint, 6.13 `bg`; mark 3.80 `bg`; `warnText` 4.35 on `border` |
| `info`    | `#0e5aa7` | `#0e5aa7`    | `#e1edf9` | `Info`          | 5.82 on tint, 6.91 `bg`                                                   |
| `pending` | `#6d28d9` | `#6d28d9`    | `#efe9fd` | `Clock`         | 6.00 on tint, 7.10 `bg`, 5.04 on `border`                                 |
| `ok`      | `#137336` | `#137336`    | `#e2f5e7` | `CircleCheck`   | 5.22 on tint, 5.94 `bg`, 4.21 on `border`                                 |

Spec words map to tones: red = `danger` (`Review now`), amber = `warn` (`Review`), blue = `info` (`Check`). A meter or
gauge fill in the warn tone uses `warnText`, because the `warn` mark is 2.69:1 on `border`.

**Acuity (ordinal ink ramp, not status)**

| Level      | Mark      | Glyph                                            |
| ---------- | --------- | ------------------------------------------------ |
| `critical` | `#13212f` | three rising bars, all filled                    |
| `watch`    | `#5b6b7a` | three bars, two filled (5.48 on `bg`)            |
| `stable`   | `#9aa8b4` | three bars, one filled (2.43, ordinal floor 2:1) |

Acuity is how closely to watch a bed, not a prompt, so it never takes a status colour. The glyph sits beside its word
(`Critical`, `Watch`, `Stable`), which carries the meaning. Unfilled steps are `grid`.

**Sequential ramps (magnitude, one hue, light to dark)**

| Ramp   | Steps                                   | Use                                                     |
| ------ | --------------------------------------- | ------------------------------------------------------- |
| intake | `#86b6ef` `#3987e5` `#1c5cab` `#0d366b` | heat cells by hourly intake (ward board options, print) |
| output | `#cf92c2` `#b06aa2` `#86407a` `#5a2452` | heat cells by hourly output                             |

Both pass the ordinal checks (monotone, ΔL ≥ 0.06, light end 2.11:1 and 2.46:1 on white). An empty cell is `grid`.

**Categorical (unchanged, spec'd)**

- `CATEGORY_HUE` (`lib/hues.ts`): water `#2a78d6`, food `#1baf7a`, IV `#008300`, urine `#eda100`, stoma `#e87ba4`, drain
  `#6250d6`, vomit `#eb6834`. Food, urine and stoma are under 3:1 on white, so every segment has a visible label or its
  legend beside it.
- Outcome hues (accuracy-views "Outcome colours"): accepted `#2a78d6`, edited at capture `#eb6834`, corrected by a nurse
  `#1baf7a`, rejected `#eda100`.
- Urine is drawn in the colours seen (`urine_rgb`), with a 1 px `borderStrong` outline so pale straw shows on white.

**Drink kinds (identity by icon and label, never by hue)**

drink-types adds 11 drink kinds (`DRINK_KINDS`, labels from `DRINK_LABEL` in `@meniscus/shared`). They are one family
inside intake, so they never get a hue each: 11 categorical hues would fail the validator and collide with
`CATEGORY_HUE` and the status set.

- **One shade.** Every drink mark (a breakdown segment, a share bar in the `In` peek, a drink chip) is `intakeBg`
  `#e3eefb` with a 1 px `intake` outline (3.76 on `intakeBg`, 4.42 on `bg`) and its label and icon in `intakeText`
  (5.36 on `intakeBg`). Adjacent drink segments are separated by the 2 px bar gap, never by a second colour.
- **The icon and the label tell kinds apart.** Every drink mark carries its kind's icon and `<Kind> <mL>`. A drink
  with no kind reads `Drink`, with the `other` icon. Overlay drink contours stay `CATEGORY_HUE.water` (5.22); only the
  label names the kind.
- **Icons** (`DRINK_ICON` in `components/drink-label.tsx`; lucide-react 1.66.0, each checked in `dist/lucide-react.d.ts`):

  | Kind            | Label              | Lucide icon  |
  | --------------- | ------------------ | ------------ |
  | `water`         | `Water`            | `GlassWater` |
  | `tea`           | `Tea`              | `Leaf`       |
  | `coffee`        | `Coffee`           | `Coffee`     |
  | `milk`          | `Milk`             | `Milk`       |
  | `juice`         | `Juice`            | `Citrus`     |
  | `coconut_water` | `Coconut water`    | `TreePalm`   |
  | `buttermilk`    | `Buttermilk`       | `Blend`      |
  | `ors`           | `ORS`              | `Droplets`   |
  | `supplement`    | `Supplement drink` | `CupSoda`    |
  | `soup`          | `Soup`             | `Soup`       |
  | `other`         | `Drink`            | `Droplet`    |

  Icons are 14 in chips and dense rows, 16 inline; each has the kind's label as its accessible name.

**Chart chrome**

| Role                    | Token                                        |
| ----------------------- | -------------------------------------------- |
| Chart surface           | `bg`                                         |
| Gridline                | `grid`                                       |
| Axis, baseline          | `borderStrong`                               |
| Midline (mirrored bars) | `border`                                     |
| Ticks and axis labels   | `muted`, `text.xs`                           |
| `now` line              | `fg`, 1 px, dash 2 2                         |
| Readout and tooltip     | `fg` fill, `bg` text                         |
| Limit band              | `warnBg` fill, `warn` rule 1.5 px            |
| Target rule             | `info`, 1.5 px, dash 4 3                     |
| Pending mark            | `bg` fill, 1.5 px direction stroke, dash 3 2 |

**Validator results** (dataviz `validate_palette.js`, light mode, surface `#ffffff`; full output in
`validator-report.txt`):

- direction `#2a78d6,#9a4a8a`, all pairs: PASS (CVD ΔE 12.7, normal 19.7, both ≥ 3:1);
- output against warn, danger and pending, all pairs: PASS (worst CVD 10.6, normal 15.3);
- status in legend order (danger, warn, info, pending, ok), adjacent: PASS with a CVD WARN (pending↔info 7.7), legal
  because every status carries a glyph and a label. Under all pairs, ok↔danger and ok↔warn fall below the CVD floor for
  protan and deutan readers: that is why status glyphs differ in shape, and why status is never a chart series;
- intake, output and acuity ramps, ordinal: PASS;
- outcome hues, adjacent: PASS.

**Dark mode: non-goal (decided).** Light is the only theme. `global.css` declares `color-scheme: light` so a
dark-mode browser does not invert form controls (v1 finding 45). Dark mode is not cheap with these tokens: every ramp,
the urine colours and the chart chrome need their own validated dark steps, and the demo is recorded in light mode. A
later change may add it through `defineVars` media values.

**The tone map.** `Tone` (`components/ui.tsx`) is the only way to pick a status colour: `tints[tone]` for fills with
text, `solids[tone]` for dots, bars and icons, `bars[tone]` for the 4 px leading edge.

| Meaning                | Tone                                                       | Source of truth                              |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| A prompt               | `ALERT_TONE[kind]`                                         | `lib/labels.ts`                              |
| A bed's status         | `bedTone(alerts, pending)` → `STATUS_LABEL`                | `lib/labels.ts`                              |
| A ward's status        | `worst_tone` of `GET /api/wards`, else pending, else ok    | `wardTone(summary)` in `lib/ward.ts`         |
| An entry's status      | pending → `pending`, approved → `ok`, rejected → `neutral` | `ENTRY_STATUS_TONE` in `lib/labels.ts`       |
| A meal fluid's status  | as an entry's                                              |                                              |
| Direction              | `in` / `out` (direction tokens, not status)                |                                              |
| A drink kind           | none: the one intake-family shade, plus its icon and label | `DRINK_ICON` in `components/drink-label.tsx` |
| Model confidence       | `neutral`, `warn` below `LOW_CONFIDENCE` (0.75)            | `lib/format.ts`                              |
| A care or device badge | `neutral`                                                  | `lib/care.ts`                                |
| Acuity                 | the acuity ramp above, never a tone                        | `ACUITY_LABEL` in `lib/labels.ts`            |
| Balance                | `neutral`, `warn` past `ALERT_RULES.overloadBalanceMl`     | `overloadTone()` in `lib/ward.ts`            |

### 2.2 Space

`space.xs` 2 · `sm` 4 · `md` 8 · `lg` 12 · `xl` 16 · `xxl` 24 · `xxxl` 32.

| Gap                                                        | Token                   |
| ---------------------------------------------------------- | ----------------------- |
| Hairline gaps between data marks, label over value         | `xs`                    |
| Label to its control, chips in a row, value to unit        | `sm`                    |
| Icon to label, buttons in a row, row cells                 | `md`                    |
| Blocks inside a sheet, the screen stack                    | `lg`                    |
| Sheet padding (wide), dialog padding, peek padding is `lg` | `xl`                    |
| Sign-in and lock card padding                              | `xxl` (`xxxl` ≥ 641 px) |

Mapping for v1 raw values: 1–3 → `xs`, 6 → `sm`, 10 → `md`, 20 → `xl`, 48 → `calc(2 * xxl)`.

### 2.3 Type

The stack is `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. No web fonts. The personality is in the
figures: values are heavy and tabular, units small and muted beside them, and labels quiet.

`text.xs` 12 · `sm` 13 · `md` 15 · `lg` 17 · `xl` 22 · `num` 26 · `hero` 32. Nothing renders below 12 px.

| Role                                        | Size                | Weight | Other                               |
| ------------------------------------------- | ------------------- | ------ | ----------------------------------- |
| App bar title (h1, names the place)         | `lg`                | 700    | ellipsis                            |
| Page title (h2: ward, patient)              | `xl`                | 700    | `-0.02em`                           |
| Sheet title (h2/h3)                         | `lg`                | 700    | `-0.01em`                           |
| Peek and dialog title                       | `md` / `lg`         | 700    |                                     |
| Body                                        | `md`                | 400    | `leading` 1.4                       |
| Row title, field label, chip, button        | `sm` (buttons `md`) | 600    |                                     |
| Meta line, hint, legend, tick, table header | `xs` or `sm`        | 400    | `muted`                             |
| Sidebar section heading                     | `xs`                | 700    | `muted`, sentence case, no tracking |
| Value in a dense row                        | `md`                | 700    | `tabular-nums`                      |
| Vital (bed banner) and stat value           | `num`               | 700    | `tabular-nums`, `-0.02em`           |
| Volume being decided (capture check screen) | `hero`              | 700    | `tabular-nums`                      |
| Unit beside a figure                        | `xs`                | 600    | `muted`, after a normal space       |
| Bed number badge                            | per badge           | 800    | the only 800 besides the brand      |

**Weights: 400, 600, 700, 800 only**, through the `weight` vars (`regular`, `semibold`, `bold`, `heavy`). Map v1's 500 →
400, 650 → 600, 750 → 700. Android's Roboto is static, so in-between weights collapse.

**No uppercase overlines.** v1's tracked uppercase overline is retired: section and group headings are sentence case
`xs`/700 `muted`, and table headers are `xs`/600 `muted`. Abbreviations keep their case (NBM, IDDSI, MRN, HDU, SAM 3.1,
mL).

All aligned numbers (volumes, times, counts, percentages, ticks) use `fontVariantNumeric: 'tabular-nums'`.

### 2.4 Radius

`radius.sm` 4 · `md` 8 · `lg` 12 · `pill` 999.

| Shape                                                                | Radius                            |
| -------------------------------------------------------------------- | --------------------------------- |
| Sheets, tiles, board, controls, inputs, badges, inset panels         | `md`                              |
| Floating layers: peeks, dialogs, bottom sheets (top corners), toasts | `lg`                              |
| Status chips, avatars, switches, dots                                | `pill`                            |
| Data ends, swatches, gauges' inner fill, keycaps                     | `sm` (bars use 1.5–2 px geometry) |

The hierarchy is deliberate: things on the page are `md`, things that float are `lg`.

### 2.5 Elevation

- **Nothing on the page casts a shadow.** Sheets and tiles are `bg` with a 1 px `border` on `canvas`.
- `shadow.raised` (`0 6px 24px rgba(19,33,47,.16), 0 1px 3px rgba(19,33,47,.10)`) is only for floating layers: peeks,
  dialogs, bottom sheets, the toast, the quick jump and the sidebar drawer.
- The sticky app bar gets a 1 px `border` bottom, never a shadow.

### 2.6 Layout, breakpoints and density

| Token / breakpoint    | Value     | Meaning                                                  |
| --------------------- | --------- | -------------------------------------------------------- |
| `layout.tap`          | 44px      | minimum target                                           |
| `layout.tapGloved`    | 52px      | capture commit, sign-in commit                           |
| `layout.tabBar`       | 64px      | phone bottom bar (plus safe area)                        |
| `layout.sidebar`      | 248px     | sidebar width                                            |
| `layout.appBar`       | 56px      | app bar height                                           |
| `layout.content`      | 1080px    | max width for forms, capture, sign-in, print preview     |
| `layout.wide`         | 1400px    | max width for the board and the bed review               |
| sheet mode            | ≤ 640 px  | dialogs and large peeks are bottom sheets                |
| sidebar               | ≥ 768 px  | sidebar shown; below, the bottom bar and the More drawer |
| board                 | ≥ 1100 px | ward board rows; below, bed tiles                        |
| two-column bed review | ≥ 1100 px | main column and a 340 px side column                     |

**Density by role.** Density follows who the screen is for, not a toggle:

| Role and screens                                               | Density                  | Rules                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nurse, matron: homes** (`/n`, `/n?view=model`, `/n/w/$ward`) | Dense                    | Open on **Next up** (5.23). Board rows or tiles at 64 px, counts by action, sheet padding `lg`, `sm` meta, peeks for every metric. One screen answers "what next" without scrolling at 1100 × 800.                                        |
| **Nurse, matron, dietitian: one patient** (`/n/$id`, `/d/$id`) | Structured, one tap away | A fixed order of sections (banner and vitals, prompts, chart, waiting, log, then the side column). Every fact is one tap or hover from the first screen: a vital, a row or a mark. No nested navigation, no tabs that hide required work. |
| **Dietitian: home** (`/d`)                                     | Dense                    | Next up as the worklist's first rows (open referrals oldest first), then rows with meal pips.                                                                                                                                             |
| **Attendant** (`/a`, `/a/bed/$token`, `/a/round`)              | Simple                   | One task per screen, at most 4 choices visible at once, 52 px commits and 48–56 px choice chips, `md`/`lg` type, sheet padding `xl`, no peeks needed to finish a task (they may exist for history), no charts beyond the bag gauge.       |
| Sign-in, lock, dialogs                                         | Comfortable              | sheet padding `xl`, `lg` commits where the dialog is the flow.                                                                                                                                                                            |

Targets stay 44 px everywhere. Dense never shrinks a target, a font below 12 px, or an input below 48/17.

### 2.7 Layers (`layer` vars)

app bar 1 · tab bar and skip link 2 · sidebar drawer 9 · dialog 10/11 · nested dialog 12/13 · peek and select 20 ·
full-screen viewer 20/21 · toast 30 · lock 100 · confirm over lock 110/111. No other z-index.

### 2.8 Motion (`motion` vars)

| Var                | Value                        | For                                    |
| ------------------ | ---------------------------- | -------------------------------------- |
| `motion.control`   | 120ms                        | switches, segmented, hover fills       |
| `motion.overlay`   | 150ms                        | peeks, dialogs, sheets, toast          |
| `motion.signature` | 480ms                        | the two signature moments (below) only |
| `motion.ease`      | `cubic-bezier(0.2, 0, 0, 1)` | all of them                            |

- Under `prefers-reduced-motion: reduce` every var is `0ms` (StyleX `defineVars` media values), so reduced motion is one
  place. The recording pulse is an `animation` gated by `(prefers-reduced-motion: no-preference)`: a static dot
  otherwise.
- Animate `opacity` and `transform` only, plus `stroke-dashoffset` for the segment contours in signature 2. Never `height`,
  `width`, `box-shadow` or `filter` (the recording meter's level is a `transform: scaleY`).
- Nothing animates on load, on refresh, or in lists. Motion answers an action.

**Signature moments** (for the recorded demo; both answer a person's action):

1. **The approval pours in.** After Approve on the bed review, the balance timeline highlights the entry's hour for 2 s,
   its bar grows from the baseline (`scaleY` 0 → 1, transform-origin at the baseline), the running line extends with
   the new step, and the Balance vital changes to the new value. The bar is the reloaded data, not a guess, so nothing
   moves until the reload lands.
2. **The photo resolves into its segments.** When a segmented photo loads (entry peek, entry details, the capture check
   screen, a tray in a meal peek), the photo dims outside the container, then each element's mask contour traces on
   (`stroke-dashoffset` over the path length, container first, then liquid or each dish in index order, 80 ms apart),
   its halo fades in, the fill line drops into place, and the labels appear. In the entry peek the graduation scale's
   ticks for the AI's, saved and approved volumes then slide in from 0 in that order. Spark-only reads have no
   segmentation, so the photo shows plain with no overlay.

Both run once per open or per approval, and are skipped entirely (final state drawn at once) under reduced motion.

---

## 3. Formatting and copy

### 3.1 Helpers (all from `src/lib/format.ts`)

| Helper                   | Output                                         |
| ------------------------ | ---------------------------------------------- |
| `clock(t)`               | `14:05` (24 h, from `getHours`, never ICU)     |
| `dayClock(t, now)`       | `14:05`, or `3 Nov 14:05` when not today       |
| `dayMonth(t)`            | `3 Nov`                                        |
| `dayLabel(t)`            | `Tue 3 Nov` (fixed English month and weekday)  |
| `hourRange(t)`           | `14:00–15:00` (the rail's hour buckets)        |
| `ml(n)`                  | `1200 mL` (integer, no grouping, normal space) |
| `signedMl(n)`            | `+120 mL`, `−80 mL` (U+2212), `0 mL`           |
| `litres(n)`              | `1.5` (care badges, spec'd `Limit 1.5 L`)      |
| `percent(x)`             | `82%` from 0..1                                |
| `rate(r)`                | `76% · 20/26`, or `— · 3/4` when withheld      |
| `ago(t, now)`            | `just now`, `12 min ago`, `3 h ago`            |
| `duration(ms)`           | `0:42`                                         |
| `plural(n, one, many)`   | `1 entry`, `3 entries`                         |
| `confidenceLow(c)`       | `c < LOW_CONFIDENCE` (0.75)                    |
| `confidenceChip(src, c)` | `{ text: 'Photo · 82%', tone }`                |

Label maps live in `lib/labels.ts`: `ALERT_LABEL`, `ALERT_TONE`, `STATUS_LABEL`, `ENTRY_STATUS_TONE`,
`CATEGORY_LABEL`, `SOURCE_LABEL`, `BAG_NAME`, `BAG_EVENT_LABEL`, `CONTAINER_LABEL`, `ISSUE_LABEL`, `STEP_LABEL`,
`REJECT_LABEL`, `MODEL_NAME`, `MODE_LABEL` (`SAM + Spark`, `Spark only`), `ACUITY_LABEL`, `DEVICE_LABEL`. Never print an
enum value.

### 3.2 Rules

- **Units:** `mL` after a normal space, never `ml`. A unit beside a big figure is a separate `xs`/600 `muted` span.
  Every volume carries its unit (`Target 600/1600 mL`). Rates are `mL/kg/h`. Counts and percentages carry none.
- **Times:** 24 h `HH:MM` everywhere. A native time input that may show 12-hour text echoes `Set to 21:38` beside it.
- **Dates:** day first, `3 Nov` or `Tue 3 Nov`, no year, never ICU.
- **Percent:** integer, no space (`82%`). A rate from a count is written with it (`76% · 20/26`).
- **Confidence:** `Photo · 82%` in a chip, warn below 75%. Not `82% confident`, not `Confidence 82%`.
- **Case:** sentence case for titles, buttons, chips, tabs, menu items and headings. No uppercase styling.
- **Voice:** short, plain, active, naming who and what. Prompts say "Review" or "Check". No "Please", no exclamation
  marks, no "Error:". A failure says what happened and what to do (`errorText` in `lib/api.ts`).
- **Punctuation:** `…` for busy labels and for buttons that ask a further question (`Reject…`, `Amend…`). Curly quotes.
  `·` separates facts on one line, `→` shows a change (`430 → 400 mL`), `–` joins ranges (`14:00–15:00`).
- **One word per idea:**

  | Idea                         | Say                                                                       | Don't say                     |
  | ---------------------------- | ------------------------------------------------------------------------- | ----------------------------- |
  | Entered without a model      | By hand                                                                   | Manual                        |
  | Waiting for a nurse          | Pending (chip), `<n> waiting for approval`, `Waiting for nurse approval.` | Awaiting, unreviewed          |
  | Undo a capture before saving | Discard                                                                   | Cancel, Skip                  |
  | Stop an action in flight     | Cancel                                                                    | Stop (except "Stop and send") |
  | The models                   | Muse Spark, SAM 3.1, Speech-to-text (`MODEL_NAME`, `STEP_LABEL`)          | the AI model, LLM             |
  | The person                   | `staffLabel()` / `who()` / `shortName()`                                  | names typed inline            |
  | Open the detail of a thing   | Details                                                                   | More info, View, Open ›       |

---

## 4. The shell (`components/app-shell.tsx`)

```
≥ 768 px
┌ sidebar 248 (rail) ┬ app bar 56 (canvas): breadcrumb + h1 · Jump to… [/] · connection · staff ┐
│ Meniscus             │ content: max 1400 (board, bed review) or 1080 (forms, capture)            │
│ Capture            │                                                                           │
│   Bed picker       │                                                                           │
│   Ward round       │                                                                           │
│ Wards · as of 22:41│                                                                           │
│   3A Medical  2 8  │                                                                           │
│   5B Neurology     │                                                                           │
│   All wards        │                                                                           │
│ This ward          │                                                                           │
│   Bed 4 · Mei Lin !│                                                                           │
│   Data quality     │                                                                           │
│   QR cards         │                                                                           │
│ Insights           │                                                                           │
│   Model accuracy   │                                                                           │
│ Nutrition          │                                                                           │
│   Worklist         │                                                                           │
└────────────────────┴───────────────────────────────────────────────────────────────────────────┘

< 768 px
┌ app bar 56: brand mark · h1 · connection · avatar ┐
│ content                                            │
├ bottom bar 64: Capture · Wards · [Nutrition] · More ┤   More opens the sidebar as a drawer
```

### 4.1 Sidebar (`components/sidebar.tsx`)

- `rail` background, 1 px `border` right, sticky full height, scrolls on its own. Links are `MenuList` rows, 44 px,
  `md`/400 `fg`. The current page is `aria-current="page"`: `bg` fill, a 3 px `accent` inset at the left, 600 weight.
- **Sections**, each shown only when it has a link, headings `xs`/700 `muted`:

  | Section   | Links                                                                                                              | Who                  |
  | --------- | ------------------------------------------------------------------------------------------------------------------ | -------------------- |
  | Capture   | `Bed picker` (`/a`), `Ward round` (`/a/round?ward=<home ward id>`)                                                 | everyone with a ward |
  | Wards     | one per `staff.wards` (`<code> <name>` when the name is known, else the code), then `All wards` (`/n`)             | everyone             |
  | This ward | on `/n/w/$ward` and `/n/$id`: up to 6 beds needing review (`Bed <n> · <patient>`), then `Data quality`, `QR cards` | nurse, matron        |
  | Insights  | `Model accuracy` (`/n?view=model`)                                                                                 | nurse, matron        |
  | Nutrition | `Worklist` (`/d`)                                                                                                  | dietitians           |

- **Counts.** The sidebar sends no request of its own. It reads `lib/snapshot.ts`, a tiny store that the routes write
  after their own loads: `/n` writes each ward's `pending` and `beds_with_alerts`, `/n/w/$ward` writes its beds. A ward
  link shows pips (`pending` violet, to-review in the ward's worst tone) only when a load has filled them, and the
  Wards heading then reads `Wards · as of <clock>`. "This ward" lists beds in "Beds needing attention first" order,
  each with its status glyph pip.
- The brand is the drop mark on an `accent` tile (`radius.md`), `DropIcon` at 2.25 stroke, then `Meniscus` `lg`/800.

### 4.2 App bar

- `canvas`, 56 px, sticky, 1 px `border` bottom. Left: breadcrumb (`sm`, links `accent`/600, 44 px tall hit areas,
  `ChevronRight` 14 separators) over the h1 that names the place (`Medical Ward 3A`, `Bed 5 · 3A`, `Nutrition`).
  Right: the quick jump button (≥ 768 px), `ConnectionStatus`, the staff badge (`StaffAvatar` + `Anita T. · Nurse`,
  name hidden below 768 px), Switch user.
- Phones show the brand mark, the h1 and the avatar. No breadcrumb: the h1 names the place and the back gesture works.

### 4.3 Bottom bar and More drawer (phones)

- `BottomNav`: Capture, Wards, Nutrition (dietitians), More. Icons 24, labels `xs`/600, current in `accent` with a 3 px
  top indicator.
- More opens the sidebar's sections in a Base UI `Drawer` from the left (`swipeDirection="left"`), 85 vw max 320 px,
  `shadow.raised`, layer 9. It closes on a link, Escape, a tap outside or a swipe. The drawer is a lazy chunk.

### 4.4 Quick jump (≥ 768 px, lazy)

- `/` or Ctrl+K (Cmd+K) outside a text field, or the app bar button, opens a `Dialog` (card layout, 520 px): a 48/17
  search field and a list of results from `staff.wards` and `lib/snapshot.ts` beds: `3A Medical Ward 3A`,
  `3A bed 5 · Joseph Mwangi · Review`. Typing filters by ward code, bed number or patient name. Arrow keys move, Enter
  opens, Escape closes and returns focus. It sends no request. The dialog and its matcher are a lazy chunk.

### 4.5 Toast viewport

Fixed above the bottom bar (`bottom: calc(tabBar + safe area + lg)`), or at the bottom right ≥ 768 px, layer 30, one at a
time (5.3).

---

## 5. Component recipes

### 5.1 Peek: hover card and popover (`components/peek.tsx`)

A peek is a floating card that shows detail about the thing under the pointer or finger. It is the main way to reach
photos, reads, history and breakdowns.

**Which primitive.** Base UI 1.9.0 has both, and they differ on touch. `peek.tsx` builds on the existing
`components/popover.tsx` (accuracy-views), extended with `delay`, `closeDelay` and a handle; there is no second Popover
wrapper. The outcome bars' popup is a peek too: it moves from its old 150 ms to 400 ms (web/ward "Outcome bars"). A bed tile's peek button is a sibling of the tile's link, never inside it.

| Need                                                                         | Use                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detail that must also open by tap and keyboard (every peek in this app)      | **`Popover`** with `Popover.Trigger openOnHover delay={400} closeDelay={150}`. Click, tap, Enter and Space open it pinned. One `Popover.createHandle()` per list, so a list of 25 rows has one `Popover.Root` and one portal, with the row's payload. |
| A purely supplementary preview for mouse users that is fine to miss on touch | `PreviewCard` (hover and focus only, renders an `<a>`, no tap). Not used today: nothing in Meniscus is fine to miss on a phone.                                                                                                                       |
| A one-line label for an icon-only control                                    | `Tooltip` (`components/tooltip.tsx`). Never holds information that is not also in the accessible name.                                                                                                                                                |

**Open and close rules** (`web/interface` "Peeks open by hover, tap and keyboard"):

- Pointer (hover-capable, `(hover: hover) and (pointer: fine)`): opens 400 ms after the pointer rests on the trigger,
  closes 150 ms after it leaves both the trigger and the peek, so the pointer can travel into it. Moving to the next
  row's trigger swaps the payload with no close and reopen animation (`instant: 'trigger-change'`).
- Tap or click: opens pinned. A second tap on the trigger, a tap outside or Escape closes it.
- Keyboard: Enter or Space on the focused trigger opens it pinned and moves focus to the peek's first control. Escape
  closes it and returns focus to the trigger. Focus alone never opens a peek, because a Tab sweep over 25 rows must not
  fetch 25 photos.
- One peek is open at a time.
- ≤ 640 px, and for any peek taller than 60 vh: it opens as a bottom sheet (5.2 layout, `Drawer` with a grab handle)
  instead of floating. A sheet peek has a visible Close button.

**Entry peek head.** `10:42 · Tea 150 mL` through `DrinkLabel` (5.24), then the item (`masala chai`) in `muted` when it
is not the kind's label; an entry with no `drink` shows its category.

**Anatomy.** `bg`, 1 px `border`, `radius.lg`, `shadow.raised`, padding `lg`, gap `md`, width 320–420 px, an 8 px arrow.
Head: title (`md`/700) and the status chip at the right. Body: compact facts, never more than one scroll. Foot:
at most two actions, right-aligned, `touch` buttons, the primary last (`Details` or the screen's commit).

**Lazy content.** The trigger and the Root live in the route chunk. The popup's content is `lazy()` (one chunk per peek
kind: `entry-peek`, `bed-peek`, `metric-peek`), loaded on first open, with a `Suspense` fallback that reserves the peek's
height. Data comes from what the route already loaded, plus at most the one media request named in section 8.

**Accessibility.** The trigger has `aria-haspopup="dialog"` and `aria-expanded`. The popup has `role="dialog"`, a title
(`Popover.Title`) and no focus trap when opened by hover (it is not modal). Its content is also reachable without it:
see 5.7 and 9.

**Never in a peek alone:** Approve, Reject…, Save, a destructive action, or the only link to a screen.

### 5.2 Sheet and dialog (`components/sheet.tsx`)

- One recipe: a centred card ≥ 641 px, a bottom sheet ≤ 640 px. Backdrop `rgba(19,33,47,.40)`, popup padding `xl`, gap
  `xl`, `radius.lg` (top corners only as a sheet), `shadow.raised`, `92dvh` max with the safe-area inset.
- Anatomy: head (`Dialog.Title` `lg`/700, `Dialog.Description` `sm` `muted`, an icon close button when it scrolls),
  body (sections with `xs`/700 sentence-case headings), `Saved in the name of <staffLabel>.` on any dialog that writes,
  the error `Notice`, actions (Cancel first, commit last, `touch`; `lg` only in sign-in, lock and break-the-glass).
- `Dialog` for forms, `AlertDialog` for confirms. Nested dialogs use layer 12/13. Focus returns to the opener.
- Motion: backdrop opacity, popup opacity plus `translateY(8px)` (sheet) or `scale(0.97)` (card) at `motion.overlay`.
- Every dialog is lazy (`lazy()` + `Suspense fallback={null}`).
- **Entry details** is a sheet: the full timeline ("Entry timeline"), the source viewer, what the AI read and the
  actions. It opens from an entry peek's `Details` and from a pending row's `Details`.

### 5.3 Toast (`components/toast.tsx`)

Base UI `Toast.Provider limit={1}`; `flash({ text, tone })` → `add()` with `timeout` 6000 (0 for danger) and `priority`
low (high for danger). One at a time, a new one replaces it. `bg`, 1 px `border`, `bars[tone]` leading edge, tone icon,
`md` text, a 44 px close button. Polite for success, assertive for failure. No other result area exists.

### 5.4 Notice (`components/ui.tsx`)

Inline, persistent context: `tints[tone]` + `bars[tone]`, `radius.md`, padding `lg`, the tone's glyph at 20. `role`
follows intent: `alert` for a danger result, `status` for an announced result, none for static guidance.

### 5.5 Sheet section (`Section`)

- The only page container: `bg`, 1 px `border`, `radius.md`, no shadow, padding `lg` (compact) or `xl`
  (comfortable), gap `md`.
- Head: title (`lg`/700), a count chip, a one-line `xs` `muted` note, actions at the right (wrap under on phones).
  No icon tiles in section heads (v1's 28 px icon tile is retired: it took a line on phones for no information).
- `tone` adds the 4 px leading edge only on banners and bed tiles, for the bed's status. Sections never carry a tone.
- Inside: **inset panel** (`subtle`, `radius.md`, padding `lg`, no border) for a draft or a form group. Never a section
  in a section.

### 5.6 Chips, badges and marks

| Kind                | Recipe                                 | Example                                 |
| ------------------- | -------------------------------------- | --------------------------------------- |
| Status chip         | `Chip tone` with the tone glyph at 14  | `▲ Review`, `◷ Pending`, `✓ Approved`   |
| Fact chip           | `Chip tone="neutral"`                  | `Photo · 90%`, `By hand`, `SAM + Spark` |
| Care / device badge | `Chip tone="neutral"` via `CareBadges` | `NBM`, `Limit 1.5 L · 82%`, `Commode`   |
| Count               | `Chip tone` with a number only         | the section count                       |
| Overflow            | `Chip tone="neutral"` `+<n>`           | tiles show one prompt, then `+n`        |

- 24 px tall, `pill`, `xs`/600, `nowrap`, at most 3 words. Longer text goes in a legend row or a peek. Chips are never
  targets.
- A neutral chip is `subtle` with a 1 px `border` inset ring, so it shows on `bg` and on `subtle` alike.
- **Direction mark:** a ▲ (intake) or ▼ (output) glyph at 12 in the direction colour, then the drink kind with its icon
  (`▲ Tea`, 5.24) or, with no `drink`, the category (`▲ Drink`) in `fg` 600.
  Used in dense rows. The `In`/`Out` tinted chip stays where a spec quotes a badge (the log's "badge coloured by
  direction").
- **`BedBadge`** (`components/bed-badge.tsx`): `accent` fill, the ward code `xs`/700 over the bed number 800. Sizes `sm`
  44, `md` 52, `lg` 56. One component everywhere.
- **`AcuityMark`**: the three-step glyph (12 × 14, steps 4 px wide, `xs` gap) then the label `xs`/700.
- **Order in a row:** direction, status, prompts or flags, facts.

### 5.7 DenseRow (`components/dense-row.tsx`)

The one row for a timed record: entry log rows, pending rows, meals, bag readings, care history, flagged entries,
worklist rows.

```
≥ 641 px, one line, 44 px min
[time 48 · 700 tab] [▲ Tea + icon 116] [volume 84 · right, 700 tab + unit] [source chip · note · who (sm muted), grows] [end: status chip | actions]

390 px, at most two lines (pending rows: three, the third holds the actions)
[time] [▲ Tea ................... 150 mL]
[    ] [Photo · 90% · masala chai · Sunita D.   ✓ Approved]
```

- The whole row is the peek trigger (5.1) for entries: a `button` with `aria-haspopup="dialog"`, `subtle` on hover and
  while its peek is open, with a 2 px `accent` inset at the left while open.
- Flags: at most 2 chips then `+<n>`; the full list is in the peek and details.
- Rejected or voided: the volume is struck through and `muted`, with a `Rejected`/`Voided` chip. Never opacity.
- The volume is `fg`. Direction is the glyph, never the text colour.
- **Pending rows** keep their actions on the row, always visible: `Reject…` (danger, opens the reject sheet) and
  `Approve` (primary, `Approve <n> mL` from 641 px). `Change…` (ghost) opens an inline stepper row under it to approve
  with a corrected volume. Approve and Reject never live only in a peek.
- Rows are dividers of `grid`, not cards.

### 5.8 Stat chip and vitals strip

- **Vital** (`components/vital.tsx`): one cell of a strip, label `xs`/600 `muted` with a direction swatch when it is a
  direction, value `num`/700 tabular, unit span, optional `xs` sub-line (`3 entries`). Cells are separated by 1 px
  `border` rules, not tinted tiles. A vital that has a breakdown is the trigger of a **metric peek**: focusable, 44 px+,
  `subtle` on hover with a 2 px `accent` underline while its peek is open.
- **Stat chip** (inline count in a header): `subtle` fill, `radius.md`, 44 px tall, the status chip then the figure
  (`lg`/700). Ward header counts use it; each opens a peek listing the beds behind the count.
- `Stat` keeps its `unit` prop (`mL` default, `''` for counts) for the Data quality tiles and the ward list.
- Balance tone comes from `overloadTone()`, never a literal.

### 5.9 BedTile and BoardRow (`components/bed-tile.tsx`, `components/board-row.tsx`)

Both render one `AdmissionSummary` with the same encodings, from the ward's one `GET /api/admissions?ward=<id>`.

| Encoding         | Source                                              | Mark                                                                                                     |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Status           | `bedTone(alerts, pending)`                          | 4 px leading edge in `bars[tone]` + status chip (`Review now`, `Review`, `Check`, `Pending`, `On track`) |
| Identity         | `bed`, `patient`                                    | `BedBadge md`, patient `md`/600, `translate="no"`                                                        |
| Acuity           | `acuity.level` (and `suggested`)                    | `AcuityMark`; a `Suggested <level> · Review` chip when suggested                                         |
| Last 24 h        | `hourly.in_ml`, `hourly.out_ml`, `hourly.in_logged` | mirrored bars (5.10), one scale across the ward, logged dots, warn dashes under gaps of 3 h or more      |
| Balance          | `totals.balance_ml`, `in_ml`, `out_ml`              | signed figure `lg`/700 with `mL`, `warn` text past the overload rule; `<in> in · <out> out` `xs`         |
| Bags             | `bag_levels` (new field, charting/bag-periods)      | a gauge per bag (5.12), `<n>%`, with `due`/`overdue` from `due_at` and the alerts                        |
| Pending          | `pending`                                           | `◷ <n>` in `pending`                                                                                     |
| Prompts          | `alerts`                                            | the worst prompt chip, then `+<n>`                                                                       |
| Care and devices | `care.orders`, `devices`                            | up to 2 badges, then `+<n>`                                                                              |
| Nutrition        | `nutrition.referral`                                | `Referred to dietitian` (`· <short name>`) as a fact chip (spec'd)                                       |
| Reads waiting    | `reads_waiting` (read-queue, later)                 | a fact chip                                                                                              |

- **BoardRow** (≥ 1100 px): one 64 px row per bed in a single `Section` with a header rail (round-hour ticks every 6 h,
  `now` at the right). Columns: edge 4 | identity and acuity 232 | 24 h strip (fluid) with chips under it | balance 128
  | bags 96 | pending 56 | peek button 44.
- **BedTile** (< 1100 px): one column of tiles ≤ 640 px, a 2-column grid from 641 px. Rows: badge, name, acuity, status
  chip and the peek button; the strip at full width; balance, bags, pending and the worst prompt.
- The whole row or tile is a link to `/n/$id` (stretched link). The 44 px `Info` button at the end opens the **bed
  peek** (prompts with their messages, care progress `600/1600 mL · 37%`, bag levels with times, last entry, `Open bed
<n>`). On pointer devices, resting on the row for 400 ms also opens it. The link and the button are separate targets.
- Groups (Critical, Watch, Stable) are `xs`/700 headings inside the board or above the tiles, never tinted bands.
- QR and nurse assignment move off the tile into the row's peek and the QR view (the tile had a 44 px QR button and a
  select on every card).

### 5.10 Sparkline and mirrored bars (`components/spark.tsx`)

- **Mirrored bars**: one column per hour, approved intake up from a `border` midline in `intake`, approved output down in
  `output`, bar gap 2 px, ends 1.5 px radius, a 2 px minimum height for any non-zero hour. One y-scale per screen (the
  ward's maximum hour, stated in the legend: `max 425 mL/h`). Optional row of 4 px ink dots below for hours with intake
  logged, and a 2 px warn dashed underline under runs of 3 h or more without.
- **Line sparkline** (time series in a table cell, 96 × 24): 1.5 px `fg` line, the last point as a 6 px dot, no axis.
  Its cell has the number beside it; the sparkline is `aria-hidden` and the row's text carries the value.
- Used in: bed tiles and board rows (24 h), shift headers in the log (12 h), ward cards on `/n` (24 h, from the new
  `hourly` on `GET /api/wards`), model accuracy small multiples (per kind), the worklist (meals eaten).

### 5.11 BalanceTimeline (`components/balance-timeline.tsx`)

The bed review's main chart. Two panels share one hour axis (small multiples, never two y-scales on one plot):

```
lane   ▲ near fluid limit        ▲ bag due                      (prompt markers, 20 px)
top    running totals, mL         ─── In 2490      Limit 1500 ▒▒ 80%
       ┌──────────────────────────────────────────────────────┐
       │ intake step line, output step line, gap shaded       │ dashed: counted toward the limit since 08:00
       └──────────────────────────────────────────────────────┘
       ▢ ▢ ▢ photo marks (entries with photos, open the entry peek)
bottom hourly bars: in up, out down from a midline; pending outlined, stacked on top
       00:00   04:00   08:00   12:00   16:00   20:00   now
```

- **Top panel (spec'd "Fluid balance chart")**: cumulative approved intake and output as 2 px step lines, one step per
  approved entry; the gap between them filled `intakeBg` where intake leads and `outputBg` where output leads; the
  final values labelled at the right edge (`In 2490`, `Out 2800`) and the balance `Balance −310 mL` in the panel head
  (`lg`/700).
- **Care orders**: with an active fluid limit or intake target, a 1.5 px dashed intake line from the chart-day start
  (`care.*.since`) counts approved and pending intake of the order's categories; the limit is a `warn` rule with a
  `warnBg` band from 80% to 100%, labelled `Limit 1500` and `80%`; the target is an `info` dashed rule with ticks at the
  `INTAKE_TARGET_CHECKS` times labelled `50% by 14:00`, `75% by 20:00`. The dashed line's last value equals the care
  read's `ml`. The chart-day start is a dotted vertical rule labelled `Chart day 08:00`.
- **Bottom panel**: approved mL per hour, bars up and down from the midline; pending entries as outlined bars stacked on
  the approved ones. Same hour columns as the top panel.
- **Lane**: prompt markers. Record prompts (`entry_ids`) at their entries' times; bag prompts at the reading they name;
  others at the `now` edge. Glyph by tone (triangle warn, octagon danger, circle info), 12 px with a 2 px `bg` ring.
- **Photo marks**: a 10 × 8 outlined frame under the top panel at each photo entry's time; hover, tap or Enter opens that
  entry's peek (one media request, section 8).
- **Hover and touch readout**: a full-height hour band (`fg` at 6%) and an `fg` readout: `20:41–21:41 · in 150 mL ·
pending 200 mL · out 350 mL · balance +600 mL`, the hour's entries through `DrinkLabel` (`Tea 100 mL`), and the
  hour's prompts. Pointer moves, a tap pins, Left and Right move by
  an hour when the chart has focus, Escape hides. Hit areas are whole hour columns. `touchAction: pan-y`.
- **Text equivalent**: `role="img"` with `Last 24 hours: in 2490 mL, out 2800 mL, balance −310 mL.`, and a `Chart |
Table` segmented control; Table shows one row per hour, newest first: hour, in, out, pending, running balance.
- Under it, side by side ≥ 641 px: the urine rate panel (spec'd, unchanged encoding: 0.5 rule labelled, points in the
  colours seen, below-line points as diamonds with a `danger` ring) and the in/out composition strip (spec'd "Intake
  and output breakdown", 16 px bars with 2 px gaps and labels under them; drinks split by kind in the one drink
  shade with icons, 2.1 "Drink kinds"; its `Table` lists each kind as a row).

### 5.12 Gauge (`components/gauge.tsx`)

A measuring cylinder for anything with a capacity or limit: bag level, fluid limit, intake target.

- Vertical: 14 × 34 (tile), 26 × 72 (bed review). `bg` fill, 1 px `borderStrong` outline, `radius.sm`+2, graduation
  ticks every 25% (or 20%) on the right inside edge, the fill from the bottom (`intake` for intake orders, the urine
  colour seen or `#c8a43a` for a urine bag, `CATEGORY_HUE` for stoma and drain), a 2 px `warn` line at the warn
  fraction (80%).
- The outline turns 2 px `warn` when a reading is due and `danger` when overdue. The word (`due`, `overdue`) is always
  beside it.
- Beside it: `840/2000 mL`, `42%`, and the time of the reading. Never the gauge alone. `role="img"` name: `Urine bag 42%
full, 840 of 2000 mL at 18:20`.

### 5.13 Legend (`components/legend.tsx`)

- Rows of swatch (10 px, `radius.sm`) + label `xs` `muted`, wrapping, below the chart or board. For ≥ 2 series a
  legend is present; ≤ 4 series are also labelled directly.
- The ward legend comes from `ALERT_LABEL`/`ALERT_TONE` and the chart keys, so new prompt kinds appear automatically.
  It is never a row of sentence chips.

### 5.14 Choice chips, segmented and switch

| Control                                                                                                                  | When                                                                                                                                                                           | Recipe                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ChoiceChips** (`components/choice-chips.tsx`, rebuilt on Base UI `RadioGroup` + `Radio`, or `ToggleGroup` for several) | pick one or several of 2–8 values in a form: meal, portion, IDDSI level, urine colour, reject reason, category, bag event, referral reason, outcome, diet type, acuity, device | min 48 px, `radius.md`, 1 px `borderStrong`, `sm`/600, focus ring. Selected: `accent` fill, `onAccent` text and a `Check` icon at 14. Optional `swatch` slot (urine colour). Grid `repeat(auto-fill, minmax(min(100%, 124px), 1fr))`. Never a status colour when selected. |
| **Segmented** (`components/segmented.tsx`)                                                                               | switch a view or filter in place                                                                                                                                               | 44 px, `subtle` track with a 1 px `borderStrong` edge, selected `bg` + 1 px `border` ring + `fg`                                                                                                                                                                           |
| **Switch** (`components/switch.tsx`, Base UI `Switch`)                                                                   | an independent on/off: My beds                                                                                                                                                 | 44 × 26 track in a 44 px label; off `borderStrong`, on `accent`; `motion.control`                                                                                                                                                                                          |

The bag event (Check, Emptied, Bag changed) is one ChoiceChips radio group.

### 5.15 Stepper (`Stepper`)

52 px square secondary buttons with `MinusIcon` and `PlusIcon`, the value `num`/700 with its `unit` (` mL` by default;
` kcal` and ` g protein` for diet targets), `aria-live="polite"`, `min`/`max` from the domain. Labelled through the form
row. On a pending row's `Change…` it sits inline with `Approve <n> mL`. The only way to set a volume, and diet targets.

### 5.16 Buttons (`components/button.tsx`)

| Variant     | Use                                                                      | Per region     |
| ----------- | ------------------------------------------------------------------------ | -------------- |
| `primary`   | the commit: Save, Approve, Sign in, Details in a peek                    | at most one    |
| `secondary` | alternatives: Add missed entry, Print chart, Cancel                      | any            |
| `ghost`     | quiet in-place actions and standalone links: Change…, Photos 9, Show all | any            |
| `danger`    | Reject…, Void meal, End order; always opens or confirms in a dialog      | one per region |

- Sizes `touch` (44, default) and `lg` (52, capture and sign-in commits, round capture actions). Icons 16 / 20 from the
  size context. Icon-only buttons have an `aria-label` and a `Tooltip`.
- Busy labels replace the text (`Saving…`) at the idle label's `minWidth`. Disabled: `opacity 0.5`, `not-allowed`, and a
  reason nearby when not obvious.
- Order: Cancel or secondary left, primary right. A standalone link that acts as a control is `ghost` with
  `render={<Link />}`.

### 5.17 Form row (`components/form-fields.tsx`)

```
Label (sm/600)
[control 48 px, 17 px text, 1 px borderStrong, radius.md, focus ring]
Hint (xs muted)  or  Error (sm/600 danger, role="alert")
```

`TextField`, `PasswordField`, `SelectField`, `TimeField` (24 h echo), `TextArea`. ` (optional)` marks optional fields.
Choice groups are a `fieldset` with a `legend`. A form's error summary is a danger `Notice` above the actions.

### 5.18 Table and TableScroll (`ui.table`, `components/table-scroll.tsx`)

- `table` 100%, `borderCollapse: separate`, `borderSpacing: 0`, body `sm`. `th`: `xs`/600 `muted` sentence case on
  `subtle`, `paddingBlock sm`, `paddingInline md`, bottom `border`, `scope`. `td`: `paddingBlock md`, top `grid`,
  numbers right-aligned (`ui.num`).
- `TableScroll`: `overflowX: auto`, `role="region"`, `tabIndex 0`, `aria-label` ending `scrolls sideways`, a right-edge
  mask while more is hidden, sticky first column.
- Sort buttons: full-height 44 px targets with `ChevronUp` / `ChevronDown` / `ChevronsUpDown` at 14.
- A sparkline cell (5.10) sits beside its number, never instead of it.
- Flag cells use `warnText` and 700 plus the word in `aria-label`.

### 5.19 Empty, loading and error

| State              | In a section                                                                                          | Whole screen                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Empty              | one `muted` sentence naming what is absent and its window (`No meals recorded in the last 24 hours.`) | `Placeholder` (icon by meaning, title, one line, optional action) |
| Loading            | `Loading <thing>…` `role="status"` at the content's height; charts draw their axes and rail empty     | the same line in the content column                               |
| Error              | danger `Notice` with `errorText(err)` and `Try again` only when `retryable`                           | `Placeholder` with the action                                     |
| Peek photo loading | the photo box shows `NoPhotoIcon` 24 `muted` on `subtle` at the photo's aspect ratio                  |                                                                   |

No spinners, no skeleton shimmer, no blank boxes.

### 5.20 Icons (`components/icons.tsx`)

Lucide per-module imports only, under app names. Sizes 14 (chips, dense meta), 16 (inline, `touch` buttons), 20 (`lg`
buttons, notices), 24 (tab bar, capture tiles, placeholders). Stroke 1.75 (`LucideProvider`); the brand drop is 2.25.
Status glyphs: `OctagonAlert`, `TriangleAlert`, `Info`, `Clock`, `CircleCheck`. Never text glyphs as icons; the ▲ ▼
direction marks are SVG in `components/direction.tsx`.

### 5.21 People

`StaffAvatar` (decorative, beside the name), `staffLabel()` for `Name · Role`, `shortName()` (`lib/staff.ts`) for
`Anita T.`.

### 5.22 SegmentOverlay: mask contours on photos (`components/segment-overlay.tsx`, `lib/contour.ts`)

What SAM 3.1 found, drawn on the photo as a highlight around each element. Replaces v1's boxes (`PhotoOverlay` boxes)
and the tray overlay's cell-by-cell masks.

- **Data.** Container photos: `segmentation.container_mask` and `segmentation.fluid_mask` (new, each a `MaskBits`
  packed at `MASK_GRID` 32 over the matching `container` or `fluid` box, exactly as tray regions are, or null; capture/photo-reading
  "Masks kept with the segmentation"). Trays: each region's `mask` (dish) and `food`. Evidence without masks (saved
  before ui-polish, or a mask that was missing) falls back to boxes, as today. Spark-only reads have `segmentation:
null` and draw no overlay.
- **Tracing (`lib/contour.ts`, pure, unit-tested).** `unpack(MaskBits)` → a `width × height` grid; `contours(grid)` →
  closed loops by marching squares on cell corners (boundary edges oriented with the mask on the left, joined into
  loops; holes are loops too, drawn with `fill-rule: evenodd`); `smooth(loop)` → two Chaikin corner-cutting passes;
  `toPath(loops, box, image)` → an SVG path in percent of the image's own pixel size. A 1-cell mask gives a 4-corner
  loop; an empty mask gives none.
- **Layers, bottom to top:** the photo; a dim of `fg` at 42% everywhere outside the container contour (an even-odd
  path), so the subject stays bright; for each element a halo (`bg` stroke 6 px at 55%) and its contour (2 px, round
  joins, `vector-effect: non-scaling-stroke`); the fill line (1.5 px `bg`, dash 4 2) across the container at the liquid's
  top; HTML labels (never SVG text, so they do not scale): `xs`/600 `bg` text on an `fg` tag at 90%, `radius.sm`.
- **Tints per element** (identity, never status):

  | Element                   | Contour                        | Fill                     |
  | ------------------------- | ------------------------------ | ------------------------ |
  | Container (jug, bag, cup) | `bg` (white) over the halo     | none (the dim frames it) |
  | Liquid, intake container  | `intake`                       | none                     |
  | Liquid, output container  | `output`                       | none                     |
  | Dish (tray region)        | `CATEGORY_HUE.food` `#1baf7a`  | none                     |
  | Food on a dish            | none                           | `#eda100` at 28%         |
  | Drink on a tray           | `CATEGORY_HUE.water` `#2a78d6` | none                     |

  The tray hues validate all pairs (validator report). On a photo every element also has its label, so no element is
  told apart by colour alone.

- **Labels:** container `Urine bag` (from `CONTAINER_LABEL`, sentence case); liquid `Liquid · 46% full ≈ 930 mL` (fill
  fraction, then `segmentation.fluid_volume_ml`, the stored fill × capacity to the nearest 10 mL; web/ward "Region
  quantities on the labeled photo"), or `Liquid · 46% full` when the volume is null or absent, and `Tea · 60% full ≈ 120
mL` when the entry or draft has a `drink`. The value is tabular; `≈` keeps it read as an estimate, never as the
  charted volume; dishes `1 rice · Half` and drinks `2 tea · 150 mL`, or `4 chaas · Buttermilk ·
200 mL` when the name is not the kind's label (spec'd "Tray overlay").
- **Toggle:** `Labeled | Raw` (`Segmented`, Labeled first) on every kept photo: the entry peek, the entry details, a
  jug's or bag's before and after photos and a meal's tray proof. Raw hides contours, halos, dim and labels together. A
  capture on the check screen shows the toggle only when segmented.
- **Where:** the entry peek (signature 2), the entry details source viewer, the full-screen viewer, the capture check
  screen, the round's reading peek, a meal's `What the AI read` and `Show tray`.
- **Two stored images** (labeled-photo-copy). Saving a segmented read also keeps a labeled copy: `lib/labeled-copy.ts`
  draws the same `overlayView` geometry and label text into the uploaded photo's own pixels on a canvas (veil `fg` 40%,
  text 3.6% of the shorter side (about 7 pt printed 90 mm wide), contours scaled with it over a halo and smoothed over one mask cell, dashed surface line, `fg` 90% chips with `bg` 600 text and a
  tint tab), and uploads it as a JPEG at 0.85, so the two never disagree. Labeled shows the stored copy (no live overlay,
  no reveal) with `Labeled copy fingerprint: 7c1e…d4`; without a copy the live overlay is drawn, captioned `Labeled copy
not kept · drawn from the read`; a Spark-only read shows the photo under `No labeled copy · Spark-only read, no
regions`. The photo strip's thumbnails and the print page's `Photos` section use the copy.
- **Accessibility:** the `img` alt names what was outlined: `Photo of the urine bag. SAM 3.1 outlined the urine bag and
the liquid, 46% full, about 930 mL.`

### 5.23 Next up (`components/next-up.tsx`, `lib/next-up.ts`)

The first block of every staff home: what to do next, in order.

```
≥ 1100 px: one strip                              ≤ 1099 px: a list, 3 shown, then "<n> more next up"
┌ Next up            ┬ 1 [3A·6] ● Overdue  Bag reading   ┬ 2 [3A·4] ● Review now  Low output ┬ … (5 at most)
│ 2 bag readings ·   │   last 18:40 · 4 h ago            │   0.31 mL/kg/h to 22:00          │
│ 2 review now · 8 … │                                    │                                   │
```

- **Order (`lib/next-up.ts`, pure, tested):** (1) overdue: `bag_reading_overdue` and every red prompt; (2) due soon:
  amber prompts, and bags whose `bag_levels.due_at` is within 30 minutes or past; (3) an intake target check
  (`care.intake_target.next_check.at`) within 60 minutes with less than its `ml` counted; (4) pending entries, one item
  per bed, most waiting first (`Approve 3 entries`); (5) blue checks. One item per bed and action: the highest group
  wins, so an overdue bag past its `due_at` is one `Bag reading` item in (1). Within a group: earliest `due_at` or `next_check`
  first, then acuity (critical first), then bed number. Prompts carry no time of their own, so ties never use one.
- **Item:** rank number, `BedBadge sm`, the tone chip (`Overdue`, `Review now`, `Due`, `◷ <n>`, `Check`), the action
  (`Bag reading`, `Low output`, `Approve entries`), and when (`last 18:40 · 4 h ago`, `due 22:20 · in 12 min`). The
  whole item is a 52 px link to the bed (`/n/<id>`), pending items to its waiting list (`/n/<id>#waiting`).
- **Counts by action** in the head: `2 bag readings · 2 review now · 1 review · 8 to approve`, each a stat-chip peek
  listing the beds behind it.
- **Empty:** `Nothing due. 0 waiting for approval.` in `muted`, with `ok` glyph.
- **Data:** the beds' existing load (`GET /api/admissions?ward=<id>`); on `/n`, the wards' `pending` and
  `beds_with_alerts` (an item per ward: `3A · 2 to review · 8 pending`, wards with red beds first, then by pending);
  on `/d`, the worklist (open referrals oldest first). It never sends a request of its own.

### 5.24 DrinkLabel, DrinkIcon and DrinkPicker (`components/drink-label.tsx`, `lib/drinks.ts`, from drink-types)

The one way to write a drink: the kind's icon (2.1 "Drink kinds", 14 in rows and chips, 16 inline, `intakeText`), the
label and the volume (`Tea 150 mL`), then the item in `muted` when `drinkTitle` gives a name (`masala chai`). Entries
with `drink: null` show their category instead. Used in dense rows, the entry peek head, the timeline readout, the `In`
metric peek, the breakdown and its table, and the check screen. Never a hue per kind; never a second icon or label map
(`src/lib/drink-source.test.ts` fails on either, and on a hex colour in these two files).

**The icon set** (`DRINK_ICON` in `components/drink-label.tsx`, the only map; one Lucide module per icon, never the
barrel). It lives beside the component rather than in `lib/drinks.ts` so the pure lib (and its node tests) never load
icon modules.

| Kind            | Label (`DRINK_LABEL`, `@meniscus/shared`) | Lucide module                    |
| --------------- | ----------------------------------------- | -------------------------------- |
| `water`         | `Water`                                   | `lucide-react/icons/glass-water` |
| `tea`           | `Tea`                                     | `lucide-react/icons/leaf`        |
| `coffee`        | `Coffee`                                  | `lucide-react/icons/coffee`      |
| `milk`          | `Milk`                                    | `lucide-react/icons/milk`        |
| `juice`         | `Juice`                                   | `lucide-react/icons/citrus`      |
| `coconut_water` | `Coconut water`                           | `lucide-react/icons/tree-palm`   |
| `buttermilk`    | `Buttermilk`                              | `lucide-react/icons/blend`       |
| `ors`           | `ORS`                                     | `lucide-react/icons/droplets`    |
| `supplement`    | `Supplement drink`                        | `lucide-react/icons/cup-soda`    |
| `soup`          | `Soup`                                    | `lucide-react/icons/soup`        |
| `other`         | `Drink`                                   | `lucide-react/icons/droplet`     |

**Components:**

- `DrinkIcon kind size` (14 | 16 | 20 | 24): the icon in `intakeText`, with the kind's label as its accessible name.
- `DrinkLabel drink item volume sep size chip`: `[icon] Tea 150 mL` (600, tabular) then the name (`muted`, 400). `sep`
  is `' '` on the bed review and `' · '` on the check screen; `size` 14 in dense rows and chips, 16 inline; `chip` draws
  the drink chip in the one intake shade (`intakeBg` fill, 1 px `intake` inset edge, `xs` text, `pill`).
- `DrinkPicker value onChange`: the `Drink` choice on the check screen and in Amend, as the form row's `SelectField`
  (48 px, 17 px), unset (`Choose the drink`) until picked. Its options are `DRINK_OPTIONS` in `DRINK_KINDS` order.
- Pure helpers in `lib/drinks.ts`: `drinkTitle` (label and the name when it differs), `drinkLine`, `drinkTotals`
  (approved drinks by kind, largest first, for the `In` peek and the breakdown), `kindLabel`, `mealFluidLine`,
  `checkTitle`, `offersDrinkPicker`, `withDrink`.

---

## 6. Charts (dataviz method)

1. **Form first.** A single number is a vital or stat, not a chart. 24 h change is the BalanceTimeline. Hourly
   activity is mirrored bars. Composition is a segmented bar with labels. Capacity is a gauge. Accuracy is outcome bars
   plus tables (spec'd), laid out as small multiples (one panel per read kind, ≥ 900 px three columns) with the same
   content as "Outcome bars".
2. **Colour by job.** Identity: `CATEGORY_HUE` and the outcome hues in fixed order, never cycled. Direction: `intake`
   and `output`. Status: prompt markers only, always with a glyph. Magnitude: one ramp. Acuity: the ink ramp.
3. **Marks.** 2 px lines (1.5 px for secondary and dashed), bars with 2 px gaps and 1.5–2 px ends anchored at the
   baseline, markers ≥ 8 px with a 2 px `bg` ring, recessive `grid`, one y-axis per panel.
4. **Text.** Ticks and labels `xs` `muted`, values and legends in text tokens, never a series colour. X ticks on round
   hours. Direct labels on line ends; never a number on every bar.
5. **Legend** for ≥ 2 series, direct labels up to 4.
6. **Interaction.** Every chart has a hover and tap readout (crosshair band on time series, per-mark on bars and
   segments), keyboard steps where it is a focus stop, hit targets larger than the mark, `touchAction: pan-y`.
7. **Text equivalent.** `role="img"` with a one-sentence `aria-label` of the totals, plus a table (inline, or `Chart |
Table`). The entry log is also the table for the bed's entries.
8. **One scale per comparison.** Tiles and board rows share the ward's scale; shift sparklines share the bed's.

---

## 7. Screens

Every route below is built by ui-polish. "Peek" means 5.1, "rows" 5.7. Request counts are in section 8.

### 7.1 `/` and the session gate

- `/` redirects by role (unchanged). Splash: the brand mark centred on `canvas`, `Loading…` status.
- **Sign-in** (`components/sign-in.tsx`): one 1080 px column; a `bg` sheet of max 420 px with the hospital name, the
  username and password fields (48/17), `Sign in` primary `lg`, and the demo accounts as dense rows grouped by role with
  `xs`/700 headings (`Ward staff`, `Matron`, `Dietitian`), each row a 44 px button `Ravi Kumar · Attendant · 3A`.
- **Lock**: the same sheet with the avatar, `Locked · Anita T.`, password, `Unlock` `lg`, and `Someone else` ghost.
- **Switch user**: `AlertDialog` (unsaved work) per 5.2.

### 7.2 `/a` bed picker (attendant)

- Ward picker (scale-store adds one later: link rows with the ward code `BedBadge sm` and name). Beds as a grid of 56
  px buttons (`BedBadge md` + patient short name + a status glyph), 3 columns at 390, 6 from 641 px. A static `Notice`
  (no live region) for "Scan the QR card…".

### 7.3 `/a/bed/$token` capture

Simple density (2.6): one task per screen, at most 4 choices visible, 52 px commits, 1080 px column, the phone is the
target (`mock-390-capture.png`).

- **Bed strip**: `BedBadge lg`, patient, ward, acuity mark, and the bed's devices (`Catheter · urine bag`) in one line;
  a compact vitals line (`In 1190 · Out 1375 · since 08:00`), no cards.
- **Capture tiles**: 2 × 2 grid of 96 px tiles (Photo, Voice, Note, By hand), the primary (Photo) on `accent` with an
  `onAccent` hint, the others `bg` with a `borderStrong` edge, icons 24, focus ring.
- **Check screen**: the photo at full column width with its SegmentOverlay (5.22; signature 2 plays once when the read
  lands), `Photo · 88%`, `SAM and Spark agree` and `3 model calls · 6.8 s`, then the draft in an inset panel: direction and category ChoiceChips, the `Stepper`, `Photo · 82%` and `SAM + Spark` chips, urine colour
  chips with swatches, consistency chips, the NBM warning `Notice`, then `Save` primary `lg` and `Discard` ghost.
- **Bag**: the gauge (26 × 72) beside the level `Stepper`, the event as one ChoiceChips group, the effect line `md`/400,
  duplicate and nearly-full notices, the device warning (patient-devices) as a warn `Notice` with `Add catheter` for
  nurses. After emptying: `Add after-emptying photo` primary `lg`, `Left in bag` stepper, `Done` secondary `lg`.
- **Meal / served tray / collected tray**: tray photo with region labels, dish rows in an inset panel, portion chips,
  served-tray line; the comparison as the before/after pair with the eaten share as a stat line.
- **Voice and note**: recording status (static dot under reduced motion), duration, `Stop and send`; the model-api-guards
  "Recording too long" message as a danger `Notice` with its spec'd copy and `Record again`. Drafts as rows with their
  own chips and steppers.
- **Late entry by hand**: `TimeField` with the 24 h echo, category chips, stepper.
- **Refused** (budget): the 7.6-v1 pattern kept: the capture stays, one warn `Notice` with the spec'd sentence, `Enter by
hand` primary `lg`, `Read again from 11:00` secondary `lg` disabled until then. No countdown.
- **Today at this bed** (below the fold): the last 6 entries as rows with peeks; `Show all` links to the bed review for
  nurses.
- Results: the toast.

### 7.4 `/a/round` ward round

- Header: ward and progress as a mirrored strip of beds (one cell per bed: done, current, to do) plus `5 of 7 beds`.
- Bed cards become a horizontal list of `BedBadge md` buttons with status glyphs (spec'd "Bed card switches the bed").
- Readings as rows with downscaled thumbs (144 px bitmaps), `Photo · 62%` chips, raw enums via labels, the refusal
  inline, bag readings with the gauge. `Save the round` primary `lg` sticky at the bottom above the tab bar.

### 7.5 `/n` nurse home

- **Next up** (5.23) across wards: one item per ward with beds to review or pending entries, `3A · 2 to review · 8 pending`,
  wards with beds to review first, then by pending count. From `GET /api/wards` only.
- **Wards view**: a dense list (one row per ward, or 2 columns ≥ 1100 px) instead of tall cards. Each row: ward code
  badge, name, `6/6 beds`, a 24 h mirrored sparkline from `hourly` (new on `GET /api/wards`), `3 pending`, `4 to review`
  as a stacked bar of occupied beds (to review in the ward's tone, the rest `grid`) with the numbers, last activity, `In
charge: Grace L.`, and the ward's status edge from `wardTone`. Spec'd strings unchanged. Your wards first.
- **Model accuracy view** (`/n?view=model`): the Model accuracy section for the hospital, as small multiples.
- Header: `Hospital census` (spec'd) with the `Wards | Model accuracy` segmented control.

### 7.6 `/n/w/$ward` ward dashboard

- **Next up** (5.23) first, above everything else (`mock-1280-ward.png`, `mock-390-ward.png`): five items at most,
  counts by action in its head. At 1100 × 800 the head, Next up and the first four board rows fit without scrolling.
- **Ward head** (one sheet): `BedBadge` with the ward code, `7 beds · In charge: Anita T.`, shift, refreshed time; stat
  chips `Review now 2`, `Review 1`, `Pending 8 entries`, `Ward balance −1840 mL`, each opening a peek of the beds behind
  it. The nurse-in-charge picker sits in the head's peek-free row as a `SelectField` for those who may set it.
- **Toolbar**: `Beds | Data quality | QR cards` segmented, the acuity filter segmented, the `My beds · 4 of 7` switch.
- **Beds**: BoardRows ≥ 1100 px, BedTiles below (5.9), grouped by acuity, ordered by "Beds needing attention first".
  The legend under the board (5.13). Assigning beds (`Assign beds`) is a sheet from the head; the per-tile nurse select
  is gone.
- **Data quality**: stat tiles (`Stat unit=""`) in one row of chips with metric peeks (each tile's peek lists the
  entries behind it), rejections by reason as a labelled bar, recorder and reviewer tables in `TableScroll` with a
  sparkline column only where a per-day series exists (none today: the tables keep numbers only), flagged entries as rows
  with entry peeks, then Model accuracy as small multiples with its `Chart | Table` and class table picker.
- **QR cards**: a grid of bed QR tiles; the QR dialog per 5.2.
- Reason to open another ward: the spec'd dialog per 5.2.

### 7.7 `/n/$id` bed review

```
≥ 1100 px
┌ banner: [BedBadge lg] Joseph Mwangi · MRN · 75 kg · admitted · Watch   │ In 2490 │ Out 2800 │ Balance −310 │ Pending 750 ┐
│ status chip · care and device badges ·························· Add missed entry · QR · Print chart                       │
├──────────────────────────────── main (1fr) ───────────────────────────┬──────────── side 340 ────────────────────────────┤
│ Last 24 hours  [Chart|Table] [Photos 9]                                │ Review prompts (rows with one action each)       │
│   BalanceTimeline                                                      │ Care plan (gauges for limit/target, rows)        │
│   urine rate │ in/out composition                                      │ Bags (gauge per bag, last reading, period line)  │
│ Waiting for approval 3  [Approve 2 high-confidence]  (pending rows)    │ Meals, 24 h (rows with portion pips)             │
│ Intake and output log (filters; shift headers with sparklines; rows)   │ Nutrition (referral row, dishes in peeks)        │
└────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────┘
```

- Below 1100 px the side column follows the main column, prompts first (they come before the chart on phones).
- **Banner**: `bars[bedTone]` edge, `BedBadge lg`, patient (`xl`/700), meta line, acuity mark; the vitals strip (5.8)
  with metric peeks: In (by category with share, drinks by kind with icons from `drinkTotals`, by shift), Out (by category, urine colours), Balance (in − out =
  balance, the overload rule `warn past 1500 mL`), Pending (each pending entry `time · category · volume · age`).
- **Prompts** as rows: tone chip, message, at most one action (`Add missed entry`, `Add missed emptying`, `Refer to
dietitian`, `Add catheter`), subtitle `Rule-based prompts for review. Not a diagnosis.`
- **Photos 9** (ghost) opens the photo strip in place (spec'd "Photo strip", now behind the toggle); thumbnails are
  fetched only then.
- **Pending**: rows (5.7) with Approve and Reject… on the row, `Change…` for a corrected approval, entry peeks on the
  row body. `Approve 2 high-confidence` primary in the section head.
- **Log**: filters in one row (`Segmented` direction, `SelectField` category, status, source, period, search), shift
  headers with totals and a 12 h mirrored sparkline, rows with entry peeks, the pager. Sorting by a column header keeps
  the spec'd behaviour.
- **Care plan**: limit and target as gauges with `1230/1500 mL · 82%`; catheter, devices, IDDSI, diet and acuity as
  rows with `Change…`/`End…` ghost buttons; history behind `Show all`.
- **Bags**: one block per bag: gauge, `840/2000 mL · checked 18:20`, due chip, the period stat line, readings as rows
  with thumbs only in their peeks.
- **Meals**: rows with portion pips (4 squares: eaten quarters in `fg`, the rest `grid`, `aria-label` `3 of 4 eaten`),
  fluid chip, `What the AI read` in the meal's peek (one media request for the tray photo).
- **Nutrition** (dietitian-care): referral row with state chip and actions; dishes listed in rows; `Show tray` per spec.
- **Entry details** sheet (5.2) from `Details`.
- Loading: banner and chart rail drawn empty at their heights; error per 5.19.

### 7.8 `/n/$id/print` daily chart

Print-only layout unchanged in structure: A4, `fg` on white, the hourly table and the timeline without interaction,
12 px floor, tokens for radii and type. No sidebar, no app bar (`data-app-chrome` hidden in print).

### 7.9 `/d` dietitian worklist and `/d/$id` patient view

- `/d`: Next up (5.23) is the first three open referrals, oldest first (`Open · referred 2 days ago`), then `Referrals`
  (spec'd) and the diet list as rows: `BedBadge sm`, patient, reason chip, a 7-day meal pips line
  (`2 of 3 meals 50% eaten or less · last 24 h` stays as text), state chip (`Open` warn, `Acknowledged` info, `Closed`
  neutral), chevron. A row's peek shows the referral note, who referred and when, and the diet order.
- `/d/$id` (dietitian-care): banner as 7.7 without vitals peeks for fluids; meals as rows with portion pips and dish
  rows; referral, assignment and diet actions per their specs, dialogs per 5.2.
  - Sections (5.5) in order: `Dietitian` (the dietitian line as subtitle, `Take on`, `Take over…`, `Hand back…`,
    `Assign…`; the assignment history as muted lines), `Diet` (the care-plan row text and its History), `Referrals`
    (newest first, state chip, lines, note), `Food chart` (one header per day, `Tue 3 Nov · 2 meals · 2 eaten 50% or
less`, then that day's meal rows). One GET; the 30 s refresh pauses while locked, hidden or awaiting a reason.
  - Outside the dietitian's wards: the reason dialog only (`AccessGate`), Cancel back or to `/d`. An assignment never
    waives it.
- **Diet form** (bed review and `/d/$id`): on the bed review's care plan a dietitian, who can add only a diet, gets one
  `Add diet` button that opens the form directly (no `Add order` kind chooser). Two ChoiceChips groups, `Diet` (type, ≤ 3 words) and `Food texture (IDDSI)`
  (two lines: `IDDSI 6`, then the name at 500). A dietitian adds targets with `Add energy target` / `Add protein target`,
  each a Stepper (`kcal`, `g protein`) with `Remove`. Everyone else reads a muted line,
  `1800 kcal · 60 g protein · set by a dietitian`: never a disabled stepper. A diet with targets offers non-dietitians
  no `End…`; the row reads `Only a dietitian can end a diet with targets.`
- **Assign dietitian** (lazy dialog, 5.2): one `GET /api/staff` on open; ChoiceChips of dietitians, those covering the
  ward first (`Sana Mirza · covers Renal HDU`); `Assign` disabled until one is picked. `Take over…` and `Hand back…`
  confirm in an AlertDialog. A refused hand back closes it and the screen shows
  `No dietitian covers <ward> to take the referral.`
- **Dishes** under each meal row: `<name> · <portion>` at 600 with the dish kind muted; amendment marks muted with a
  pencil (`Amended 14:10 by Anita T. · was rice`, `Added …`); removed dishes in `<s>` with `Removed …` in words, never
  strike-through alone. `Show tray` (ghost, sm) fetches the photo once per meal and draws the tray overlay.
- **Diet badges**: neutral fact chips after the other care badges: `Renal diet`, `Food IDDSI 6`.
- Not a dietitian: `Placeholder` with the spec'd sentence.

### 7.10 Not found and route error

`Placeholder` with `NotFoundIcon` (`Page not found`) or `CircleAlert` (`Something went wrong` + `Try again`). Never the
camera icon.

---

## 8. Data flows and request counts

The redesign adds **0 model requests** to every user action. Peeks and charts read what the route already loaded.

| Surface                             | Data                                                      | Requests on open                                                                                    |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Entry peek (photo entry)            | the `Entry` from `GET /api/admissions/:id/entries`        | 1: `GET /api/media/<entry.media.id>` (or the level drop's `levels.after.media.id`), first open only |
| Entry peek (voice, text, by hand)   | the `Entry` (transcript and turns from `evidence`)        | 0 (no audio is fetched; the player is in Details)                                                   |
| Entry details sheet                 | the `Entry` + `GET /api/entries/:id/events`               | as today (events, then media in the source viewer, reusing the cached photo)                        |
| Bed peek, stat-chip peeks           | `AdmissionSummary[]` from `GET /api/admissions?ward=<id>` | 0                                                                                                   |
| Metric peeks (vitals, Data quality) | `EntryList`, `WardQuality`                                | 0                                                                                                   |
| Segment contours (5.22)             | `evidence.segmentation` masks already on the `Entry`      | 0 (traced in the browser from the packed masks)                                                     |
| Next up (5.23)                      | the route's own load                                      | 0                                                                                                   |
| Timeline readout, photo marks       | `EntryList`                                               | 0 (a photo mark opens the entry peek: row 1)                                                        |
| Sidebar, quick jump                 | `staff.wards`, `lib/snapshot.ts`                          | 0                                                                                                   |
| Ward cards sparkline (`/n`)         | new `hourly` on `GET /api/wards` items                    | 0 extra (same single request)                                                                       |
| Bed tile gauges                     | new `bag_levels` on `GET /api/admissions` items           | 0 extra (same single request)                                                                       |
| Photo strip                         | `Photos <n>` toggle opens it                              | up to 12 photo requests, only when opened                                                           |

- **Media cache** (`lib/media-cache.ts`): object URLs by media id for the route's lifetime (at most 24, least recently
  used revoked first, all revoked on route unmount). The peek and the details viewer share it, so opening Details after
  the peek sends no second media request. Thumbnails are downscaled once per photo to 320 px wide
  (`createImageBitmap(blob, { resizeWidth: 320 })` → canvas → object URL).
- **Abort**: closing a peek before its photo arrives aborts the request (`AbortController`); the next open sends it again.
- **Hover dwell**: a pointer that crosses rows without resting 400 ms opens nothing and fetches nothing.
- **No prefetch**: lists never prefetch media; nothing fetches on focus, render, reconnect or refresh.
- **New server fields** (specified in ui-polish): `bag_levels` on `GET /api/admissions` items (charting/bag-periods
  "Bag levels on the bed list"), `hourly` on `GET /api/wards` items (charting/wards "Ward summary"), and
  `container_mask` / `fluid_mask` in photo segmentation (capture/photo-reading "Masks kept with the segmentation",
  charting/photo-evidence "Segmentation masks in stored evidence"). The masks come from SAM responses the read already
  receives (3 requests in `sam+spark`; 1 in `spark` mode, with no masks), so no request is added. Each mask is at most 172
  base64 characters, so a photo entry's body stays far inside the 16 KB JSON limit.

---

## 9. Accessibility rules

1. **Targets:** 44 × 44 px minimum (`layout.tap`), 52 for capture and sign-in commits. Peek triggers, sort buttons,
   `summary`, pager buttons, breadcrumb and sidebar links included.
2. **Focus:** `outline: 2px solid accent; outlineOffset: 2px` on `:focus-visible` (`ui.focus`). Never `outline: none`
   without it. Rows and tiles show it on the row; stretched-link tiles on `:focus-within`.
3. **Contrast:** text 4.5:1, meaningful non-text 3:1, checked by `src/tokens.test.ts` against the tables in 2.1.
4. **Never colour alone:** tones have glyphs and labels; acuity has its word; gauges have their numbers; direction has
   ▲/▼ and `In`/`Out`.
5. **Structure:** one `h1` (app bar), `h2` page title and sections, `h3` inside. Lists are `ul`/`ol`, figures `dl`,
   tables have `th scope`. Landmarks: `nav` (sidebar, bottom bar), `main`, `header`.
6. **Peeks:** open by tap and Enter as well as hover; Escape closes and returns focus; content duplicated in Details or on
   the row; `aria-haspopup="dialog"` and `aria-expanded` on triggers; no information only in a peek that a task needs
   (the peek summarises, Details holds the record).
7. **Charts:** a sentence `aria-label` and a table view; the timeline is one focus stop with arrow-key hours and a polite
   live readout.
8. **Live regions:** the toast (polite, assertive for danger), busy labels, the timeline readout. Static guidance is not
   live. Connection status announces changes only.
9. **Forms:** visible labels, `aria-describedby` for hints and errors, 17 px inputs, no placeholder-as-label.
10. **Dialogs and sheets:** focus in on open, back to the opener on close, Esc closes, background inert.
11. **Motion:** every var is 0 ms under reduced motion; the signature moments draw their final state at once.
12. **Zoom and width:** no horizontal page scroll at 390 and 320 px, layout survives 200% zoom, no `nowrap` on sentences.
13. **Text size:** 12 px floor.
14. **Language:** `<html lang="en">`, patient names `translate="no"`.

---

## 10. Bundle and performance

1. **Budget:** shell ≤ 120 KB gzip (about 117 KB before ui-polish), each route's own chunks ≤ 50 KB. Measure with
   `pnpm --filter @meniscus/web build` before and after.
2. **Shell additions must be tiny:** the sidebar's sections and `lib/snapshot.ts` (< 2 KB), the toast manager. The More
   drawer, the quick jump and every peek's content are lazy. About 117 + 4 KB is over budget, so if the shell measures
   120 KB or more: the sidebar body is lazy behind a same-size rail placeholder, the peek trigger is a tiny inline hook
   whose content chunk loads on first open, and the toast viewport loads on the first `flash()`.
3. **Peeks:** `Popover` root and trigger in the route chunk (one handle per list); content in lazy chunks per kind,
   imported on first open, preloaded with `import()` when the pointer first enters a list (no data, code only).
4. **Charts:** hand-built SVG in `components/` (timeline ≈ 6 KB, spark and gauge < 2 KB each). No chart, date or
   animation library. Signature motion is CSS transforms on SVG groups.
5. **`/n/$id`:** below-the-fold sections (log, meals, bags, nutrition, evidence and source viewer, tray proof) are lazy
   with height-reserving fallbacks and loader-started imports. Target: first-paint chunks ≤ 40 KB.
6. **No new runtime dependencies. No web fonts.** Add each new Base UI component (`popover`, `drawer`) to
   `optimizeDeps.include`.
7. **Paint cost:** no `backdrop-filter`, no animated shadow or filter, no layout-property transitions.
8. **Images:** thumbnails downscaled once, `loading="lazy" decoding="async"`, fixed `aspect-ratio`, object URLs revoked.
   Media only when opened.
9. **Refresh:** the 30 s refresh pauses while locked or hidden. Never poll `/api/ai/*`, never re-fire on render, focus or
   reconnect.
10. **Lists:** the log pages at 25; hidden tabs and closed peeks render nothing.

---

## 11. Do / Don't

| Do                                                               | Don't                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Open every staff home on Next up: overdue, due soon, waiting     | Make a nurse scan bed cards to find the next job                         |
| Keep attendant screens to one task, 4 choices, 52 px commits     | Bring board density, charts or peek-only flows to `/a/*`                 |
| Draw SAM's mask contours with a halo, labels and the fill line   | Draw boxes when masks exist, or colour segments with status colours      |
| Show a dense row and put the photo, read and history in its peek | Show a photo strip, an evidence card or a tall card per entry by default |
| Open peeks by hover (400 ms), tap and Enter                      | Make a peek hover-only (`PreviewCard`) or open it on focus               |
| Keep Approve and Reject… on the pending row                      | Put a required action only in a peek or behind hover                     |
| Draw a value against its limit, capacity or threshold            | Show `1230 mL` alone when a 1500 mL limit exists                         |
| Use the shared hour rail with round-hour ticks and `now`         | Start ticks at `now − 6 h`, or give each chart its own time window       |
| Use two panels on one time axis for different magnitudes         | Use two y-scales on one plot                                             |
| Use `intake` blue and `output` mulberry for direction            | Use amber for output, or any status colour for data                      |
| Tell drink kinds apart by icon and label, in one intake shade    | Give each drink kind its own hue                                         |
| Use the acuity ink ramp and its word                             | Colour acuity red or amber                                               |
| Fetch media on open, once, through `lib/media-cache.ts`          | Prefetch thumbnails for a list, or `fetch` media in a render             |
| Use `Section` sheets with a border and no shadow                 | Use soft shadows on page cards, or gradients as decoration               |
| Use sentence-case `xs`/700 headings                              | Use uppercase tracked overlines                                          |
| Use `Button` at `touch` or `lg`                                  | Use `sm`/`md` or a raw styled `<button>`                                 |
| Use ChoiceChips (48 px, accent selected) for choices             | Invent selected states or use status colours for a selection             |
| Use `f.input` 48/17                                              | Use 40 px or 15 px inputs                                                |
| Format with `lib/format.ts`                                      | Write `toLocaleTimeString`, `padStart(2`, or `* 100)}%` in a component   |
| Put units on every volume                                        | Leave a bare number that means mL                                        |
| Use the toast for results                                        | Add a flash slot or stack notices                                        |
| Use Lucide icons at 14/16/20/24 and the tone glyphs              | Use text glyphs or 18/22/28 px                                           |
| Give every chart a sentence and a table                          | Ship a chart with no text equivalent                                     |
| Declare motion through `motion.*`                                | Hard-code a duration or animate on load                                  |

---

## 12. Review checklist (paste into the PR)

- [ ] Tokens only: no new hex, px size, radius, weight, z-index or duration outside section 2.
- [ ] Every element uses a recipe in section 5, or this file gains one in the same change.
- [ ] Density by role (2.6): staff homes open on Next up; patient screens are one tap to anything; attendant screens
      stay simple.
- [ ] Dense by default: no always-visible photos, evidence or history; detail in a peek or sheet.
- [ ] Segmented photos draw mask contours (5.22), boxes only as the fallback, nothing for Spark-only reads.
- [ ] Peeks open by hover (400 ms), tap and Enter; Escape returns focus; ≤ 640 px they are sheets; no required action
      only in a peek.
- [ ] Media fetched only on open, once per page, aborted on close; request counts asserted in a test; 0 model requests.
- [ ] Every value with a limit, capacity or threshold is drawn against it.
- [ ] Charts: one y-scale per panel, round-hour ticks, legend for ≥ 2 series, readout on hover and tap, sentence and
      table equivalent.
- [ ] Targets ≥ 44 px, focus ring, contrast checked, no text < 12 px, no sideways scroll at 390 and 320 px.
- [ ] Copy: sentence case, `…`, units, 24 h times, day-first dates, helper-formatted numbers, spec'd strings verbatim.
- [ ] Empty, loading and error states drawn, no blank boxes.
- [ ] Motion through `motion.*`; reduced motion checked; signature moments only on approval and the entry peek photo.
- [ ] `pnpm --filter @meniscus/web build` within budget; no new runtime dependency.
- [ ] Screenshots at 390 and 1100 px for every screen and state touched.
