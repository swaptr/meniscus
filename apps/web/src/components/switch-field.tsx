/**
 * The one on/off switch (DESIGN.md 4.8): a 44×26 track inside a 44 px label, off `borderStrong`, on `accent`,
 * 120 ms and 0 under reduced motion. For an independent on/off that applies at once or to one draft.
 */
import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Switch } from '@base-ui/react/switch'
import { color, layout, motion, radius, space, text, weight } from '../tokens.stylex.ts'
import { ui } from './ui.styles.ts'

export function SwitchField({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label {...stylex.props(s.label)}>
      <Switch.Root checked={checked} onCheckedChange={onChange} {...stylex.props(s.track, ui.focus, checked && s.trackOn)}>
        <Switch.Thumb {...stylex.props(s.thumb, checked && s.thumbOn)} />
      </Switch.Root>
      <span>{children}</span>
    </label>
  )
}

const s = stylex.create({
  label: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.tap,
    fontSize: text.md,
    fontWeight: weight.semibold,
    cursor: 'pointer',
  },
  track: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    width: 44,
    height: 26,
    padding: space.xs,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: color.borderStrong,
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: motion.control,
    transitionTimingFunction: motion.ease,
  },
  trackOn: { backgroundColor: color.accent },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: color.bg,
    transitionProperty: 'transform',
    transitionDuration: motion.control,
    transitionTimingFunction: motion.ease,
  },
  thumbOn: { transform: 'translateX(18px)' },
})
