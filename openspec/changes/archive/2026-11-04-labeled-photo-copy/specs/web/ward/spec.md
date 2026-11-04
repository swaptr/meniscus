# Spec Delta

## ADDED Requirements

### Requirement: Raw and labeled views of a kept photo
Where a kept photo is shown (entry peek, entry details, jug before and after photos, tray proof, a bag reading's photo viewer), the app SHALL offer `Labeled | Raw`, Labeled first: the labeled copy, else the live overlay captioned `Labeled copy not kept · drawn from the read`, else the photo under `No labeled copy · Spark-only read, no regions`. Raw shows the photo alone. Each view fetches its media once when first shown, with 0 model requests; the photo strip shows copies.

#### Scenario: Copy shown first
- **WHEN** a peek opens for an entry with media 41 and labeled copy 42, whose `sha256` begins `7c1e` and ends `d4`
- **THEN** `Labeled` is pressed, the copy is shown, `Labeled copy fingerprint: 7c1e…d4` is shown under it, and exactly one request, `GET /api/media/42`, was made

#### Scenario: Raw picked
- **WHEN** `Raw` is then picked, and then `Labeled` again
- **THEN** one `GET /api/media/41` was made in all, the raw photo has no outline or label, and the copy is not fetched again

#### Scenario: Copy not kept
- **WHEN** a segmented entry with `labeled_media: null` is peeked
- **THEN** `Labeled` shows the raw photo with the live overlay and `Labeled copy not kept · drawn from the read`, after one `GET /api/media/<photo>`

#### Scenario: Spark-only read
- **WHEN** an entry read in `spark` mode is peeked
- **THEN** `Labeled` shows the raw photo under `No labeled copy · Spark-only read, no regions`, and no other media is requested

#### Scenario: Tray proof
- **WHEN** a lunch's tray proof is opened, its meal having `labeled_media.id: 43`
- **THEN** `Labeled` is pressed and `GET /api/media/43` is the only request

#### Scenario: Bag reading photo
- **WHEN** on the bed review a 08:00 emptying has media 70 and labeled copy 72, and its `Before emptying` tile, a camera icon with that label, is tapped
- **THEN** the viewer opens with `Labeled` pressed on copy 72 and `Labeled copy fingerprint: …`, after one `GET /api/media/72`; nothing was fetched before the tap

### Requirement: Photos on the printed chart
`/n/<id>/print` SHALL follow the hourly table with `Photos`: the photo entries and photo meals of the same 24 hours, newest first, at most 12, each with its time, what was charted and its labeled copy, else its raw photo under `No labeled copy`. Each is fetched once with `GET /api/media/<id>`, and printing waits until they have loaded or failed. It makes no model request. With no photos the section is not shown.

#### Scenario: Two photos
- **WHEN** at 14:30 the bed has a 09:10 urine bag entry of 380 mL with labeled copy 42 and a 12:40 lunch with labeled copy 45
- **THEN** `Photos` lists `12:40 · Lunch` with copy 45, then `09:10 · Urine 380 mL` with copy 42
- **AND** exactly two media requests were made, `GET /api/media/45` and `GET /api/media/42`, and no `/api/ai` request

#### Scenario: Spark-only photo
- **WHEN** a 10:00 cup entry read in `spark` mode, with raw photo 46 and no copy, is in those 24 hours
- **THEN** it is listed with photo 46 under `No labeled copy`

#### Scenario: No photos
- **WHEN** the bed's only entries in those 24 hours are typed notes
- **THEN** no `Photos` section is shown and no media request is made

## MODIFIED Requirements

### Requirement: Bag periods on the bed review
The bed review SHALL show a "Bags" section from `bags`, each bag's newest period first. A period has a header such as `08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h` (`· — mL/h` when a known start has no rate), then each reading's time, event, level and rise, its photo and after-emptying photo, who saved it, `Late` and any fall. It sends no request beyond the bed review's own load, and is not shown for a bed with no bag reading.

#### Scenario: Closed period
- **WHEN** a urine bag was emptied at 08:00, checked at 150 mL at 10:00 and at 260 mL at 11:00, and emptied at 380 mL at 12:00
- **THEN** that period's header reads `08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h`
- **AND** its rows read `10:00 · Check · 150 mL · +150 mL`, `11:00 · Check · 260 mL · +110 mL` and `12:00 · Emptied · 380 mL · +120 mL`

#### Scenario: Open period and unknown start
- **WHEN** after that emptying the bag is checked at 150 mL at 13:00, and the 08:00 emptying at 600 mL was its first reading
- **THEN** the newest header reads `Since 12:00: 150 mL so far (1 reading)`
- **AND** the oldest reads `Until 08:00: 600 mL (1 reading, emptied 08:00)`, with no rate

#### Scenario: Fall
- **WHEN** a check at 150 mL at 12:00 fell from 500 mL at 09:00
- **THEN** its row reads `12:00 · Check · 150 mL · +150 mL · Level fell from 500 mL`

#### Scenario: Late reading already charted
- **WHEN** a check at 260 mL charted for 10:00 was saved at 11:30 between readings at 09:00 and 11:00, and charted nothing
- **THEN** its row reads `10:00 · Check · 260 mL · +110 mL · Late · 90 min · charted with 11:00`

#### Scenario: Proof
- **WHEN** Ravi Kumar's 08:00 emptying has an after-emptying photo and 30 mL left in the bag
- **THEN** its row shows two thumbnails, `Before emptying` and `After emptying`, with `Left in bag 30 mL` and `by Ravi K.`

#### Scenario: No extra request
- **WHEN** the bed review of a bed with bag readings is opened
- **THEN** the only requests are `GET /api/admissions/<id>/entries` and `GET /api/admissions/<id>/meals`

#### Scenario: Too short to rate
- **WHEN** a urine bag emptied at 08:00 is emptied at 450 mL at 08:10, and that period's `rate_ml_h` is null
- **THEN** its header reads `08:00 → 08:10: 450 mL (1 reading, emptied 08:10) · — mL/h`


### Requirement: Source preview
Entry details SHALL show the source by kind:
- **Photo:** a `Labeled | Raw` toggle and a full-screen view.
- **Recording:** play/pause, elapsed/total time, a scrubber, and timed transcript turns (highlighted while playing, tap to seek, amounts marked).
- **Typed note:** quoted.
- **By hand:** `Entered by hand by <name>`.

Media loads with one `GET /api/media/<id>`. A photo meal's "What the AI read" shows its tray photo. Rejecting says if the photo or recording is deleted.

#### Scenario: Recording with turns
- **WHEN** a voice entry with `duration_ms` 4200 and the turns 0–1800 ms `bed 4 had a coconut water` and 1900–4100 ms `200 mL` is opened
- **THEN** it shows `0:00 / 0:04` and the turns `0:00 bed 4 had a coconut water` and `0:01 200 mL`, with `200 mL` marked
- **AND** the playing turn at 2.5 s is the second, and tapping the second turn seeks to 1.9 s

#### Scenario: Photo outline
- **WHEN** a segmented photo entry is opened and `Raw` is picked
- **THEN** the photo shows no container or liquid outline
- **AND** the full-screen view shows the same photo

#### Scenario: By hand
- **WHEN** an entry entered by hand by Anita Thomas is opened
- **THEN** its source reads `Entered by hand by Anita T.`, and no media is requested

#### Scenario: Tray photo
- **WHEN** a photo lunch with a tray photo is shown on the bed review and "What the AI read" is opened
- **THEN** the tray photo is shown with the read

#### Scenario: Reject a photo entry
- **WHEN** a nurse rejects a pending 450 mL urine entry that has its photo
- **THEN** the reject sheet ends with `Its photo is deleted.`
- **AND** the message after rejecting ends with `Its photo was deleted.`

#### Scenario: Reject a recorded entry
- **WHEN** a nurse rejects a pending 200 mL coconut water entry from a recording
- **THEN** the reject sheet and the message after rejecting both end with `Its recording is deleted once no other entry from it remains.`

#### Scenario: Reject a level drop
- **WHEN** a nurse rejects the pending 400 mL entry from a water jug at 1000 mL (08:00) and then 600 mL (12:00)
- **THEN** neither the reject sheet nor the message after rejecting mentions a photo, since both jug photos stay with their levels

#### Scenario: Reject a typed note
- **WHEN** a nurse rejects a pending 200 mL entry from the typed note `tea 200 ml`
- **THEN** neither the reject sheet nor the message after rejecting mentions a photo or recording

### Requirement: Region quantities on the labeled photo
Wherever a container photo's segmentation overlay is drawn, live or into a labeled copy, the container region SHALL be labelled with its container name and the liquid region `<Liquid or drink kind> · <fill %> full ≈ <fluid_volume_ml> mL`, or without ` ≈ … mL` when `fluid_volume_ml` is null or absent. A labeled copy keeps the labels as drawn at capture; the live overlay is drawn from the stored masks with no request.

#### Scenario: Urine bag with a volume
- **WHEN** the check screen shows a urine bag read with fill fraction 0.463 and `fluid_volume_ml: 930`
- **THEN** the container region is labelled `Urine bag` and the liquid region `Liquid · 46% full ≈ 930 mL`
- **AND** the labeled copy saved with it, shown in the entry's peek, has the same two labels drawn in

#### Scenario: No capacity
- **WHEN** an entry's photo evidence has fill fraction 0.46 and `fluid_volume_ml: null`
- **THEN** the liquid region is labelled `Liquid · 46% full`, with no mL

#### Scenario: Spark-only read
- **WHEN** an entry read in `spark` mode, with `segmentation: null`, is peeked
- **THEN** it shows the raw photo with no region labels under `No labeled copy · Spark-only read, no regions`, and no request beyond the photo's own `GET /api/media/<id>` is made

### Requirement: Entry peek fetches its photo on open
An entry peek for an entry with a photo SHALL fetch the view shown with exactly one `GET /api/media/<id>` (the labeled copy's id when there is one, else the photo's: the entry's or a level drop's `levels.after`) the first time it opens, reuse it on later opens while cached (24 most recent) and in the entry details, and cancel it when closed before it arrives. Lists never prefetch photos, and opening a peek makes 0 model requests.

#### Scenario: First and second open
- **WHEN** the peek of a photo entry with media 41 and no labeled copy is opened, closed and opened again, then its `Details` is opened
- **THEN** exactly one `GET /api/media/41` was made and no `/api/ai` request

#### Scenario: Labeled copy first
- **WHEN** the peek of a photo entry with media 41 and labeled copy 42 is opened, and then `Raw` is picked
- **THEN** `GET /api/media/42` was made on opening, and `GET /api/media/41` only when `Raw` was picked

#### Scenario: Closed early
- **WHEN** the peek is closed before media 41 arrives and opened again later
- **THEN** the first request was aborted and one more `GET /api/media/41` was made

#### Scenario: No photo
- **WHEN** a typed-note entry's peek opens
- **THEN** no media request is made

### Requirement: Segments revealed on first open
The first time a segmented photo's live overlay is shown, on the check screen or in a peek of an entry with no labeled copy, it SHALL be revealed once in 480 ms: the area outside the container dims, the container contour traces, then the liquid or dish contours 80 ms apart, then the labels. A labeled copy, later opens, other screens and reduced motion show the final state at once.

#### Scenario: Peek opened twice
- **WHEN** a nurse opens the 10:42 urine bag entry's peek, closes it and opens it again
- **THEN** the contours trace on the first open only

#### Scenario: Peek with a labeled copy
- **WHEN** a nurse opens the peek of an entry whose labeled copy was kept
- **THEN** the copy is shown at once, with no trace

### Requirement: Photo strip
The bed review SHALL keep the capture photos of the last 24 hours behind a `Photos <n>` toggle, closed by default, and only when it is opened show them as thumbnails, at most the 12 newest, newest first, each with its time and volume, fetching each thumbnail then: the labeled copy when one was kept, else the photo. Tapping one opens that entry's peek.

#### Scenario: Three photos
- **WHEN** four entries in the last 24 hours exist and three of them have photos
- **THEN** the toggle reads `Photos 3`, and once opened three thumbnails are shown, newest first

#### Scenario: Many photos
- **WHEN** 15 entries in the last 24 hours have photos and the toggle is opened
- **THEN** the 12 newest are shown

#### Scenario: Closed sends nothing
- **WHEN** the bed review of admission 10 loads with 3 photo entries and the toggle stays closed
- **THEN** no `GET /api/media/<id>` request is made

#### Scenario: Thumbnail of a labeled copy
- **WHEN** the toggle is opened and one photo entry has media 41 and labeled copy 42
- **THEN** its thumbnail is fetched with `GET /api/media/42`, and `GET /api/media/41` is not requested

### Requirement: Tray overlay
A tray photo with segmentation SHALL be overlaid with each dish region's contour from its dish mask, and its food from its food mask, in proportion to the image's pixels. Each region is labelled `<index> <name> · <portion>` per dish in it, from the meal's dishes or, before saving, the form's, and `<index> <name> · <Kind> · <mL> mL` per drink in it, from the read's `fluids`, without `<Kind> · ` when it equals the name ignoring case. Unnamed regions are unlabelled; `Raw` hides all.

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
- **WHEN** `Raw` is picked on that photo
- **THEN** no contour and no label is drawn, and the bare photo is shown

#### Scenario: Kept tray copy
- **WHEN** a saved lunch's tray proof has `labeled_media.id: 43`
- **THEN** `Labeled` shows that copy with `1 rice · Half` drawn in and no live overlay over it, and `Raw` shows the tray photo with no contour or label

### Requirement: Read drawn on the peek photo
An entry peek's photo of a container SHALL show the segmentation overlay, or the labeled copy when one was kept, and, beside it, a scale from 0 to the container's capacity marking the AI's volume, the saved volume and, when approved, the approved volume, each labelled, so a correction is seen against the photo. `Raw` hides the overlay, not the scale. Without a reading or capacity there is no scale.

#### Scenario: Corrected bag
- **WHEN** the urine bag entry read 450 mL of 2000 mL, saved 430 mL and approved 375 mL is peeked
- **THEN** the scale runs 0 to 2000 mL with marks labelled `AI read 450`, `Saved 430` and `Approved 375`

#### Scenario: Spark only
- **WHEN** an entry read in `spark` mode with no segmentation is peeked
- **THEN** its photo has no overlay, and the scale still marks the AI's volume

#### Scenario: Corrected bag with its copy
- **WHEN** that urine bag entry has a labeled copy, and `Raw` is picked in its peek
- **THEN** `Labeled` showed the copy beside the scale, and `Raw` shows the bare photo with the same three marks on the scale

### Requirement: Segmentation overlay
An entry's photo with segmentation evidence SHALL be overlaid with the container and the liquid, a surface line at the liquid's top edge, and the labels of both (the liquid named by its drink kind when the entry or draft has one), placed in proportion to the image's own pixel size. With masks (`container_mask`, `fluid_mask`), each is drawn as the contour traced from its mask over its box; without, as its box. A Spark-only read, with no segmentation, has no overlay; `Raw` hides it.

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

#### Scenario: Raw hides the overlay
- **WHEN** the cup photo is shown and `Raw` is picked
- **THEN** no container, liquid, surface line or label is drawn
