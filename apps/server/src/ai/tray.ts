/**
 * Tray geometry between SAM and Spark (capture/meal-reading "Dish coverage"). Pure: SAM masks in, dish regions with
 * food coverage, packed masks and the Spark grounding text out. No model call, no I/O.
 */
import { decodeMaskToRaster, type SegmentationMaskRecord } from '@meniscus/meta'
import { MASK_GRID, MAX_TRAY_REGIONS, type MaskBits, type SegmentBox, type TrayRegion, type TraySegmentation } from '@meniscus/shared'
import { MEAL_PROMPT } from './meal.ts'
import type { Box } from './segmentation.ts'

/** SAM concepts: one short noun phrase each (SAM 3.1 docs: no lists, no "or"). Changing one is a spec change. */
export const TRAY_DISH_CONCEPT = 'dish'
export const TRAY_FOOD_CONCEPT = 'food'
/** Dishes smaller than this (px²) are noise: a crumb, a spoon tip. */
export const MIN_DISH_PX = 400
/** About this many sample points over the tray, whatever the photo size. */
const SAMPLES = 40_000

/** One SAM mask: an H × W 0/1 raster stretched over its half-open source box. */
export interface TrayMask {
  bounds: Box
  width: number
  height: number
  raster: Uint8Array
  confidence?: number
}

export function toTrayMask(rec: SegmentationMaskRecord): TrayMask {
  const { left, top, right, bottom } = rec.bounds
  return {
    bounds: { left, top, right, bottom },
    width: rec.mask.width,
    height: rec.mask.height,
    raster: decodeMaskToRaster(rec.mask),
    ...(rec.confidence !== undefined && { confidence: rec.confidence }),
  }
}

/** Is source point (x, y) inside the mask? */
export function inMask(m: TrayMask, x: number, y: number): boolean {
  const { left: l, top: t, right: r, bottom: b } = m.bounds
  if (x < l || x >= r || y < t || y >= b) return false
  return !!m.raster[Math.floor(((y - t) * m.height) / (b - t)) * m.width + Math.floor(((x - l) * m.width) / (r - l))]
}

/** Mask area in source px². */
export function area(m: TrayMask): number {
  let ones = 0
  for (const v of m.raster) if (v) ones++
  return (ones * (m.bounds.right - m.bounds.left) * (m.bounds.bottom - m.bounds.top)) / (m.width * m.height)
}

/** Sampling step in px over a w × h box: 1 for small fixtures (exact), 6 for a 1280 × 960 tray. */
export const sampleStep = (w: number, h: number) => Math.max(1, Math.ceil(Math.sqrt((w * h) / SAMPLES)))

const round3 = (x: number) => Math.round(x * 1000) / 1000
const centre = (b: Box) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 })

/**
 * Dish regions of one tray photo. Each sample point belongs to the smallest dish whose mask holds it (a bowl on a plate
 * owns its pixels), and counts as food when any food mask holds it. Regions are numbered by box centre, left to right,
 * then top to bottom, then larger first.
 */
export function layoutTray(dishes: readonly TrayMask[], foods: readonly TrayMask[]): TraySegmentation {
  const kept = dishes
    .map((m) => ({ m, area: area(m) }))
    .filter((d) => d.area >= MIN_DISH_PX)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_TRAY_REGIONS)
  const boxes = [...kept.map((d) => d.m.bounds), ...foods.map((f) => f.bounds)]
  if (!boxes.length) return { regions: [], loose_food: null }

  const u = {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  }
  const s = sampleStep(u.right - u.left, u.bottom - u.top)
  const smallestFirst = [...kept].sort((a, b) => a.area - b.area)
  const owner = (list: typeof kept, x: number, y: number) => list.find((d) => inMask(d.m, x, y))
  const isFood = (x: number, y: number) => foods.some((f) => inMask(f, x, y))

  const own = new Map<(typeof kept)[number], number>()
  const fed = new Map<(typeof kept)[number], number>()
  let loose = 0
  let foodAll = 0
  for (let y = u.top; y < u.bottom; y += s) {
    for (let x = u.left; x < u.right; x += s) {
      const px = x + 0.5
      const py = y + 0.5
      const d = owner(smallestFirst, px, py)
      const f = isFood(px, py)
      if (f) foodAll++
      if (d) {
        own.set(d, (own.get(d) ?? 0) + 1)
        if (f) fed.set(d, (fed.get(d) ?? 0) + 1)
      } else if (f) loose++
    }
  }

  // A dish hidden entirely under smaller ones owns nothing and is dropped.
  const shown = kept.filter((d) => own.get(d))
  const shownSmallestFirst = smallestFirst.filter((d) => own.get(d))
  const ordered = [...shown].sort((a, b) => {
    const ca = centre(a.m.bounds)
    const cb = centre(b.m.bounds)
    return ca.x - cb.x || ca.y - cb.y || b.area - a.area
  })
  const regions = ordered.map((d, i): TrayRegion => {
    const box: SegmentBox = { ...d.m.bounds, ...(d.m.confidence !== undefined && { confidence: d.m.confidence }) }
    return {
      index: i + 1,
      box,
      coverage: round3((fed.get(d) ?? 0) / own.get(d)!),
      mask: packMask(d.m.bounds, (x, y) => inMask(d.m, x, y)),
      food: packMask(d.m.bounds, (x, y) => owner(shownSmallestFirst, x, y) === d && isFood(x, y)),
    }
  })
  return { regions, loose_food: foodAll ? round3(loose / foodAll) : null }
}

