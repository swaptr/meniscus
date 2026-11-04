/**
 * The labeled copy kept beside a segmented photo (web/capture "Labeled copy drawn at the bed", design.md D1): the raw
 * pixels at their own size with SegmentOverlay's dim, contours, surface line and labels drawn in, as a JPEG at 0.85.
 *
 * `drawPlan` is pure and DOM-free: it reuses `overlayView` (the same geometry and label text the live SVG overlay
 * draws, so the two never disagree) and maps it to the photo's own pixels. `renderLabeledCopy` is browser-only and
 * paints a plan on a canvas. No requests.
 */
import type { DrinkKind, PhotoEvidence } from '@meniscus/shared'
import { CATEGORY_HUE, SLOT } from './hues.ts'
import { overlayView, type LayerKind, type OverlayView } from './overlay.ts'
import type { TrayView } from './tray.ts'

/** What a copy is drawn from: a container read with the entry's drink, or a tray read with its dishes and fluids. */
export type CopySubject =
  { kind: 'photo'; evidence: Pick<PhotoEvidence, 'reading' | 'segmentation'>; drink: DrinkKind | null } | { kind: 'tray'; tray: TrayView }

/** A closed polygon in source pixels, `[x, y]` corners. */
export type Poly = [number, number][]

export interface PlanLayer {
  key: string
  kind: LayerKind
  /** Even-odd, so holes stay open. */
  polys: Poly[]
  /** Contour colour, or the fill colour for `food`. */
  tint: string
}
export interface PlanLabel {
  key: string
  kind: LayerKind
  /** The chip's top-left anchor in source pixels (the region's box corner, inset by `inset`). */
  x: number
  y: number
  lines: string[]
}
export interface DrawPlan {
  width: number
  height: number
  /** Whole photo minus the container: filled with ink at `VEIL_ALPHA`, even-odd. Null for trays. */
  veil: Poly[] | null
  layers: PlanLayer[]
  surface: { x1: number; x2: number; y: number } | null
  labels: PlanLabel[]
  /** Label text size, contour and halo widths, chip padding and inset, all in source pixels. */
  font: number
  stroke: number
  halo: number
  pad: number
  inset: number
}

/** DESIGN.md 2.1 token values (checked against tokens.stylex.ts by the test). */
export const PAINT = {
  fg: '#13212f',
  bg: '#ffffff',
  intake: '#2a78d6',
  output: '#9a4a8a',
  dish: CATEGORY_HUE.food,
  food: SLOT[3],
  drink: CATEGORY_HUE.water,
} as const

export const VEIL_ALPHA = 0.4
export const COPY_QUALITY = 0.85
/** The app's system font stack (global.css). */
export const COPY_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

/** `M10 8L40 8…Z` in percent (absolute M, L, Z only, as contour.ts writes) to pixel polygons. */
export function percentPolys(d: string, width: number, height: number): Poly[] {
  return d
    .split('Z')
    .map((sub) => {
      const n = sub.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      const poly: Poly = []
      for (let k = 0; k + 1 < n.length; k += 2) poly.push([px((n[k]! * width) / 100), px((n[k + 1]! * height) / 100)])
      return poly
    })
    .filter((p) => p.length > 2)
}

const px = (v: number) => Math.round(v * 10) / 10

/**
 * Rounds a traced mask contour's stair steps into the outline SAM saw: resampled evenly along its length, then averaged
 * over about `radius` px (one mask cell), and kept inside the traced outline's own bounds (the SAM box). Boxes and short
 * loops (≤ 8 corners) are kept as they are.
 */
export function smoothPoly(poly: Poly, radius = 12): Poly {
  if (poly.length <= 8 || radius <= 0) return poly
  const spacing = Math.max(1.5, radius / 4)
  // Even resampling, so the averaging weighs every part of the outline alike.
  const even: [number, number][] = []
  let carry = 0
  for (let k = 0; k < poly.length; k++) {
    const [ax, ay] = poly[k]!
    const [bx, by] = poly[(k + 1) % poly.length]!
    const len = Math.hypot(bx - ax, by - ay)
    let t = carry
    while (t < len) {
      even.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len])
      t += spacing
    }
    carry = t - len
  }
  if (even.length <= 8) return poly
  let pts = even
  // Repeated 1-2-1 averaging: a Gaussian of σ ≈ spacing · √(passes / 2) = radius.
  const passes = Math.round(2 * (radius / spacing) ** 2)
  for (let n = 0; n < passes; n++) {
    const m = pts.length
    pts = pts.map(([x, y], i) => {
      const [ax, ay] = pts[(i + m - 1) % m]!
      const [bx, by] = pts[(i + 1) % m]!
      return [(ax + 2 * x + bx) / 4, (ay + 2 * y + by) / 4]
    })
  }
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return pts.map(([x, y]) => [px(Math.min(x1, Math.max(x0, x))), px(Math.min(y1, Math.max(y0, y)))])
}

