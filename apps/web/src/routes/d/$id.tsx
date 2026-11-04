import { lazy, Suspense, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import type { NutritionView, Staff } from '@meniscus/shared'
import { AccessGate } from '../../components/access-gate.tsx'
import { Button } from '../../components/button.tsx'
import { CareIcon, CheckIcon, MealIcon, PencilIcon, PlusIcon, ReviewIcon, XIcon } from '../../components/icons.tsx'
import { MealsList } from '../../components/meals.tsx'
import { Placeholder } from '../../components/placeholder.tsx'
import { BedBadge, Chip, Notice, Section, Stat } from '../../components/ui.tsx'
import { ui } from '../../components/ui.styles.ts'
import { api, errorText } from '../../lib/api.ts'
import { rowActions } from '../../lib/care.ts'
import {
  HAND_BACK_CONFIRM,
  REFERRAL_STATUS_LABEL,
  REFERRAL_STATUS_TONE,
  assignmentActions,
  assignmentLine,
  dietitianAction,
  dietitianLine,
  isDietitian,
  referralAction,
} from '../../lib/nutrition.ts'
import {
  VIEW_ONLY,
  dayRows,
  dietCare,
  dietHistory,
  dietLine,
  nutritionViewLoad,
  viewReferrals,
  viewTitle,
} from '../../lib/nutrition-view.ts'
import { usePlace } from '../../lib/place.ts'
import { useNeedsReason } from '../../lib/use-access.ts'
import { useResource } from '../../lib/use-resource.ts'
import { useStaff } from '../../lib/use-staff.ts'
import { color, radius, space, text, weight } from '../../tokens.stylex.ts'
import { failureGoesTo, flash as showToast } from '../../lib/toast.ts'

export const Route = createFileRoute('/d/$id')({
  staticData: { title: 'Nutrition view' },
  component: PatientView,
})

// Every dialog loads on first use.
const AssignDietitianDialog = lazy(() =>
  import('../../components/assign-dietitian-dialog.tsx').then((m) => ({ default: m.AssignDietitianDialog })),
)
const ConfirmDialog = lazy(() => import('../../components/assign-dietitian-dialog.tsx').then((m) => ({ default: m.ConfirmDialog })))
const CloseReferralDialog = lazy(() =>
  import('../../components/close-referral-dialog.tsx').then((m) => ({ default: m.CloseReferralDialog })),
)
const CareFormDialog = lazy(() => import('../../components/care-forms.tsx').then((m) => ({ default: m.CareFormDialog })))
const EndCareDialog = lazy(() => import('../../components/care-forms.tsx').then((m) => ({ default: m.EndCareDialog })))

type Open =
  | { kind: 'assign' }
  | { kind: 'confirm'; title: string; confirm: string; op: 'takeOver' | 'handBack' }
  | { kind: 'close'; referralId: number }
  | { kind: 'diet'; changing: boolean }
  | { kind: 'endDiet' }
  | null

/** The patient nutrition view (web/dietitian). Anyone else is told it is for dietitians, and nothing is loaded. */
function PatientView() {
  const { id } = Route.useParams()
  const staff = useStaff()
  if (!isDietitian(staff)) {
    return (
      <div {...stylex.props(ui.stack)}>
        <Placeholder icon={MealIcon} title={VIEW_ONLY} />
        <span>
          <Button nativeButton={false} render={<Link to="/n/$id" params={{ id }} />}>
            Open the bed review
          </Button>
        </span>
      </div>
    )
  }
  return <Loaded admissionId={Number(id)} staff={staff!} />
}

function Loaded({ admissionId, staff }: { admissionId: number; staff: Staff }) {
  // The first load names the ward. Until then, and while that ward still needs a reason, nothing refreshes.
  const [wardId, setWardId] = useState<number | null>(null)
  const gated = useNeedsReason(wardId)
  // Local API only (no model requests): one GET, then every 30 s while visible, not locked and not gated.
  const res = useResource(
    `nutrition:${admissionId}`,
    async (signal) => ({ v: await nutritionViewLoad(api, admissionId)(signal), at: Date.now() }),
    wardId === null || gated ? undefined : 30_000,
  )
  const named = res.data?.v.admission.ward_id ?? null
  if (named !== wardId) setWardId(named)
  // A reason was just accepted: the view opens with the next GET.
  const [waited, setWaited] = useState(false)
  if (gated && !waited) setWaited(true)
  if (!gated && waited) {
    setWaited(false)
    res.reload()
  }

  if (res.error && !res.data) {
    return (
      <div {...stylex.props(ui.stack)}>
        <Notice tone="danger">{errorText(res.error)}</Notice>
        <span>
          <Button variant="secondary" size="touch" onClick={res.reload}>
            Try again
          </Button>
        </span>
      </div>
    )
  }
  if (!res.data) {
    return (
      <p role="status" {...stylex.props(ui.muted)}>
        Loading the nutrition view…
      </p>
    )
  }
  const { v, at } = res.data
  // Outside the dietitian's wards: nothing of the patient until a reason is given. An assignment does not waive it.
  return (
    <AccessGate wardId={v.admission.ward_id} wardName={v.admission.ward_name} fallback="/d">
      <View v={v} now={at} staff={staff} reload={res.reload} />
    </AccessGate>
  )
}

function View({ v, now, staff, reload }: { v: NutritionView; now: number; staff: Staff; reload: () => void }) {
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)
  const [message, setInline] = useState<{ ok: boolean; text: string } | null>(null)
  /** Results go to the one toast; a refusal about what was sent stays inline here. */
  const setMessage = (m: { ok: boolean; text: string } | null, err?: unknown) => {
    if (m && (m.ok || failureGoesTo(err) === 'toast')) {
      setInline(null)
      showToast({ tone: m.ok ? 'ok' : 'danger', text: m.text })
    } else setInline(m)
  }
  const a = v.admission
  usePlace({
    title: `Bed ${a.bed} · ${a.ward_code}`,
    crumbs: [
      { label: 'Nutrition', href: '/d' },
      { label: viewTitle(v), href: `/d/${a.id}` },
    ],
  })
  const assign = assignmentActions(v.nutrition, staff)
  const diet = v.diet ? rowActions(v.diet, staff) : null
  const history = dietHistory(v, now)
  const days = dayRows(v)

  const run = async (fn: () => Promise<{ ok: boolean; text: string } | string>) => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fn()
      setMessage(typeof r === 'string' ? { ok: true, text: r } : r)
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) }, err)
    } finally {
      setBusy(false)
    }
  }
  const done = (text: string, ok = true) => {
    setOpen(null)
    setMessage({ ok, text })
  }

  const today = v.days[0] ?? { meals: 0, poor_meals: 0 }
  const threeDay = v.days.reduce((n, d) => n + d.meals, 0)
  const referral = v.nutrition.referral

  return (
    <div {...stylex.props(ui.stack)}>
      <section aria-label="Patient" {...stylex.props(s.banner)}>
        <div {...stylex.props(s.bannerTop)}>
          <BedBadge ward={a.ward_code} bed={a.bed} size="lg" />
          <div {...stylex.props(s.bannerMain)}>
            <h2 translate="no" {...stylex.props(s.title)}>
              {viewTitle(v)}
            </h2>
            <span {...stylex.props(s.meta)}>
              {[a.ward_name, `MRN ${a.mrn}`, a.weight_kg !== null ? `${a.weight_kg} kg` : null].filter(Boolean).join(' · ')}
            </span>
            {referral && (
              <span {...stylex.props(s.chips)}>
                <Chip tone={REFERRAL_STATUS_TONE[referral.status]} glyph>
                  {`Referral ${REFERRAL_STATUS_LABEL[referral.status].toLowerCase()}`}
                </Chip>
              </span>
            )}
          </div>
          <Button variant="secondary" nativeButton={false} render={<Link to="/n/$id" params={{ id: String(a.id) }} />}>
            Bed review
          </Button>
        </div>
        <dl aria-label="Meals" {...stylex.props(s.vitals)}>
          <Stat label="Meals today" value={today.meals} unit="" />
          <Stat label="50% or less today" value={today.poor_meals} unit="" tone={today.poor_meals > 0 ? 'warn' : 'neutral'} />
          <Stat label={`Last ${v.days.length} days`} value={threeDay} unit="" />
        </dl>
      </section>

      {message && <Notice tone={message.ok ? 'ok' : 'danger'}>{message.text}</Notice>}

      <div {...stylex.props(s.columns)}>
        <div {...stylex.props(s.side)}>
          <Section
            icon={<MealIcon />}
            title="Dietitian"
            subtitle={dietitianLine(v.nutrition, a.ward_name, now)}
            actions={
              <span {...stylex.props(s.actions)}>
                {assign.takeOn && (
                  <Button
                    variant="secondary"
                    size="touch"
                    disabled={busy}
                    onClick={() => void run(() => dietitianAction(api, { op: 'assign', admissionId: a.id, staffId: staff.id }, reload))}
                  >
                    <PlusIcon /> Take on
                  </Button>
                )}
                {assign.takeOver && (
                  <Button
                    variant="secondary"
                    size="touch"
                    onClick={() => setOpen({ kind: 'confirm', title: assign.takeOver!, confirm: 'Take over', op: 'takeOver' })}
                  >
                    Take over…
                  </Button>
                )}
                {assign.handBack && (
                  <Button
                    variant="ghost"
                    size="touch"
                    onClick={() => setOpen({ kind: 'confirm', title: HAND_BACK_CONFIRM, confirm: 'Hand back', op: 'handBack' })}
                  >
                    Hand back…
                  </Button>
                )}
                {assign.assign && (
                  <Button variant="ghost" size="touch" onClick={() => setOpen({ kind: 'assign' })}>
                    Assign…
                  </Button>
                )}
              </span>
            }
          >
            {v.assignments.length > 0 && (
              <ol aria-label="Assignment history" {...stylex.props(s.history)}>
                {v.assignments.map((x) => (
                  <li key={x.id} {...stylex.props(s.historyRow)}>
                    {assignmentLine(x, now)}
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section
            icon={<CareIcon />}
            title="Diet"
            actions={
              !v.diet && (
                <Button variant="secondary" size="touch" onClick={() => setOpen({ kind: 'diet', changing: false })}>
                  <PlusIcon /> Add diet
                </Button>
              )
            }
          >
            <div {...stylex.props(s.rowTop)}>
              <strong {...stylex.props(s.rowText)}>{dietLine(v)}</strong>
              {diet?.change && (
                <span {...stylex.props(s.actions)}>
                  <Button variant="ghost" size="touch" aria-label="Change diet" onClick={() => setOpen({ kind: 'diet', changing: true })}>
                    <PencilIcon /> Change…
                  </Button>
                  {diet.end && (
                    <Button variant="ghost" size="touch" aria-label="End diet" onClick={() => setOpen({ kind: 'endDiet' })}>
                      <XIcon /> End…
                    </Button>
                  )}
                </span>
              )}
            </div>
            {history.length > 0 && (
              <>
                <h3 {...stylex.props(s.h3)}>History</h3>
                <ol {...stylex.props(s.history)}>
                  {history.map((line, i) => (
                    <li key={i} {...stylex.props(s.historyRow)}>
                      {line}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Section>

          <Section icon={<ReviewIcon />} title="Referrals">
            {v.referrals.length === 0 ? (
              <p {...stylex.props(ui.muted)}>No referrals</p>
            ) : (
              <ul {...stylex.props(s.list)}>
                {viewReferrals(v, now).map((r) => (
                  <li key={r.referral.id} {...stylex.props(s.referral)}>
                    <div {...stylex.props(s.head)}>
                      <Chip tone={REFERRAL_STATUS_TONE[r.referral.status]} dot>
                        {REFERRAL_STATUS_LABEL[r.referral.status]}
                      </Chip>
                      <div {...stylex.props(s.lines)}>
                        {r.lines.map((l) => (
                          <p key={l} {...stylex.props(s.line)}>
                            {l}
                          </p>
                        ))}
                        {r.note && <p {...stylex.props(s.note)}>{r.note}</p>}
                      </div>
                    </div>
                    {(r.acknowledge || r.close) && (
                      <div {...stylex.props(s.actions, s.end)}>
                        {r.acknowledge && (
                          <Button
                            variant="secondary"
                            size="touch"
                            disabled={busy}
                            onClick={() => void run(() => referralAction(api, { op: 'acknowledge', id: r.referral.id }, reload))}
                          >
                            <CheckIcon /> Acknowledge
                          </Button>
                        )}
                        <Button variant="ghost" size="touch" onClick={() => setOpen({ kind: 'close', referralId: r.referral.id })}>
                          <ReviewIcon /> Close…
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div {...stylex.props(s.main)}>
          <Section icon={<MealIcon />} title="Food chart" subtitle="Meals of the last 3 days, newest first.">
            {days.map((d) => (
              <div key={d.date} {...stylex.props(s.day)}>
                <h3 {...stylex.props(s.dayTitle)}>{d.title}</h3>
                {d.meals.length > 0 && <MealsList meals={d.meals} canVoid={false} onChanged={(text) => done(text)} />}
              </div>
            ))}
          </Section>
        </div>
      </div>

      {open && (
        <Suspense fallback={null}>
          {open.kind === 'assign' ? (
            <AssignDietitianDialog
              admissionId={a.id}
              wardId={a.ward_id}
              wardName={a.ward_name}
              reload={reload}
              onClose={() => setOpen(null)}
              onDone={(text) => done(text)}
            />
          ) : open.kind === 'confirm' ? (
            <ConfirmDialog
              title={open.title}
              description={
                open.op === 'handBack'
                  ? "The patient goes back to the ward's dietitians. Referrals stay as they are."
                  : 'The patient is assigned to you from now. The other dietitian is no longer assigned.'
              }
              confirm={open.confirm}
              run={() =>
                dietitianAction(
                  api,
                  open.op === 'handBack'
                    ? { op: 'handBack', admissionId: a.id, wardName: a.ward_name }
                    : { op: 'assign', admissionId: a.id, staffId: staff.id },
                  reload,
                )
              }
              onClose={() => setOpen(null)}
              onDone={done}
            />
          ) : open.kind === 'close' ? (
            <CloseReferralDialog
              referralId={open.referralId}
              now={now}
              onClose={() => setOpen(null)}
              onDone={(text) => done(text)}
              reload={reload}
            />
          ) : open.kind === 'diet' ? (
            <CareFormDialog
              kind="diet"
              changing={open.changing}
              admissionId={a.id}
              wardCode={a.ward_code}
              care={dietCare(v.diet)}
              reload={reload}
              onClose={() => setOpen(null)}
              onDone={(text) => done(text)}
            />
          ) : (
            <EndCareDialog kind="diet" admissionId={a.id} reload={reload} onClose={() => setOpen(null)} onDone={(text) => done(text)} />
          )}
        </Suspense>
      )}
    </div>
  )
}

const WIDE = '@media (min-width: 1100px)'

const s = stylex.create({
  banner: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    padding: space.xl,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  bannerTop: { display: 'flex', alignItems: 'flex-start', gap: space.lg, flexWrap: 'wrap' },
  bannerMain: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0, flexGrow: 1, flexBasis: 200 },
  title: { margin: 0, fontSize: text.xl, fontWeight: weight.bold, letterSpacing: '-0.02em', overflowWrap: 'anywhere' },
  meta: { fontSize: text.sm, color: color.muted },
  chips: { display: 'flex', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  vitals: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: space.md,
    margin: 0,
  },
  // Phones: one column in the spec'd order (Dietitian, Diet, Referrals, Food chart). From 1100 px the food chart is the
  // main column and the dietitian, diet and referrals a 340 px side column.
  columns: {
    display: { default: 'flex', [WIDE]: 'grid' },
    flexDirection: 'column',
    gap: space.lg,
    gridTemplateColumns: { default: null, [WIDE]: 'minmax(0, 1fr) 340px' },
    alignItems: { default: 'stretch', [WIDE]: 'start' },
  },
  side: {
    display: { default: 'contents', [WIDE]: 'flex' },
    flexDirection: 'column',
    gap: space.lg,
    gridColumn: { default: null, [WIDE]: '2' },
    gridRow: { default: null, [WIDE]: '1' },
    minWidth: 0,
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    minWidth: 0,
    gridColumn: { default: null, [WIDE]: '1' },
    gridRow: { default: null, [WIDE]: '1' },
  },
  actions: { display: 'flex', gap: space.sm, flexWrap: 'wrap' },
  end: { justifyContent: 'flex-end' },
  rowTop: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  rowText: { flexGrow: 1, flexBasis: 220, fontSize: text.md, fontWeight: weight.semibold },
  h3: { margin: 0, fontSize: text.xs, fontWeight: weight.bold, color: color.muted },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  /** A history list in a column: no flex basis, which would set its height. */
  history: { display: 'flex', flexDirection: 'column', gap: space.sm, minWidth: 0, margin: 0, padding: 0, listStyle: 'none' },
  historyRow: { fontSize: text.sm, overflowWrap: 'anywhere' },
  list: { display: 'flex', flexDirection: 'column', gap: space.md, margin: 0, padding: 0, listStyle: 'none' },
  referral: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
  },
  head: { display: 'flex', alignItems: 'flex-start', gap: space.md, flexWrap: 'wrap' },
  line: { margin: 0, fontSize: text.md, overflowWrap: 'anywhere' },
  note: { margin: 0, fontSize: text.sm, color: color.muted, overflowWrap: 'anywhere' },
  day: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  dayTitle: { margin: 0, fontSize: text.sm, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
})
