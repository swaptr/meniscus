# Tasks

No task sends a live request. Every test uses `createMetaClient({ apiKey: 'LLM_test', fetch: fake })` and asserts the exact upstream request count. Section references (§) are to design.md.

## 0. Before starting

- [x] 0.1 Check `.claude/agents-running`. While it lists the care-plan web apply, do not run `pnpm verify`, `pnpm test` or `pnpm typecheck` across the workspace: they pick up its half-applied web files. Use only the package-scoped commands named in each task (`pnpm --filter @meniscus/meta …`, `pnpm --filter @meniscus/server …`) until that line is gone. Task 8.1 waits for it.

## 1. `@meniscus/meta` types and errors

- [x] 1.1 Add the types and stubs:
  - the wire and param types from design §1 in a new `packages/meta/src/images.ts`, with `timeoutMs?` on `GenerateImageParams` and `createImages` returning methods that throw `new Error('not implemented')`;
  - `InvalidImageRequestError` and `MetaContentPolicyError` (with `override readonly retryable = false`) in `errors.ts`;
  - `timeoutMs?` on the internal `RequestInit` in `transport.ts`, not yet used. `CallOptions` in `responses.ts` stays unchanged;
  - `images` on the client (`client.ts`, `models.image` defaulting to `muse-image-1.0`);
  - the exports in `index.ts`.

  Verify: `pnpm --filter @meniscus/meta typecheck` and `pnpm exec eslint --max-warnings=0 packages/meta` pass.

## 2. `@meniscus/meta` image calls

- [x] 2.1 Write the tests first, in `packages/meta/src/client.test.ts` under a new `describe('images')`, using `fakeFetch`. Each test asserts `sent.length`:
  - [model-api/client] Image requests:
    - "Generate with defaults": 1 request, the exact body compared with `deepEqual`, the bytes `89 50 4E 47 0D 0A 1A 0A`;
    - "Edit one image": 1, and the `Content-Type: application/json` header;
    - "Server error not retried": 1;
    - "No image in the reply": 1.
  - [model-api/client] Image calls checked locally:
    - "Bad calls never sent": 0, over all twelve calls, including `n` 1.5, `temperature` 2.5 and `timeoutMs` 0 and 1.5;
    - "Limits allowed": 2.
  - [model-api/client] Content policy refusals: "Blocked prompt" (1), "Any endpoint" (1, through `responses.create`) and "Retryable status" (1).
  - [model-api/client] Image calls take their own timeout: "Longer for one call" (1) and "Others keep the client timeout" (1, through `models.list`).

  Verify: `pnpm --filter @meniscus/meta test` runs them, and they fail against the stubs.
- [x] 2.2 `transport.ts`:
  - a per-request `timeoutMs`, which overrides the client timeout and is reported by `MetaTimeoutError`;
  - `apiError()` returns `MetaContentPolicyError` for code `content_policy_violation` (§5).

  Satisfies the transport side of [model-api/client] Content policy refusals and [model-api/client] Image calls take their own timeout. Verify: [model-api/client] Content policy refusals "Any endpoint", [model-api/client] Image calls take their own timeout "Others keep the client timeout", and every existing `client.test.ts` test pass.
- [x] 2.3 `images.ts`:
  - `checkImageRequest` (§4);
  - `generate` and `edit`: one `request()` each, the defaults in §3, `atob` decoding, and `MetaOutputError` when `b64_json` is missing;
  - `p.timeoutMs` passed to `request()`, and `opts.signal` as `asr.ts` does.

  Satisfies [model-api/client] Image requests, [model-api/client] Image calls checked locally, [model-api/client] Content policy refusals and [model-api/client] Image calls take their own timeout. Verify: `pnpm --filter @meniscus/meta test` passes, and `pnpm spec:check` reports no unknown citation.

## 3. Synthesis script

