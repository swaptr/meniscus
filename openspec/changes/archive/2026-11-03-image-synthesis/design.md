# Design

## Context

See proposal.md "Why". The current state:

- **`@meniscus/meta`.**
  - `transport.ts` `createTransport()` takes one `RequestBudget` slot per request, sends a JSON or `FormData` body with one client-wide `timeoutMs`, and maps HTTP errors to `MetaApiError`. `MetaApiError.retryable` is true for 429/500/502/503 (`errors.ts:40`). The client never retries.
  - `RequestBudget` (`budget.ts`) lives in the client's memory. `stats()` returns `{ total, lastHour, inFlight, perHour, maxConcurrent }`.
  - `asr.ts` `checkWav()` is the pattern for local validation: it throws a `MetaError` subclass before any request.
  - Tests build the real client over `fakeFetch` in `client.test.ts` and count `sent`.
- **Server.**
  - `apps/server/src/model-api.ts` `metaClient()` is the single lazy client. It throws `ModelApiNotConfiguredError` when `MODEL_API_KEY` is unset. Its budget comes from `MODEL_API_MAX_REQUESTS_PER_HOUR` (default 120) and `MODEL_API_MAX_CONCURRENT`, and its timeout from `MODEL_API_TIMEOUT_MS` (default 90 s).
  - Its `onRequest` logs method, path, model, status, ms and, on failure, `error.name: error.message`. The message is the upstream error's message.
- **Eval.** This change does not touch it. The in-flight `read-outcomes` change owns how the eval treats synthetic photos: `charting/model-accuracy` "Synthetic photos in the lab eval". The eval reads the sidecar `<name>.json` beside each photo, with or without `--container-labels <manifest.jsonl>` (where a file matches the record whose `id` equals its base name or ends it). A photo is synthetic when its sidecar or record says `synthetic: true` or its name starts `synth-`. It is scored only when each of those has `label_status: verified` and a non-empty `verified_by`, so `draft` and a null `verified_by` count as unverified and are skipped at no request. Verified ones are reported apart from real photos.
- **Dataset.** `attend-realworld-dataset` (outside the repo) holds about 180 openly licensed photos, with metadata stripped and no people or patient identifiers. It is being rebuilt while this change is planned, so counts move.
  - `manifest.jsonl` fields include `container_type`, `expected_container`, `expected_fluid`, `liquid_colour`, `expected_ml`, `ml_tolerance`, `expected_outcome`, `meal_portion_eaten`, `truth` (a string: `read-from-graduations`, `estimated` or `unknown`) and `record_type`. No record is synthetic yet.
  - `generation/shortlist.jsonl` is written by `tools/shortlist.py`, which calls no API. It holds 39 items, all `method: edit` from a real `source_id`:
    - 15 `tray_pair_after`, with `pair_id` and `pair_role: after`;
    - 24 `container_series_frame` across 8 series on 5 sources;
    - each with `prompt` and an `intended_truth` object.
  - `tools/build.py` re-encodes every source into `images/` and rebuilds `eval/`. It deletes both folders with `shutil.rmtree` first (`build.py:197`, `:216`). It does not touch `generation/`.
  - The largest shortlist source is 575 KB, so a `data:` URL is at most about 770 KB.
- **Guard hook.** `.claude/hooks/guard-bash.sh` blocks `(pnpm|tsx|node)…[ /]eval(.ts)? … --yes` within one command segment.

### Doc facts this design relies on (checked 2026-11-03)

