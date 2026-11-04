# Spec Delta

## Purpose

Synthetic test images for the real-world accuracy dataset, made with Muse Image by a script that only developers run. They fill gaps where real photos are scarce, such as meal tray before/after pairs and the same urine bag over a shift.

The product never generates images: there is no HTTP route and no web UI for it. Each image gets a provenance sidecar that marks it synthetic and holds draft labels, which a person verifies. How the eval treats synthetic photos is specified in `charting/model-accuracy`, not here.

## ADDED Requirements

### Requirement: Plan file
The synthesis script SHALL refuse a plan with any invalid item, exiting 2 with 0 requests sent. Each item is one request: `generate` from a prompt, or `edit` from a prompt and 1–10 local JPEG, PNG or WebP files. Its id is unique in the plan, of lowercase letters, digits and hyphens. It has no unknown field, no blank prompt, an integer `n` from 1 to 10, a `size` the client accepts, labels in dataset vocabularies, no missing input, no inputs on a generate, and no output file another item writes.

#### Scenario: Valid plan
- **WHEN** a plan holds two items, both valid, and is run without `--yes`:
  - generate `probe-bag-half`, with labels `{expected_container: urine_bag, liquid_colour: dark, expected_ml: 1000}`;
  - edit `gen-tray-01`, from the JPEG `tray-001.jpg` with labels `{expected_container: food_tray, truth: {expected_items: [{name: "bread roll", portion_eaten_pct: 100}]}, pair_id: "pair-tray-001", pair_role: "after"}`
- **THEN** it is accepted as 2 requests and 2 images, and exits 0
- **AND** the upstream received 0 requests

#### Scenario: Invalid plans
- **WHEN** twelve plans are run, one at a time, each with `--yes` and each with one invalid item, `bag-a` unless named:
  - an item with the field `patient_name`;
  - two items with id `bag-a`;
  - an item with id `../bag`;
  - an item with prompt `"   "`;
  - an item with `n` 11;
  - an item with size `square`;
  - an item with labels `{liquid_colour: amber}`;
  - an edit with 0 inputs;
  - a generate with the input `bag.webp`, a WebP file;
  - an edit input `missing.jpg` that does not exist;
  - an edit input `bag.gif` that is a GIF;
  - item `bag-a` with `n` 2 and item `bag-a-1`, which both write `synth-bag-a-1.json`
- **THEN** each run exits 2 and prints, in the same order:
  - `invalid plan: bag-a: unknown field patient_name`;
  - `invalid plan: bag-a: duplicate id`;
  - `invalid plan: ../bag: id must be lowercase letters, digits and hyphens`;
  - `invalid plan: bag-a: prompt is blank`;
  - `invalid plan: bag-a: n must be an integer from 1 to 10`;
  - `invalid plan: bag-a: size must be <width>x<height> in positive integers`;
  - `invalid plan: bag-a: labels.liquid_colour is not allowed`;
  - `invalid plan: bag-a: an edit needs 1 to 10 inputs`;
  - `invalid plan: bag-a: a generate item takes no inputs`;
  - `invalid plan: bag-a: input missing.jpg not found`;
  - `invalid plan: bag-a: input bag.gif is not JPEG, PNG or WebP`;
  - `invalid plan: bag-a and bag-a-1 both write synth-bag-a-1.json`
- **AND** the upstream received 0 requests

### Requirement: Dry run by default
Without `--yes`, the synthesis script SHALL print the number of items to make, the exact number of model requests (one per item to make), the number of images and the cost at $0.01 per image. It then exits 0, having sent 0 requests.

#### Scenario: Plan of 21
- **WHEN** a plan of 21 items, one of them with `n` 2, is run without `--yes`
- **THEN** it prints `21 requests, 22 images, $0.22` and exits 0
- **AND** the upstream received 0 requests

### Requirement: Made items are not remade
An item SHALL count as made only when all n of its sidecars exist in the output folder. A made item is skipped at 0 requests, both in a dry run and with `--yes`. Every other item is planned and sent as 1 request, so a re-run sends only the items not yet made.

#### Scenario: One already made
- **WHEN** the output folder already holds `synth-bag-a.webp` (the bytes `RIFF`) and `synth-bag-a.json`, and a plan of items `bag-a`, `bag-b` and `bag-c` is run first without and then with `--yes`
- **THEN** the dry run prints `1 already made` and `2 requests`, and sends 0 requests
- **AND** the run with `--yes` sends exactly 2 requests, for `bag-b` and then `bag-c`
- **AND** after the run, `synth-bag-a.webp` and `synth-bag-a.json` are byte-identical to what was placed

#### Scenario: Partly made
- **WHEN** the output folder holds only `synth-tray-02-1.json`, and a plan of one item `tray-02` with `n` 2 is run without `--yes`
- **THEN** it prints `0 already made` and `1 request, 2 images, $0.02`
- **AND** the upstream received 0 requests

### Requirement: Hourly budget checked first
The synthesis script SHALL refuse a plan whose request count exceeds the requests left this hour, exiting 2 having sent 0 requests. Requests left are, with `--yes`, the client's rolling-hour budget: its hourly limit minus the requests that client sent in the last hour; in a dry run, the configured hourly limit. A dry run never builds the Meta client, so it needs no API key.

#### Scenario: Too big for the hour
- **WHEN** the client's budget is 3 per hour with 1 request already sent, and a plan of 3 items is run with `--yes`
- **THEN** it exits 2 with `plan needs 3 requests; 2 left this hour`
- **AND** the upstream received 1 request in all, the earlier one, and 0 for the plan

