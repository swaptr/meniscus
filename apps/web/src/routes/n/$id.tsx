import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import type { Entry, EntryCategory, OutputDevices, Totals } from '@meniscus/shared'
import { AddDevice } from '../../components/add-device.tsx'
import { BedQrButton } from '../../components/bed-qr-button.tsx'
import { Button } from '../../components/button.tsx'
import { CareBadges } from '../../components/care-badges.tsx'
import { DenseRow } from '../../components/dense-row.tsx'
import { AlertIcon, CheckIcon, DropIcon, MealIcon, PlusIcon, PrintIcon, ReviewIcon, SparkIcon, XIcon } from '../../components/icons.tsx'
import { Peek, PeekTrigger } from '../../components/peek.tsx'
import { AcuityMark, BedBadge, Chip, Notice, Reserve, Section, Stepper } from '../../components/ui.tsx'
import { bars, ui } from '../../components/ui.styles.ts'
import { usePopoverList } from '../../components/use-popover-list.ts'
import { UrineSwatch } from '../../components/urine-swatch.tsx'
import { AccessGate } from '../../components/access-gate.tsx'
import type { MetricKind } from '../../components/metric-peek.tsx'
import { ACUITY_LABEL, ALERT_LABEL, ALERT_TONE, STATUS_LABEL, bedTone } from '../../lib/labels.ts'
import { api, errorText } from '../../lib/api.ts'
import { useResource } from '../../lib/use-resource.ts'
import { fallsOf, offersMissedEmptying, promptDevice, type Fall } from '../../lib/bag-prompts.ts'
import { mayOrder } from '../../lib/care.ts'
import { offersMissedEntry, offersReferral } from '../../lib/resolve-rules.ts'
import { REFER, canRefer } from '../../lib/nutrition.ts'
import { rejectSourceText } from '../../lib/reject-source.ts'
import { entryRow } from '../../lib/rows.ts'
import { useStaff } from '../../lib/use-staff.ts'
import { outsideTeam } from '../../lib/rota.ts'
import { canDecide, decisionNotice } from '../../lib/staff.ts'
import { useNeedsReason } from '../../lib/use-access.ts'
import { usePlace } from '../../lib/place.ts'
import { snapshot } from '../../lib/snapshot.ts'
import { ago, approveBatch, batchApprovable, bedLoad, overloadTone, requestExplanation } from '../../lib/ward.ts'
import { color, layout, radius, space, text, weight } from '../../tokens.stylex.ts'
import { seenSwatch, type Swatch } from '../../lib/urine.ts'
import { ml, signedMl } from '../../lib/format.ts'
import { failureGoesTo, flash as showToast } from '../../lib/toast.ts'

export const Route = createFileRoute('/n/$id')({
  staticData: { title: 'Bed review' },
  component: BedReview,
})

// Dialogs, peek bodies and below-the-fold sections load on first need, keeping them out of the route's first paint
// (DESIGN.md 10; design.md D9). Each fallback reserves its section's height, so nothing shifts when it lands.
const EntryDetails = lazy(() => import('../../components/entry-details.tsx').then((m) => ({ default: m.EntryDetails })))
const RejectDialog = lazy(() => import('../../components/resolve.tsx').then((m) => ({ default: m.RejectDialog })))
const MissedEntryDialog = lazy(() => import('../../components/resolve.tsx').then((m) => ({ default: m.MissedEntryDialog })))
const MissedEmptyingDialog = lazy(() => import('../../components/missed-emptying.tsx').then((m) => ({ default: m.MissedEmptyingDialog })))
const EntryPeekBody = lazy(() => import('../../components/entry-peek.tsx'))
const BedMetricPeekBody = lazy(() => import('../../components/metric-peek.tsx'))
// The charts come with the bed's data: their chunk starts when the route mounts and lands with the first answer.
const loadCharts = () => import('../../components/bed-charts.tsx')
const BedCharts = lazy(() => loadCharts().then((m) => ({ default: m.BedCharts })))
const loadLog = () => import('../../components/entry-log.tsx')
const EntryLog = lazy(() => loadLog().then((m) => ({ default: m.EntryLog })))
const CarePlan = lazy(() => import('../../components/care-plan.tsx').then((m) => ({ default: m.CarePlan })))
const NutritionSection = lazy(() => import('../../components/nutrition.tsx').then((m) => ({ default: m.NutritionSection })))
const BagPeriods = lazy(() => import('../../components/bag-periods.tsx').then((m) => ({ default: m.BagPeriods })))