| Fact | Source |
| --- | --- |
| `muse-image-1.0`; `POST /v1/images/generations` (JSON) and `POST /v1/images/edits` (JSON or multipart) | image-generation, api-reference/images/create-image, edit-image |
| `n` 1–10, default 1 | schemas, image-generation |
| `size` is `WxH`, converted to an aspect ratio only (pixel dimensions stay fixed); ratios beyond 16:1 return 400 `param: size` | schemas, image-generation |
| `response_format` `url` \| `b64_json`, default `b64_json`; `url` is a temporary signed URL | schemas, image-generation |
| `output_format` `png` \| `jpeg` \| `webp`, default `webp`; other values are rejected; the response echoes it | schemas |
| `reasoning_strength` `low` \| `high`, **default `high`**; `low` skips self-refinement | schemas |
| `temperature` 0–2 (affects planning, not image sampling); `user` (abuse detection); `stream` default false | schemas |
| `tool_enablement` `{enable_image_search, enable_web_search, enable_shell}`; tools stay on unless set to `false`; `enable_web_search: false` also drops the browser tools | schemas, image-generation |
| Edits, JSON: `images` has 1–10 items, each with **exactly one** of `image_url` and `file_id`; a fetched `image_url` must be `image/*`, otherwise 400 `param: images[i].image_url` | image-generation |
| **`image_url` takes a `data:` URL**: the edit-image reference's curl and Python examples send `"image_url": "data:image/webp;base64,UklGR..."`, and the cookbook says `input_image` takes "a public URL or a `data:` URL". No page states a size limit for it | api-reference/images/edit-image, cookbook/image-editing-with-reasoning |
| Multipart edits use `image` or `image[N]`. The multipart schema lists no `output_format` and no `temperature`. Multipart `mask`, `input_fidelity` and `partial_images` return 400 `unsupported_parameter` (the schemas page calls `partial_images` "accepted but ignored"; we never send it) | image-generation, schemas |
| `moderation` returns 400 `unsupported_parameter` on `muse-image-1.0`. **An unknown top-level JSON field returns 400** | image-generation |
| `ImagesResponse {created, data: [{b64_json?, url?, revised_prompt?}], output_format?, background?, usage?: {input_tokens, input_tokens_details: {image_tokens, text_tokens}, output_tokens, total_tokens}}` | schemas |
| A safety block returns 400 `code: content_policy_violation`, `param: prompt`. Images that fail or are safety-filtered are not billed | image-generation, error-handling |
| 503 `server_error` is retryable ("transient image failure"); a non-retryable failure is a generic 500 | image-generation, error-handling |
| $0.01 per generated image, whatever the `reasoning_strength` or tools; `n` images are billed as `n`; 150 RPM per team | pricing-rate-limits, image-generation |

Not stated in the docs pages above: latency, input size limits, the maximum prompt length, and whether outputs carry C2PA, IPTC or watermark metadata. The AUP terms on provenance (do not present outputs as human-made; do not strip provenance metadata or watermarks) come from the request for this change; the fetched docs pages do not quote them. The design follows them either way.

## Goals / Non-Goals

**Goals:**
- Image calls in `@meniscus/meta` follow the client's rules: one request, the budget, no retry, typed errors, and local checks.
- A script with a fixed request count. Its cost is known before anything is sent, and the user runs every send.
- Every synthetic file can be traced (hashes, prompt, model, sources) and carries a sidecar that marks it synthetic with draft labels.

**Non-Goals:**
- Prompt-quality tooling: automatic re-prompting, choosing the best of n, image QA.
- Any server, route, `AiPorts` or web change for images.
- Decoding, resizing or inspecting generated images (there is no image library on the server).
- How the eval scores synthetic photos. `read-outcomes` owns that rule.
- Turning sidecars into manifest records. That is the dataset tooling's job, outside this repo (§7).

## Decisions

### 1. `@meniscus/meta` types (`packages/meta/src/images.ts`; transport layer)

```ts
/** Wire types, mirrored from https://dev.meta.ai/docs/api-reference/images/schemas (2026-11-03). */
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'
export interface ImageToolEnablement {
  enable_image_search?: boolean
  enable_web_search?: boolean // false also drops the browser tools
  enable_shell?: boolean
}
/** Exactly one of the two (docs: image-generation "Edits"). `image_url`: https URL or `data:image/...;base64,...`. */
export type ImageInputItem = { image_url: string; file_id?: never } | { file_id: string; image_url?: never }
export interface CreateImageRequest {
  model: string
  prompt: string
  n?: number // 1–10, default 1
  size?: string // "WxH", aspect ratio only; ≤ 16:1
  response_format?: 'url' | 'b64_json' // default b64_json
  output_format?: ImageOutputFormat // default webp
  reasoning_strength?: 'low' | 'high' // API default high
  temperature?: number // 0–2
  user?: string
  moderation?: string // 400 unsupported_parameter on muse-image-1.0: never sent
  stream?: boolean // never sent
  tool_enablement?: ImageToolEnablement // all on when omitted
}
export interface EditImageBodyJsonParam extends CreateImageRequest {
  images: ImageInputItem[] // 1–10
}
export interface ImageObject {
  b64_json?: string
  url?: string
  revised_prompt?: string
}
export interface ImageGenUsage {
  input_tokens?: number
  input_tokens_details?: { image_tokens?: number; text_tokens?: number }
  output_tokens?: number
  total_tokens?: number
}
export interface ImagesResponse {
  created: number // Unix seconds
  data: ImageObject[]
  output_format?: string // echoes the request; webp when omitted
  background?: string // "accepted but ignored"; always "opaque"
  usage?: ImageGenUsage
}

/** Client params (camelCase, as sam.ts and asr.ts). */
export interface GenerateImageParams {
  prompt: string
  model?: string // default 'muse-image-1.0'
  n?: number
  size?: string
  outputFormat?: ImageOutputFormat // omitted → API default webp
  reasoningStrength?: 'low' | 'high' // default 'low'
  temperature?: number
  tools?: ImageToolEnablement // merged over all-false
  timeoutMs?: number // this request only; omitted → the client's timeout
}
export interface EditImageParams extends GenerateImageParams {
  images: ImageInputItem[]
}
export interface GeneratedImage {
  bytes: Uint8Array
  revisedPrompt?: string
}
export interface ImagesResult {
  created: number
  model: string
  outputFormat: ImageOutputFormat
  images: GeneratedImage[]
  usage?: ImageGenUsage
  ms: number
}
```

