import { lazy, Suspense, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import type { WardSummary } from '@meniscus/shared'
import { Button } from '../../components/button.tsx'
import { HrefLink } from '../../components/href-link.tsx'
import { ChevronRightIcon, InChargeIcon } from '../../components/icons.tsx'
import { WardsNextUp } from '../../components/next-up.tsx'
import { Segmented } from '../../components/segmented.tsx'
import { MirroredBars } from '../../components/spark.tsx'
import { Chip, Notice, ToneGlyph } from '../../components/ui.tsx'
import { bars, ui } from '../../components/ui.styles.ts'
import { api, ApiError, errorText } from '../../lib/api.ts'
import { ml } from '../../lib/format.ts'
import { hospitalModelLoad, hospitalView } from '../../lib/model-view.ts'
import { wardsNextUp } from '../../lib/next-up.ts'
import { splitWards } from '../../lib/rota.ts'
import { snapshot } from '../../lib/snapshot.ts'
import { rememberWards } from '../../lib/use-access.ts'
import { useResource } from '../../lib/use-resource.ts'
import { useStaff } from '../../lib/use-staff.ts'
import { wardRow, wardsScale, type WardRow } from '../../lib/ward-home.ts'
import { color, radius, space, text, weight } from '../../tokens.stylex.ts'

export const Route = createFileRoute('/n/')({
  staticData: { title: 'Wards' },
  validateSearch: hospitalView,
  component: Wards,
})

// The section's code loads only when the model view opens, so the Wards view ships none of it.
const ModelAccuracy = lazy(() => import('../../components/model-accuracy.tsx'))
const VIEWS = [
  ['wards', 'Wards'],
  ['model', 'Model accuracy'],
] as const

function Wards() {
  const staff = useStaff()
  // The root passes unvalidated params through, so `?view=x` is read through hospitalView again.
  const { view = 'wards' } = hospitalView(Route.useSearch())
  const navigate = Route.useNavigate()
  // Local API only (no model requests); refreshed every 30 s while visible.
  const res = useResource(
    'wards',
    async (signal) => {
      const h = await api.wards(signal)
      rememberWards(h.wards)
      return { h, at: Date.now() }
    },
    30_000,
  )
  const loaded = res.data
  // The sidebar and quick jump read the page's own load (lib/snapshot.ts): no request of theirs.
  useEffect(() => {
    if (loaded) snapshot.writeWards(loaded.h.wards, loaded.at)
  }, [loaded])
  if (res.error && !res.data) return <Notice tone="danger">{errorText(res.error)}</Notice>
  if (!res.data) return <p {...stylex.props(ui.muted)}>Loading wards…</p>
  const { h, at } = res.data
  const { yours, others } = splitWards(h.wards, staff)
  const groups = [
    { id: 'yours', title: 'Your wards', wards: yours },
    { id: 'others', title: 'Other wards', wards: others },
  ].filter((g) => g.wards.length > 0)
  const pending = h.wards.reduce((n, w) => n + w.pending, 0)
  const review = h.wards.reduce((n, w) => n + w.beds_with_alerts, 0)
  const patients = h.wards.reduce((n, w) => n + w.occupied, 0)

  return (
    <div {...stylex.props(ui.stack)}>
      {view === 'wards' && <WardsNextUp items={wardsNextUp(yours)} />}
      <header {...stylex.props(s.head)}>
        <div {...stylex.props(s.headText)}>
          <p {...stylex.props(s.eyebrow)}>Hospital census</p>
          <h2 {...stylex.props(s.hospital)}>{h.hospital}</h2>
          <div {...stylex.props(ui.row)}>
            <Chip tone="neutral">
              {h.wards.length} wards · {patients} patients
            </Chip>
            <Chip tone={pending ? 'pending' : 'ok'} glyph>
              {pending ? `${pending} waiting for approval` : 'All entries reviewed'}
            </Chip>
            {review > 0 && (
              <Chip tone="warn" glyph>
                {review} bed{review === 1 ? '' : 's'} to review
              </Chip>
            )}
          </div>
        </div>
        <Segmented
          label="Hospital view"
          value={view}
          options={VIEWS}
          size="lg"
          onChange={(v) => void navigate({ search: v === 'model' ? { view: 'model' } : {}, replace: true })}
        />
      </header>

      {view === 'model' ? <HospitalModelAccuracy /> : <WardGroups groups={groups} at={at} max={wardsScale(h.wards)} />}
      <p {...stylex.props(ui.muted)}>Demo census with fictional patients. Prompts ask for review; they are not diagnoses.</p>
    </div>
  )
}

/**
 * The whole hospital's model accuracy: one `GET /api/quality/model?days=7` when it opens, no refresh and no model
 * request. Counts and classes only (no names, beds or MRNs), so no access gate.
 */
function HospitalModelAccuracy() {
  const res = useResource('quality:model', (signal) => hospitalModelLoad(api, signal))
  if (res.error && !res.data) {
    return (
      <div {...stylex.props(ui.stack)}>
        <Notice tone="danger">{errorText(res.error)}</Notice>
        {res.error instanceof ApiError && res.error.retryable && (
          <span>
            <Button variant="secondary" size="touch" onClick={res.reload}>
              Try again
            </Button>
          </span>
        )}
      </div>
    )
  }
  const loading = (
    <p role="status" {...stylex.props(ui.muted)}>
      Loading model accuracy…
    </p>
  )
  if (!res.data) return loading
  return (
    <Suspense fallback={loading}>
      <ModelAccuracy q={res.data} subtitle="All wards · Last 7 days" />
    </Suspense>
  )
}

function WardGroups({ groups, at, max }: { groups: { id: string; title: string; wards: WardSummary[] }[]; at: number; max: number }) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.title} aria-labelledby={`wards-${g.id}`} {...stylex.props(s.group)}>
          <h3 id={`wards-${g.id}`} {...stylex.props(ui.overline, s.groupTitle)}>
            {g.title} · {g.wards.length}
          </h3>
          <ul {...stylex.props(s.list)}>
            {g.wards.map((w) => (
              <WardRowItem key={w.id} r={wardRow(w, at)} max={max} />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

/** One ward: a whole-row link (DESIGN.md 7.5), its status edge and chip from `wardTone`, its 24 h bars on the screen's one scale. */
function WardRowItem({ r, max }: { r: WardRow; max: number }) {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
  return (
    <li {...stylex.props(s.cell)}>
      <HrefLink href={r.href} xstyle={[s.row, bars[r.tone.tone], ui.focus]}>
        <span {...stylex.props(s.ident)}>
          <span {...stylex.props(s.code)}>{r.code}</span>
          <span {...stylex.props(s.titles)}>
            <span {...stylex.props(s.name)}>{r.title}</span>
            <span {...stylex.props(s.meta)}>
              {r.specialty} · {r.beds}
            </span>
          </span>
        </span>
        <span {...stylex.props(s.status)}>
          <Chip tone={r.tone.tone} glyph>
            {r.tone.label}
          </Chip>
        </span>
        <span {...stylex.props(s.bars)}>
          <MirroredBars in_ml={r.hourly.in_ml} out_ml={r.hourly.out_ml} max={max} name={r.barsName} height={32} />
          <span aria-hidden {...stylex.props(s.meta, s.num)}>
            In {ml(sum(r.hourly.in_ml))} · Out {ml(sum(r.hourly.out_ml))}
          </span>
        </span>
        <span {...stylex.props(s.counts)}>
          <span {...stylex.props(s.count, r.pending !== 'All reviewed' && s.pendingText)}>
            {r.pending !== 'All reviewed' && <ToneGlyph tone="pending" size={14} />}
            {r.pending}
          </span>
          {r.review && (
            <span {...stylex.props(s.count)}>
              <ToneGlyph tone={r.tone.tone === 'danger' ? 'danger' : 'warn'} size={14} />
              {r.review}
            </span>
          )}
          <span aria-hidden {...stylex.props(s.share)}>
            <span {...stylex.props(s.shareFill(r.reviewShare), r.tone.tone === 'danger' ? s.shareDanger : s.shareWarn)} />
          </span>
        </span>
        <span {...stylex.props(s.foot)}>
          <span {...stylex.props(s.charge, r.in_charge === 'No nurse in charge' && s.noCharge)}>
            <InChargeIcon size={14} aria-hidden />
            {r.in_charge}
          </span>
          <span {...stylex.props(s.meta)}>{r.activity === 'No entries today' ? r.activity : `Last entry ${r.activity}`}</span>
        </span>
        <ChevronRightIcon size={20} aria-hidden {...stylex.props(s.chev)} />
      </HrefLink>
    </li>
  )
}

const WIDE = '@media (min-width: 1100px)'

const s = stylex.create({
  group: { display: 'flex', flexDirection: 'column', gap: space.sm },
  groupTitle: { margin: 0 },
  head: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.md },
  headText: { display: 'flex', flexDirection: 'column', gap: space.xs },
  eyebrow: { margin: 0, fontSize: text.sm, fontWeight: weight.bold, color: color.accent },
  hospital: { fontSize: text.xl, fontWeight: weight.bold, letterSpacing: '-0.02em' },
  list: {
    display: 'flex',
    flexDirection: 'column',
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
  cell: { display: 'flex', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: color.grid },
  row: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) auto',
      [WIDE]: 'minmax(220px, 1.4fr) 112px minmax(160px, 1.6fr) minmax(120px, 0.9fr) minmax(150px, 1fr) 20px',
    },
    alignItems: 'center',
    columnGap: space.lg,
    rowGap: space.md,
    width: '100%',
    minHeight: 72,
    paddingBlock: space.md,
    paddingInline: space.lg,
    color: color.fg,
    textDecoration: 'none',
    backgroundColor: { default: color.bg, ':hover': color.subtle },
  },
  ident: {
    gridColumnStart: { default: 1, [WIDE]: 1 },
    gridColumnEnd: { default: 'auto', [WIDE]: 'auto' },
    gridRowStart: { default: 1, [WIDE]: 1 },
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    minWidth: 0,
  },
  code: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    color: color.onAccent,
    fontSize: text.md,
    fontWeight: weight.heavy,
  },
  titles: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  name: { fontSize: text.md, fontWeight: weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { fontSize: text.xs, color: color.muted },
  num: { fontVariantNumeric: 'tabular-nums' },
  status: {
    gridColumnStart: { default: 2, [WIDE]: 2 },
    gridColumnEnd: { default: 'auto', [WIDE]: 'auto' },
    gridRowStart: { default: 1, [WIDE]: 1 },
    display: 'flex',
    justifyContent: { default: 'flex-end', [WIDE]: 'flex-start' },
  },
  bars: {
    gridColumnStart: { default: 1, [WIDE]: 3 },
    gridColumnEnd: { default: -1, [WIDE]: 'auto' },
    gridRowStart: { default: 2, [WIDE]: 1 },
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    minWidth: 0,
  },
  counts: {
    gridColumnStart: { default: 1, [WIDE]: 4 },
    gridColumnEnd: { default: -1, [WIDE]: 'auto' },
    gridRowStart: { default: 3, [WIDE]: 1 },
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    minWidth: 0,
  },
  count: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: text.sm, fontWeight: weight.semibold },
  pendingText: { color: color.pending },
  share: { display: 'block', height: 4, borderRadius: radius.pill, backgroundColor: color.grid, overflow: 'hidden' },
  shareFill: (x: number) => ({ display: 'block', height: '100%', width: `${x * 100}%` }),
  shareWarn: { backgroundColor: color.warnText },
  shareDanger: { backgroundColor: color.danger },
  foot: {
    gridColumnStart: { default: 1, [WIDE]: 5 },
    gridColumnEnd: { default: -1, [WIDE]: 'auto' },
    gridRowStart: { default: 4, [WIDE]: 1 },
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    minWidth: 0,
  },
  charge: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: text.sm, fontWeight: weight.semibold },
  noCharge: { color: color.warnText },
  chev: {
    gridColumnStart: { default: 1, [WIDE]: 6 },
    gridColumnEnd: { default: 'auto', [WIDE]: 'auto' },
    gridRowStart: { default: 1, [WIDE]: 1 },
    display: { default: 'none', [WIDE]: 'block' },
    color: color.muted,
  },
})
