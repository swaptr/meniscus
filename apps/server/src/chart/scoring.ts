/**
 * Field scoring shared by the ward's model accuracy summary, the lab eval and the tray eval (charting/model-accuracy
 * "Field scoring", "Lab eval scored like the ward", "Dish scoring", "Portion agreement", "Top corrections"). Pure; no
 * model requests.
 */
import {
  CLASS_TABLES,
  MIN_N,
  TOP_CORRECTIONS,
  VOLUME_TOLERANCE_ML,
  type ClassRow,
  type ClassTable,
  type Portion,
  type PortionAgreement,
  type Rate,
  type TopCorrection,
  type VolumeError,
} from '@meniscus/shared'

/** Floored: 199/200 → 99, 3/7 → 42. Exact for integer n and of (division is correctly rounded). Null below `minN`. */
export const rate = (n: number, of: number, minN = MIN_N): Rate => ({ n, of, pct: of >= minN ? Math.floor((100 * n) / of) : null })

/** Null when either side is null. `within` is inclusive. */
export function volumeError(
  model: number | null,
  final: number | null,
  tol = VOLUME_TOLERANCE_ML,
): { abs_ml: number; within: boolean } | null {
  if (model === null || final === null) return null
  const abs_ml = Math.abs(model - final)
  return { abs_ml, within: abs_ml <= tol }
}

/** Over the pairs with both values; a pair whose model read no volume but staff kept one counts in `no_volume`. */
export function summariseVolume(
  pairs: { model: number | null; final: number | null }[],
  tol = VOLUME_TOLERANCE_ML,
  minN = MIN_N,
): VolumeError {
  let of = 0
  let sum = 0
  let within = 0
  let noVolume = 0
  for (const p of pairs) {
    const e = volumeError(p.model, p.final, tol)
    if (e) {
      of++
      sum += e.abs_ml
      if (e.within) within++
    } else if (p.model === null && p.final !== null) noVolume++
  }
  return { of, mae_ml: of >= minN ? Math.round(sum / of) : null, within: rate(within, of, minN), no_volume: noVolume }
}

/** Most first, then by name. */
const byCount =
  <T extends { n: number }>(key: (x: T) => string) =>
  (a: T, b: T) =>
    b.n - a.n || key(a).localeCompare(key(b))

/**
 * One row per class. `by: 'model'` in the ward (what happens when the model says X): `n` counts the decided rows, `kept`
 * the settled rows whose final value equals the model's, and `corrections` what staff changed it to. `by: 'final'` in
 * the lab (recall per true class): rows with no truth are skipped, and `corrections` lists what the model read instead.
 */
export function tallyClasses(
  rows: { model: string; final: string | null; settled: boolean }[],
  by: 'model' | 'final',
  minN = MIN_N,
): ClassRow[] {
  const groups = new Map<string, { n: number; settled: number; kept: number; corrections: Map<string, number> }>()
  for (const r of rows) {
    const key = by === 'model' ? r.model : r.final
    if (key === null) continue
    const g = groups.get(key) ?? { n: 0, settled: 0, kept: 0, corrections: new Map<string, number>() }
    g.n++
    if (r.settled && r.final !== null) {
      g.settled++
      if (r.final === r.model) g.kept++
      else {
        const to = by === 'model' ? r.final : r.model
        g.corrections.set(to, (g.corrections.get(to) ?? 0) + 1)
      }
    }
    groups.set(key, g)
  }
  return [...groups]
    .map(([model, g]): ClassRow => ({
      model,
      n: g.n,
      kept: rate(g.kept, g.settled, minN),
      corrections: [...g.corrections].map(([to, n]) => ({ to, n })).sort(byCount((c) => c.to)),
    }))
    .sort(byCount((r) => r.model))
}

/** A dish as scored: its kind and portion (null when unknown, as in the lab). Names are never compared. */
export interface ScoredDish {
  dish_kind: string
  portion: Portion | null
}

/**
 * Same kind first (each model dish takes the first unpaired final dish of its kind), then the rest in list order.
 * Left-overs pair with nothing: a model dish with no final one was removed, a final dish with no model one was added.
 */
export function pairDishes<M extends ScoredDish, F extends ScoredDish>(
  model: readonly M[],
  final: readonly F[],
): { model: M | null; final: F | null }[] {
  const used = new Set<number>()
  const out: { model: M | null; final: F | null }[] = []
  const rest: M[] = []
  for (const m of model) {
    const i = final.findIndex((f, k) => !used.has(k) && f.dish_kind === m.dish_kind)
    if (i < 0) rest.push(m)
    else {
      used.add(i)
      out.push({ model: m, final: final[i]! })
    }
  }
  const left = final.filter((_, k) => !used.has(k))
  const n = Math.min(rest.length, left.length)
  for (let i = 0; i < n; i++) out.push({ model: rest[i]!, final: left[i]! })
  for (const m of rest.slice(n)) out.push({ model: m, final: null })
  for (const f of left.slice(n)) out.push({ model: null, final: f })
  return out
}

/** Pairs compared in quarters (|a − b| / 25), each pair with an unknown portion left out. Rates through `rate()`. */
export function portionAgreement(pairs: readonly { model: Portion | null; final: Portion | null }[], minN = MIN_N): PortionAgreement {
  const off: PortionAgreement['quarters_off'] = [0, 0, 0, 0, 0]
  let of = 0
  for (const p of pairs) {
    if (p.model === null || p.final === null) continue
    of++
    off[Math.abs(p.model - p.final) / 25]!++
  }
  return { of, exact: rate(off[0], of, minN), within_quarter: rate(off[0] + off[1], of, minN), quarters_off: off }
}

/** Every correction of every class table, most first, then CLASS_TABLES order, then from, then to; the first `k`. Counts, not rates. */
export function topCorrections(classes: Record<ClassTable, ClassRow[]>, k = TOP_CORRECTIONS): TopCorrection[] {
  return CLASS_TABLES.flatMap((table, t) =>
    classes[table].flatMap((r) => r.corrections.map((c) => ({ table, from: r.model, to: c.to, n: c.n, t }))),
  )
    .sort((a, b) => b.n - a.n || a.t - b.t || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .slice(0, k)
    .map(({ table, from, to, n }) => ({ table, from, to, n }))
}