- `errors.ts` adds:
  - `InvalidImageRequestError extends MetaError` (not retryable; like `InvalidAudioError`);
  - `MetaContentPolicyError extends MetaApiError`, with `override name = 'MetaContentPolicyError'` and `override readonly retryable = false` set explicitly (§5).
- **Calls.** `images.generate(p: GenerateImageParams, opts: CallOptions = {})` and `images.edit(p: EditImageParams, opts: CallOptions = {})`, as `asr.transcribe` does; `opts` carries only `signal`.
- **Timeout on image params only.** `timeoutMs` is a field of `GenerateImageParams` (and so of `EditImageParams`). `responses.ts` `CallOptions` is unchanged, so no other call can take its own timeout. Inside the package, `transport.ts` `RequestInit` gains `timeoutMs?: number`, used instead of `o.timeoutMs` for that request. Only `images.ts` sets it, and `checkImageRequest` refuses one that is not a positive integer (0 requests). `MetaTimeoutError.timeoutMs` reports the timeout that applied.
- `client.ts` adds `images: createImages(request, o.models?.image ?? 'muse-image-1.0')`, and `models` gains `image?`. `index.ts` exports the above.

### 2. JSON edits with `data:` URLs, not multipart

The reference examples send `data:` URLs in JSON (see the facts table). JSON keeps `output_format` and `temperature`, which the multipart schema does not list. It never sends the multipart-only fields that return 400. It reuses the transport's JSON path.

Alternatives rejected:
- Multipart: a different field set, and `image[N]` naming.
- `file_id` through the Files API: an extra upload request per input, and the file is retained upstream.

The script builds `data:<mime>;base64,…` from local bytes, with the MIME type taken from the magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`). No request size limit is documented, and the dataset inputs are at most about 770 KB encoded.

### 3. Request defaults

- `response_format: 'b64_json'` is sent explicitly, so a change in the default cannot switch us to URLs. There is no option for `url`, so an image is never fetched in a second request.
- If a 200 has no `b64_json` in some item, the client throws `MetaOutputError`.
- `reasoning_strength: 'low'` overrides the API default `high`. Test images need staging, not self-refinement, and the price is the same.
- `tool_enablement` is all `false`: no web, image search or shell. The image comes from the prompt alone, and the prompt never leaves the model call.
- Never sent: `stream`, `moderation` (400), `mask`, `input_fidelity`, `partial_images` (400 on multipart, and an unknown field in JSON is 400 too), `user`, and `store`. The images endpoints have no `store` field, and an unknown top-level field returns 400.
- **Retention.** The Responses-API image path defaults to `store: true`. These endpoints are one-shot and take no retention flag. That is acceptable because the only inputs are staged-scene prompts and openly licensed dataset photos that hold no people and no patient identifiers (see the dataset README "Privacy rules applied"). Patient media never reaches this code: there is no route and no `AiPorts` port.
- **Base64.** `b64_json` is decoded with `atob` into a `Uint8Array`. `@meniscus/meta` has no `Buffer` (its lib is ES2023 + DOM), and `Uint8Array.fromBase64` is not in Node 24.

### 4. Local checks (`checkImageRequest`, pure, exported for tests)

These run in order and throw `InvalidImageRequestError` with a message that names the field:
1. `prompt.trim()` is empty.
2. `n` is not an integer in 1–10 (`Number.isInteger`, so `1.5` fails).
3. `temperature` is outside 0–2 (so `2.5` fails and `2` passes).
4. `size` does not match `^(\d+)x(\d+)$`, has a side of 0, or has `max/min > 16`.
5. For an edit: `images.length` is outside 1–10, or an item does not have exactly one of `image_url` and `file_id` as a non-empty string.

No prompt length limit is enforced, because none is documented: an over-long prompt returns an API 400.

### 5. Content policy as a transport-wide subclass

`apiError()` in `transport.ts` builds a `MetaContentPolicyError` when `error.code === 'content_policy_violation'`, on any endpoint. The error-handling docs list it for submitted media generally, not only for images. It is still a `MetaApiError` with the same fields, so `routes/ai.ts` `aiError()` maps it as before (502 `model_api_error` with the `code`). No HTTP response changes.

`MetaApiError`'s constructor sets `retryable` from the status. The subclass overrides it with an explicit `false` field, so a refusal is never retryable even if it ever arrives with a 5xx status.

**500 and retryability.** The image docs call a generic 500 non-retryable, while `errors.ts:40` marks every 500 retryable. This change leaves that alone: changing it would change every endpoint's error, and the script never retries on any error, so the flag does not matter here. The script prints the code either way.

### 6. Script (`apps/server/scripts/synth-images.ts`, thin CLI; `apps/server/src/lab/synth.ts`, testable core)

`src/lab/` is new. It holds dev-only modules that scripts import, and routes and `src/ai` never import it (§8). The core takes its dependencies, so tests pass a `createMetaClient({ apiKey: 'LLM_test', fetch: fake })` and a temp folder.

```ts
// src/lab/synth.ts
import type { MetaClient } from '@meniscus/meta'
import { CONTAINER_KINDS, FLUID_KINDS, PORTIONS, URINE_COLOURS } from '@meniscus/shared'

