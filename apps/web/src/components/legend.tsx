import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { wardLegend } from '../lib/legend.ts'
import { Chip } from './ui.tsx'

/** Rows of a key and its words (DESIGN.md 5.13), wrapping; never a row of sentence chips. */
export function Legend({ title, rows }: { title?: string; rows: readonly { key: ReactNode; text: ReactNode }[] }) {
  return (
    <div {...stylex.props(s.wrap)}>
      {title && <span {...stylex.props(s.title)}>{title}</span>}
      <dl {...stylex.props(s.list)}>
        {rows.map((r, i) => (
          <div key={i} {...stylex.props(s.row)}>
            <dt {...stylex.props(s.key)}>{r.key}</dt>
            <dd {...stylex.props(s.text)}>{r.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** The ward's status key: one row per tone with every prompt kind of that tone, bag prompts included. */
export function WardLegend() {
  return (
    <Legend
      title="Bed status"
      rows={wardLegend().map((r) => ({
        key: (
          <Chip tone={r.tone} glyph>
            {r.label}
          </Chip>
        ),
        text: r.kinds.join(', '),
      }))}
    />
  )
}

/** A 10 px swatch for chart legends. */
export function Swatch({ fill }: { fill: string }) {
  return <span aria-hidden {...stylex.props(s.swatch)} style={{ backgroundColor: fill }} />
}

const s = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.sm, minWidth: 0 },
  title: { fontSize: text.xs, fontWeight: weight.bold, color: color.muted },
  list: { display: 'flex', flexDirection: 'column', gap: space.sm, margin: 0 },
  row: { display: 'grid', gridTemplateColumns: 'minmax(96px, max-content) 1fr', gap: space.md, alignItems: 'baseline' },
  key: { margin: 0 },
  text: { margin: 0, fontSize: text.xs, color: color.muted, lineHeight: text.leading, minWidth: 0 },
  swatch: { display: 'inline-block', width: 10, height: 10, borderRadius: radius.sm, flexShrink: 0 },
})
