/**
 * Served and collected tray comparison (capture/meal-reading "Served dishes matched by place", "Portion measured from
 * the served tray"). Pure and in integers: box centres in thousandths of each photo's own size, squared distances,
 * shares cross-multiplied in BigInt, and quarters eaten from coverages in thousandths. No model call, no I/O.
 */
import {
  MATCH_MAX_DISTANCE,
  MAX_TRAY_REGIONS,
  MIN_SERVED_COVERAGE,
  PORTIONS,
  type ImageSize,
  type MealDish,
  type Portion,
  type RegionMatch,
  type TraySegmentation,
} from '@meniscus/shared'
import { sha256Hex } from '../hash.ts'
import { imageSize } from './image-size.ts'
import type { Box } from './segmentation.ts'

export type ServedCheck = 'same_bytes' | 'size_unknown' | { size: ImageSize; served_size: ImageSize }

/** Same bytes first (by SHA-256, before any size is read), then both header sizes. */
export function servedCheck(
  image: Uint8Array,
  mime: string,
  served: { bytes: Uint8Array; mime: string; sha256: string | null },
): ServedCheck {
  if ((served.sha256 ?? sha256Hex(served.bytes)) === sha256Hex(image)) return 'same_bytes'
  const size = imageSize(image, mime)
  const servedSize = imageSize(served.bytes, served.mime)
  return size && servedSize ? { size, served_size: servedSize } : 'size_unknown'
}

/** A half-open box's centre in thousandths of its photo's width and height, rounded half up. */
export function centreOf(b: Box, size: ImageSize): { x: number; y: number } {
  return {
    x: Math.floor((1000 * (b.left + b.right) + size.width) / (2 * size.width)),
    y: Math.floor((1000 * (b.top + b.bottom) + size.height) / (2 * size.height)),
  }
}

/** The smaller box's share of its photo is at least half the larger's (BigInt: w·h·W·H can pass 2⁵³). */
export function shareOk(a: Box, sa: ImageSize, b: Box, sb: ImageSize): boolean {
  const area = (x: Box) => BigInt(x.right - x.left) * BigInt(x.bottom - x.top)
  const pa = area(a) * BigInt(sb.width) * BigInt(sb.height)
  const pb = area(b) * BigInt(sa.width) * BigInt(sa.height)
  const [lo, hi] = pa < pb ? [pa, pb] : [pb, pa]
  return 2n * lo >= hi
}

type Placed = { index: number; box: Box }

/**
 * Pairs passing the distance and size rules, kept when each is the other's strictly nearest such region (a tie leaves
 * both without a nearest). Sorted by collected index, at most MAX_TRAY_REGIONS.
 */
export function matchRegions(
  collected: readonly Placed[],
  size: ImageSize,
  served: readonly Placed[],
  servedSize: ImageSize,
): RegionMatch[] {
  const candidates: RegionMatch[] = []
  for (const c of collected) {
    const cc = centreOf(c.box, size)
    for (const s of served) {
      const sc = centreOf(s.box, servedSize)
      const distance2 = (cc.x - sc.x) ** 2 + (cc.y - sc.y) ** 2
      if (distance2 <= MATCH_MAX_DISTANCE && shareOk(c.box, size, s.box, servedSize)) {
        candidates.push({ index: c.index, served_index: s.index, distance2 })
      }
    }
  }
  const nearest = (key: 'index' | 'served_index', id: number): RegionMatch | undefined => {
    const mine = candidates.filter((m) => m[key] === id)
    const best = Math.min(...mine.map((m) => m.distance2))
    const at = mine.filter((m) => m.distance2 === best)
    return at.length === 1 ? at[0] : undefined
  }
  return candidates
    .filter((m) => nearest('index', m.index) === m && nearest('served_index', m.served_index) === m)
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_TRAY_REGIONS)
}

/** Quarters eaten, rounded half up and kept to 0–4, from served S and collected N coverage in thousandths (S > 0). */
export function quarters(s: number, n: number): number {
  return Math.min(4, Math.max(0, Math.floor((8 * (s - n) + s) / (2 * s))))
}

const thousandths = (c: number) => Math.round(c * 1000)

/**
 * A dish is measured only when it is the one dish citing its region, that region matched, S ≥ MIN_SERVED_COVERAGE and
 * 4·N ≤ 5·S. Every other dish keeps Spark's portion. `model_portion` is always Spark's.
 */
export function measureDishes(
  dishes: readonly MealDish[],
  seg: TraySegmentation,
  served: TraySegmentation,
  matches: readonly RegionMatch[],
): MealDish[] {
  return dishes.map((d) => {
    const model: MealDish = { ...d, portion: d.model_portion, basis: 'model', measure: null }
    if (d.index === 0 || dishes.filter((x) => x.index === d.index).length !== 1) return model
    const m = matches.find((x) => x.index === d.index)
    const c = seg.regions.find((r) => r.index === d.index)
    const s = m && served.regions.find((r) => r.index === m.served_index)
    if (!m || !c || !s) return model
    const S = thousandths(s.coverage)
    const N = thousandths(c.coverage)
    if (S < MIN_SERVED_COVERAGE || 4 * N > 5 * S) return model
    const portion = PORTIONS[quarters(S, N)] as Portion
    return { ...d, portion, basis: 'measured', measure: { served_index: s.index, served_coverage: s.coverage } }
  })
}
