/**
 * What SegmentOverlay draws on a photo (DESIGN.md §5.22): the dim outside the container, one layer per element (a
 * contour traced from its SAM mask, or its box for evidence without masks), the fill line and the HTML labels, all in
 * percent of the photo's own pixels. Pure. Spark-only reads (`segmentation: null`) and an outline toggled off draw none.
 */
import type { ContainerKind, DrinkKind, Segmentation, SegmentBox } from '@meniscus/shared'
import { boxPath, maskPath } from './contour.ts'
import { DRINK_LABEL } from './drinks.ts'
import { CONTAINER_LABEL } from './labels.ts'
import { trayRegionLines, type TrayView } from './tray.ts'

export { trayRegionLines }

export type LayerKind = 'container' | 'liquid' | 'dish' | 'food' | 'drink'
export interface OverlayLayer {
  key: string
  kind: LayerKind
  /** SVG path in percent of the photo (viewBox 0 0 100 100), drawn even-odd. */
  d: string
}
export interface OverlayLabel {
  key: string
  kind: LayerKind
  left: number
  top: number
  lines: string[]
}
export interface OverlayView {
  /** `contour` when any element came from a mask, `box` for older evidence, `none` when nothing is drawn. */
  mode: 'contour' | 'box' | 'none'
  /** Even-odd path: the whole photo minus the container, dimmed so the subject stays bright. */
  dim: string | null
  /** Bottom to top, in reveal order: container, then the liquid or each dish (with its food) in index order. */
  layers: OverlayLayer[]
  /** The fill line across the container at the liquid's top. */
  surface: { x1: number; x2: number; y: number } | null
  labels: OverlayLabel[]
  /** The liquid's tint: `out` for an output container (bag, urinal, pan), else `in`. */
  layerTone: 'in' | 'out'
}

const OUTPUT_CONTAINERS: ReadonlySet<ContainerKind> = new Set([
  'urinal',
  'urine_bag',
  'stoma_bag',
  'drain_bag',
  'bedpan',
  'commode_pan',
  'emesis_basin',
])

const r2 = (v: number) => Math.round(v * 100) / 100
const pctX = (v: number, image: { width: number }) => r2((100 * v) / image.width)
const pctY = (v: number, image: { height: number }) => r2((100 * v) / image.height)
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const containerName = (c: ContainerKind | null | undefined) => (c ? CONTAINER_LABEL[c] : CONTAINER_LABEL.other)

/** `Urine bag`, sentence case, from CONTAINER_LABEL. */
export const containerLabel = (c: ContainerKind | null | undefined): string => sentence(containerName(c))

/** `Liquid · 46% full ≈ 930 mL`; the drink kind replaces `Liquid`; no ` ≈ … mL` without a volume; just the name without a fill. */
export function liquidLabel(seg: Pick<Segmentation, 'fill_fraction' | 'fluid_volume_ml'>, drink?: DrinkKind | null): string {
  const name = drink ? DRINK_LABEL[drink] : 'Liquid'
  if (seg.fill_fraction === null) return name
  const vol = seg.fluid_volume_ml
  return `${name} · ${Math.round(seg.fill_fraction * 100)}% full${vol != null ? ` ≈ ${vol} mL` : ''}`
}

/** The photo's alt text: what SAM outlined (`… the liquid, 46% full, about 930 mL.`). */
export function overlayAlt(seg: Segmentation | null, container: ContainerKind | null | undefined, drink?: DrinkKind | null): string {
  const what = containerName(container)
  const head = `Photo of the ${what}.`
  if (!seg?.container) return head
  if (!seg.fluid) return `${head} SAM 3.1 outlined the ${what}.`
  const liquid = drink ? DRINK_LABEL[drink].toLowerCase() : 'liquid'
  const fill = seg.fill_fraction === null ? '' : `, ${Math.round(seg.fill_fraction * 100)}% full`
  const vol = seg.fill_fraction !== null && seg.fluid_volume_ml != null ? `, about ${seg.fluid_volume_ml} mL` : ''
  return `${head} SAM 3.1 outlined the ${what} and the ${liquid}${fill}${vol}.`
}

const NONE = (layerTone: 'in' | 'out'): OverlayView => ({ mode: 'none', dim: null, layers: [], surface: null, labels: [], layerTone })

const element = (box: SegmentBox, mask: Segmentation['container_mask'], image: { width: number; height: number }) => {
  const d = mask ? maskPath(mask, box, image) : ''
  return d ? { d, traced: true } : { d: boxPath(box, image), traced: false }
}

/**
 * The overlay for a `image.width × image.height` photo. A container photo draws its container and liquid from
 * `seg`; a tray photo (`tray` with regions) draws each dish region's contour, its food, and drink regions.
 */
export function overlayView(o: {
  seg: Segmentation | null
  image: { width: number; height: number }
  container?: ContainerKind | null
  drink?: DrinkKind | null
  tray?: TrayView | null
  on: boolean
}): OverlayView {
  const layerTone = o.container && OUTPUT_CONTAINERS.has(o.container) ? 'out' : 'in'
  if (!o.on) return NONE(layerTone)
  const regions = o.tray?.segmentation?.regions ?? []
  if (regions.length) return trayView(o.tray!, o.image, layerTone)
  const seg = o.seg
  if (!seg?.container) return NONE(layerTone)
  const { image } = o
  const c = element(seg.container, seg.container_mask, image)
  const layers: OverlayLayer[] = [{ key: 'container', kind: 'container', d: c.d }]
  const labels: OverlayLabel[] = [
    {
      key: 'container',
      kind: 'container',
      left: pctX(seg.container.left, image),
      top: pctY(seg.container.top, image),
      lines: [containerLabel(o.container)],
    },
  ]
  let traced = c.traced
  let surface: OverlayView['surface'] = null
  if (seg.fluid) {
    const f = element(seg.fluid, seg.fluid_mask, image)
    traced ||= f.traced
    layers.push({ key: 'liquid', kind: 'liquid', d: f.d })
    surface = { x1: pctX(seg.container.left, image), x2: pctX(seg.container.right, image), y: pctY(seg.fluid.top, image) }
    labels.push({
      key: 'liquid',
      kind: 'liquid',
      left: pctX(seg.fluid.left, image),
      top: pctY(seg.fluid.top, image),
      lines: [liquidLabel(seg, o.drink)],
    })
  }
  return { mode: traced ? 'contour' : 'box', dim: `M0 0L100 0L100 100L0 100Z${c.d}`, layers, surface, labels, layerTone }
}

function trayView(tray: TrayView, image: { width: number; height: number }, layerTone: 'in' | 'out'): OverlayView {
  const cited = (index: number, by: readonly { index: number }[]) => by.some((x) => x.index === index)
  const layers: OverlayLayer[] = []
  const labels: OverlayLabel[] = []
  for (const r of tray.segmentation!.regions) {
    const drink = cited(r.index, tray.fluids) && !cited(r.index, tray.dishes)
    const kind: LayerKind = drink ? 'drink' : 'dish'
    layers.push({ key: `r${r.index}`, kind, d: maskPath(r.mask, r.box, image) || boxPath(r.box, image) })
    const food = drink ? '' : maskPath(r.food, r.box, image)
    if (food) layers.push({ key: `f${r.index}`, kind: 'food', d: food })
    const lines = trayRegionLines(r, tray)
    if (lines.length) labels.push({ key: `r${r.index}`, kind, left: pctX(r.box.left, image), top: pctY(r.box.top, image), lines })
  }
  return { mode: 'contour', dim: null, layers, surface: null, labels, layerTone }
}
