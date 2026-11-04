import { decodeMaskToRaster, type SegmentationMaskRecord } from '@meniscus/meta'
import type { ContainerKind, MaskBits, SegmentBox, Segmentation } from '@meniscus/shared'
import { packMask } from './tray.ts'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** One segmented instance, reduced to the geometry the domain needs. */
export interface SamInstance {
  box: Box
  confidence: number | undefined
  /** Tight vertical extent of the mask in source pixels (the box can be loose). */
  maskTop: number
  maskBottom: number
  /** Mask area in source pixels². */
  area: number
  /** The decoded mask over `box`, when it came from SAM (kept so the chosen one can be packed). */
  raster?: { width: number; height: number; data: Uint8Array }
}

export function toInstance(rec: SegmentationMaskRecord): SamInstance {
  const data = decodeMaskToRaster(rec.mask)
  return {
    ...maskGeometry(data, rec.mask.width, rec.mask.height, rec.bounds),
    confidence: rec.confidence,
    raster: { width: rec.mask.width, height: rec.mask.height, data },
  }
}

/**
 * The instance's mask packed at MASK_GRID (tray.ts `packMask`) over the box the segmentation reports for it (the
 * tight vertical extent, `toBox`), sampling the raster where it lies over SAM's own bounds; null without a raster.
 */
export function packInstance(i: SamInstance | undefined): MaskBits | null {
  const r = i?.raster
  if (!i || !r) return null
  const { left: l, top: t, right: rt, bottom: b } = i.box
  if (rt <= l || b <= t) return null
  const shown = { left: l, top: i.maskTop, right: rt, bottom: i.maskBottom }
  if (shown.bottom <= shown.top) return null
  return packMask(shown, (x, y) => {
    if (x < l || x >= rt || y < t || y >= b) return false
    return !!r.data[Math.floor(((y - t) * r.height) / (b - t)) * r.width + Math.floor(((x - l) * r.width) / (rt - l))]
  })
}

/** Pure: row-major 0/1 raster covering `bounds` → tight vertical extent and area. */
export function maskGeometry(raster: ArrayLike<number>, width: number, height: number, bounds: Box): Omit<SamInstance, 'confidence'> {
  let first = -1
  let last = -1
  let px = 0
  for (let y = 0; y < height; y++) {
    let hit = false
    for (let x = 0; x < width; x++) {
      if (raster[y * width + x]) {
        px++
        hit = true
      }
    }
    if (hit) {
      if (first < 0) first = y
      last = y
    }
  }
  const sy = (bounds.bottom - bounds.top) / height
  const sx = (bounds.right - bounds.left) / width
  return {
    box: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
    maskTop: first < 0 ? bounds.top : Math.round(bounds.top + first * sy),
    maskBottom: last < 0 ? bounds.bottom : Math.round(bounds.top + (last + 1) * sy),
    area: Math.round(px * sx * sy),
  }
}

/** SAM concept prompt per container hint. Short noun phrases only (SAM 3 rule). */
export const SAM_CONCEPT: Record<ContainerKind, string> = {
  urinal: 'urinal',
  urine_bag: 'urine bag',
  stoma_bag: 'stoma bag',
  drain_bag: 'drainage bag',
  bedpan: 'bedpan',
  commode_pan: 'commode pan',
  emesis_basin: 'basin',
  water_jug: 'jug',
  water_bottle: 'bottle',
  cup: 'cup',
  measuring_jug: 'measuring jug',
  food_tray: 'tray',
  other: 'container',
  none: 'container',
}

export const LIQUID_CONCEPT = 'liquid'

const centreInside = (inner: SamInstance['box'], outer: SamInstance['box']) => {
  const cx = (inner.left + inner.right) / 2
  const cy = (inner.top + inner.bottom) / 2
  return cx >= outer.left && cx < outer.right && cy >= outer.top && cy < outer.bottom
}

/** Highest confidence wins; ties go to the larger mask (the subject, not background clutter). */
export function pickBest(xs: readonly SamInstance[]): SamInstance | undefined {
  return [...xs].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || b.area - a.area)[0]
}

/**
 * Pure: choose the container and the liquid inside it, and derive the fill
 * fraction (liquid height / container height). The fraction ignores container
 * shape, so it is a sanity check for Spark's mark reading, never the volume.
 */
export function locate(containers: readonly SamInstance[], liquids: readonly SamInstance[]): Segmentation {
  const { container, liquid } = choose(containers, liquids)

  let fill: number | null = null
  if (container && liquid) {
    const h = container.maskBottom - container.maskTop
    if (h > 0) fill = clamp01((container.maskBottom - liquid.maskTop) / h)
  }
  return {
    container: container ? toBox(container) : null,
    fluid: liquid ? toBox(liquid) : null,
    fill_fraction: fill === null ? null : Math.round(fill * 1000) / 1000,
  }
}

function choose(containers: readonly SamInstance[], liquids: readonly SamInstance[]) {
  const container = pickBest(containers)
  const liquid = pickBest(container ? liquids.filter((l) => centreInside(l.box, container.box)) : liquids)
  return { container, liquid }
}

/**
 * `locate`, plus the chosen container's and liquid's masks packed over their boxes (capture/photo-reading "Masks kept
 * with the segmentation"), null when that element was not found.
 */
export function locateWithMasks(containers: readonly SamInstance[], liquids: readonly SamInstance[]): Segmentation {
  const { container, liquid } = choose(containers, liquids)
  return { ...locate(containers, liquids), container_mask: packInstance(container), fluid_mask: packInstance(liquid) }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function toBox(i: SamInstance): SegmentBox {
  // Report the tight mask extent vertically: Spark uses `top` as the liquid surface.
  return {
    left: i.box.left,
    top: i.maskTop,
    right: i.box.right,
    bottom: i.maskBottom,
    ...(i.confidence !== undefined && { confidence: i.confidence }),
  }
}
