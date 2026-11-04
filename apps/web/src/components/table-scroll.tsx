import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { scrollName } from '../lib/legend.ts'
import { ui } from './ui.styles.ts'

/**
 * A wide table's own scroll region (DESIGN.md 5.18): the page never scrolls sideways, this does. Focusable, labelled
 * `… scrolls sideways`, with the focus ring.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" tabIndex={0} aria-label={scrollName(label)} {...stylex.props(s.scroll, ui.focus)}>
      {children}
    </div>
  )
}

const s = stylex.create({
  scroll: { overflowX: 'auto', maxWidth: '100%', minWidth: 0, overscrollBehaviorX: 'contain' },
})