type Resolving = { kind: 'reject'; entry: Entry } | { kind: 'missed'; initial: EntryCategory } | { kind: 'emptying'; fall: Fall } | null

function BedReview() {
  const { id } = Route.useParams()
  const admissionId = Number(id)
  // The first load names the ward. Until then, and while that ward still needs a reason, nothing refreshes.
  const [wardId, setWardId] = useState<number | null>(null)
  const gated = useNeedsReason(wardId)
  // Local API only; refreshed every 30 s while visible so new captures appear.
  const bed = useResource(`entries:${id}`, bedLoad(api, admissionId), wardId === null || gated ? undefined : 30_000)
  const named = bed.data?.admission.ward_id ?? null
  if (named !== wardId) {
    setWardId(named)
    snapshot.writeBedWard(named)
  }
  // Code only, no data: the chart and log chunks load alongside the bed's first request.
  useEffect(() => {
    void loadCharts()
    void loadLog()
  }, [])
  const [busy, setBusy] = useState(false)
  const [message, setInline] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  /** Results go to the one toast; a refusal about what was sent stays inline here. */
  const setMessage = (m: { tone: 'ok' | 'danger'; text: string } | null, err?: unknown) => {
    if (m && (m.tone === 'ok' || failureGoesTo(err) === 'toast')) {
      setInline(null)
      showToast(m)
    } else setInline(m)
  }
  const [explanation, setExplanation] = useState<{ forKinds: string; text: string } | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [detail, setDetail] = useState<Entry | null>(null)
  const [resolving, setResolving] = useState<Resolving>(null)
  const [referring, setReferring] = useState(false)
  // One entry peek for the bed review (pending rows, the log, timeline photo marks, the photo strip) and one for the
  // banner's figures: one open at a time, each list one Root and one portal.
  const entryPeek = usePopoverList<Entry>()
  const metricPeek = usePopoverList<MetricKind>()
  const staff = useStaff()
  const decide = canDecide(staff)
  const a0 = bed.data?.admission
  usePlace(
    a0
      ? {
          title: `Bed ${a0.bed} · ${a0.ward_code}`,
          crumbs: [
            { label: 'Wards', href: '/n' },
            { label: a0.ward_name, href: `/n/w/${a0.ward_id}` },
          ],
        }
      : null,
  )

  if (bed.error && !bed.data) return <Notice tone="danger">{errorText(bed.error)}</Notice>
  if (!bed.data)
    return (
      <div aria-busy aria-label="Loading bed" {...stylex.props(ui.stack)}>
        <Reserve h={160} />
        <Reserve h={420} />
      </div>
    )
  const { admission, totals, alerts, entries, meals, at, urine_seen, care, devices, acuity, care_history, bags, nutrition } = bed.data
  const refer = canRefer(staff, nutrition)
  const pending = entries.filter((e) => e.status === 'pending')
  const batch = batchApprovable(pending)
  const alertKinds = alerts.map((a) => a.kind).join(',')
  const tone = bedTone(alerts, pending.length)
  const alertTone = alerts.some((a) => ALERT_TONE[a.kind] === 'danger') ? 'danger' : 'warn'
  // Each fall prompt with its reading; nurses and matrons may add the emptying that was missed.
  const falls = fallsOf(bags, alerts, at)
  const onEmptying = offersMissedEmptying(staff) ? (fall: Fall) => setResolving({ kind: 'emptying', fall }) : undefined

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      setMessage({ tone: 'ok', text: done })
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err) }, err)
    } finally {
      setBusy(false)
      bed.reload()
    }
  }
  const approve = (e: Entry, volume = e.volume_ml) =>
    void act(
      () => api.review(e.id, volume === e.volume_ml ? { action: 'approve' } : { action: 'approve', volume_ml: volume }),
      `Approved ${volume} mL.`,
    )
  const reject = (e: Entry) => setResolving({ kind: 'reject', entry: e })

  /** After a fix made in a dialog: say what happened and reload the chart. */
  const changed = (text: string) => {
    setMessage({ tone: 'ok', text })
    bed.reload()
  }

  const onExplain = async () => {
    setExplaining(true)
    setMessage(null)
    try {
      // One model request, only on this tap.
      const r = await requestExplanation(api, { id: admission.id, alerts })
      if (r) setExplanation({ forKinds: alertKinds, text: r.text })
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err) }, err)
    } finally {
      setExplaining(false)
    }
  }

  const outside = outsideTeam(admission.ward_id, admission.ward_name, staff)
  const notice = decisionNotice(staff)

  const prompts = alerts.length > 0 && (
    <Section
      tone={alertTone}
      icon={<AlertIcon />}
      title="Review prompts"
      count={alerts.length}
      subtitle="Rule-based prompts for review. Not a diagnosis."
      compact
      actions={
        <Button variant="secondary" onClick={() => void onExplain()} disabled={explaining}>
          <SparkIcon /> {explaining ? 'Explaining…' : 'Explain'}
        </Button>
      }
    >
      <ul {...stylex.props(s.prompts)}>
        {alerts.map((a, i) => {
          const fall = onEmptying && falls.find((f) => f.alert === a)
          // web/ward "Bag without a device on the bed review": its order, for a nurse or matron.
          const device = promptDevice(a)
          return (
            <li key={`${a.kind}:${i}`} {...stylex.props(s.prompt)}>
              <Chip tone={ALERT_TONE[a.kind]} glyph>
                {ALERT_LABEL[a.kind]}
              </Chip>
              <span {...stylex.props(s.promptText)}>{a.message}</span>
              {offersMissedEntry(a.kind) && (
                <Button variant="secondary" onClick={() => setResolving({ kind: 'missed', initial: 'water' })}>
                  <PlusIcon /> Add missed entry
                </Button>
              )}
              {device && mayOrder(device.kind, staff) && (
                <AddDevice
                  kind={device.kind}
                  label={device.add}
                  admissionId={admission.id}
                  wardCode={admission.ward_code}
                  care={care}
                  reload={bed.reload}
                  onDone={(text) => setMessage({ tone: 'ok', text })}
                />
              )}
              {fall && (
                <Button variant="secondary" onClick={() => onEmptying(fall)}>
                  <PlusIcon /> Add missed emptying
                </Button>
              )}
              {refer && offersReferral(a.kind) && (
                <Button variant="secondary" onClick={() => setReferring(true)}>
                  <MealIcon /> {REFER}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {explanation && explanation.forKinds === alertKinds && (
        <Notice tone="info">
          <strong>AI summary of the chart numbers, not clinical advice. </strong>
          {explanation.text}
        </Notice>
      )}
    </Section>
  )

  // Outside the person's wards: nothing of the bed (not even the banner) until a reason is given.
  return (
    <AccessGate wardId={admission.ward_id} wardName={admission.ward_name}>
      <div {...stylex.props(ui.stack, s.page)}>
        <section aria-label="Patient" {...stylex.props(s.banner, bars[tone])}>
          <div {...stylex.props(s.bannerTop)}>
            <BedBadge ward={admission.ward_code} bed={admission.bed} size="lg" />
            <div {...stylex.props(s.who)}>
              <h2 {...stylex.props(s.patient)}>{admission.patient}</h2>
              <p {...stylex.props(s.meta)}>
                <span translate="no">{admission.mrn}</span>
                <span aria-hidden>·</span>
                {admission.weight_kg ? `${admission.weight_kg} kg` : 'Weight not recorded'}
                <span aria-hidden>·</span>
                admitted {ago(admission.admitted_at, at)}
                <span aria-hidden>·</span>
                <AcuityMark level={acuity.level} label={ACUITY_LABEL[acuity.level]} />
              </p>
            </div>
            <Vitals totals={totals} urine={seenSwatch(urine_seen)} devices={devices} pending={pending.length} peek={metricPeek} />
          </div>
          <div {...stylex.props(s.bannerFoot)}>
            <Chip tone={tone} glyph>
              {STATUS_LABEL[tone]}
            </Chip>
            <CareBadges care={care} />
            <span {...stylex.props(ui.grow)} />
            <div {...stylex.props(s.bannerActions)}>
              <Button variant="secondary" onClick={() => setResolving({ kind: 'missed', initial: 'water' })}>
                <PlusIcon /> Add missed entry
              </Button>
              <BedQrButton a={admission} />
              <Button variant="secondary" nativeButton={false} render={<Link to="/n/$id/print" params={{ id: String(admission.id) }} />}>
                <PrintIcon /> Print chart
              </Button>
            </div>
          </div>
        </section>

        {outside && <Notice tone="warn">{outside}</Notice>}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <div {...stylex.props(s.columns)}>
          <div {...stylex.props(s.main)}>
            {/* Prompts come before the chart on phones; from 1100 px they head the side column. */}
            {prompts && <div {...stylex.props(s.phoneOnly)}>{prompts}</div>}

            <Suspense fallback={<Reserve h={420} />}>
              <BedCharts
                admission={admission}
                entries={entries}
                now={at}
                onOpen={setDetail}
                urineSeen={urine_seen}
                bags={bags}
                devices={devices}
                care={care}
                alerts={alerts}
                peek={entryPeek}
              />
            </Suspense>

            <Section
              tone={pending.length ? 'pending' : undefined}
              icon={<ReviewIcon />}
              title="Waiting for approval"
              count={pending.length}
              compact
              actions={
                decide &&
                batch.length > 0 && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => approveBatch(api, pending),
                        `Approved ${batch.length} high-confidence entr${batch.length === 1 ? 'y' : 'ies'}.`,
                      )
                    }
                  >
                    <CheckIcon /> Approve {batch.length} high-confidence
                  </Button>
                )
              }
            >
              {pending.length > 0 && notice && <Notice tone="info">{notice}</Notice>}
              {pending.length === 0 ? (
                <p {...stylex.props(ui.muted)}>All caught up.</p>
              ) : (
                <ul {...stylex.props(s.rows)}>
                  {pending.map((e) => (
                    <PendingRow
                      key={e.id}
                      entry={e}
                      busy={busy}
                      decide={decide}
                      peek={entryPeek}
                      onApprove={(v) => approve(e, v)}
                      onReject={() => reject(e)}
                    />
                  ))}
                </ul>
              )}
            </Section>

            <Section
              icon={<DropIcon />}
              title="Intake and output log"
              subtitle="Grouped by 12-hour shift. Totals count approved entries."
              compact
            >
              <Suspense fallback={<Reserve h={480} />}>
                <EntryLog entries={entries} now={at} peek={entryPeek} />
              </Suspense>
            </Section>
          </div>

          <aside aria-label="Prompts, care plan, bags and meals" {...stylex.props(s.side)}>
            {prompts && <div {...stylex.props(s.wideOnly)}>{prompts}</div>}
            <Suspense fallback={<Reserve h={220} />}>
              <CarePlan
                admissionId={admission.id}
                wardCode={admission.ward_code}
                bags={bags}
                care={care}
                acuity={acuity}
                history={care_history}
                now={at}
                decide={decide}
                staff={staff}
                reload={bed.reload}
              />
            </Suspense>
            <Suspense fallback={<Reserve h={120} />}>
              <BagPeriods bags={bags} now={at} />
            </Suspense>
            <Suspense fallback={<Reserve h={260} />}>
              <NutritionSection
                admission={admission}
                nutrition={nutrition}
                meals={meals}
                alerts={alerts}
                staff={staff}
                now={at}
                canVoid={decide}
                reload={bed.reload}
                onChanged={(text) => setMessage({ tone: 'ok', text })}
                onMealChanged={changed}
                referring={referring}
                onReferringChange={setReferring}
              />
            </Suspense>
          </aside>
        </div>

        <Peek list={entryPeek} title={(e) => entryRow(e).peekTitle} minHeight={260}>
          {(e) => {
            const live = entries.find((x) => x.id === e.id) ?? e
            return (
              <EntryPeekBody
                entry={live}
                alerts={alerts}
                decide={decide}
                busy={busy}
                onDetails={() => {
                  entryPeek.ctl.close()
                  setDetail(live)
                }}
                onApprove={() => {
                  entryPeek.ctl.close()
                  approve(live)
                }}
                onReject={() => {
                  entryPeek.ctl.close()
                  reject(live)
                }}
              />
            )
          }}
        </Peek>
        <Peek list={metricPeek} title={(k) => METRIC_TITLE[k]} minHeight={140}>
          {(k) => <BedMetricPeekBody kind={k} entries={entries} totals={totals} devices={devices} />}
        </Peek>

        {detail && (
          <Suspense fallback={null}>
            <EntryDetails
              entry={entries.find((x) => x.id === detail.id) ?? detail}
              alerts={alerts}
              onClose={() => setDetail(null)}
              onChanged={changed}
            />
          </Suspense>
        )}
        {resolving && (
          <Suspense fallback={null}>
            {resolving.kind === 'emptying' ? (
              <MissedEmptyingDialog
                admissionId={admission.id}
                admittedAt={admission.admitted_at}
                fall={resolving.fall}
                onClose={() => setResolving(null)}
                onDone={(text) => {
                  setResolving(null)
                  changed(text)
                }}
              />
            ) : resolving.kind === 'reject' ? (
              <RejectDialog
                entry={resolving.entry}
                onClose={() => setResolving(null)}
                onDone={(text) => {
                  setResolving(null)
                  const media = rejectSourceText(resolving.entry)
                  changed(media ? `${text} ${media.after}` : text)
                }}
              />
            ) : (
              <MissedEntryDialog
                admissionId={admission.id}
                admittedAt={admission.admitted_at}
                care={care}
                initial={resolving.initial}
                onClose={() => setResolving(null)}
                onDone={(text) => {
                  setResolving(null)
                  changed(text)
                }}
              />
            )}
          </Suspense>
        )}
      </div>
    </AccessGate>
  )
}

const METRIC_TITLE: Record<MetricKind, string> = {
  in: 'In, last 24 hours',
  out: 'Out, last 24 hours',
  balance: 'Balance, last 24 hours',
  pending: 'Waiting for approval',
}

/** The banner's vitals strip (DESIGN.md 5.8): each figure opens its metric peek. */
function Vitals({
  totals,
  urine,
  devices,
  pending,
  peek,
}: {
  totals: Totals
  urine: Swatch | null
  devices: Pick<OutputDevices, 'urine_measured'>
  pending: number
  peek: ReturnType<typeof usePopoverList<MetricKind>>
}) {
  const balanceTone = overloadTone(totals.balance_ml, devices)
  const cell = (kind: MetricKind, label: ReactNode, value: string, sub: ReactNode, name: string, valueStyle?: stylex.StyleXStyles) => (
    <PeekTrigger list={peek} payload={kind} label={name} xstyle={[s.vital, ui.focus]} openStyle={s.vitalOpen}>
      <span {...stylex.props(s.vitalLabel)}>{label}</span>
      <span {...stylex.props(s.vitalValue, valueStyle)}>
        {value.replace(/ mL$/, '')}
        <span {...stylex.props(s.vitalUnit)}> mL</span>
      </span>
      <span {...stylex.props(s.vitalSub)}>{sub}</span>
    </PeekTrigger>
  )
  return (
    <div role="group" aria-label="Last 24 hours" {...stylex.props(s.vitals)}>
      {cell(
        'in',
        <>
          <span aria-hidden {...stylex.props(s.swatch, s.swatchIn)} />
          In · 24 h
        </>,
        ml(totals.in_ml),
        'approved',
        `In ${ml(totals.in_ml)}, last 24 hours`,
      )}
      {cell(
        'out',
        <>
          <span aria-hidden {...stylex.props(s.swatch, s.swatchOut)} />
          Out · 24 h
        </>,
        ml(totals.out_ml),
        urine ? <UrineSwatch swatch={urine} size="sm" /> : 'approved',
        `Out ${ml(totals.out_ml)}, last 24 hours`,
      )}
      {cell(
        'balance',
        'Balance',
        signedMl(totals.balance_ml),
        devices.urine_measured ? 'in − out' : 'Urine not measured',
        `Balance ${signedMl(totals.balance_ml)}${devices.urine_measured ? '' : ', urine not measured'}`,
        balanceTone === 'warn' ? s.warnValue : undefined,
      )}
      {cell(
        'pending',
        <>
          <span aria-hidden {...stylex.props(s.swatch, s.swatchPending)} />
          Pending
        </>,
        ml(totals.pending_ml),
        `${pending} ${pending === 1 ? 'entry' : 'entries'}`,
        `Pending ${ml(totals.pending_ml)}, ${pending} entries`,
      )}
    </div>
  )
}

/** A pending entry as a dense row with its actions always on it; `Change…` approves a corrected volume. */
function PendingRow({
  entry: e,
  busy,
  decide,
  peek,
  onApprove,
  onReject,
}: {
  entry: Entry
  busy: boolean
  /** A nurse or matron: Reject…, Change… and Approve. Attendants see the entry only. */
  decide: boolean
  peek: ReturnType<typeof usePopoverList<Entry>>
  onApprove: (volume: number) => void
  onReject: () => void
}) {
  const [changing, setChanging] = useState(false)
  const [volume, setVolume] = useState(e.volume_ml)
  return (
    <li>
      <DenseRow
        row={entryRow(e)}
        peek={{ list: peek, payload: e }}
        actions={
          decide && (
            <>
              <Button variant="ghost" disabled={busy} aria-expanded={changing} onClick={() => setChanging(!changing)}>
                Change…
              </Button>
              <Button variant="danger" disabled={busy} onClick={onReject}>
                <XIcon /> Reject…
              </Button>
              <Button disabled={busy} onClick={() => onApprove(e.volume_ml)} minWidth={112}>
                <CheckIcon /> Approve
              </Button>
            </>
          )
        }
      />
      {decide && changing && (
        <div {...stylex.props(s.change)}>
          <Stepper label="Approved volume" value={volume} onChange={setVolume} />
          <Button disabled={busy || volume === e.volume_ml} onClick={() => onApprove(volume)}>
            <CheckIcon /> Approve {volume} mL
          </Button>
        </div>
      )}
    </li>
  )
}

const WIDE = '@media (min-width: 1100px)'
const PHONE = '@media (max-width: 640px)'

const s = stylex.create({
  page: { maxWidth: layout.wide, marginInline: 'auto', width: '100%' },
  banner: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    paddingBlock: space.lg,
    paddingInline: { default: space.xl, [PHONE]: space.lg },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  bannerTop: { display: 'flex', alignItems: 'center', gap: space.lg, flexWrap: 'wrap' },
  who: { display: 'flex', flexDirection: 'column', gap: space.xs, flexGrow: 1, minWidth: 0, flexBasis: 240 },
  patient: { fontSize: text.xl, fontWeight: weight.bold, letterSpacing: '-0.02em', lineHeight: text.leadingTight },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
    rowGap: space.xs,
    fontSize: text.sm,
    color: color.muted,
    fontVariantNumeric: 'tabular-nums',
  },
  bannerFoot: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  bannerActions: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  vitals: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(4, minmax(0, 1fr))', [PHONE]: 'repeat(2, minmax(0, 1fr))' },
    flexBasis: { default: 560, [PHONE]: '100%' },
    flexGrow: { default: 0, [PHONE]: 1 },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  vital: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.xs,
    minHeight: 44,
    minWidth: 0,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderWidth: 0,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: color.border,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
  },
  vitalOpen: { backgroundColor: color.subtle, borderBottomColor: color.accent },
  vitalLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.muted,
  },
  vitalValue: {
    fontSize: text.num,
    fontWeight: weight.bold,
    lineHeight: 1,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  warnValue: { color: color.warnText },
  vitalUnit: { fontSize: text.xs, fontWeight: weight.semibold, color: color.muted, letterSpacing: 0 },
  vitalSub: { display: 'inline-flex', alignItems: 'center', fontSize: text.xs, color: color.muted, minHeight: 16 },
  swatch: { display: 'inline-block', width: 8, height: 8, borderRadius: radius.sm },
  swatchIn: { backgroundColor: color.intake },
  swatchOut: { backgroundColor: color.output },
  swatchPending: { backgroundColor: color.pending },
  columns: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [WIDE]: 'minmax(0, 1fr) 340px' },
    gap: space.lg,
    alignItems: 'start',
  },
  main: { display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 },
  side: { display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 },
  phoneOnly: { display: { default: 'block', [WIDE]: 'none' } },
  wideOnly: { display: { default: 'none', [WIDE]: 'block' } },
  prompts: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  prompt: {
    display: 'flex',
    alignItems: 'center',
    columnGap: space.md,
    rowGap: space.sm,
    flexWrap: 'wrap',
    paddingBlock: space.md,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: color.grid,
  },
  promptText: { flexBasis: '100%', fontSize: text.sm },
  rows: { margin: 0, padding: 0, listStyle: 'none' },
  change: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
    paddingBlock: space.md,
    paddingInlineStart: { default: `calc(2 * ${space.xxxl})`, [PHONE]: space.sm },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.grid,
    backgroundColor: color.subtle,
  },
})
