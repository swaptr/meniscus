import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ENTRY_CATEGORIES, ENTRY_SOURCES, type Entry } from '@meniscus/shared'
import { isFlagged } from '../lib/flags.ts'
import { CATEGORY_LABEL, SOURCE_LABEL } from '../lib/labels.ts'
import { logView, shiftLabel, type LogFilter, type LogSort, type SortKey } from '../lib/history.ts'
import { entryRow } from '../lib/rows.ts'
import { shiftBars } from '../lib/shifts.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { DenseRow } from './dense-row.tsx'
import { FlagIcon } from './icons.tsx'
import { Segmented } from './segmented.tsx'
import { ShiftBars } from './shift-bars.tsx'
import { ui } from './ui.styles.ts'
import { f } from './form.styles.ts'
import type { PopoverList } from './use-popover-list.ts'
import { dayMonth } from '../lib/format.ts'

const WIDE = '@media (min-width: 760px)'
const DEFAULT_FILTER: LogFilter = { period: '24h' }

type Column = { key: SortKey; label: string; firstDesc?: boolean }
const COLUMNS: Column[] = [
  { key: 'time', label: 'Time', firstDesc: true },
  { key: 'type', label: 'Type' },
  { key: 'volume', label: 'Volume', firstDesc: true },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Status' },
]

/**
 * The intake and output log (web/ward "Filter and sort the log", "Dense entry rows", "Shift totals drawn in the log"):
 * filters, a sort by column, 25 rows a page, shift headings with their totals drawn on one scale, and one dense row per
 * entry that opens its peek. Local data only.
 */
