import { lazy, Suspense } from 'react'
import { TableScroll } from './table-scroll.tsx'
import { Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { REJECT_REASONS, type ModelQuality, type StaffRef, type WardQuality } from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import { dataQualityLoad } from '../lib/model-accuracy.ts'
import { REJECT_LABEL } from '../lib/labels.ts'
import { flaggedRows, QUIET_TEXT, qualityTiles } from '../lib/quality.ts'
import { ROLE_LABEL } from '../lib/staff.ts'
import { useResource } from '../lib/use-resource.ts'
import { ChevronRightIcon, FlagIcon, ReviewIcon, UserIcon, XIcon } from './icons.tsx'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Chip, Notice, Section, ToneGlyph } from './ui.tsx'
import { Peek, PeekHead, PeekLines, PeekTrigger } from './peek.tsx'
import { usePopoverList } from './use-popover-list.ts'
import { tileByRecorder } from '../lib/quality-peek.ts'
import { ui } from './ui.styles.ts'
import { UrineSwatch } from './urine-swatch.tsx'
import { dayLabelClock } from '../lib/format.ts'

const when = (iso: string) => dayLabelClock(iso)
const name = (s: StaffRef | null) => s?.name ?? 'Not recorded'

/** Its own chunk: the tables of the Model accuracy section. */
const ModelAccuracy = lazy(() => import('./model-accuracy.tsx'))

/**
 * Ward data quality, last 7 days: what was fixed after the fact, and by whom, then the model accuracy. Exactly two reads
 * (the ward summary and the model summary), in parallel; no model request. Loaded lazily.
 */
export function WardQualityView({ wardId }: { wardId: number }) {
  const q = useResource(`quality:${wardId}`, (signal) => dataQualityLoad(api, wardId, signal))
  if (q.error && !q.data) return <Notice tone="danger">{errorText(q.error)}</Notice>
  if (!q.data) {
    return (
      <p role="status" {...stylex.props(ui.muted)}>
        Loading data quality…
      </p>
    )
  }
  return <Quality q={q.data.quality} model={q.data.model} />
}

