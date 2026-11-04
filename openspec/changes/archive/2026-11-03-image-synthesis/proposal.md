# Proposal

## Why

The real-world test set is short of exactly the photos the eval needs most. The dataset README's "Known gaps" lists too few urine bags against a target of 25–40, few readings taken from graduations, and no meal tray before/after pairs. Meta's `muse-image-1.0` can generate and edit images at $0.01 each. A dev-only script can therefore make labelled synthetic candidates where real photos are scarce. Each image carries a sidecar that marks it synthetic, with draft labels that a person verifies. The dataset's own tooling then adds verified images to its manifest, where the eval (the in-flight `read-outcomes` change) scores them apart from real photos.

## What Changes

- **`@meniscus/meta` image calls.**
  - `images.generate()` calls `POST /v1/images/generations` and `images.edit()` calls `POST /v1/images/edits`. Both send JSON, and edit inputs are `data:` URLs.
  - Each call is one request through the budget, with no retry.
  - Defaults: `n` 1, `response_format: b64_json` always, `reasoning_strength: low`, and all three `tool_enablement` tools off.
  - The call is checked locally first, so a bad call costs 0 requests: the prompt, `n`, the size ratio, the temperature, and the count and shape of edit inputs.
  - A new error type, `MetaContentPolicyError`, with `retryable` set to `false` explicitly.
  - Image calls take their own timeout (`timeoutMs` on the image params), so a slow image call can wait longer without raising the timeout for every call. Other calls keep the client timeout.
- **Synthesis script** (dev only): `pnpm --filter @meniscus/server synth <plan.json> <outdir> [--yes]`, in `apps/server/scripts/synth-images.ts`, with its core in a new `apps/server/src/lab/`. It uses the server's single Meta client.
  - **Plan file.** One plan item is one request. A plan with any invalid item is refused whole, including one whose output file names collide.
  - **Dry run by default.** It prints the request count and the cost. A dry run never builds the client, so it needs no API key.
  - **Budget.** It refuses a plan that is larger than the hourly budget left: with `--yes`, its client's; in a dry run, the configured hourly limit. Each run starts at 0 used, so the check is per run.
  - **Sending.** With `--yes` it sends the items in order and stops at the first failure. An item counts as made, and is skipped, only when all n of its sidecars exist.
  - **Output.** It writes the image bytes exactly as returned, as `synth-<item id>.<ext>`, plus a sidecar per image. The sidecar holds `synthetic: true`, `label_status: "draft"`, `verified_by: null`, the prompt, hashes, and the plan's labels unchanged, including an opaque `truth` object and optional `pair_id` and `pair_role`. The sidecar is the output contract with the dataset.
  - **Script output.** Its own lines never hold images, base64 or prompts.
