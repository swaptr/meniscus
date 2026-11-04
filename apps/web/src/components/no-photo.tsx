import * as stylex from '@stylexjs/stylex'
import { color, radius } from '../tokens.stylex.ts'
import { NoPhotoIcon } from './icons.tsx'

/**
 * A photo box that has not loaded or failed (web/interface "No blank media boxes"): the no-photo icon centred at the
 * photo's aspect ratio, never an empty grey box.
 */
export function NoPhoto({ aspect = '4 / 3', label = 'Photo loading' }: { aspect?: string; label?: string }) {
  return (
    <span role="img" aria-label={label} {...stylex.props(s.box)} style={{ aspectRatio: aspect }}>
      <NoPhotoIcon size={24} aria-hidden />
    </span>
  )
}

const s = stylex.create({
  box: {
    display: 'grid',
    placeItems: 'center',
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    color: color.muted,
  },
})