/**
 * A mask on at most MASK_GRID cells a side, keeping the box's aspect: each cell sampled at its centre, row-major, most
 * significant bit first, zero-padded to a byte, base64.
 */
export function packMask(box: Box, bit: (x: number, y: number) => boolean): MaskBits {
  const bw = box.right - box.left
  const bh = box.bottom - box.top
  const g = Math.min(1, MASK_GRID / Math.max(bw, bh))
  const width = Math.max(1, Math.round(bw * g))
  const height = Math.max(1, Math.round(bh * g))
  const bytes = new Uint8Array(Math.ceil((width * height) / 8))
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (!bit(box.left + ((i + 0.5) * bw) / width, box.top + ((j + 0.5) * bh) / height)) continue
      const k = j * width + i
      bytes[k >> 3]! |= 0x80 >> (k & 7)
    }
  }
  return { width, height, bits: Buffer.from(bytes).toString('base64') }
}

/** Where a box sits among all the regions, by thirds of their extent: `top left`, `centre`, `bottom`, `right`, … */
export function positionOf(box: Box, all: readonly Box[]): string {
  const l = Math.min(...all.map((b) => b.left))
  const r = Math.max(...all.map((b) => b.right))
  const t = Math.min(...all.map((b) => b.top))
  const b = Math.max(...all.map((x) => x.bottom))
  const c = centre(box)
  const fx = r > l ? (c.x - l) / (r - l) : 0.5
  const fy = b > t ? (c.y - t) / (b - t) : 0.5
  const column = fx < 1 / 3 ? 'left' : fx > 2 / 3 ? 'right' : 'centre'
  const row = fy < 1 / 3 ? 'top' : fy > 2 / 3 ? 'bottom' : 'middle'
  if (row === 'middle') return column
  if (column === 'centre') return row
  return `${row} ${column}`
}

/** Coverage (3 decimals) as a whole percent, halves up, in integers so float error cannot flip a half: 0.995 → 100. */
export const coveragePercent = (c: number) => Math.floor((Math.round(c * 1000) + 5) / 10)

/**
 * The Spark prompt: the dish list in `sam+spark` mode, the bare prompt when there is no region to cite. `served` maps a
 * matched collected region's index to its served dish's coverage, added as `, served <p>%` with one explaining line.
 */
export function trayContext(seg: TraySegmentation | null, served: ReadonlyMap<number, number> = new Map()): string {
  if (!seg?.regions.length) return MEAL_PROMPT
  const boxes = seg.regions.map((r) => r.box)
  const servedOf = (i: number) => (served.has(i) ? `, served ${coveragePercent(served.get(i)!)}%` : '')
  return [
    MEAL_PROMPT,
    'Segmentation found these dishes (pixels; place on the tray; share of the dish still covered by food):',
    ...seg.regions.map(
      (r) =>
        `Dish ${r.index}: x ${r.box.left}–${r.box.right}, y ${r.box.top}–${r.box.bottom}, ${positionOf(r.box, boxes)}, ` +
        `food covers ${coveragePercent(r.coverage)}%${servedOf(r.index)}.`,
    ),
    ...(seg.loose_food ? [`Food outside the dishes: ${coveragePercent(seg.loose_food)}% of the food seen.`] : []),
    ...(seg.regions.some((r) => served.has(r.index))
      ? ['"served" is the share of the same dish covered by food when the tray was served.']
      : []),
    'Use dish numbers from this list, or 0 for food in none of them.',
  ].join('\n')
}
