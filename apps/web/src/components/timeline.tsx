import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StepKind, TimelineStep } from '../lib/timeline.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { CheckIcon, ClockIcon, DropIcon, PencilIcon, SparkIcon, UserIcon, XIcon } from './icons.tsx'
import type { Tone } from './ui.tsx'
import { solids, tints } from './ui.styles.ts'

const KIND_LABEL: Record<StepKind, string> = {
  capture: 'Captured',
  model: 'AI step',
  check: 'Cross-check',
  save: 'Saved',
  review: 'Review',
  amend: 'Amended',
  wait: 'Waiting',
}

function icon(step: TimelineStep): ReactNode {
  switch (step.kind) {
    case 'capture':
      return <UserIcon size={14} />
    case 'model':
      return <SparkIcon size={14} />
    case 'check':
      return step.tone === 'ok' ? <CheckIcon size={14} /> : <XIcon size={14} />
    case 'save':
      return <DropIcon size={14} />
    case 'review':
      return step.tone === 'danger' ? <XIcon size={14} /> : step.tone === 'warn' ? <PencilIcon size={14} /> : <CheckIcon size={14} />
    case 'amend':
      return <PencilIcon size={14} />
    case 'wait':
      return <ClockIcon size={14} />
  }
}

const solid = (t: Tone) => t === 'warn' || t === 'danger' || t === 'ok' || t === 'pending'

/** Vertical rail, oldest first. People's steps carry a time; model steps carry how long they took. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol {...stylex.props(s.list)}>
      {steps.map((step, i) => (
        <li key={i} {...stylex.props(s.item)}>
          <span aria-hidden {...stylex.props(s.rail, i === steps.length - 1 && s.railEnd)} />
          <span aria-hidden {...stylex.props(s.dot, solid(step.tone) ? solids[step.tone] : tints[step.tone])}>
            {icon(step)}
          </span>
          <div {...stylex.props(s.body, step.kind === 'model' && s.modelBody)}>
            <span {...stylex.props(s.kind)}>
              {KIND_LABEL[step.kind]}
              {step.time && <span {...stylex.props(s.time)}>{step.time}</span>}
            </span>
            <span {...stylex.props(s.text, (step.kind === 'review' || step.kind === 'amend') && s.strong)}>{step.text}</span>
          </div>
          {step.detail && <span {...stylex.props(s.detail)}>{step.detail}</span>}
        </li>
      ))}
    </ol>
  )
}

const DOT = 26

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column', listStyle: 'none' },
  item: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.md,
    paddingBottom: space.lg,
  },
  rail: {
    position: 'absolute',
    top: DOT,
    bottom: 0,
    left: DOT / 2 - 1,
    width: 2,
    backgroundColor: color.border,
  },
  railEnd: { display: 'none' },
  dot: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    flexShrink: 0,
    boxShadow: `0 0 0 3px ${color.bg}`,
  },
  body: { display: 'flex', flexDirection: 'column', gap: space.xs, flexGrow: 1, minWidth: 0, paddingTop: space.xs },
  modelBody: {
    paddingBlock: space.sm,
    paddingInline: space.md,
    marginTop: -2,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
  },
  kind: {
    display: 'flex',
    gap: space.md,
    fontSize: text.xs,
    fontWeight: weight.bold,
    letterSpacing: '0.05em',
    color: color.muted,
  },
  time: { color: color.fg, fontVariantNumeric: 'tabular-nums' },
  text: { fontSize: text.md, overflowWrap: 'anywhere' },
  strong: { fontWeight: weight.semibold },
  detail: {
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.muted,
    fontVariantNumeric: 'tabular-nums',
    paddingTop: space.sm,
    flexShrink: 0,
  },
})
