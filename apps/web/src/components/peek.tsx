/**
 * Peek: a floating card of detail about one row, tile, chart mark or figure (DESIGN.md 5.1; web/interface "Peeks open
 * by hover, tap and keyboard"). Built on `popover.tsx`: one `usePopoverList()` (use-popover-list.ts) per list, a `PeekTrigger` per row, one `Peek`
 * rendering the open row's payload. Up to 640 px wide it is a bottom sheet with a Close button. Content components
 * are passed in by the screen, which lazy-loads them per peek kind.
 */
import { Suspense, useSyncExternalStore, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { SHEET_MAX } from '../lib/peek.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { PopoverRoot, PopoverTrigger } from './popover.tsx'
import type { PopoverList } from './use-popover-list.ts'

const sheetQuery = typeof matchMedia === 'function' ? matchMedia(`(max-width: ${SHEET_MAX}px)`) : null
const subscribeSheet = (fn: () => void) => {
  sheetQuery?.addEventListener('change', fn)
  return () => sheetQuery?.removeEventListener('change', fn)
}
const isSheet = () => sheetQuery?.matches ?? false

export type { PopoverList as PeekList }

export { PopoverTrigger as PeekTrigger }

type PeekProps<P> = {
  list: PopoverList<P>
  /** The peek's accessible name for a payload, e.g. `Entry 14:05`. */
  title: (payload: P) => string
  children: (payload: P) => ReactNode
  /** Height the lazy content reserves while its chunk loads. */
  minHeight?: number
}

export function Peek<P>({ list, title, children, minHeight = 160 }: PeekProps<P>) {
  const sheet = useSyncExternalStore(subscribeSheet, isSheet)
  return (
    <PopoverRoot list={list} popupLabel={title} sheet={sheet}>
      {(p) => <Suspense fallback={<div aria-busy {...stylex.props(s.reserve(minHeight))} />}>{children(p)}</Suspense>}
    </PopoverRoot>
  )
}

/** Head: title (`md`/700) and an end slot (the status chip). */
export function PeekHead({ title, end, sub }: { title: ReactNode; end?: ReactNode; sub?: ReactNode }) {
  return (
    <div {...stylex.props(s.head)}>
      <div {...stylex.props(s.headText)}>
        <p {...stylex.props(s.title)}>{title}</p>
        {sub && <p {...stylex.props(s.sub)}>{sub}</p>}
      </div>
      {end}
    </div>
  )
}

/** Compact facts: label and value pairs. */
export function PeekFacts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl {...stylex.props(s.facts)}>
      {rows.map(([k, v]) => (
        <div key={k} {...stylex.props(s.fact)}>
          <dt {...stylex.props(s.factKey)}>{k}</dt>
          <dd {...stylex.props(s.factValue)}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Lines of text, one per fact (`Low urine output: review`). */
export function PeekLines({ lines }: { lines: readonly string[] }) {
  return (
    <ul {...stylex.props(s.lines)}>
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  )
}

/** At most two actions, right-aligned, the primary last. */
export function PeekFoot({ children }: { children: ReactNode }) {
  return <div {...stylex.props(s.foot)}>{children}</div>
}

const s = stylex.create({
  reserve: (h: number) => ({ minHeight: h }),
  head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md },
  headText: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  title: { margin: 0, fontSize: text.md, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  sub: { margin: 0, fontSize: text.sm, color: color.muted },
  facts: { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: space.lg, rowGap: space.xs, margin: 0 },
  fact: { display: 'contents' },
  factKey: { fontSize: text.xs, fontWeight: weight.semibold, color: color.muted, alignSelf: 'baseline' },
  factValue: { margin: 0, fontSize: text.sm, fontVariantNumeric: 'tabular-nums', alignSelf: 'baseline', minWidth: 0 },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
  foot: { display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: space.md },
})