#### Scenario: Dry run without a key
- **WHEN** no API key is set, the configured hourly limit is 120, and a plan of 2 items is run without `--yes`
- **THEN** it prints `2 requests` and `120 left`, and exits 0
- **AND** the Meta client is never built, and the upstream received 0 requests

### Requirement: Items sent in order, stop at first failure
With `--yes`, the synthesis script SHALL send the items not yet made one at a time in plan order, exactly 1 request each. An item fails on an error or on a reply with fewer than `n` images. At the first failed item it stops: it never retries that item, changes its prompt or moves on to the next item. It reports the item, the error code and the number of requests sent, then exits 1.

#### Scenario: All sent
- **WHEN** a plan of a generate `bag-a`, then edits `bag-a-0300` and `bag-a-0600` from a local `bag-a.webp`, is run with `--yes`, and the API answers 200 three times
- **THEN** exactly 3 requests were sent, in this order: `/images/generations`, `/images/edits`, `/images/edits`
- **AND** it wrote 3 images and 3 sidecars, printed `3 of 3 requests sent` and exited 0

#### Scenario: Blocked at the second item
- **WHEN** a plan of `bag-a`, `bag-b` and `bag-c` is run with `--yes`, and the API answers 200 and then 400 with code `content_policy_violation`
- **THEN** exactly 2 requests were sent, and `bag-c` was never sent
- **AND** the output folder holds only `synth-bag-a.webp` and `synth-bag-a.json`
- **AND** it printed `stopped at bag-b: content_policy_violation; 2 of 3 requests sent` and exited 1

#### Scenario: Retryable error not retried
- **WHEN** a plan of 2 items is run with `--yes`, and the API answers the first with 503 `server_error`
- **THEN** exactly 1 request was sent, nothing was written, and it exited 1

#### Scenario: Fewer images than asked
- **WHEN** a plan of `tray-02` with `n` 2, then `bag-b`, is run with `--yes`, and the API answers 200 holding 1 image
- **THEN** exactly 1 request was sent, and nothing was written
- **AND** it printed `stopped at tray-02: image_count; 1 of 2 requests sent` and exited 1

### Requirement: Image saved as returned
The synthesis script SHALL write each image returned by an item's 1 request as exactly the bytes decoded from `b64_json`, with the extension of the requested `output_format`. It never re-encodes, resizes or strips the image's metadata. The file is named `synth-<item id>.<ext>`, or `synth-<item id>-<k>.<ext>` for k = 1…n when an item has `n` above 1.

#### Scenario: Byte-exact PNG
- **WHEN** item `bag-a`, with output format `png`, is run with `--yes` and gets back `b64_json` `iVBORw0KGgo=`
- **THEN** exactly 1 request was sent
- **AND** `synth-bag-a.png` holds exactly the 8 bytes `89 50 4E 47 0D 0A 1A 0A`

#### Scenario: Two images from one item
- **WHEN** item `tray-02`, with `n` 2 and output format `webp`, is run with `--yes` and gets back two images
- **THEN** exactly 1 request was sent, and the script wrote `synth-tray-02-1.webp`, `synth-tray-02-2.webp` and one sidecar for each

### Requirement: Provenance sidecar
Next to each image from an item's 1 request, the synthesis script SHALL write `synth-<…>.json`: `id` (the image file name without extension), `synthetic: true`, `label_status: "draft"`, `verified_by: null`, the model, the plan item id and kind, the prompt, revised prompt and `created`, the image's SHA-256, each edit input's SHA-256 and dataset id in order, and the plan's labels unchanged.

#### Scenario: Edit sidecar
- **WHEN** item `gen-tray-01`, run with `--yes`:
  - edits `tray-001.jpg` (dataset id `tray-001`) with prompt `the same tray after the meal, about half of each dish eaten`;
  - has labels `{expected_container: food_tray, truth: {expected_items: [{name: "bread roll", portion_eaten_pct: 100}]}, pair_id: "pair-tray-001", pair_role: "after"}`;
  - and the API returns `created` 1793750400 and revised prompt `half-eaten hospital tray`
- **THEN** exactly 1 request was sent, and `synth-gen-tray-01.json` holds:
  - `id: "synth-gen-tray-01"`, `synthetic: true`, `label_status: "draft"` and `verified_by: null`;
  - `generator: "muse-image-1.0"`, `plan_item: "gen-tray-01"` and `kind: "edit"`;
  - that prompt, that revised prompt, and `created: 1793750400`;
  - `sha256` equal to the SHA-256 of `synth-gen-tray-01.webp`;
  - `source_sha256` equal to `[<SHA-256 of tray-001.jpg>]`, and `source_ids: ["tray-001"]`;
  - `labels` equal to the plan's labels, `truth`, `pair_id` and `pair_role` unchanged

#### Scenario: Generate sidecar
- **WHEN** generate item `probe-bag-half` with labels `{expected_container: urine_bag, expected_fluid: urine, liquid_colour: dark, expected_ml: 1000}` is run with `--yes` and succeeds
- **THEN** exactly 1 request was sent
- **AND** its sidecar has `id: "synth-probe-bag-half"`, `kind: "generate"`, those labels, `label_status: "draft"` and no `source_sha256`

### Requirement: Script output carries no image or prompt
The synthesis script's own output lines SHALL never hold a prompt, revised prompt, label value, image bytes or base64. Sending k items takes exactly k requests.

#### Scenario: Two items sent
- **WHEN** a plan of 2 items with prompt `amber urine in a bag on a bed rail` is run with `--yes`, and the API returns `b64_json` `iVBORw0KGgo=` with revised prompt `a bag of amber urine`
- **THEN** exactly 2 requests were sent
- **AND** no line the script printed contains `amber`, `bed rail` or `iVBORw0KGgo`
- **AND** the script's lines name both item ids
