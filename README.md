# Meniscus

_Every drop counted._ Bedside fluid intake/output charting with Meta models.

Ward staff photograph a urine bag, a water jug or a meal tray, or say what happened. Meta models turn it into a draft chart entry. A nurse approves it in one tap. Rule-based prompts tell the nurse when the chart needs review.

Meta Global AI Developer Hackathon · Indie track · _Build for Your World_.

## Why

Fluid balance charts are often incomplete. In 10 of 18 studies, no more than half were complete [1]. On one ward, charted intake and output agreed with weight change only 15% of the time [2]. A missed intake can make a chart look like dehydration and send a patient for tests they don't need. Automatic urine monitors cost thousands per unit [3]. Meniscus needs only a phone.

## How it works

1. **Capture at the bed.** Scan the bed's QR card, then take a photo or record a voice note.
2. **AI drafts the entry.** SAM 3.1 finds the container and the liquid. Muse Spark reads the volume, the urine colour or what was eaten. Speech-to-text turns voice notes into entries.
3. **Nurse approves.** Nurses see the draft, the photo and what the AI saw. They approve, correct or reject it.

Roles: attendants capture, nurses review the ward, dietitians follow meal intake.

## Meta models

| Model                     | Used for                                                                    | Requests                     |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| SAM 3.1                   | finds the container, the liquid and the dishes                              | 2 per photo                  |
| Muse Spark 1.3            | reads the volume and meal trays; turns notes into entries; explains prompts | 1 per photo, note or Explain |
| muse-voice-transcribe-1.0 | voice notes                                                                 | 1 per voice note             |

Every user action makes a fixed, tested number of requests. Nothing is retried. Responses API calls use `store: false`.

**Scaling.** Once `BUDGET_PRESSURE_PCT` (default 50) of the hourly cap is used, photo and tray reads for stable beds use 1 request instead of 3. Watch and critical beds keep segmentation.
The matron can read `GET /api/metrics`. It shows request counts and latencies by route, budget use and refusals by class, and the store and media sizes. It contains no patient data.

## Safety

- **Not a diagnostic device.** Prompts say "review", and a nurse approves every entry.
- Images, audio and notes are never logged. Every demo patient is fictional.
- Staff sign in, and every chart change records who made it.

## Run it

Requires Node 24, pnpm 12, Docker and ffmpeg.

```sh
pnpm install
cp .env.example .env     # add your Meta model key
pnpm dev:stack           # local Postgres + media bucket (Supabase CLI); copy its S3 values into .env
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c 'create database meniscus_dev'   # once
pnpm dev                 # http://localhost:5173
```

Sign in with a demo account: the password is the first name in lowercase. `pnpm verify` runs every check CI runs. To deploy, see `render.yaml`.

## Stack

Hono API, React 19 PWA, Postgres (Drizzle), S3 storage. Behaviour is specified in `openspec/specs`, and every requirement is cited by a test.

## Sources

1. Leinum LR, Krogsgaard M, Tantholdt-Hansen S, Gögenur I, Baandrup AO, Azawi N. Quality of fluid balance charting and interventions to improve it: a systematic review. BMJ Open Quality, 2023. https://doi.org/10.1136/bmjoq-2023-002260 (accessed 2026-11-04)
2. Prevost M, Gresham T, Olsen G, et al. Improving Accuracy in Measuring Fluid Balance on a General Medicine Ward (Abstract 206). Hospital Medicine 2017, Journal of Hospital Medicine 12 (Suppl 2), 2017. https://shmabstracts.org/?p=21622 (accessed 2026-11-04)
3. National Institute for Health and Care Excellence (NICE). RenalSense Clarity RMS for acute kidney injury. Medtech innovation briefing MIB256, 2021. https://www.nice.org.uk/advice/mib256/chapter/Summary (accessed 2026-11-04, via the UK Government Web Archive copy https://tnaqa.mirrorweb.com/ukgwa/20260505173614mp_/https://www.nice.org.uk/advice/mib256/chapter/Summary)