export function EntryLog({ entries, now, peek }: { entries: Entry[]; now: number; peek?: PopoverList<Entry> }) {
  const [filter, setFilterState] = useState<LogFilter>(DEFAULT_FILTER)
  const [sort, setSortState] = useState<LogSort>({ key: 'time', desc: true })
  const [page, setPage] = useState(0)
  const view = logView(entries, filter, sort, now, page)
  const bars = view.groups ? shiftBars(view.groups.map((g) => g.shift)) : []

  const setFilter = (next: LogFilter) => {
    setFilterState(next)
    setPage(0)
  }
  const set = <K extends keyof LogFilter>(k: K, v: LogFilter[K] | '') => setFilter({ ...filter, [k]: v === '' ? undefined : v })
  const sortBy = (c: Column) => {
    setSortState(sort.key === c.key ? { key: c.key, desc: !sort.desc } : { key: c.key, desc: !!c.firstDesc })
    setPage(0)
  }
  const filtered = Object.entries(filter).some(([k, v]) => v !== undefined && (k !== 'period' || v !== DEFAULT_FILTER.period))
  const flaggedCount = entries.filter(isFlagged).length
  const row = (e: Entry, withDate = false) => {
    const r = entryRow(e)
    return (
      <li key={e.id}>
        <DenseRow
          row={withDate ? { ...r, time: r.time, who: [dayMonth(e.created_at), r.who].filter(Boolean).join(' · ') } : r}
          peek={peek && { list: peek, payload: e }}
        />
      </li>
    )
  }

  return (
    <div {...stylex.props(s.wrap)}>
      <div {...stylex.props(s.filters)} role="search" aria-label="Filter the log">
        <Segmented
          label="Direction"
          value={filter.direction ?? ''}
          options={[
            ['', 'All'],
            ['in', 'In'],
            ['out', 'Out'],
          ]}
          onChange={(v) => set('direction', v)}
        />
        <Segmented
          label="Period"
          value={filter.period ?? 'all'}
          options={[
            ['shift', 'This shift'],
            ['24h', '24 h'],
            ['all', 'All'],
          ]}
          onChange={(v) => set('period', v)}
        />
        <select
          aria-label="Type"
          value={filter.category ?? ''}
          onChange={(e) => set('category', e.target.value as Entry['category'] | '')}
          {...stylex.props(f.input, s.select)}
        >
          <option value="">All types</option>
          {ENTRY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={filter.status ?? ''}
          onChange={(e) => set('status', e.target.value as Entry['status'] | '')}
          {...stylex.props(f.input, s.select)}
        >
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          aria-label="Source"
          value={filter.source ?? ''}
          onChange={(e) => set('source', e.target.value as Entry['source'] | '')}
          {...stylex.props(f.input, s.select)}
        >
          <option value="">Any source</option>
          {ENTRY_SOURCES.map((x) => (
            <option key={x} value={x}>
              {SOURCE_LABEL[x]}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={!!filter.flagged}
          onClick={() => set('flagged', filter.flagged ? undefined : true)}
          {...stylex.props(s.flagToggle, ui.focus, filter.flagged && s.flagOn)}
        >
          <FlagIcon size={16} />
          Flagged only
          <span {...stylex.props(s.flagCount)}>{flaggedCount}</span>
        </button>
        <input
          type="search"
          placeholder="Search item or note"
          aria-label="Search item or note"
          value={filter.text ?? ''}
          onChange={(e) => set('text', e.target.value)}
          {...stylex.props(f.input, s.search)}
        />
      </div>

      <div {...stylex.props(s.card)}>
        <div {...stylex.props(s.bar)}>
          <span aria-live="polite" {...stylex.props(s.count)}>
            {view.count} entries
          </span>
          {filtered && (
            <button type="button" onClick={() => setFilter(DEFAULT_FILTER)} {...stylex.props(s.clear, ui.focus)}>
              Clear filters
            </button>
          )}
          <span {...stylex.props(ui.grow)} />
          <div role="group" aria-label="Sort the log by" {...stylex.props(s.sorts)}>
            {COLUMNS.map((c) => {
              const active = sort.key === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Sort by ${c.label.toLowerCase()}${active ? (sort.desc ? ', descending' : ', ascending') : ''}`}
                  onClick={() => sortBy(c)}
                  {...stylex.props(s.sortBtn, ui.focus, active && s.sortOn)}
                >
                  {c.label}
                  <span aria-hidden {...stylex.props(s.arrow, !active && s.arrowIdle)}>
                    {active ? (sort.desc ? '▼' : '▲') : '▲▼'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {view.rows.length === 0 ? (
          <p {...stylex.props(s.empty)}>No entries match these filters.</p>
        ) : view.groups ? (
          view.groups.map((g, i) => (
            <section key={g.shift.start} aria-label={shiftLabel(g.shift)}>
              <header {...stylex.props(s.shift)}>
                <h3 {...stylex.props(s.shiftTitle)}>{shiftLabel(g.shift)}</h3>
                <ShiftBars bar={bars[i]!} />
              </header>
              <ul {...stylex.props(s.rows)}>{g.rows.map((e) => row(e))}</ul>
            </section>
          ))
        ) : (
          <ul {...stylex.props(s.rows)}>{view.rows.map((e) => row(e, true))}</ul>
        )}

        <nav aria-label="Log pages" {...stylex.props(s.pager)}>
          <span {...stylex.props(s.range)}>Rows {view.page.range}</span>
          <span {...stylex.props(ui.grow)} />
          <Button variant="secondary" disabled={view.page.index === 0} onClick={() => setPage(view.page.index - 1)}>
            ‹ Prev
          </Button>
          <span {...stylex.props(s.pageNo)}>
            {view.page.index + 1} / {view.page.pages}
          </span>
          <Button variant="secondary" disabled={view.page.index >= view.page.pages - 1} onClick={() => setPage(view.page.index + 1)}>
            Next ›
          </Button>
        </nav>
      </div>
    </div>
  )
}

const s = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 },
  filters: { display: 'flex', flexWrap: 'wrap', gap: space.md, alignItems: 'center' },
  select: { width: 'auto', flexGrow: { default: 1, [WIDE]: 0 } },
  search: { width: 'auto', flexGrow: 1, flexBasis: 200 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    overflow: 'hidden',
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
    minHeight: 44,
    paddingInline: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  count: { fontSize: text.sm, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  clear: {
    minHeight: 44,
    paddingInline: space.sm,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: color.accent,
    font: 'inherit',
    fontSize: text.sm,
    fontWeight: weight.semibold,
    cursor: 'pointer',
    textDecorationLine: 'underline',
  },
  sorts: { display: 'flex', flexWrap: 'wrap', gap: space.xs },
  sortBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    minWidth: 44,
    paddingInline: space.sm,
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    color: { default: color.muted, ':hover': color.fg },
    font: 'inherit',
    fontSize: text.xs,
    fontWeight: weight.semibold,
    cursor: 'pointer',
  },
  sortOn: { color: color.accent },
  arrow: { fontSize: text.xs },
  arrowIdle: { opacity: 0.35 },
  shift: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.lg,
    minHeight: 44,
    paddingBlock: space.sm,
    paddingInline: space.md,
    backgroundColor: color.subtle,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.grid,
  },
  shiftTitle: { margin: 0, fontSize: text.sm, fontWeight: weight.bold },
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  empty: { margin: 0, padding: space.xl, fontSize: text.sm, color: color.muted, textAlign: 'center' },
  flagToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    font: 'inherit',
    fontSize: text.sm,
    fontWeight: weight.semibold,
    cursor: 'pointer',
  },
  flagOn: { borderColor: color.warnText, backgroundColor: { default: color.warnBg, ':hover': color.warnBg }, color: color.warnText },
  flagCount: {
    minWidth: 20,
    paddingInline: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.warnBg,
    color: color.warnText,
    fontSize: text.xs,
    fontWeight: weight.heavy,
    textAlign: 'center',
  },
  pager: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
    padding: space.md,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  range: { fontSize: text.sm, color: color.muted, fontWeight: weight.semibold, fontVariantNumeric: 'tabular-nums' },
  pageNo: { fontSize: text.sm, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'center' },
})
