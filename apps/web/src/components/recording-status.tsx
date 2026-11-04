import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { formatElapsed, MAX_RECORDING_MS, type Recording, type RecordingFrame } from '../lib/recorder.ts'
import { color, motion, radius, space, text, weight } from '../tokens.stylex.ts'

const BARS = 16

/** Live elapsed time against the 1:00 limit and the microphone level, so the attendant can see it is hearing them. */
export function RecordingStatus({ rec }: { rec: Recording }) {
  const [f, setF] = useState<RecordingFrame>({ elapsedMs: 0, level: 0 })
  useEffect(() => rec.listen(setF), [rec])
  const lit = Math.round(f.level * BARS)
  const nearEnd = MAX_RECORDING_MS - f.elapsedMs <= 10_000
  return (
    <div {...stylex.props(s.box)}>
      <div {...stylex.props(s.top)}>
        <span aria-hidden {...stylex.props(s.dot)} />
        <span {...stylex.props(s.label)}>Recording</span>
        <span role="timer" aria-label="Recording time" {...stylex.props(s.time, nearEnd && s.timeEnd)}>
          {formatElapsed(f.elapsedMs)}
        </span>
      </div>
      <div aria-hidden {...stylex.props(s.meter)}>
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            {...stylex.props(s.bar, i < lit && s.barOn)}
            style={{ transform: `scaleY(${(30 + (i % 4) * 15 + (i < lit ? 25 : 0)) / 100})` }}
          />
        ))}
      </div>
      <p {...stylex.props(s.hint)}>
        Say what was taken or emptied, e.g. “bed 4 drank 200 mL tea”. Nothing is sent until you stop
        {nearEnd ? '; it stops by itself at 1:00' : ''}.
      </p>
    </div>
  )
}

const pulse = stylex.keyframes({ '0%': { opacity: 1 }, '50%': { opacity: 0.35 }, '100%': { opacity: 1 } })

const s = stylex.create({
  box: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.danger,
    backgroundColor: color.dangerBg,
  },
  top: { display: 'flex', alignItems: 'center', gap: space.md },
  dot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: color.danger,
    animationName: { default: pulse, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1.2s', // motion-ok: the recording pulse, gated by reduced motion (a static dot)
    animationIterationCount: 'infinite',
  },
  label: { fontWeight: weight.bold, color: color.danger, flexGrow: 1 },
  time: { fontSize: text.xl, fontWeight: weight.heavy, fontVariantNumeric: 'tabular-nums', color: color.fg },
  timeEnd: { color: color.danger },
  meter: { display: 'flex', alignItems: 'center', gap: space.sm, height: 36 },
  bar: {
    flexGrow: 1,
    height: '100%',
    borderRadius: radius.sm,
    backgroundColor: color.border,
    transitionProperty: 'transform',
    transitionDuration: motion.control,
  },
  barOn: { backgroundColor: color.danger },
  hint: { fontSize: text.sm, color: color.fg },
})
