# Proposal

## Why

The founder's story is a chart that looked like dehydration because intake was never logged. Totals alone don't catch that; the nurse needs rule-based "review" prompts, including the intake/output mismatch, with a plain-language explanation when asked (PLAN §4).

## What Changes

- Rule-based alerts computed from approved entries on every read, no model request: low urine output (< 0.5 mL/kg/h over 6 h), fluid overload (24 h balance > +1500 mL), logging gap (no intake recorded for 3 h), mismatch (low output with ≥ 1500 mL intake logged) or incomplete intake (low output with less), and appearance notes (blood, dark, cloudy, …).
- `GET /api/admissions` and `GET /api/admissions/:id/entries` include `alerts`.
- `POST /api/ai/explain` `{ admission_id }`: one Spark request that explains the current alerts for the nurse, framed as review, never diagnosis. No alerts → 409 `no_alerts` and no request. Only bed, weight, totals, alert messages and entry volumes/times are sent; never the patient's name.

## Capabilities

### New Capabilities
- `charting/alerts`: alert rules and the on-request explanation.

### Modified Capabilities
None.

## Impact

`packages/shared` (`Alert`, thresholds), `apps/server/src/chart/alerts.ts` (pure rules), `src/store/store.ts` (recent entries), `src/routes/chart.ts`, `src/routes/ai.ts` + `src/ai/explain.ts` (explain), `src/ai/pipeline.ts`.

Out of scope: per-patient thresholds, notifications.
