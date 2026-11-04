/**
 * The one row for a timed entry (DESIGN.md 5.7; web/ward "Dense entry rows"): one line at 44 px or more, the whole row
 * one button opening the entry's peek, with the row's own actions (Reject…, Approve) as siblings after it, never only
 * in the peek. Rejected volumes are struck through and the status says so.
 */
import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { EntryRow } from '../lib/rows.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { DrinkIcon } from './drink-label.tsx'
import { PopoverTrigger } from './popover.tsx'
import { Chip } from './ui.tsx'
import type { PopoverList } from './use-popover-list.ts'

const PHONE = '@media (max-width: 640px)'

type Props<P> = {
  row: EntryRow
  /** The list's peek and this row's payload; without, the row is static. */
  peek?: { list: PopoverList<P>; payload: P }
  /** The row's own actions: always visible. */
  actions?: ReactNode
}

export function DenseRow<P>({ row, peek, actions }: Props<P>) {
  const body = (
    <>
      <span {...stylex.props(s.time)}>{row.time}</span>
      <span {...stylex.props(s.what)}>
        <span aria-hidden {...stylex.props(row.glyph === '▲' ? s.in : s.out)}>
          {row.glyph}
        </span>
        {row.drink && (
          <span {...stylex.props(s.icon)}>
            <DrinkIcon kind={row.drink} size={14} />
          </span>
        )}
        <span {...stylex.props(s.kind)}>{row.kind}</span>
        <span {...stylex.props(s.volume, row.struck && s.struck)}>{row.volume}</span>
      </span>
      <span {...stylex.props(s.meta)}>
        <Chip tone={row.source.tone}>{row.source.text}</Chip>
        {row.name && (
          <span translate="no" {...stylex.props(s.name)}>
            {row.name}
          </span>
        )}
        {row.who && (
          <span {...stylex.props(s.who)}>
            {row.name && <span aria-hidden>· </span>}
            {row.who}
          </span>
        )}
      </span>
      <span {...stylex.props(s.status)}>
        <Chip tone={row.status.tone} glyph>
          {row.status.text}
        </Chip>
      </span>
    </>
  )
  return (
    <div {...stylex.props(s.row)}>
      {peek ? (
        <PopoverTrigger list={peek.list} payload={peek.payload} label={row.label} xstyle={[s.main, s.button]} openStyle={s.open}>
          {body}
        </PopoverTrigger>
      ) : (
        <div {...stylex.props(s.main)}>{body}</div>
      )}
      {actions && <div {...stylex.props(s.actions)}>{actions}</div>}
    </div>
  )
}

const s = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: { default: 'nowrap', [PHONE]: 'wrap' },
    gap: space.md,
    minHeight: 44,
    paddingInline: space.sm,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.grid,
  },
  main: {
    display: 'grid',
    gridTemplateColumns: { default: '48px 196px minmax(0, 1fr) auto', [PHONE]: '48px minmax(0, 1fr) auto' },
    gridTemplateAreas: { default: '"time what meta status"', [PHONE]: '"time what what" ". meta status"' },
    alignItems: 'center',
    columnGap: space.md,
    rowGap: space.xs,
    flexGrow: 1,
    minWidth: 0,
    minHeight: 44,
    paddingBlock: space.sm,
    paddingInline: space.sm,
    color: color.fg,
    fontSize: text.sm,
  },
  button: {
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    touchAction: 'pan-y',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  open: { backgroundColor: color.subtle, boxShadow: `inset 2px 0 0 ${color.accent}` },
  time: {
    gridColumnEnd: 'time',
    gridColumnStart: 'time',
    gridRowEnd: 'time',
    gridRowStart: 'time',
    fontWeight: weight.bold,
    fontVariantNumeric: 'tabular-nums',
  },
  what: {
    gridColumnEnd: 'what',
    gridColumnStart: 'what',
    gridRowEnd: 'what',
    gridRowStart: 'what',
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    minWidth: 0,
  },
  in: { color: color.intake, fontSize: text.xs },
  out: { color: color.output, fontSize: text.xs },
  icon: { display: 'inline-flex', color: color.intakeText },
  kind: { fontWeight: weight.semibold },
  volume: {
    marginInlineStart: 'auto',
    paddingInlineStart: space.sm,
    fontSize: text.md,
    fontWeight: weight.bold,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  struck: { textDecorationLine: 'line-through', color: color.muted },
  meta: {
    gridColumnEnd: 'meta',
    gridColumnStart: 'meta',
    gridRowEnd: 'meta',
    gridRowStart: 'meta',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: space.sm,
    minWidth: 0,
    overflow: 'hidden',
    color: color.muted,
  },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: color.fg, minWidth: 0 },
  who: { whiteSpace: 'nowrap', flexShrink: 0 },
  status: { gridColumnEnd: 'status', gridColumnStart: 'status', gridRowEnd: 'status', gridRowStart: 'status', justifySelf: 'end' },
  actions: { display: 'flex', gap: space.md, flexShrink: 0, marginInlineStart: 'auto' },
})
