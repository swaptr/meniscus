import * as stylex from '@stylexjs/stylex'
import { color, layer, space } from '../tokens.stylex.ts'

/** The lock's cover, shared with the placeholder shown while the lock's code loads, so the two look the same. */
export const lockCover = stylex.create({
  // Opaque: nothing of the screen behind (patients, drafts) shows through. It scrolls if the card is taller.
  cover: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: layer.lock,
    display: 'grid',
    placeItems: 'center',
    overflowY: 'auto',
    padding: space.lg,
    backgroundColor: color.canvas,
    backgroundImage: `radial-gradient(900px 360px at 50% -80px, color-mix(in srgb, ${color.accent} 16%, transparent), transparent)`,
  },
})
