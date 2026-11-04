/**
 * The bed review's "Bags" section (DESIGN.md 7.1): an inset panel per period, newest first and open, older ones
 * collapsed, each reading a list row. Nothing is fetched on open; a photo tile opens the full-screen viewer, which loads
 * that photo (one GET). Not shown for a bed with no reading. "Add missed emptying" is the fall prompt's action.
 */
import { lazy, Suspense, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { BagChart } from '@meniscus/shared'
import { bagSections, type PeriodView, type ReadingRow } from '../lib/bags.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { CameraIcon, ChevronRightIcon, DropIcon } from './icons.tsx'
import { Chip, Section } from './ui.tsx'

const PhotoViewer = lazy(() => import('./source-view.tsx').then((m) => ({ default: m.PhotoViewer })))

export function BagPeriods({ bags, now }: { bags: BagChart; now: number }) {
  const sections = bagSections(bags, now)
  if (!sections.length) return null
  return (
    <Section
      icon={<DropIcon />}
      title="Bags"
      subtitle="Periods with a reading in the last 24 hours, newest first. Each reading charts its rise from the bag's baseline."
    >
      {sections.map((b) => (
        <div key={b.container} {...stylex.props(s.bag)}>
          <h3 {...stylex.props(s.bagTitle)}>{b.title}</h3>
          {b.periods.map((p, i) => (
            <Period key={p.key} period={p} first={i === 0} />
          ))}
        </div>
      ))}
    </Section>
  )
}

/** An inset panel: the stat-line header opens and closes it (the newest starts open). */
function Period({ period, first }: { period: PeriodView; first: boolean }) {
  const [open, setOpen] = useState(first)
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} {...stylex.props(s.period)}>
      <summary {...stylex.props(s.header)}>
        <span {...stylex.props(s.chevron, open && s.chevronOpen)}>
          <ChevronRightIcon />
        </span>
        {period.header}
      </summary>
      <ul {...stylex.props(s.rows)}>
        {period.rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>
    </details>
  )
}

/** time | event chip, level and rise, fall and lateness | who, where it was charted, what was left. */
function Row({ row }: { row: ReadingRow }) {
  const [shown, setShown] = useState<number | null>(null)
  const photo = row.photos.find((p) => p.media_id === shown)
  const meta = [row.note, row.by, row.residual].filter(Boolean).join(' · ')
  return (
    <li {...stylex.props(s.row)}>
      <span {...stylex.props(s.time)}>{row.time}</span>
      <div {...stylex.props(s.main)}>
        <div {...stylex.props(s.chips)}>
          <Chip tone="neutral" inset>
            {row.event}
          </Chip>
          <span {...stylex.props(s.change)}>{row.change}</span>
          {row.fall && (
            <>
              <Chip tone="warn" dot>
                {row.fall.chip}
              </Chip>
              <span {...stylex.props(s.fallFrom)}>{row.fall.from}</span>
            </>
          )}
          {row.lateness && (
            <Chip tone="neutral" inset>
              {row.lateness}
            </Chip>
          )}
          {row.anyway && <span {...stylex.props(s.fallFrom)}>{row.anyway}</span>}
        </div>
        {meta && <span {...stylex.props(s.meta)}>{meta}</span>}
        {row.photos.length > 0 && (
          <div {...stylex.props(s.tiles)}>
            {row.photos.map((p) => (
              <button
                key={p.media_id}
                type="button"
                aria-label={/photo/i.test(p.label) ? p.label : `${p.label} photo`}
                onClick={() => setShown(p.media_id)}
                {...stylex.props(s.tile)}
              >
                <CameraIcon size={24} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {photo && (
        <Suspense fallback={null}>
          <PhotoViewer
            src={{ media_id: photo.media_id }}
            evidence={photo.media_id === row.reading.media?.id ? row.reading.evidence : null}
            labeled={photo.labeled ?? null}
            alt={`${photo.label}: ${row.text}`}
            onClose={() => setShown(null)}
          />
        </Suspense>
      )}
    </li>
  )
}

const s = stylex.create({
  bag: { display: 'flex', flexDirection: 'column', gap: space.md },
  bagTitle: { margin: 0, fontSize: text.md, fontWeight: weight.bold },
  period: { borderRadius: radius.md, backgroundColor: color.subtle, paddingInline: space.lg },
  header: {
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    paddingBlock: space.md,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    color: color.fg,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    cursor: 'pointer',
    listStyle: 'none',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  chevron: { display: 'inline-flex', flexShrink: 0, color: color.muted },
  chevronOpen: { transform: 'rotate(90deg)' },
  rows: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none', paddingBottom: space.sm },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.md,
    paddingBlock: space.lg,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  // DESIGN.md 2.2: space.xs (2) once the polish change adds it; aligns the time with the chips' first line.
  time: { width: 44, flexShrink: 0, paddingTop: space.sm, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  main: { display: 'flex', flexDirection: 'column', gap: space.sm, flexGrow: 1, minWidth: 0 },
  chips: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  change: { fontSize: text.md, fontWeight: weight.semibold, color: color.fg, fontVariantNumeric: 'tabular-nums' },
  fallFrom: { fontSize: text.md, color: color.fg, fontVariantNumeric: 'tabular-nums' },
  meta: { fontSize: text.sm, color: color.muted, overflowWrap: 'anywhere' },
  tiles: { display: 'flex', flexWrap: 'wrap', gap: space.md },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    width: 72,
    height: 96,
    padding: space.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    color: color.muted,
    // DESIGN.md 2.3: text.xs (12) once the polish change adds it.
    fontSize: text.sm,
    fontWeight: weight.semibold,
    lineHeight: text.leadingTight,
    overflowWrap: 'anywhere',
    textAlign: 'center',
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
})
