/** The "Model accuracy" section (web/ward "Model accuracy view"): outcome bars or the kinds table, one class table, and stat lines. Lazy chunk. */
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { ModelQuality } from '@meniscus/shared'
import {
  CLASS_PICKS,
  MODEL_VIEW_DEFAULT,
  NO_READS_TEXT,
  classRows,
  correctionsText,
  emptyText,
  hasReads,
  kindRows,
  mealFluidText,
  negativesText,
  portionText,
  positivesText,
  volumeText,
  type ClassPick,
  type ModelView,
  type Table,
} from '../lib/model-accuracy.ts'
import { color, layer, radius, space, text, weight } from '../tokens.stylex.ts'
import { SelectField } from './form-fields.tsx'
import { ChartIcon } from './icons.tsx'
import { OutcomeBars } from './outcome-bars.tsx'
import { Segmented } from './segmented.tsx'
import { Section } from './ui.tsx'
import { ui } from './ui.styles.ts'

const WIDE = '@media (min-width: 900px)'
const VIEWS = [
  ['chart', 'Chart'],
  ['table', 'Table'],
] as const

/** `subtitle`: the window, `Last 7 days` on a ward or `All wards · Last 7 days` for the hospital. No request of its own. */
export default function ModelAccuracy({ q, subtitle = 'Last 7 days' }: { q: ModelQuality; subtitle?: string }) {
  // Kept while the view stays open; switching builds rows from the one summary, so it sends nothing.
  const [view, setView] = useState<ModelView>(MODEL_VIEW_DEFAULT)
  const [pick, setPick] = useState<ClassPick>(CLASS_PICKS[0].id)
  const pickLabel = CLASS_PICKS.find((p) => p.id === pick)!.label
  const portion = pick === 'dish_portion' ? q.dish_portion : pick === 'meal_portion' ? q.meal_portion : null
  const mealFluid = mealFluidText(q)
  return (
    <Section icon={<ChartIcon />} title="Model accuracy" subtitle={subtitle}>
      {!hasReads(q) ? (
        <p {...stylex.props(ui.muted)}>{NO_READS_TEXT}</p>
      ) : (
        <div {...stylex.props(ui.stack)}>
          <p {...stylex.props(ui.muted)}>What staff did with each AI draft: agreement, not measured truth.</p>
          <div>
            {/* DESIGN.md 4.8 asks 44 px; Segmented's lg is 40 px until the polish change. */}
            <Segmented label="Model accuracy view" value={view} options={VIEWS} onChange={setView} size="lg" />
          </div>
          {view === 'chart' ? <OutcomeBars q={q} /> : <RateTable label="Read kinds" table={kindRows(q)} empty={NO_READS_TEXT} />}
          <SelectField label="Table" value={pick} options={CLASS_PICKS} onChange={setPick} />
          {portion && portion.of > 0 && <p {...stylex.props(s.line)}>{portionText(portion)}</p>}
          <RateTable label={pickLabel} table={classRows(pick, q)} empty={emptyText(pick, q)} />
          <p {...stylex.props(s.line)}>{volumeText(q.volume, q.tolerance_ml)}</p>
          <p {...stylex.props(s.line)}>{negativesText(q.negatives)}</p>
          <p {...stylex.props(s.line)}>{positivesText(q.positives)}</p>
          {mealFluid && <p {...stylex.props(s.line)}>{mealFluid}</p>}
          <p {...stylex.props(s.line)}>{correctionsText(q)}</p>
        </div>
      )}
    </Section>
  )
}

function RateTable({ label, table, empty }: { label: string; table: Table; empty: string }) {
  const [first, ...rest] = table.headers
  return (
    <div role="region" tabIndex={0} aria-label={`${label}, scrolls sideways`} {...stylex.props(s.scroll)}>
      <table {...stylex.props(s.table)}>
        <thead>
          <tr>
            <th scope="col" {...stylex.props(s.sticky, s.th)}>
              {first}
            </th>
            {rest.map((h) => (
              <th key={h} scope="col" {...stylex.props(s.th, s.num)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 ? (
            <tr>
              <td colSpan={table.headers.length} {...stylex.props(s.td, s.empty)}>
                {empty}
              </td>
            </tr>
          ) : (
            table.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" {...stylex.props(s.td, s.rowHead, s.sticky)}>
                  {r.label}
                </th>
                {r.cells.map((c, i) => (
                  <td key={i} {...stylex.props(s.td, s.num)}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

const s = stylex.create({
  scroll: {
    overflowX: 'auto',
    maxWidth: '100%',
    borderRadius: radius.md,
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
  },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: text.sm, color: color.fg },
  th: {
    paddingBlock: space.sm,
    paddingInline: { default: space.md, [WIDE]: space.lg },
    backgroundColor: color.subtle,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    textAlign: 'left',
    fontSize: text.xs,
    fontWeight: weight.bold,
    letterSpacing: '0.05em',
    color: color.muted,
    whiteSpace: 'nowrap',
  },
  td: {
    paddingBlock: space.md,
    paddingInline: { default: space.md, [WIDE]: space.lg },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  rowHead: { textAlign: 'left', fontWeight: weight.semibold },
  sticky: { position: 'sticky', insetInlineStart: 0, backgroundColor: color.bg, zIndex: layer.appBar },
  num: { textAlign: 'right' },
  empty: { color: color.muted, whiteSpace: 'normal' },
  line: { margin: 0, fontSize: text.sm, color: color.fg, fontVariantNumeric: 'tabular-nums' },
})
