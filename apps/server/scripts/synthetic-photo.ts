/**
 * Synthetic "photos" for the demo history: flat drawings (PNG) of a urine drainage bag, a jug or cup, and a meal tray.
 * The bag and vessel drawings match the stored SAM boxes, so the evidence overlay lines up. No real images, no patient data.
 */
import { crc32, deflateSync } from 'node:zlib'
import type { TrayMask } from '../src/ai/tray.ts'

type Box = { left: number; top: number; right: number; bottom: number }
type Rgb = readonly [number, number, number]

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as unknown as Rgb

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

/** An RGB canvas with the few shapes the drawings need, encoded as PNG. */
function canvas(W: number, H: number) {
  const stride = 1 + W * 3
  const raw = Buffer.alloc(H * stride)
  const set = (x: number, y: number, c: Rgb) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const o = y * stride + 1 + x * 3
    raw[o] = c[0]
    raw[o + 1] = c[1]
    raw[o + 2] = c[2]
  }
  /** Filled rectangle with corner radius `r`. */
  const rect = (b: Box, c: Rgb, r = 0) => {
    for (let y = Math.max(0, b.top); y < Math.min(H, b.bottom); y++) {
      for (let x = Math.max(0, b.left); x < Math.min(W, b.right); x++) {
        const dx = x < b.left + r ? b.left + r - x : x >= b.right - r ? x - (b.right - r - 1) : 0
        const dy = y < b.top + r ? b.top + r - y : y >= b.bottom - r ? y - (b.bottom - r - 1) : 0
        if (dx * dx + dy * dy <= r * r) set(x, y, c)
      }
    }
  }
  const circle = (cx: number, cy: number, r: number, c: Rgb) => {
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c)
  }
  /** Vertical gradient over the whole canvas. */
  const wall = (top: Rgb, bottom: Rgb) => {
    for (let y = 0; y < H; y++) {
      const c = mix(top, bottom, y / H)
      for (let x = 0; x < W; x++) set(x, y, c)
    }
  }
  const png = () => {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(W, 0)
    ihdr.writeUInt32BE(H, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // RGB
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
      ]),
    )
  }
  return { set, rect, circle, wall, png }
}

/** Portrait photos are this size; the stored SAM boxes use these pixels. */
export const PHOTO_W = 960
export const PHOTO_H = 1280

export function bagPhoto(container: Box, fluid: Box, colour: string): Uint8Array {
  const { rect, wall, png } = canvas(PHOTO_W, PHOTO_H)
  // Wall behind the bed: a soft vertical gradient; a bed rail across the top.
  wall(hex('#e8edf2'), hex('#d4dbe2'))
  rect({ left: 0, top: 40, right: PHOTO_W, bottom: 72 }, hex('#9aa6b2'), 0)
  // Hanger and drain tube.
  const mid = Math.round((container.left + container.right) / 2)
  rect({ left: mid - 70, top: 56, right: mid + 70, bottom: container.top + 20 }, hex('#7b8794'), 10)
  rect({ left: mid - 14, top: container.bottom - 10, right: mid + 14, bottom: PHOTO_H }, hex('#c3ccd5'), 6)

  // The bag: outline, clear plastic, then the liquid.
  rect({ left: container.left - 6, top: container.top - 6, right: container.right + 6, bottom: container.bottom + 6 }, hex('#8c98a4'), 46)
  rect(container, hex('#f5f7f9'), 40)
  const liquid = hex(colour)
  rect(fluid, liquid, 26)
  rect({ left: fluid.left, top: fluid.top, right: fluid.right, bottom: fluid.top + 8 }, mix(liquid, hex('#ffffff'), 0.35), 0)

  // Graduations every 100 mL of 2000, longer every 500, on the scale the stored fill fraction uses.
  for (let ml = 100; ml < 2000; ml += 100) {
    const y = Math.round(container.bottom - (ml / 2000) * (container.bottom - container.top))
    const len = ml % 500 === 0 ? 70 : 34
    rect({ left: container.right - 24 - len, top: y - 2, right: container.right - 24, bottom: y + 2 }, hex('#4a5560'), 0)
  }
  return png()
}

/**
 * A clear jug or cup on a bedside table, liquid inside `fluid`, marks every 100 mL (longer every 500) of `capacity` on the
 * same scale as the stored fill fraction.
 */
