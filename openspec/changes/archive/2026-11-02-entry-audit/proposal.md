# Proposal

## Why

A nurse or ward manager cannot see who charted an entry, what the models did with the photo or voice note, or which records were fixed afterwards. Fluid charts are legal records: corrections, late entries and rejected captures must stay visible with who did them and why. Without that, the AI's part in an entry is a black box, and nobody can tell where charting goes wrong.

## What Changes

- **Staff roster and attribution.**
  - The demo hospital gets a fictional staff roster: attendants and nurses.
  - The app asks "Who's on shift?" and sends the chosen id as `X-Staff-Id` on every request that changes the chart.
  - Entries carry `created_by` and `reviewed_by`.
  - This is attribution for a demo, not authentication. A deployment would take identity from the hospital's sign-in.
- **Entry history.** Every entry keeps an append-only history: recorded, approved, corrected at approval, rejected (with a reason) and amended (with before/after and a reason). It is served by `GET /api/entries/:id/events`.
- **Fixing records.**
  - Approved entries can be amended (volume or type) with a required reason.
  - Rejection takes a reason from a short list.
  - Entries can be charted late with `charted_at`. An entry saved more than 60 minutes after the time it happened is marked late.
  - A nurse can add a missed entry from the bed review. It is saved and approved in their name. The logging-gap and incomplete-intake prompts offer this directly.
- **Entry timeline.** Opening an entry shows, in plain language and oldest first:
  - who captured it and how;
  - each model step (SAM outline, SAM liquid fill, Spark reading, speech-to-text, Spark note);
  - what was saved and whether it differs from the AI;
  - the review;
  - every amendment.
- **Flagged records.** Corrected, amended, late, rejected and by-hand entries get badges. The log can show flagged entries only.
- **Data quality view** on the ward dashboard, covering 7 days:
  - counts of entries, corrections, amendments, late entries, rejections by reason and by-hand entries;
  - a per-staff table;
  - the flagged entries, each linking to its bed.
  - It is served by `GET /api/wards/:id/quality`.
- **Demo history** is attributed to the roster and includes a few corrected, amended, late and rejected entries, with synthetic read evidence on some photo entries. The README says it is synthetic.

Model requests per user action: none change. Every new endpoint and action makes 0 upstream requests.

Changed shapes:
- **BREAKING** (web-consumed): `Entry` gains `recorded_at`, `late`, `created_by`, `reviewed_by`, `approved_ml`, `amended_at` and `reject_reason`. `Entry.created_at` now means the charted time: for a late entry it is earlier than when it was saved. Lists, totals and prompts already order and window by it.
- **BREAKING**: `EntryInput` gains `charted_at?`; `ReviewInput` gains `reason?` and `note?`. Requests with an invalid `X-Staff-Id` now get 400.
- New types: `Staff`, `StaffRef`, `StaffRole`, `EntryEvent`, `EventKind`, `AmendInput`, `RejectReason`, `QualityFlag`, `QualityTotals`, `WardQuality`; constants `STAFF_ROLES`, `REJECT_REASONS`, `EVENT_KINDS`, `LATE_ENTRY_MINUTES`, `QUALITY_DAYS`.
- New endpoints: `GET /api/staff`, `GET /api/entries/:id/events`, `POST /api/entries/:id/amend`, `GET /api/wards/:id/quality`.
- New request header `X-Staff-Id`.

### Out of scope

- Real authentication, passwords, PINs or SSO. The roster pick is trusted.
- Editing or deleting history events, and deleting entries.
- Amending rejected entries, or un-rejecting them.
- Exports, notifications and per-staff dashboards beyond the ward's data quality view.
- Server-held read results. Evidence stays client-reported, per `entry-evidence`.

## Capabilities

### New Capabilities
- `charting/audit`: staff roster, attribution of chart changes, entry history, amendments, rejection reasons, late entries and the ward data-quality summary.
- `web/staff`: choosing who is on shift and sending it with chart changes.

### Modified Capabilities
- `web/ward`: adds "Entry timeline", "Flagged records highlighted", "Data quality view" and "Resolve from the bed review".
- `web/capture`: adds "Late entry by hand".
- `charting/entries`: "Record an entry" (charted time and staff header errors) and "24-hour totals" (counted by charted time).

## Impact

- `packages/shared`: the new types and fields above, plus `REJECT_REASONS`, `LATE_ENTRY_MINUTES` and `STAFF_ROLES`.
- `apps/server`:
  - `staff` and `entry_event` tables, new `entry` columns, and a migration that backfills history for existing entries;
  - staff header validation;
  - the new routes;
  - the quality query;
  - demo roster and demo history.
- `apps/web`:
  - staff picker in the shell, and `X-Staff-Id` in `lib/api.ts`;
  - `lib/timeline.ts`, `lib/flags.ts`, `lib/resolve.ts` and `lib/quality.ts`;
  - the entry details dialog;
  - amend, reject-reason and missed-entry dialogs;
  - the Data quality view;
  - the "When?" time on Enter by hand.
- Depends on `entry-evidence` (evidence, `recorded_ml`). Apply and archive after it.
- "Flagged only" extends the log filter in `apps/web/src/lib/history.ts`, which `ward-charts` added (code only; no shared requirement is modified).
