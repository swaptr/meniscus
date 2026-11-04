import * as stylex from '@stylexjs/stylex'
import { color, layout, motion, radius, space, text, weight } from '../tokens.stylex.ts'
import { ui } from './ui.styles.ts'

/** Switch a view or filter in place (DESIGN.md 5.14): 44 px options on a `subtle` track with a `borderStrong` edge. */
export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  label: string
  value: V
  options: readonly (readonly [V, string])[]
  onChange: (v: V) => void
  size?: 'md' | 'lg'
}) {
  return (
    <div role="group" aria-label={label} {...stylex.props(s.group)}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          {...stylex.props(s.seg, ui.focus, size === 'lg' && s.lg, value === v && s.on)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

const s = stylex.create({
  group: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    padding: space.xs,
    gap: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    maxWidth: '100%',
  },
  seg: {
    // Each option is a full 44 px target (web/interface "Targets big enough for gloved hands"); the track grows.
    minHeight: layout.tap,
    minWidth: layout.tap,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: radius.sm,
    backgroundColor: { default: 'transparent', ':hover': color.bg },
    color: color.muted,
    fontFamily: 'inherit',
    fontWeight: weight.semibold,
    fontSize: text.sm,
    cursor: 'pointer',
    transitionProperty: 'background-color, color',
    transitionDuration: motion.control,
    transitionTimingFunction: motion.ease,
  },
  lg: { fontSize: text.md },
  on: { backgroundColor: { default: color.bg, ':hover': color.bg }, borderColor: color.border, color: color.fg },
})
