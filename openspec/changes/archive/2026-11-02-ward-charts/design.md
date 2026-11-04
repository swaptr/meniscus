# Design

## Context

`GET /api/admissions/:id/entries` already returns every entry with its time, status, category and volume, plus the weight on the admission, so the bed charts can be computed in the browser. The ward dashboard has only `AdmissionSummary` (totals), so the activity strip needs the server to add a small series. The project's web budget is under 100 KB gzipped JS per route, so no chart library.

## Types (packages/shared)

```ts
export interface HourlySeries {
  /** 24 rolling hours, oldest first; index 23 = the last 60 minutes (an entry exactly 60 min old is in 22). */
  in_ml: number[] // approved
  out_ml: number[] // approved
  in_logged: number[] // count of intake entries not rejected (what the logging-gap rule counts)
}
export interface AdmissionSummary extends Admission {
  totals: Totals
  pending: number
  alerts: Alert[]
  hourly: HourlySeries
}
```

## Decisions

- **Buckets on the server (apps/server/src/store).** `admissions()` already reads 24 h of entries for totals. A second grouped query over entries charted after `now - 24 h`, with `bucket = 23 - floor((now - created_at) / 1h)` (so exactly 60 min old is 22), sums approved volume by direction and counts non-rejected intake. It is folded into 24-element arrays. One query for the whole hospital, not one per bed.
- **Bed charts in the browser (apps/web).** `lib/charts.ts` is pure, with `now` injected:
  - `cumulative(entries, now)` returns `{ in: Point[], out: Point[], balance }`;
  - `urineRate(entries, weightKg, now)` returns 24 hourly points of the 6 h rolling rate;
  - `breakdown(entries, now)` returns segments by category;
  - `photoStrip(entries, now)`;
  - `activityCells(hourly)` (from `in_logged`);
  - `printRows(entries, now)`: 24 clock-hour rows ending with the current hour, from approved entries.
  - `urineRate` leaves out hours less than 6 h after `admitted_at`; `photoStrip` keeps the 12 newest.
- **SVG components.** `components/charts.tsx` holds `<BalanceChart>` (the step lines), `<RateChart>`, `<StackBars>` and `<ActivityStrip>`; `components/bed-charts.tsx` lays them out with the photo strip:
  - Fixed `viewBox` and `preserveAspectRatio="none"` for the plot area, with HTML labels outside it so text isn't stretched.
  - Colours come from `tokens.stylex.ts`, with intake and output each given a distinct accessible hue. Below-threshold points get a danger token plus a shape difference, never colour alone.
  - The `dataviz` skill guidance is applied when writing these (palette, marks, tooltips).
- **Print route.** `n/$id_.print.tsx` (the trailing `_` un-nests it from the bed review component) loads `GET /api/admissions/:id/entries` and computes clock-hour rows in the browser: the paper form is by clock hour, unlike the rolling series. The shell's sidebar, header and bottom nav carry `data-app-chrome`, and print CSS in `global.css` hides them.
- **Recorder level.** `startRecording(onAutoStop, deps?)` taps the stream with `AudioContext` + `AnalyserNode`; the controller's `listen(fn)` reports `{ elapsedMs, level }` about 20 times a second via `requestAnimationFrame`. `deps` (media, recorder, meter, clock, frames) default to the browser and are faked in tests. `stop()` and `cancel()` stop the frame loop and close the context. The capture screen ignores a microphone grant that arrives after it closed, and cancels a live recording on unmount, so no audio is sent later. `formatElapsed(ms)` returns `m:ss / 1:00`.
- **Photo strip.** It uses `GET /api/entries/:id/photo` thumbnails with `loading="lazy"`, the 12 newest. A tap opens the entry details (evidence and timeline).

## Risks / Trade-offs

- [A rolling bucket edge differs between server and client by a few ms] → Both take `now` once per request or render. Tests pin the bucket maths.
- [24 tiny `<img>` loads on beds with many photos] → Limit the strip to 12 newest, lazy-loaded.
- [AudioContext is blocked before a user gesture] → It is created inside the tap handler that starts recording.