- **`src/lab` boundary.** A lint rule stops routes and `src/ai` from importing `src/lab`. `.claude/rules/server.md` and the AGENTS.md layout name it.
- **Guard hook.** `.claude/hooks/guard-bash.sh` blocks `synth … --yes` in the same way it blocks `eval … --yes`. Sending is a step the user runs.
- **Docs.** AGENTS.md: the request-count list gains "image synthesis (dev script only): 1 per plan item", and the commands table gains the script. A new `docs/synthetic-images.md` gives the protocol: staged props only, verification, the folder layout, and running the eval on the output folder.
- **Probe plan** (in the dataset's `generation/` folder): a 1-item probe, `generation/plans/probe.json`: one urine bag on a bed frame, about half full, amber, no people. It checks that the safety filter allows the subject.

### Follow-up (not in this change)

- **The full plan**, derived from `generation/shortlist.jsonl` after a successful probe: 39 edits of real photos (15 tray "after" images, 24 container series frames). Every item has a real source, so no base image is generated. The dataset tooling derives it and the user runs it (design §12).

Upstream model requests per user action: **none change**. Photo read stays at 3 requests (1 Spark-only), text note 1, voice note 2 and meal tray photo 1. The in-flight `tray-segmentation` change makes the meal tray photo 3, or 1 Spark-only; this change does not. The new dev script makes 1 request per plan item with `--yes`, and 0 in a dry run. This change does not touch the eval.

Changed shapes:
- `packages/shared`: none. No HTTP request or response shape changes, and nothing the web app consumes changes. Not breaking.
- `@meniscus/meta` (additive):
  - new exports: `images` on the client, `InvalidImageRequestError`, `MetaContentPolicyError`, and the image wire and param types. `GenerateImageParams` and `EditImageParams` carry an optional `timeoutMs`;
  - `CallOptions` is unchanged;
  - a `content_policy_violation` from any endpoint now throws the `MetaApiError` subclass `MetaContentPolicyError`, so existing `instanceof MetaApiError` checks and the server's HTTP mapping are unchanged.

### Out of scope

- Generating or editing images in the product. There is no HTTP route, no web UI, no `AiPorts` image port, and no image generation from patient media.
- Image generation over the Responses API (multi-turn), streaming, `response_format: url`, multipart edits, `mask`, `moderation`, and the Files API.
- Sending any request while building this change. The probe (1 request) and the full plan (39 requests) are steps the user runs.
- The eval. `read-outcomes` owns how it treats synthetic photos (`charting/model-accuracy` "Lab eval labels from the dataset"). This change does not edit `scripts/eval.ts` or `docs/accuracy.md`.
- Verifying labels. A person reads each synthetic image and sets `label_status: "verified"` and `verified_by`.
- Merging verified sidecars into the dataset's `manifest.jsonl` or `LICENSES.md`, and deriving the full plan from the shortlist. That is the dataset tooling's job, outside this repo.
- Scoring tray before/after pairs. This change only produces the pairs.
- Training or fine-tuning on synthetic images.

## Capabilities

### New Capabilities

- `eval/synthetic-images`: the dev-only synthesis script for the accuracy dataset. It covers the plan file, the dry run, made items, the budget check, ordered sending with a stop at the first failure, byte-exact images, provenance sidecars and the script's output lines. It is dev tooling, not charting behaviour, so it opens an `eval` domain. It specifies no eval scoring.

### Modified Capabilities

- `model-api/client`: four ADDED requirements:
  - **Image requests**: one request each, no retry, the defaults above;
  - **Image calls checked locally**: 0 requests on invalid input;
  - **Content policy refusals**: a typed, non-retryable error;
  - **Image calls take their own timeout**.

  No existing requirement changes.

## Impact

- `packages/meta/src`:
  - new `images.ts`;
  - `errors.ts`: `InvalidImageRequestError`, `MetaContentPolicyError`;
  - `transport.ts`: a per-request timeout, used only by image calls, and the content policy error;
  - `client.ts`: `images`;
  - `index.ts`: exports;
  - `client.test.ts`: tests.
- `apps/server`:
  - new `src/lab/synth.ts`, with `src/lab/synth.test.ts`;
  - new `scripts/synth-images.ts`;
  - `package.json`: a `synth` script.
- `packages/config/eslint.js`: the `src/lab` import boundary.
- `.claude/hooks/guard-bash.sh` and `guard-bash.test.sh`; `.claude/rules/server.md`.
- `AGENTS.md`: layout, import boundaries, request counts and the commands table. `CLAUDE.md`: the hooks bullet.
- New `docs/synthetic-images.md`.
- External dataset: new file `attend-realworld-dataset/generation/plans/probe.json`. Outputs go to `generation/out/<plan>/`.
- Other in-flight changes: see design.md "Coordination with other changes". No file is shared with `read-outcomes`. `tray-segmentation` also edits the AGENTS.md request-count line.
- Cost:
  - building this change sends 0 requests;
  - probe: 1 request, $0.01;
  - full plan: 39 requests, $0.39.
