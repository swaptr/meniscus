/**
 * SAM mask contours for the photo overlays (DESIGN.md §5.22, design.md D6). Pure and DOM-free.
 *
 * A packed `MaskBits` (at most MASK_GRID cells a side over its box, row-major, MSB first) is unpacked to a grid, its
 * boundary is traced into closed loops on cell corners, each loop is smoothed with two Chaikin passes, and the loops are
 * mapped over the box to percent of the photo's own pixel size, ready for an SVG `path` drawn `fill-rule: evenodd`.
 */
import type { MaskBits, SegmentBox } from '@meniscus/shared'

export interface Grid {
  width: number
  height: number
  /** Row-major 0/1. */
  cells: Uint8Array
}
export type Pt = readonly [number, number]
export type Loop = Pt[]

/** The bits of a packed mask, row-major, as 0/1 (the web's own base64, never `@meniscus/meta`). */
export function decodeBits(m: MaskBits): Uint8Array {
  const bytes = atob(m.bits)
  const out = new Uint8Array(m.width * m.height)
  for (let k = 0; k < out.length; k++) out[k] = (bytes.charCodeAt(k >> 3) >> (7 - (k & 7))) & 1
  return out
}

export const unpack = (m: MaskBits): Grid => ({ width: m.width, height: m.height, cells: decodeBits(m) })

/** Shoelace area in cell units; outer loops and holes have opposite signs. */
export function loopArea(loop: readonly Pt[]): number {
  let a = 0
  for (let k = 0; k < loop.length; k++) {
    const [x1, y1] = loop[k]!
    const [x2, y2] = loop[(k + 1) % loop.length]!
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

interface Edge {
  from: Pt
  to: Pt
  used: boolean
}
const key = (p: Pt) => `${p[0]},${p[1]}`

/**
 * Closed boundary loops by marching squares on cell corners. Every edge between a set and an unset cell is emitted
 * clockwise around its set cell (on screen, y down), so outer loops run clockwise and holes anticlockwise. At a saddle
 * corner the trace turns right first, so diagonal neighbours stay separate simple loops. Collinear corners are dropped.
 */
export function contours(g: Grid): Loop[] {
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < g.width && j < g.height && g.cells[j * g.width + i] === 1
  const edges: Edge[] = []
  const add = (from: Pt, to: Pt) => edges.push({ from, to, used: false })
  for (let j = 0; j < g.height; j++)
    for (let i = 0; i < g.width; i++) {
      if (!on(i, j)) continue
      if (!on(i, j - 1)) add([i, j], [i + 1, j])
      if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1])
      if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1])
      if (!on(i - 1, j)) add([i, j + 1], [i, j])
    }
  const byStart = new Map<string, Edge[]>()
  for (const e of edges) byStart.set(key(e.from), [...(byStart.get(key(e.from)) ?? []), e])
  const dir = (e: Edge): Pt => [e.to[0] - e.from[0], e.to[1] - e.from[1]]
  const loops: Loop[] = []
  for (const first of edges) {
    if (first.used) continue
    const pts: Pt[] = []
    let e: Edge | undefined = first
    while (e && !e.used) {
      e.used = true
      pts.push(e.from)
      const [dx, dy] = dir(e)
      const turns: Pt[] = [
        [-dy, dx], // right on screen
        [dx, dy], // straight
        [dy, -dx], // left
      ]
      const next: Edge[] = (byStart.get(key(e.to)) ?? []).filter((x) => !x.used)
      e = turns.map(([tx, ty]) => next.find((x) => dir(x)[0] === tx && dir(x)[1] === ty)).find(Boolean)
    }
    loops.push(simplify(pts))
  }
  return loops
}

/** Drops corners that sit on a straight run. */
function simplify(pts: Pt[]): Loop {
  return pts.filter((p, k) => {
    const a = pts[(k + pts.length - 1) % pts.length]!
    const b = pts[(k + 1) % pts.length]!
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0
  })
}

/** Chaikin corner cutting on a closed loop; every point stays inside the original loop's hull. */
export function smooth(loop: readonly Pt[], passes = 2): Loop {
  let pts: Loop = [...loop]
  for (let n = 0; n < passes; n++) {
    const out: Pt[] = []
    for (let k = 0; k < pts.length; k++) {
      const [x1, y1] = pts[k]!
      const [x2, y2] = pts[(k + 1) % pts.length]!
      // Chaikin cuts a quarter of each edge, but at most half a cell: `simplify` merged straight runs into long edges,
      // and a quarter of a 20-cell edge would bevel a square corner into a diagonal the mask never had.
      const len = Math.hypot(x2 - x1, y2 - y1)
      const t = len > 0 ? Math.min(0.25, 0.5 / len) : 0.25
      out.push([(1 - t) * x1 + t * x2, (1 - t) * y1 + t * y2], [t * x1 + (1 - t) * x2, t * y1 + (1 - t) * y2])
    }
    pts = out
  }
  return pts
}

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * Loops in grid units (`grid`'s cells spread over `box`) as one SVG path in percent of a `image.width × image.height` photo.
 * Draw it with `fill-rule: evenodd` so holes stay open.
 */
export function toPath(
  loops: readonly (readonly Pt[])[],
  box: SegmentBox,
  image: { width: number; height: number },
  grid: { width: number; height: number },
): string {
  const gw = grid.width
  const gh = grid.height
  const x = (v: number) => r2((100 * (box.left + (v * (box.right - box.left)) / gw)) / image.width)
  const y = (v: number) => r2((100 * (box.top + (v * (box.bottom - box.top)) / gh)) / image.height)
  return loops
    .filter((l) => l.length > 2)
    .map((l) => `M${l.map(([a, b]) => `${x(a)} ${y(b)}`).join('L')}Z`)
    .join('')
}

/** A packed mask over its box, traced and smoothed, as a percent path of the photo; '' for an empty mask. */
export function maskPath(mask: MaskBits, box: SegmentBox, image: { width: number; height: number }): string {
  const g = unpack(mask)
  return toPath(
    contours(g).map((l) => smooth(l)),
    box,
    image,
    g,
  )
}

/** A box as a closed percent path (the fallback for evidence without masks). */
export function boxPath(box: SegmentBox, image: { width: number; height: number }): string {
  const l = r2((100 * box.left) / image.width)
  const r = r2((100 * box.right) / image.width)
  const t = r2((100 * box.top) / image.height)
  const b = r2((100 * box.bottom) / image.height)
  return `M${l} ${t}L${r} ${t}L${r} ${b}L${l} ${b}Z`
}