/** Plan file, zod-validated with .strict() at every level except `labels.truth`; paths are relative to the plan file. */
interface SynthPlan {
  version: 1
  model?: string // default 'muse-image-1.0'
  defaults?: ItemOptions
  items: SynthItem[] // ≥ 1
}
interface ItemOptions {
  n?: number // integer 1–10, default 1
  size?: string // e.g. '1536x2048' (3:4 portrait, phone snapshot)
  output_format?: 'webp' | 'png' | 'jpeg' // default 'webp'
  reasoning_strength?: 'low' | 'high' // default 'low'
}
type SynthItem = ItemOptions & {
  id: string // ^[a-z0-9][a-z0-9-]{0,62}$, unique; outputs are synth-<id>[-k]
  prompt: string // not blank
  labels?: SynthLabels
} & (
    | { kind: 'generate' }
    | { kind: 'edit'; inputs: { path: string; id?: string }[] } // 1–10; id = dataset id, e.g. 'tray-001'
  )
/** Draft labels: the manifest's field names and vocabularies, plus pass-through fields. */
interface SynthLabels {
  expected_container?: (typeof CONTAINER_KINDS)[number]
  expected_fluid?: (typeof FLUID_KINDS)[number]
  liquid_colour?: (typeof URINE_COLOURS)[number] | 'clear' | 'n/a'
  expected_ml?: number | null // integer ≥ 0
  ml_tolerance?: number // integer ≥ 1
  expected_outcome?: 'positive' | 'degraded' | 'negative'
  meal_portion_eaten?: (typeof PORTIONS)[number]
  truth?: Record<string, unknown> // opaque JSON object: z.record(z.string(), z.unknown()), copied unchanged
  pair_id?: string // e.g. 'pair-tray-001'
  pair_role?: 'before' | 'after'
}

/** synth-<id>[-k].json beside each image. Written last; an item is made when all n exist. */
interface SynthSidecar {
  id: string // 'synth-gen-tray-01': the image's file name without extension
  synthetic: true
  label_status: 'draft' // a person sets 'verified' together with verified_by (§7)
  verified_by: null
  generator: string // request model, 'muse-image-1.0'
  plan_item: string // 'gen-tray-01'
  kind: 'generate' | 'edit'
  image: string // 'synth-gen-tray-01.webp'
  index: number // 1…n
  prompt: string
  revised_prompt: string | null
  created: number // ImagesResponse.created
  output_format: 'webp' | 'png' | 'jpeg'
  sha256: string // hex, of the bytes written
  source_sha256?: string[] // edits: one per input, in order, of the bytes sent
  source_ids?: (string | null)[] // edits
  labels: SynthLabels // copied from the plan, unchanged
}

