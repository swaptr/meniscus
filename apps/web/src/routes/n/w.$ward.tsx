import { lazy, Suspense, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { ACUITY_LEVELS, type AdmissionSummary, type Staff, type WardTeam } from '@meniscus/shared'
import { AccessGate } from '../../components/access-gate.tsx'
import { LazyQrCard } from '../../components/bed-qr-button.tsx'
import { BedPeek, BedTile, BoardHead, BoardRow } from '../../components/bed-tile.tsx'
import { Button } from '../../components/button.tsx'
import { AlertIcon, InChargeIcon, PrintIcon, UserIcon } from '../../components/icons.tsx'
import { Legend, Swatch, WardLegend } from '../../components/legend.tsx'
import { NextUp } from '../../components/next-up.tsx'
import { NursePicker } from '../../components/nurse-picker.tsx'
import { Peek, PeekTrigger } from '../../components/peek.tsx'
import { Segmented } from '../../components/segmented.tsx'
import { SwitchField } from '../../components/switch-field.tsx'
import { BedBadge, Notice, StatChip } from '../../components/ui.tsx'
import { ui } from '../../components/ui.styles.ts'
import { usePopoverList } from '../../components/use-popover-list.ts'
import { api, errorText } from '../../lib/api.ts'
import { scaleShared } from '../../lib/charts.ts'
import { clock, plural } from '../../lib/format.ts'
import { ACUITY_LABEL } from '../../lib/labels.ts'
import { wardView } from '../../lib/model-view.ts'
import { nextUp } from '../../lib/next-up.ts'
import { usePlace } from '../../lib/place.ts'
import {
  assignBed,
  assignmentsNow,
  bedNurse,
  canAssign,
  canTakeCharge,
  inChargeText,
  myBeds,
  nurseOptions,
  outsideTeam,
  takeCharge,
  visibleBeds,
} from '../../lib/rota.ts'
import { snapshot } from '../../lib/snapshot.ts'
import { failureGoesTo, flash as showToast } from '../../lib/toast.ts'
import { useMediaQuery } from '../../lib/use-media-query.ts'
import { useNow, wardName } from '../../lib/use-access.ts'
import { useResource } from '../../lib/use-resource.ts'
import { useStaff } from '../../lib/use-staff.ts'
import { BOARD_QUERY, bedPromptTone, wardStats, type WardStat } from '../../lib/ward-board.ts'
import { filterByAcuity, groupLevel, wardLoads, wardOrder, type AcuityFilter } from '../../lib/ward.ts'
import { color, radius, space, text, weight } from '../../tokens.stylex.ts'

// The stat chips' peek body: its own chunk, loaded on first open.
const WardStatPeek = lazy(() => import('../../components/ward-stat-peek.tsx'))

export const Route = createFileRoute('/n/w/$ward')({
  staticData: { title: 'Ward' },
  validateSearch: wardView,
  component: WardDashboard,
})

// Its own request and tables: loaded when the view is first opened.
const WardQualityView = lazy(() => import('../../components/ward-quality.tsx').then((m) => ({ default: m.WardQualityView })))

function WardDashboard() {
  const { ward: wardParam } = Route.useParams()
  const wardId = Number(wardParam)
  // Outside the person's wards nothing loads until a reason is given: both loaders live inside the gate.
  return (
    <AccessGate key={wardParam} wardId={wardId} wardName={wardName(wardId)}>
      <WardBody wardParam={wardParam} wardId={wardId} />
    </AccessGate>
  )
}

function WardBody({ wardParam, wardId }: { wardParam: string; wardId: number }) {
  // Re-read through wardView: useSearch also passes the root's unvalidated params through (web/ward "Ward dashboard views").
  const { view = 'beds' } = wardView(Route.useSearch())
  const navigate = Route.useNavigate()
  const staff = useStaff()
  const load = wardLoads(api, wardId)
  // The beds: one request per load, refreshed every 30 s. The team: once per visit; PUTs answer with it. No model requests.
  const ward = useResource(`ward:${wardParam}`, async (signal) => ({ beds: await load.beds(signal), at: Date.now() }), 30_000)
  const team = useResource(`team:${wardParam}`, load.team)
  // Re-reads the in-charge line and assignments each minute, with no request (a shift can end while open).
  const now = useNow(60_000)
  const wide = useMediaQuery(BOARD_QUERY)
  const peek = usePopoverList<AdmissionSummary>()
  const stats = usePopoverList<WardStat>()
  const [myOnly, setMyOnly] = useState(true)
  // Filters the loaded beds in place: no request.
  const [acuity, setAcuity] = useState<AcuityFilter>('all')
  const [busy, setBusy] = useState(false)
  const [message, setInline] = useState<string | null>(null)
  const loaded = ward.data
  const name = loaded?.beds[0]?.ward_name ?? wardName(wardId) ?? 'Ward'
  usePlace({ title: name, crumbs: [{ label: 'Wards', href: '/n' }] })
  // The sidebar, quick jump and Next up read the page's own load (lib/snapshot.ts): no request of theirs.
  useEffect(() => {
    if (loaded) snapshot.writeWard(wardId, wardOrder(loaded.beds), loaded.at, bedPromptTone)
  }, [loaded, wardId])
  const setMessage = (text: string | null, err?: unknown) => {
    if (text && failureGoesTo(err) === 'toast') {
      setInline(null)
      showToast({ tone: 'danger', text })
    } else setInline(text)
  }
  if (ward.error && !ward.data) return <Notice tone="danger">{errorText(ward.error)}</Notice>
  if (!loaded) return <p {...stylex.props(ui.muted)}>Loading ward…</p>
  const { at } = loaded
  const beds = wardOrder(loaded.beds)
  const first = beds[0]
  const outside = outsideTeam(wardId, name, staff)
  const t = team.data
  const mine = t ? myBeds(beds, t, staff, now) : null
  const shown = filterByAcuity(visibleBeds(beds, mine, myOnly), acuity)
  // Acuity headings above each group, in wardOrder's order (DESIGN.md 5.9).
  const groups = ACUITY_LEVELS.map((level) => ({ level, beds: shown.filter((a) => groupLevel(a) === level) })).filter((g) => g.beds.length)
  const max = scaleShared(beds.map((b) => b.hourly))
  const assigner = t ? canAssign(t, staff, now) : false

  /** One PUT; the ward team comes back in its response, so nothing is re-fetched. */
  const change = async (fn: () => Promise<WardTeam>) => {
    setBusy(true)
    setMessage(null)
    try {
      team.set(await fn())
    } catch (err) {
      setMessage(errorText(err), err)
    } finally {
      setBusy(false)
    }
  }
  const nurse = (a: AdmissionSummary) =>
    t &&
    (assigner ? (
      <NursePicker
        bed={a.bed}
        value={assignmentsNow(t, now).find((x) => x.admission_id === a.id)?.staff_id ?? null}
        label={bedNurse(t, a.id, now)}
        options={nurseOptions(t)}
        disabled={busy}
        compact={wide}
        onChange={(id) => void change(() => assignBed(api, t, a.id, id, now))}
      />
    ) : (
      <span {...stylex.props(s.nurse)}>
        <UserIcon size={14} aria-hidden />
        {bedNurse(t, a.id, now)}
      </span>
    ))
  const Row = wide ? BoardRow : BedTile

  return (
    <div {...stylex.props(ui.stack)}>
      {view === 'beds' && <NextUp data={nextUp(beds, at, { wide })} />}

      <header data-no-print {...stylex.props(s.head)}>
        <div {...stylex.props(s.headTop)}>
          {first && <BedBadge bed={first.ward_code} size="md" />}
          <div {...stylex.props(s.headText)}>
            <h2 {...stylex.props(s.title)}>{name}</h2>
            <InCharge
              team={t}
              error={team.error}
              staff={staff}
              now={now}
              busy={busy}
              beds={beds.length}
              at={at}
              onTake={(id) => void change(() => takeCharge(api, wardId, id))}
            />
          </div>
          <ul aria-label="Ward figures" {...stylex.props(s.stats)}>
            {wardStats(beds).map((x) => (
              <li key={x.id}>
                <PeekTrigger
                  list={stats}
                  payload={x}
                  label={`${x.label}: ${x.value} ${x.unit}`.trim()}
                  xstyle={[s.statBtn, ui.focus]}
                  openStyle={s.statOpen}
                >
                  <StatChip tone={x.tone} label={x.label} value={x.value} unit={x.unit} />
                </PeekTrigger>
              </li>
            ))}
          </ul>
        </div>
        {outside && <Notice tone="warn">{outside}</Notice>}
        {message && <Notice tone="danger">{message}</Notice>}
        <Peek list={stats} title={(x) => x.title} minHeight={120}>
          {(x) => <WardStatPeek stat={x} />}
        </Peek>
      </header>

      <div data-no-print {...stylex.props(s.toolbar)}>
        <Segmented
          label="View"
          size="lg"
          value={view}
          options={[
            ['beds', 'Beds'],
            ['quality', 'Data quality'],
            ['qr', 'QR cards'],
          ]}
          onChange={(v) => void navigate({ search: v === 'beds' ? {} : { view: v }, replace: true })}
        />
        <span {...stylex.props(ui.grow)} />
        {view === 'beds' && mine && (
          <SwitchField checked={myOnly} onChange={setMyOnly}>
            My beds
            <span {...stylex.props(s.mineCount)}>
              {' '}
              · {mine.length} of {beds.length}
            </span>
          </SwitchField>
        )}
        {view === 'beds' && (
          <Segmented
            label="Acuity"
            size="lg"
            value={acuity}
            options={[['all', 'All'], ...ACUITY_LEVELS.map((l) => [l, ACUITY_LABEL[l]] as const)]}
            onChange={setAcuity}
          />
        )}
        {view === 'qr' && (
          <Button onClick={() => window.print()}>
            <PrintIcon size={16} />
            Print cards
          </Button>
        )}
      </div>

      {view === 'quality' ? (
        <Suspense fallback={<p {...stylex.props(ui.muted)}>Loading data quality…</p>}>
          <WardQualityView wardId={wardId} />
        </Suspense>
      ) : view === 'qr' ? (
        <>
          <p data-no-print {...stylex.props(ui.muted)}>
            One card per bed. Scanning opens that bed’s capture screen. Cards carry no patient name or MRN.
          </p>
          <ul {...stylex.props(s.qrGrid)} aria-label="Bed QR cards">
            {[...loaded.beds]
              .sort((x, y) => Number(x.bed) - Number(y.bed))
              .map((a) => (
                <li key={a.id} {...stylex.props(s.qrCell)}>
                  <Suspense fallback={<span {...stylex.props(ui.muted)}>Loading card…</span>}>
                    <LazyQrCard a={a} />
                  </Suspense>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <>
          {shown.length === 0 ? (
            <p {...stylex.props(ui.muted)}>
              {acuity !== 'all'
                ? `No ${ACUITY_LABEL[acuity].toLowerCase()} beds${mine && myOnly ? ' among your beds' : ''}. Pick All to see every bed.`
                : 'None of your beds is on the ward now. Turn off “My beds” to see every bed.'}
            </p>
          ) : (
            <div {...stylex.props(wide && s.board)}>
              {wide && <BoardHead />}
              {groups.map((g) => (
                <section key={g.level} aria-labelledby={`acuity-${g.level}`} {...stylex.props(s.group, wide && s.boardGroup)}>
                  <h3 id={`acuity-${g.level}`} {...stylex.props(ui.overline, wide && s.boardHeading)}>
                    {ACUITY_LABEL[g.level]} · {g.beds.length}
                  </h3>
                  <ul
                    {...stylex.props(wide ? s.rows : s.tiles)}
                    aria-label={`${ACUITY_LABEL[g.level]} ${mine && myOnly ? 'beds of mine' : 'beds'}, those needing attention first`}
                  >
                    {g.beds.map((a) => (
                      <Row key={a.id} a={a} now={at} max={max} peek={peek} nurse={nurse(a)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <BedPeek list={peek} now={at} />
          <div {...stylex.props(s.legends)}>
            <WardLegend />
            <BarsKey max={max} />
          </div>
        </>
      )}
    </div>
  )
}

/** The 24 h bars' key: direction swatches and the ward's one scale. */
function BarsKey({ max }: { max: number }) {
  return (
    <Legend
      title="Last 24 hours"
      rows={[
        { key: <Swatch fill={color.intake} />, text: 'Intake per hour, up' },
        { key: <Swatch fill={color.output} />, text: 'Output per hour, down' },
        { key: <span {...stylex.props(s.dotKey)} />, text: 'Intake logged that hour' },
        { key: <span {...stylex.props(s.gapKey)} />, text: 'No intake logged for 3 h or more' },
        { key: <span />, text: `One scale for the ward: max ${max} mL/h` },
      ]}
    />
  )
}

/** `7 beds · In charge: Anita T. · day shift · as of 14:05`, or nobody; "Take charge" for a nurse on the team who is not. */
function InCharge({
  team,
  error,
  staff,
  now,
  busy,
  beds,
  at,
  onTake,
}: {
  team: WardTeam | undefined
  error: unknown
  staff: Staff | null
  now: number
  busy: boolean
  beds: number
  at: number
  onTake: (staffId: number) => void
}) {
  const line = team ? inChargeText(team, now) : error ? `Ward team not loaded: ${errorText(error)}` : 'Loading the ward team…'
  const nobody = line === 'No nurse in charge this shift'
  return (
    <div {...stylex.props(s.charge)}>
      <span {...stylex.props(s.chargeText)}>
        <span>{plural(beds, 'bed', 'beds')}</span>
        <span aria-hidden>·</span>
        <span {...stylex.props(s.chargeLine, nobody && s.chargeNone)}>
          {nobody ? <AlertIcon size={16} aria-hidden /> : <InChargeIcon size={16} aria-hidden />}
          {line}
        </span>
        <span aria-hidden>·</span>
        <span {...stylex.props(s.asOf)}>as of {clock(at)}</span>
      </span>
      {team && staff && canTakeCharge(team, staff, now) && (
        <Button variant={nobody ? 'primary' : 'secondary'} disabled={busy} onClick={() => onTake(staff.id)}>
          <InChargeIcon size={16} />
          Take charge
        </Button>
      )}
    </div>
  )
}

const s = stylex.create({
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  headTop: { display: 'flex', alignItems: 'center', columnGap: space.lg, rowGap: space.md, flexWrap: 'wrap', minWidth: 0 },
  headText: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  title: { fontSize: text.xl, fontWeight: weight.bold, letterSpacing: '-0.02em', lineHeight: text.leadingTight },
  charge: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  chargeText: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    fontSize: text.sm,
    color: color.muted,
  },
  chargeLine: { display: 'inline-flex', alignItems: 'center', gap: space.sm, color: color.fg, fontWeight: weight.semibold },
  chargeNone: { color: color.warnText },
  asOf: { fontVariantNumeric: 'tabular-nums' },
  stats: { display: 'flex', flexWrap: 'wrap', gap: space.sm, margin: 0, marginInlineStart: 'auto', padding: 0, listStyle: 'none' },
  statBtn: {
    display: 'inline-flex',
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    cursor: 'pointer',
    boxShadow: { default: 'none', ':hover': `inset 0 -2px 0 ${color.borderStrong}` },
  },
  statOpen: { boxShadow: `inset 0 -2px 0 ${color.accent}` },
  toolbar: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  mineCount: { color: color.muted, fontWeight: weight.semibold },
  group: { display: 'flex', flexDirection: 'column', gap: space.md },
  board: {
    display: 'flex',
    flexDirection: 'column',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    overflow: 'hidden',
  },
  boardGroup: { gap: 0 },
  boardHeading: {
    paddingBlock: space.sm,
    paddingInline: space.lg,
    backgroundColor: color.bg,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.grid,
  },
  rows: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  tiles: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 641px)': 'repeat(2, minmax(0, 1fr))' },
    gap: space.md,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  qrGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
    gap: space.lg,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  qrCell: { display: 'flex', minHeight: 300, alignItems: 'center', justifyContent: 'center' },
  nurse: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.muted,
  },
  legends: { display: 'flex', flexWrap: 'wrap', gap: space.xl, alignItems: 'flex-start' },
  dotKey: { display: 'inline-block', width: 4, height: 4, borderRadius: radius.pill, backgroundColor: color.fg },
  gapKey: { display: 'inline-block', width: 14, borderTopWidth: 2, borderTopStyle: 'dashed', borderTopColor: color.warn },
})