export function vesselPhoto(container: Box, fluid: Box, colour: string, capacity: number): Uint8Array {
  const { rect, wall, png } = canvas(PHOTO_W, PHOTO_H)
  wall(hex('#eef1f4'), hex('#dde3e8'))
  // Bedside table top and its front edge.
  rect({ left: 0, top: container.bottom - 4, right: PHOTO_W, bottom: PHOTO_H }, hex('#c9b79c'), 0)
  rect({ left: 0, top: container.bottom - 4, right: PHOTO_W, bottom: container.bottom + 10 }, hex('#b39f82'), 0)
  const h = container.bottom - container.top
  // Handle: an outlined loop on the right.
  const handle = {
    left: container.right - 20,
    top: container.top + Math.round(h * 0.18),
    right: container.right + 90,
    bottom: container.top + Math.round(h * 0.7),
  }
  rect(handle, hex('#9aa7b4'), 44)
  rect({ left: handle.left + 26, top: handle.top + 26, right: handle.right - 26, bottom: handle.bottom - 26 }, hex('#e6eaee'), 24)
  // Body: rim, clear plastic, liquid with a lighter surface band.
  rect({ left: container.left - 8, top: container.top - 8, right: container.right + 8, bottom: container.bottom + 6 }, hex('#9aa7b4'), 22)
  rect(container, hex('#f7f9fb'), 16)
  const liquid = hex(colour)
  rect(fluid, liquid, 10)
  rect({ left: fluid.left, top: fluid.top, right: fluid.right, bottom: fluid.top + 8 }, mix(liquid, hex('#ffffff'), 0.4), 0)
  // Spout on the left of the rim.
  rect({ left: container.left - 40, top: container.top - 8, right: container.left + 20, bottom: container.top + 14 }, hex('#9aa7b4'), 8)
  for (let ml = 100; ml < capacity; ml += 100) {
    const y = Math.round(container.bottom - (ml / capacity) * h)
    const len = ml % 500 === 0 ? 60 : 30
    rect({ left: container.left + 18, top: y - 2, right: container.left + 18 + len, bottom: y + 2 }, hex('#4a5560'), 0)
  }
  return png()
}

const FOOD = ['#f3efe2', '#e2b33c', '#c9772e', '#8fae4b', '#e7d3a7'].map(hex)

/** A collected meal tray seen from above: a plate, a bowl and a cup, with food left for whatever was not eaten. */
/** A drawn circle: every pixel (x, y) with (x − cx)² + (y − cy)² ≤ r². */
export interface Circle {
  cx: number
  cy: number
  r: number
}

/** The tray's dishes (plate, bowl, cup) and the food left on them, as `trayPhoto` draws them. */
export function trayScene(portion: number, seed: number) {
  const left = 1 - portion / 100
  // Leftovers on the plate in proportion to what was not eaten; the bowl's dal level by what is left.
  const blobs = Array.from({ length: Math.round(left * 14) }, (_, i): Circle & { colour: Rgb } => {
    const a = (i * 2.4 + seed) % (2 * Math.PI)
    const d = 40 + ((i * 53 + seed * 17) % 120)
    return {
      cx: 470 + Math.round(Math.cos(a) * d),
      cy: 480 + Math.round(Math.sin(a) * d),
      r: 34 + ((i * 7) % 18),
      colour: FOOD[(i + seed) % FOOD.length]!,
    }
  })
  return {
    left,
    plate: { cx: 470, cy: 480, r: 250 },
    bowl: { cx: 930, cy: 380, r: 150 },
    cup: { cx: 950, cy: 700, r: 92 },
    blobs,
    dal: left > 0 ? { cx: 930, cy: 380, r: Math.round(40 + 80 * left) } : null,
  }
}

/** A circle as a SAM mask at pixel resolution: half-open bounds, one raster cell per drawn pixel. */
function circleMask({ cx, cy, r }: Circle): TrayMask {
  const n = 2 * r + 1
  const raster = new Uint8Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) raster[j * n + i] = (i - r) ** 2 + (j - r) ** 2 <= r * r ? 1 : 0
  return { bounds: { left: cx - r, top: cy - r, right: cx + r + 1, bottom: cy + r + 1 }, width: n, height: n, raster }
}

/**
 * The masks SAM would return for `trayPhoto(portion, seed)`: `dish` for the plate, bowl and cup, `food` for each
 * leftover and the dal (the cup's drink is not food). For the demo's real `layoutTray`, so outlines match the drawing.
 */
export function trayMasks(portion: number, seed: number): { dishes: TrayMask[]; foods: TrayMask[] } {
  const t = trayScene(portion, seed)
  return {
    dishes: [t.plate, t.bowl, t.cup].map(circleMask),
    foods: [...t.blobs, ...(t.dal ? [t.dal] : [])].map(circleMask),
  }
}

export function trayPhoto(portion: number, seed: number): Uint8Array {
  const W = 1280
  const H = 960
  const { rect, circle, wall, png } = canvas(W, H)
  const t = trayScene(portion, seed)
  const draw = (c: Circle, colour: Rgb, r = c.r) => circle(c.cx, c.cy, r, colour)
  wall(hex('#d9dee3'), hex('#cfd5db'))
  rect({ left: 90, top: 110, right: W - 90, bottom: H - 110 }, hex('#8fa3b5'), 36)
  rect({ left: 104, top: 124, right: W - 104, bottom: H - 124 }, hex('#a9bccd'), 28)
  // Plate: rim, face, then leftovers.
  draw(t.plate, hex('#e3e7ea'))
  draw(t.plate, hex('#fbfcfc'), 225)
  for (const b of t.blobs) draw(b, b.colour)
  // Bowl, then the dal left in it.
  draw(t.bowl, hex('#e3e7ea'))
  draw(t.bowl, hex('#fbfcfc'), 128)
  if (t.dal) draw(t.dal, hex('#e0a83a'))
  // Cup, nearly empty unless the meal was left.
  draw(t.cup, hex('#e3e7ea'))
  draw(t.cup, t.left > 0.5 ? hex('#c9a27a') : hex('#f4efe6'), 74)
  // Spoon.
  rect({ left: 760, top: 560, right: 780, bottom: 820 }, hex('#c3cbd3'), 8)
  return png()
}