/** synth-<id> for n = 1; synth-<id>-1 … synth-<id>-n otherwise. */
export function outputStems(item: SynthItem, n: number): string[]
export function loadPlan(file: string): Promise<LoadedPlan> // throws PlanError(item, problem); reads, sniffs and hashes inputs; checks stem collisions
export function planFor(p: LoadedPlan, outDir: string): { todo: SynthItem[]; made: string[]; requests: number; images: number; usd: number }
export function runPlan(
  p: LoadedPlan,
  o: { client: MetaClient; outDir: string; timeoutMs: number; log: (line: string) => void },
): Promise<{ sent: number; failed?: { item: string; code: string } }>
/** The whole CLI except process wiring; returns the exit code. Tests call this directly. */
export function main(
  argv: string[],
  // client: built only with --yes; perHour: the configured hourly limit (config.MODEL_API_MAX_REQUESTS_PER_HOUR), used by a dry run
  deps: { client: () => MetaClient; perHour: number; log: (line: string) => void; timeoutMs?: number },
): Promise<0 | 1 | 2>
```

- **Plan checks** (`loadPlan`; any failure exits 2 before the client is built, so 0 requests). Each prints one line, `invalid plan: <item id>: <problem>` (the spec's "Invalid plans" lists the exact texts):
  - zod `.strict()`, so an unknown field (`patient_name`) is named;
  - an id that is not `^[a-z0-9][a-z0-9-]{0,62}$` (`../bag`), so an output name never leaves the output folder;
  - a duplicate id;
  - a blank prompt, or `n` outside the integers 1–10;
  - a label outside the vocabularies above (`liquid_colour: amber`);
  - an edit with 0 or more than 10 inputs;
  - a missing input, or one whose magic bytes are not JPEG, PNG or WebP (a GIF);
  - **output collisions**: the stems of every item (`outputStems`) must be unique across the plan. Item `bag-a` with `n` 2 writes `synth-bag-a-1` and `synth-bag-a-2`, so a second item `bag-a-1` collides on `synth-bag-a-1.json`. The error names both items: `invalid plan: bag-a and bag-a-1 both write synth-bag-a-1.json`.
- **Made.** An item is made when every one of its n sidecars exists in the output folder. Each sidecar is written after its image, so a sidecar means that image is complete. An item with some of its sidecars present (a write failed part-way) is planned again as 1 request and overwrites its own files.
- **CLI flow** (`main`; `scripts/synth-images.ts` only calls `process.exit(await main(process.argv.slice(2), { client: metaClient, perHour: config.MODEL_API_MAX_REQUESTS_PER_HOUR, log: console.log }))`). Parse args with `parseArgs`, which has no short alias, so `--yes` is the only spelling. Then:
  1. `loadPlan`: an error exits 2.
  2. `planFor`.
  3. **Requests left.** Without `--yes`, `left = deps.perHour` and no client is built, so a dry run needs no `MODEL_API_KEY` (as `scripts/eval.ts` checks its plan against `config.MODEL_API_MAX_REQUESTS_PER_HOUR`). With `--yes`, `const client = deps.client()`, called exactly once per run; the budget check and every send use this one client, and building it sends nothing. Then `const s = client.budget.stats(); const left = s.perHour − s.lastHour`, and `perHour` in the plan line is `s.perHour`. Without `MODEL_API_KEY`, `metaClient()` throws `ModelApiNotConfiguredError`; `main` prints its message and exits 2.
  4. Print the plan line. **Budget check**, with or without `--yes`: if `requests > left`, print `plan needs <r> requests; <left> left this hour` and exit 2.
  5. Without `--yes`: print `dry run. Re-run with --yes to send these requests.` and exit 0.
  6. `runPlan` with the same client and `timeoutMs` 300 000 (default), then exit 0, or 1 on failure.
- **The budget check is per run.** The budget lives in the client's memory, so every script process starts at 0 used and `left` equals `MODEL_API_MAX_REQUESTS_PER_HOUR`, the same number the dry run uses. It does not see requests sent this hour by the server or by an earlier run. It guarantees that one plan fits one hour's budget. The upstream team limit (150 RPM for images) still applies, and runs are started by the user. The test seeds a used request with one `models.list` on the same client before calling `main`.
- **Plan line.** `<items> items (<g> generate, <e> edit), <m> already made`, then `plan: <r> requests, <i> images, $<usd> (budget <perHour>/h, <left> left)`. The nouns are singular for 1 (`1 request, 1 image, $0.01`), and the cost always has 2 decimals.
- **One item, one request.** `n > 1` is one request that returns n images and is billed n. Requests are sequential (`await` in a `for…of`), so the 150 RPM team limit and the concurrency cap are never reached.
- **Stop at first failure.** Any thrown error ends the loop:
  - `MetaContentPolicyError`, any `MetaApiError` (including retryable 429/500/503), `MetaTimeoutError` (printed as "may still be billed"), `MetaOutputError`, `MetaBudgetError`, and file-write errors;
  - a 200 with fewer than n images, checked before any of that item's files is written, stops with code `image_count`;
  - the code printed is `err.code ?? err.name`.

  There is no catch-and-continue, no second prompt, and no retry. A re-run (the user's decision) resumes at the first item that is not made.
- **Writing.** For each image: write the bytes to `synth-<id>[-k].<ext>` (`jpeg` → `.jpg`) with `fs.writeFile` on the decoded `Uint8Array`, with no transform; compute the SHA-256 over the same buffer; then write the sidecar. The input hashes are computed in `loadPlan` from the bytes that are actually sent.
- **Script output.** The requirement covers only the lines the script itself prints through `log()`:
  - `<id> <kind> sent|made|skipped <status> <ms>ms`;
  - the plan line;
  - `stopped at <id>: <code>; <sent> of <requests> requests sent`;
  - `<sent> of <requests> requests sent`.

  **The server's client logs too.** `model-api.ts` `onRequest` prints its own `[model-api]` line per request, and on failure that line ends with `error.name: error.message`, the upstream error message. That line belongs to the server's client, not to the script, and is outside the requirement. An upstream message could echo part of a prompt. Prompts are staged-scene text with no patient data (below), so this is accepted rather than changed here.
- **Staged props only.** Every prompt describes staged props: no people, faces, hands, names, wristbands, meal tickets, handwriting or other identifiers. The script cannot test a prompt for that, so it is not a requirement. It is a rule for whoever writes a plan, and the human verifier checks each image for it (§7, `docs/synthetic-images.md`).
- **Package script.** `"synth": "tsx --env-file-if-exists=../../.env scripts/synth-images.ts"`, as `eval` does. The script imports `metaClient()` from `src/model-api.ts` and builds no client of its own.

### 7. The sidecar is the output contract

The script writes only image files and sidecars into the output folder it is given. It never writes the dataset's `manifest.jsonl`, `LICENSES.md`, `images/` or `eval/`.

- **Field names follow `read-outcomes`.** The sidecar uses the same `synthetic: true` flag and the same `label_status`, which is `draft` until a person verifies it and then `verified`. Its `id` has the `synth-` prefix. The labels use the manifest's field names (`expected_container`, `expected_fluid`, `liquid_colour`, `expected_ml`, `ml_tolerance`, `expected_outcome`), the ones read-outcomes' `--container-labels` reads.
- **Into the manifest: the dataset tooling's job.** Turning verified sidecars into `manifest.jsonl` records happens in the dataset's own tools, outside this repo. Those tools set the record `id` to the sidecar `id`, carry `synthetic`, `label_status` and `verified_by`, flatten `labels`, and take attribution from `source_ids`. They skip any sidecar that is not verified.
  - One name needs mapping: the manifest's own `truth` is a string naming how the truth was read. The sidecar's `labels.truth` is an object and must never be copied over it.
  - Series fields (`series_id`, `series_index`, `minutes_since_previous`) and `pair_minutes_apart` stay in `shortlist.jsonl`. The tools join them by `plan_item`, which is the shortlist id.
- **Eval.** read-outcomes' rule reads the sidecar beside each photo, with or without `--container-labels`, and the manifest record once there is one. A synthetic photo is scored only when each of them has `label_status: verified` and a non-empty `verified_by`; `draft`, or a null `verified_by`, is skipped at no request. Verified ones are reported apart from real photos. `synth-gen-tray-01.webp` matches the record `synth-gen-tray-01` by name. Labels come from the record, else the sidecar's `labels`; the `<container>-<ml>` name rule never labels a synthetic file, so it is never scored as real.
- **Folder layout** (dataset root):

  ```
  generation/
    shortlist.jsonl          tools/shortlist.py (no API call)
    plans/probe.json         task 7.1 (§11)
    plans/shortlist.json     derived from shortlist.jsonl after the probe (§12)
    out/probe/               synth-probe-bag-half.webp, synth-probe-bag-half.json
    out/shortlist/           synth-gen-tray-01.webp, synth-gen-tray-01.json, …
  ```

  The output folder is `generation/out/<plan name>/`, and plan input paths are relative to the plan file (`../../images/food_tray/tray-001.jpg`).
- **Run the eval on `generation/out/<plan>/` directly**, with `--container-labels <dataset>/manifest.jsonl` once the tooling has added the verified records. Never copy outputs into `images/` or `eval/`: `tools/build.py` deletes both with `shutil.rmtree` on every build.
- **`source_sha256` records what an edit was made from**, not what is on disk now. `tools/build.py` re-encodes every source on a rebuild, so after a rebuild the hash no longer matches `images/<category>/<id>.jpg`. The source is identified by `source_ids`.
- **Verification (a person).** Open the image. Read the scale or the plate, and correct `expected_ml`, `liquid_colour` or `truth` to what the image shows. Check that the model invented no identifier: no text, labels, names, wristbands, meal tickets, faces or hands. An image with one is left `draft` and not used. Then set `label_status: "verified"` and `verified_by`. A sidecar counts as verified only with both. A sidecar with `verified_by` null is treated as draft by read-outcomes' eval rule, which scores a synthetic record only when `label_status` is `verified` and `verified_by` is non-empty.
- **Provenance.** Files are never re-encoded or stripped. The dataset's `imgtool.sh clean` strips metadata, so it never runs on `generation/out/`. Edits of CC BY or CC BY-SA sources are adaptations that keep the source's attribution.

### 8. `src/lab` import boundary

A new block in `packages/config/eslint.js` `boundaries`:

```js
{
  files: ['apps/server/src/routes/**/*.ts', 'apps/server/src/ai/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [{ group: ['**/lab/**'], message: 'src/lab is dev-only: scripts import it; routes and src/ai never do.' }] },
    ],
  },
},
```

No other block sets `no-restricted-imports` for `apps/server`, so nothing is overridden. The pattern matches a `lab/` folder, not a file named `lab.ts`. `read-outcomes` adds `src/chart/lab.ts`, and imports of it stay allowed. The boundary comment above `boundaries`, `.claude/rules/server.md` and the AGENTS.md layout and boundary line each gain `src/lab`.

### 9. Capability placement

`eval/synthetic-images` is a new `eval` domain: dev tooling for the accuracy dataset, not charting behaviour. It owns no eval scoring rule. `read-outcomes`' `charting/model-accuracy` owns that. The two changes share no requirement and can archive in either order.

### 10. Guard hook

`.claude/hooks/guard-bash.sh` gains a second line, in the same style as the eval rule:

```bash
# Image synthesis only as an explicit, user-approved step (dry run without --yes).
grep -qE "(pnpm|tsx|node)${seg}[[:space:]/]synth(-images)?(\.ts)?[[:space:]]${seg}--yes" <<<"$cmd" &&
  block "running image synthesis with --yes sends paid image requests; ask the user first."
```

New cases in `guard-bash.test.sh`:

| Exit | Command |
| --- | --- |
| 2 | `pnpm --filter @meniscus/server synth /d/generation/plans/probe.json /d/generation/out/probe --yes` |
| 2 | `pnpm --filter @meniscus/server synth --yes plans/shortlist.json out` |
| 2 | `cd apps/server && pnpm exec tsx scripts/synth-images.ts plans/shortlist.json out --yes` |
| 2 | `pnpm -F @meniscus/server synth p.json out --yes 2>&1 \| tee synth.log` |
| 0 | `pnpm --filter @meniscus/server synth /d/generation/plans/probe.json /d/generation/out/probe` (dry run) |
| 0 | a heredoc writing docs that mention `` `synth <plan> <outdir> --yes` `` (backticks split the segment, as in the existing eval docs case) |

### 11. Probe plan (`attend-realworld-dataset/generation/plans/probe.json`)

One item: 1 request, 1 image, $0.01. It answers one question: does the safety filter allow a urine drainage bag on a bed? It shows a bag on a bed frame, about half full of amber urine, with no people.

```json
{
  "version": 1,
  "model": "muse-image-1.0",
  "defaults": { "size": "1536x2048", "output_format": "webp", "reasoning_strength": "low" },
  "items": [
    {
      "id": "probe-bag-half",
      "kind": "generate",
      "prompt": "Phone snapshot of a 2000 mL urine drainage bag hanging from the side rail of a hospital bed, about half full of amber urine, the printed volume scale on the bag clearly visible, the drainage tube running up out of frame. Hospital ward in the background, slightly out of focus, ordinary ward lighting, handheld framing at bed height. Staged props only: no people, no hands, no faces, no wristbands, no names, no handwriting, no labels or stickers, no text other than the bag's printed scale.",
      "labels": {
        "expected_container": "urine_bag",
        "expected_fluid": "urine",
        "liquid_colour": "dark",
        "expected_ml": 1000,
        "expected_outcome": "positive"
      }
    }
  ]
}
```

The user runs it as a dry run first (0 requests), then with `--yes` (1 request):

```sh
pnpm --filter @meniscus/server synth <dataset>/generation/plans/probe.json <dataset>/generation/out/probe
```

| Outcome | Meaning |
| --- | --- |
| 200 | The subject is allowed. Look at the image before deriving the full plan. |
| 400 `content_policy_violation` | Not billed. The full plan is not run. Rewording is the user's decision, not an automatic fallback. |

### 12. Full plan, derived from the shortlist (after a successful probe; run by the user)

`generation/shortlist.jsonl` already names a real source for every item, so no base image has to be generated first. The full plan is `generation/plans/shortlist.json`, with one plan item per shortlist line:

| Shortlist | Items | Requests | Images | Cost |
| --- | --- | --- | --- | --- |
| `tray_pair_after` edits (15 real trays, one "after" each) | 15 | 15 | 15 | $0.15 |
| `container_series_frame` edits (8 series on 5 real containers) | 24 | 24 | 24 | $0.24 |
| **`shortlist.json`** | **39** | **39** | **39** | **$0.39** |
| with the probe | 40 | 40 | 40 | $0.40 |

`n` is 1 throughout. 39 requests fit the default 120/h budget in one run. The counts are those of `shortlist.jsonl` on 2026-11-03. If the dataset tooling rewrites it, the dry run of the derived plan prints the new count before anything is sent.

The mapping (done by the dataset tooling, or by hand; outside this repo):

| Plan item field | From the shortlist line |
| --- | --- |
| `id` | `shortlist_id`, unchanged (`gen-tray-01`, `gen-series-01`), so outputs are `synth-gen-tray-01.*` |
| `kind` | `edit` (`method`) |
| `prompt` | `prompt`, verbatim |
| `inputs` | `[{ path: "../../" + <manifest record of source_id>.file, id: source_id }]` |
| `labels.truth` | `intended_truth`, unchanged |
| `labels.pair_id`, `labels.pair_role` | `pair_id`, `pair_role` (tray items) |
| `labels.expected_container`, `expected_fluid`, `expected_outcome` | the source record's values |
| `labels.liquid_colour`, `expected_ml`, `ml_tolerance` | series items: `intended_truth.liquid_colour`, `.volume_ml`, `.ml_tolerance` |

- Every value in the shortlist today is within the vocabularies: containers `urine_bag`, `other`, `water_bottle`, `food_tray`; colours `pale`, `yellow`, `dark`, `pink`, `red`, `clear`.
- **Tray prompts** must say "no text, labels, names, wristbands or meal tickets". The shared closing sentence in `tools/shortlist.py` (`KEEP`) reads "Do not add people, hands, faces, text, labels, names or wristbands." It gains "meal tickets" before the plan is derived. That is a dataset-side edit, and the shortlist is regenerated, which calls no API.
- **Sources must exist.** The dataset is rebuilt from time to time, and during a rebuild some `images/` files are briefly missing. `loadPlan` then rejects the whole plan (exit 2, 0 requests). Derive and send after a complete build.

## Risks / Trade-offs

- **[The model does not hit the asked fill level or portion]** → Labels are written `draft`. A person reads the generated scale or plate and corrects the labels before setting `verified` and `verified_by`. Nothing unverified reaches the manifest, and read-outcomes skips any synthetic record that is not verified.
- **[The model invents an identifier (a name, a wristband, a meal ticket)]** → Prompts forbid it, and verification checks for it. Such an image stays `draft` and is not used.
- **[Synthetic images flatter or skew accuracy]** → read-outcomes reports them apart from real photos and never merges the numbers.
- **[A synthetic file is copied without its sidecar and scored as real]** → The `synth-` prefix never matches the `<container>-<ml>` name rule. Outputs stay in `generation/out/`, which no build step copies into `eval/`.
- **[The safety filter blocks clinical subjects]** → The 1-request probe comes first. A block is not billed, and the script stops instead of trying variants.
- **[A timeout after the server has done the work]** → A 300 s image timeout, sequential sending, and a printed "may still be billed". There is no automatic re-send.
- **[An upstream error message echoes the prompt in the server client's `[model-api]` line]** → Prompts are staged-scene text with no patient data. The script's own lines print codes only (§6).
- **[The budget check sees only this run]** → Each process starts at 0 used (§6). One plan fits one hour's budget; the user decides when to run the next.
- **[Provenance metadata lost]** → Bytes are written as decoded, with no re-encode and no strip, and `imgtool.sh clean` never runs on `generation/out/`.
- **[No upstream retention flag on the images endpoints]** → Only staged-scene prompts and openly licensed dataset photos without people are sent. No patient media can reach the script (§3).
- **[A dataset rebuild re-encodes sources]** → `source_sha256` stops matching the file on disk. It still records the bytes the edit was made from, and `source_ids` names the source (§7).

## Coordination with other changes

- **`read-outcomes`** owns the eval's synthetic rule ("Synthetic photos in the lab eval"). This change adds no eval requirement and does not edit `scripts/eval.ts` or `docs/accuracy.md`. That rule reads the sidecar this change writes beside each photo, with or without `--container-labels`, and treats `draft` and a null `verified_by` as unverified. Its `parseSidecar` (its design §9) accepts every label key this change's plan allows, so tray sidecars with `pair_id`, `pair_role` or `meal_portion_eaten` are not rejected.
- **`tray-segmentation`** edits `AGENTS.md:51` ("meal tray photo 3, or 1 in Spark-only mode"). This change only appends its own item to that list, so the two edits merge textually in either order.

## Migration Plan

Additive only. There is no data, config or HTTP change. Rollback is a revert of the change. Generated files live in the external dataset folder and are not touched by a rollback.

## Open Questions

- The `data:` URL size limit for edits is undocumented. Inputs are at most about 770 KB encoded. A 400 or 413 would stop the run at that item with nothing billed.
- Whether `muse-image-1.0` outputs carry C2PA, IPTC or a watermark is undocumented. The sidecar and the unmodified bytes cover provenance either way.