/** One mask cell's size in source pixels, the scale of the stair steps a traced contour has. */
const cellOf = (
  box: { left: number; top: number; right: number; bottom: number } | null | undefined,
  mask: { width: number; height: number } | null | undefined,
) => (box && mask ? Math.max((box.right - box.left) / mask.width, (box.bottom - box.top) / mask.height) : 0)

/** Sizes in source pixels: text 3.6% of the shorter side (about 7 pt with the photo printed 90 mm wide), at least 14 px. */
export function copyMetrics(width: number, height: number) {
  const font = Math.max(14, Math.round(Math.min(width, height) * 0.036))
  return {
    font,
    stroke: Math.max(3, Math.round(font * 0.2)),
    halo: Math.max(1, Math.round(font * 0.12)),
    pad: Math.round(font * 0.45),
    inset: Math.round(font * 0.35),
  }
}

const isSegmented = (s: CopySubject) => (s.kind === 'photo' ? !!s.evidence.segmentation?.container : !!s.tray.segmentation?.regions.length)

/** The plan for a `width × height` bitmap, or null when the read has nothing to draw (Spark-only, no regions). */
export function drawPlan(size: { width: number; height: number }, subject: CopySubject): DrawPlan | null {
  if (!isSegmented(subject)) return null
  const { width, height } = size
  const view: OverlayView =
    subject.kind === 'photo'
      ? overlayView({
          seg: subject.evidence.segmentation,
          image: size,
          container: subject.evidence.reading.container,
          drink: subject.drink,
          on: true,
        })
      : overlayView({ seg: null, image: size, tray: subject.tray, on: true })
  if (view.mode === 'none') return null
  const tint = (k: LayerKind) =>
    k === 'container' ? PAINT.bg : k === 'liquid' ? PAINT[view.layerTone === 'out' ? 'output' : 'intake'] : PAINT[k]
  const m = copyMetrics(width, height)
  const at = (pct: number, of: number) => px((pct * of) / 100)
  // Each traced layer is smoothed over one cell of its own mask; boxes (older evidence) stay square.
  const cell = (key: string): number => {
    if (subject.kind === 'photo') {
      const seg = subject.evidence.segmentation!
      return key === 'container' ? cellOf(seg.container, seg.container_mask) : cellOf(seg.fluid, seg.fluid_mask)
    }
    const r = subject.tray.segmentation!.regions.find((x) => `r${x.index}` === key || `f${x.index}` === key)
    return r ? cellOf(r.box, key.startsWith('f') ? r.food : r.mask) : 0
  }
  const layers = view.layers.map((l) => ({
    key: l.key,
    kind: l.kind,
    polys: percentPolys(l.d, width, height).map((p) => smoothPoly(p, cell(l.key))),
    tint: tint(l.kind),
  }))
  const frame: Poly = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ]
  return {
    width,
    height,
    // The whole photo minus the container's (smoothed) outline.
    veil: view.dim ? [frame, ...(layers.find((l) => l.kind === 'container')?.polys ?? [])] : null,
    layers,
    surface: view.surface && { x1: at(view.surface.x1, width), x2: at(view.surface.x2, width), y: at(view.surface.y, height) },
    // The liquid's chip sits a little lower, as on the live overlay, so it clears the container's.
    labels: view.labels.map((l) => ({
      key: l.key,
      kind: l.kind,
      x: at(l.left, width) + m.inset,
      y: at(l.top, height) + (l.kind === 'liquid' ? m.inset * 2 : m.inset),
      lines: l.lines,
    })),
    ...m,
  }
}

/** Every label line a plan draws, in order (what the copy reads). */
export const planTexts = (p: DrawPlan): string[] => p.labels.flatMap((l) => l.lines)

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const trace = (ctx: Ctx, polys: readonly Poly[]) => {
  for (const poly of polys) {
    ctx.moveTo(poly[0]![0], poly[0]![1])
    for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k]![0], poly[k]![1])
    ctx.closePath()
  }
}