function Quality({ q, model }: { q: WardQuality; model: ModelQuality }) {
  const peek = usePopoverList<{ label: string; value: string; lines: string[] }>()
  const rows = flaggedRows(q)
  const reasons = REJECT_REASONS.filter((r) => q.rejected_by_reason[r])
  const unspecified = q.rejected_by_reason.unspecified ?? 0
  return (
    <div {...stylex.props(ui.stack)}>
      <p {...stylex.props(ui.muted)}>
        Last 7 days of charting on this ward, from the entries' own history. For charting quality, not performance review.
      </p>
      <ul aria-label="Data quality, last 7 days" {...stylex.props(s.tiles)}>
        {qualityTiles(q.totals).map((t) => {
          const lines = tileByRecorder(q, t.label)
          const body = (
            <>
              <span {...stylex.props(s.tileLabel)}>{t.label}</span>
              <span {...stylex.props(s.tileValue)}>
                {t.tone !== 'neutral' && t.tone !== 'info' && <ToneGlyph tone={t.tone} size={16} />}
                {t.value}
              </span>
            </>
          )
          return (
            <li key={t.label} {...stylex.props(s.tileCell)}>
              {lines ? (
                <PeekTrigger
                  list={peek}
                  label={`${t.label} ${t.value}, by recorder`}
                  payload={{ label: t.label, value: t.value, lines }}
                  xstyle={[s.tile, s.tileBtn, ui.focus]}
                  openStyle={s.tileOpen}
                >
                  {body}
                </PeekTrigger>
              ) : (
                <span {...stylex.props(s.tile)}>{body}</span>
              )}
            </li>
          )
        })}
      </ul>
      <Peek list={peek} title={(p) => `${p.label} by recorder`} minHeight={80}>
        {(p) => (
          <div {...stylex.props(s.peek)}>
            <PeekHead title={`${p.label} · ${p.value}`} sub="By recorder, last 7 days" />
            {p.lines.length ? <PeekLines lines={p.lines} /> : <p {...stylex.props(ui.muted)}>None in the last 7 days.</p>}
          </div>
        )}
      </Peek>

      <Section
        icon={<FlagIcon />}
        title="Flagged entries"
        subtitle="Corrected, amended, late or rejected. Newest first; each opens its bed."
      >
        {rows.length === 0 ? (
          <p {...stylex.props(ui.muted)}>{QUIET_TEXT}</p>
        ) : (
          <ul {...stylex.props(s.flagged)}>
            {rows.map((r) => (
              <li key={r.key}>
                <Link to={r.href} {...stylex.props(s.flagRow)}>
                  <span {...stylex.props(s.flagBed)}>Bed {r.bed}</span>
                  <span {...stylex.props(s.flagMain)}>
                    <span {...stylex.props(s.flagWho)}>{r.patient}</span>
                    <span {...stylex.props(s.flagWhen)}>
                      {when(r.charted)} · {r.what}
                    </span>
                    {r.swatch && <UrineSwatch swatch={r.swatch} size="sm" />}
                  </span>
                  <span {...stylex.props(s.flagBadges)}>
                    {r.badges.map((b) => (
                      <Chip key={b.text} tone={b.tone}>
                        {b.text}
                      </Chip>
                    ))}
                  </span>
                  <ChevronRightIcon size={20} aria-hidden {...stylex.props(s.chev)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div {...stylex.props(s.pair)}>
        <Section icon={<UserIcon />} title="By recorder" subtitle="Who charted the entries, and how many were fixed later.">
          <TableScroll label="Entries by recorder">
            <table {...stylex.props(s.table)}>
              <thead>
                <tr>
                  <th scope="col" {...stylex.props(s.th)}>
                    Staff
                  </th>
                  {['Entries', 'Corrected', 'Amended', 'Late', 'Rejected'].map((h) => (
                    <th key={h} scope="col" {...stylex.props(s.th, s.num)}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.recorders.map((r) => (
                  <tr key={r.staff?.id ?? 0}>
                    <th scope="row" {...stylex.props(s.td, s.staff)}>
                      {name(r.staff)}
                      {r.staff && <span {...stylex.props(s.role)}>{ROLE_LABEL[r.staff.role]}</span>}
                    </th>
                    {[r.recorded, r.corrected, r.amended, r.late, r.rejected].map((n, i) => (
                      <td key={i} {...stylex.props(s.td, s.num, i > 0 && n > 0 && s.hot)}>
                        {n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Section>
        <div {...stylex.props(ui.stack)}>
          <Section icon={<ReviewIcon />} title="By reviewer">
            {q.reviewers.length === 0 ? (
              <p {...stylex.props(ui.muted)}>No reviews yet.</p>
            ) : (
              <table {...stylex.props(s.table)}>
                <thead>
                  <tr>
                    <th scope="col" {...stylex.props(s.th)}>
                      Staff
                    </th>
                    <th scope="col" {...stylex.props(s.th, s.num)}>
                      Reviewed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.reviewers.map((r) => (
                    <tr key={r.staff?.id ?? 0}>
                      <th scope="row" {...stylex.props(s.td, s.staff)}>
                        {name(r.staff)}
                        {r.staff && <span {...stylex.props(s.role)}>{ROLE_LABEL[r.staff.role]}</span>}
                      </th>
                      <td {...stylex.props(s.td, s.num)}>{r.reviewed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          <Section icon={<XIcon />} title="Rejections by reason">
            {reasons.length === 0 && !unspecified ? (
              <p {...stylex.props(ui.muted)}>No rejections.</p>
            ) : (
              <div {...stylex.props(ui.row)}>
                {reasons.map((r) => (
                  <Chip key={r} tone="danger">
                    {REJECT_LABEL[r]} · {q.rejected_by_reason[r]}
                  </Chip>
                ))}
                {unspecified > 0 && <Chip tone="neutral">No reason given · {unspecified}</Chip>}
              </div>
            )}
          </Section>
        </div>
      </div>

      <Suspense
        fallback={
          <p role="status" {...stylex.props(ui.muted)}>
            Loading model accuracy…
          </p>
        }
      >
        <ModelAccuracy q={model} />
      </Suspense>
    </div>
  )
}

const WIDE = '@media (min-width: 900px)'

const s = stylex.create({
  tiles: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    overflow: 'hidden',
  },
  tileCell: { display: 'flex', borderInlineEndWidth: 1, borderInlineEndStyle: 'solid', borderInlineEndColor: color.grid },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.xs,
    width: '100%',
    minHeight: 72,
    paddingBlock: space.md,
    paddingInline: space.lg,
    color: color.fg,
    textAlign: 'start',
  },
  tileBtn: {
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  tileOpen: { backgroundColor: color.subtle, boxShadow: `inset 0 -2px 0 ${color.accent}` },
  tileLabel: { fontSize: text.xs, fontWeight: weight.semibold, color: color.muted },
  tileValue: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: text.xl,
    fontWeight: weight.bold,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
  },
  peek: { display: 'flex', flexDirection: 'column', gap: space.md },
  flagged: { display: 'flex', flexDirection: 'column', listStyle: 'none' },
  flagRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.sm,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
    borderRadius: radius.md,
    color: color.fg,
    textDecoration: 'none',
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
  },
  flagBed: {
    minWidth: 56,
    paddingBlock: space.xs,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    fontSize: text.sm,
    fontWeight: weight.heavy,
    textAlign: 'center',
  },
  flagMain: { display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 200, minWidth: 0 },
  flagWho: { fontWeight: weight.bold },
  flagWhen: { fontSize: text.sm, color: color.muted },
  flagBadges: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  chev: { fontSize: text.xl, color: color.muted },
  pair: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [WIDE]: 'minmax(0, 3fr) minmax(0, 2fr)' },
    gap: space.lg,
    alignItems: 'start',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: text.sm },
  th: {
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    textAlign: 'left',
    fontSize: text.xs,
    fontWeight: weight.bold,
    letterSpacing: '0.04em',
    color: color.muted,
    whiteSpace: 'nowrap',
  },
  td: {
    paddingBlock: space.md,
    paddingInline: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    fontVariantNumeric: 'tabular-nums',
  },
  staff: { textAlign: 'left', fontWeight: weight.semibold, whiteSpace: 'nowrap' },
  role: { display: 'block', fontSize: text.xs, fontWeight: weight.regular, color: color.muted },
  num: { textAlign: 'right' },
  hot: { color: color.warn, fontWeight: weight.heavy },
})