- [x] 3.1 Write the tests first, in a new `apps/server/src/lab/synth.test.ts`. They call `main(argv, { client, perHour, log: (l) => lines.push(l) })`, where `client` returns one `createMetaClient({ apiKey: 'LLM_test', fetch: fake, budget })` and counts its own calls.
  - Plans and inputs are written to `mkdtemp` folders: tiny byte strings with JPEG `FF D8 FF E0` and PNG `89 50 4E 47` headers, and a `GIF89a` header for the bad input. No real photos, no people.
  - Each test asserts the exit code, the upstream request count, and that `client` was called at most once:
    - [eval/synthetic-images] Plan file: "Valid plan" (dry run, 0) and "Invalid plans" (twelve runs with `--yes`, each exiting 2 with the scenario's exact text, each with 0 requests: unknown field, duplicate id, id `../bag`, blank prompt, `n` 11, size `square`, `liquid_colour: amber` (the message names the field, never the value), an edit with 0 inputs, a generate with an input, missing input, GIF input, the `bag-a` / `bag-a-1` name collision).
    - [eval/synthetic-images] Dry run by default: "Plan of 21" (0).
    - [eval/synthetic-images] Made items are not remade: "One already made" (0, then 2) and "Partly made" (0).
    - [eval/synthetic-images] Hourly budget checked first: "Too big for the hour". One earlier `models.list` on the same client uses 1 of 3; then 0 more requests. "Dry run without a key": `perHour` 120 and a `client` that throws `ModelApiNotConfiguredError` if called; it is never called.
    - [eval/synthetic-images] Items sent in order, stop at first failure: "All sent" (3, with the paths in order), "Blocked at the second item" (2), "Retryable error not retried" (1) and "Fewer images than asked" (1: a 200 with 1 image for `n` 2 stops with code `image_count`, writing nothing).
    - [eval/synthetic-images] Image saved as returned: "Byte-exact PNG" (1) and "Two images from one item" (1).
    - [eval/synthetic-images] Provenance sidecar: "Edit sidecar" (1, with the hashes recomputed in the test and `labels` compared with `deepEqual`) and "Generate sidecar" (1).
    - [eval/synthetic-images] Script output carries no image or prompt: "Two items sent" (2), checking only the lines passed to `log`.

  Verify: `pnpm --filter @meniscus/server test` runs them, and they fail.
- [x] 3.2 Implement the plan side of `src/lab/synth.ts`:
  - the plan zod schema (`.strict()` except `labels.truth`, which is `z.record(z.string(), z.unknown())`; vocabularies from `@meniscus/shared`);
  - `outputStems` and the collision check;
  - `loadPlan`, which resolves paths against the plan file, sniffs magic bytes and hashes the inputs;
  - `planFor`, where an item is made only when all n sidecars exist;
  - the client, budget and dry-run branches of `main` (§6): a dry run builds no client and takes `left = deps.perHour`; with `--yes`, one `deps.client()` call and `left = perHour − lastHour` from its `budget.stats()`.

  Satisfies [eval/synthetic-images] Plan file, [eval/synthetic-images] Dry run by default, [eval/synthetic-images] Made items are not remade and [eval/synthetic-images] Hourly budget checked first. Verify: those tests pass.
- [x] 3.3 Implement `runPlan` and the writers:
  - sequential sending through the one client;
  - a stop at the first thrown error, with `code ?? name`, and at a 200 with fewer than n images, with `image_count`;
  - byte-exact image files named `synth-<id>[-k].<ext>`, hashed, with each sidecar written after its image;
  - sidecars with `id`, `synthetic: true`, `label_status: "draft"` and `verified_by: null`;
  - `log` lines limited to ids, kinds, statuses, codes, timings and counts.

  Satisfies [eval/synthetic-images] Items sent in order, stop at first failure, [eval/synthetic-images] Image saved as returned, [eval/synthetic-images] Provenance sidecar and [eval/synthetic-images] Script output carries no image or prompt. Verify: every `synth.test.ts` test passes.
- [x] 3.4 Add the entry point:
  - `apps/server/scripts/synth-images.ts`, which calls `main` with `metaClient`, `config.MODEL_API_MAX_REQUESTS_PER_HOUR` and `console.log`;
  - the `"synth"` script in `apps/server/package.json` (§6).

  Verify: `pnpm --filter @meniscus/server synth` with no arguments prints the usage and exits 2, and `pnpm --filter @meniscus/server typecheck` and `pnpm exec eslint --max-warnings=0 apps/server` pass.

## 4. `src/lab` boundary

- [x] 4.1 Add the `no-restricted-imports` block from design §8 to `packages/config/eslint.js` `boundaries`, and name `src/lab` in the boundary comment above it. Verify:
  - a scratch line `import '../lab/synth.ts'` in a file under `apps/server/src/routes/` makes `pnpm exec eslint apps/server` fail with the `src/lab is dev-only` message, and so does the same import in a file under `apps/server/src/ai/`;
  - an import of `../chart/lab.ts` (read-outcomes' module, if present) is not reported;
  - after the scratch lines are removed, `pnpm exec eslint --max-warnings=0 apps/server packages/config` passes.
- [x] 4.2 Name `src/lab` in the agent docs:
  - `.claude/rules/server.md`: the Layers bullet gains `src/lab` (dev-only modules for `scripts/`; routes and `src/ai` never import it);
  - `AGENTS.md`: the `apps/server` layout line gains `src/lab/ (dev-only script modules)`, and the import-boundaries sentence gains "server routes and `src/ai` never import `src/lab`".

  Verify: `pnpm format:check` passes.

## 5. Guard hook and agent docs

- [x] 5.1 Add the six cases from design §10 to `.claude/hooks/guard-bash.test.sh`, and run it to see the four blocking cases fail. Then add the `synth … --yes` rule to `.claude/hooks/guard-bash.sh`. Verify: `bash .claude/hooks/guard-bash.test.sh` prints `guard-bash: all cases pass`.
- [x] 5.2 Update the agent docs:
  - `AGENTS.md`:
    - the request-count list in "Rules that always apply" gains "image synthesis (dev script only): 1 per plan item". Leave the meal tray wording as it is; `tray-segmentation` owns it;
    - the Commands table gains `pnpm --filter @meniscus/server synth <plan.json> <outdir>` (synthetic test images; dry run only; sending needs the user's approval; see `docs/synthetic-images.md`).
  - `CLAUDE.md`: the Hooks bullet reads "run the eval or image synthesis with `--yes`".

  Verify: `pnpm format:check` passes, and `bash .claude/hooks/guard-bash.test.sh` still passes.

## 6. Docs

- [x] 6.1 Write `docs/synthetic-images.md` (at most 60 lines), from design §6, §7, §11 and §12:
  - what synthetic images are for, and that they are never presented as photos;
  - the plan file, and the request counts: 1 per plan item, 0 in a dry run; sending needs the user's approval;
  - plans describe staged props only: no people, faces, hands, names, wristbands, meal tickets, handwriting or other identifiers;
  - the folder layout: `generation/plans/` and `generation/out/<plan>/`;
  - verification: read the scale or the plate and correct the labels; check for invented identifiers; set `label_status: "verified"` and `verified_by` (a sidecar is verified only with both);
  - the sidecar is the output contract, and merging verified sidecars into `manifest.jsonl` (carrying `synthetic`, `label_status` and `verified_by`) is the dataset tooling's job;
  - run the eval on `generation/out/<plan>/` directly, with `--container-labels`. Never copy outputs into the dataset's `images/` or `eval/`, because `tools/build.py` deletes both with `rmtree`;
  - `source_sha256` stops matching after a rebuild re-encodes the sources;
  - never re-encode or strip the outputs, and never run `imgtool.sh clean` on `generation/out/`;
  - attribution for edits of CC BY and CC BY-SA sources.

  Verify: `pnpm format:check` passes.

## 7. Probe plan

- [x] 7.1 Create `/home/swapnil/repo/hackathons/attend-realworld-dataset/generation/plans/probe.json` with exactly the JSON in design §11: 1 generate item, `probe-bag-half`.
  - Verify with a dry run, which sends 0 requests: `pnpm --filter @meniscus/server synth /home/swapnil/repo/hackathons/attend-realworld-dataset/generation/plans/probe.json /home/swapnil/repo/hackathons/attend-realworld-dataset/generation/out/probe`. It prints `1 request, 1 image, $0.01` and `dry run`, and exits 0.
  - Probe: the user runs it, 1 request. This task does not send it.

## 8. Verify

- [ ] 8.1 Check `.claude/agents-running` as in 0.1. Then `pnpm verify` passes (format, lint, typecheck, tests, specs, traces).

## Workflow follow-up

- Probe: the user runs it, 1 request ($0.01): the dry-run command from 7.1 plus `--yes`. The guard hook blocks agents from running it.
- Only if the probe returns 200 and the image looks right, the dataset tooling (outside this repo):
  - adds "meal tickets" to `tools/shortlist.py` `KEEP` and regenerates `generation/shortlist.jsonl`, which calls no API;
  - derives `generation/plans/shortlist.json` with the mapping in design §12, after a complete build.
- The user dry-runs it (0 requests; prints `39 requests, 39 images, $0.39` if the shortlist is unchanged), then runs it with `--yes`: 39 requests, $0.39.
- A person verifies each image, setting `label_status: "verified"` and `verified_by`. The dataset tooling adds the verified ones to `manifest.jsonl`.
- Run the `spec-reviewer` agent before `/opsx:apply` and again before `/opsx:archive`. Then archive with `openspec archive image-synthesis --yes` once `pnpm verify` passes.