/** Paints a plan over the bitmap already drawn on `ctx`. */
export function paintPlan(ctx: Ctx, plan: DrawPlan): void {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (plan.veil) {
    ctx.beginPath()
    trace(ctx, plan.veil)
    ctx.globalAlpha = VEIL_ALPHA
    ctx.fillStyle = PAINT.fg
    ctx.fill('evenodd')
    ctx.globalAlpha = 1
  }
  for (const l of plan.layers) {
    ctx.beginPath()
    trace(ctx, l.polys)
    if (l.kind === 'food') {
      ctx.globalAlpha = 0.28
      ctx.fillStyle = l.tint
      ctx.fill('evenodd')
      ctx.globalAlpha = 1
      continue
    }
    // A light halo under a tinted contour, so it reads on any background; white containers get an ink halo instead.
    ctx.strokeStyle = l.kind === 'container' ? PAINT.fg : PAINT.bg
    ctx.globalAlpha = l.kind === 'container' ? 0.5 : 0.85
    ctx.lineWidth = plan.stroke + plan.halo * 2
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.strokeStyle = l.tint
    ctx.lineWidth = plan.stroke
    ctx.stroke()
  }
  if (plan.surface) {
    ctx.beginPath()
    ctx.setLineDash([plan.stroke * 2.5, plan.stroke * 1.25])
    ctx.moveTo(plan.surface.x1, plan.surface.y)
    ctx.lineTo(plan.surface.x2, plan.surface.y)
    ctx.strokeStyle = PAINT.bg
    ctx.lineWidth = Math.max(2, plan.stroke * 0.7)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.font = `600 ${plan.font}px ${COPY_FONT}`
  ctx.textBaseline = 'top'
  const lineH = Math.round(plan.font * 1.25)
  const placed: { x: number; y: number; w: number; h: number }[] = []
  for (const l of plan.labels) {
    const w = Math.ceil(Math.max(...l.lines.map((t) => ctx.measureText(t).width))) + plan.pad * 2
    const h = lineH * l.lines.length + plan.pad * 1.4
    // Kept inside the photo, and pushed below any chip it would cover.
    const x = Math.max(plan.inset, Math.min(l.x, plan.width - w - plan.inset))
    let y = Math.max(plan.inset, Math.min(l.y, plan.height - h - plan.inset))
    for (const p of placed) if (x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h) y = p.y + p.h + plan.inset
    placed.push({ x, y, w, h })
    ctx.globalAlpha = 0.9
    ctx.fillStyle = PAINT.fg
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, Math.round(plan.font * 0.3))
    ctx.fill()
    ctx.globalAlpha = 1
    // A tint tab on the chip's left edge ties it to its contour; the text itself is never coloured.
    ctx.fillStyle = l.kind === 'container' ? PAINT.bg : (plan.layers.find((x2) => x2.key === l.key)?.tint ?? PAINT.bg)
    ctx.fillRect(x, y + plan.pad * 0.5, Math.max(3, Math.round(plan.font * 0.18)), h - plan.pad)
    ctx.fillStyle = PAINT.bg
    l.lines.forEach((t, i) => ctx.fillText(t, x + plan.pad, y + plan.pad * 0.7 + i * lineH))
  }
}

/**
 * Browser-only: the labeled JPEG of `photo` (the very blob uploaded as the raw), at its own pixel size. Rejects when the
 * read has nothing to draw or the browser cannot encode, so the caller saves without a copy.
 */
export async function renderLabeledCopy(photo: Blob, subject: CopySubject): Promise<Blob> {
  const bitmap = await createImageBitmap(photo)
  try {
    const plan = drawPlan({ width: bitmap.width, height: bitmap.height }, subject)
    if (!plan) throw new Error('nothing to label')
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(plan.width, plan.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      ctx.drawImage(bitmap, 0, 0)
      paintPlan(ctx, plan)
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: COPY_QUALITY })
    }
    const canvas = document.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(bitmap, 0, 0)
    paintPlan(ctx, plan)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', COPY_QUALITY))
    if (!blob) throw new Error('no encode')
    return blob
  } finally {
    bitmap.close()
  }
}

/** Whether a subject gets a copy at all (Spark-only reads and trays without regions do not). */
export const wantsCopy = (s: CopySubject | null | undefined): s is CopySubject => !!s && isSegmented(s)
