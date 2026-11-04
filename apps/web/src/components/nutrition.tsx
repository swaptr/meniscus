import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import type { Admission, Alert, Meal, NutritionStatus, Staff } from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import {
  HAND_BACK_CONFIRM,
  REFER,
  REFERRAL_STATUS_LABEL,
  REFERRAL_STATUS_TONE,
  canActOnReferral,
  bedDietitianActions,
  canRefer,
  dietitianAction,
  dietitianLine,
  referralAction,
  referralLines,
} from '../lib/nutrition.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { ChevronRightIcon, CheckIcon, MealIcon, ReviewIcon } from './icons.tsx'
import { nutritionViewHref } from '../lib/nutrition-view.ts'
import { MealsList } from './meals.tsx'
import { Chip, Notice, Section } from './ui.tsx'

// Both dialogs load on first open, keeping them out of the route bundle.
const ReferralDialog = lazy(() => import('./referral-dialog.tsx').then((m) => ({ default: m.ReferralDialog })))
const CloseReferralDialog = lazy(() => import('./close-referral-dialog.tsx').then((m) => ({ default: m.CloseReferralDialog })))
const AssignDietitianDialog = lazy(() => import('./assign-dietitian-dialog.tsx').then((m) => ({ default: m.AssignDietitianDialog })))
const ConfirmDialog = lazy(() => import('./assign-dietitian-dialog.tsx').then((m) => ({ default: m.ConfirmDialog })))

type Open = 'refer' | 'close' | 'assign' | 'handBack' | null

/**
 * The bed review's Nutrition section: whether a dietitian covers the ward, the latest referral, and the last 24 h of
 * meals (the same rows as before, moved here). Nurses and the matron refer; dietitians acknowledge and close. Everything
 * shown comes from the bed review's own load; each action is one request, then the reload. No model requests.
 */
export function NutritionSection({
  admission,
  nutrition,
  meals,
  alerts,
  staff,
  now,
  canVoid,
  reload,
  onChanged,
  onMealChanged,
  referring,
  onReferringChange,
}: {
  admission: Admission
  nutrition: NutritionStatus
  meals: Meal[]
  alerts: Alert[]
  staff: Staff | null
  now: number
  canVoid: boolean
  reload: () => void
  /** After a referral action, which has already reloaded: show the message. */
  onChanged: (message: string) => void
  /** After a meal was voided: show the message and reload. */
  onMealChanged: (message: string) => void
  /** The referral dialog is open (also opened from the prompt row). */
  referring: boolean
  onReferringChange: (open: boolean) => void
}) {
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const r = nutrition.referral
  const lines = r && referralLines(r, now)
  const act = canActOnReferral(staff) && r !== null && r.status !== 'closed'
  const refer = canRefer(staff, nutrition)
  const dietitian = bedDietitianActions(staff, admission.ward_id, nutrition)
  const viewHref = nutritionViewHref(staff, admission.id)
  const [refused, setRefused] = useState<string | null>(null)
  // Each action removes the button that started it, so once the reload shows the new state, focus moves to the referral.
  const card = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  const state = r && `${r.id}:${r.status}`
  useEffect(() => {
    if (!refocus.current || !state) return
    refocus.current = false
    card.current?.focus()
  }, [state])

  const acknowledge = async (id: number) => {
    setBusy(true)
    setError(null)
    try {
      refocus.current = true
      onChanged(await referralAction(api, { op: 'acknowledge', id }, reload))
    } catch (err) {
      refocus.current = false
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const done = (message: string) => {
    refocus.current = true
    setOpen(null)
    onReferringChange(false)
    onChanged(message)
  }

  return (
    <Section
      icon={<MealIcon />}
      title="Nutrition"
      subtitle={dietitianLine(nutrition, admission.ward_name, now)}
      actions={
        (refer || dietitian.assign || viewHref) && (
          <span {...stylex.props(s.actions)}>
            {refer && (
              <Button variant="secondary" size="touch" onClick={() => onReferringChange(true)}>
                {REFER}
              </Button>
            )}
            {dietitian.assign && (
              <Button
                variant="secondary"
                size="touch"
                onClick={() => {
                  setRefused(null)
                  setOpen('assign')
                }}
              >
                {dietitian.assign}
              </Button>
            )}
            {dietitian.handBack && (
              <Button
                variant="ghost"
                size="touch"
                onClick={() => {
                  setRefused(null)
                  setOpen('handBack')
                }}
              >
                Hand back…
              </Button>
            )}
            {viewHref && (
              <Button variant="ghost" size="touch" nativeButton={false} render={<Link to="/d/$id" params={{ id: String(admission.id) }} />}>
                Nutrition view <ChevronRightIcon />
              </Button>
            )}
          </span>
        )
      }
    >
      {refused && <Notice tone="danger">{refused}</Notice>}
      {r && lines && (
        <div ref={card} role="group" tabIndex={-1} aria-label="Dietitian referral" {...stylex.props(s.referral)}>
          <div {...stylex.props(s.head)}>
            <Chip tone={REFERRAL_STATUS_TONE[r.status]} dot>
              {REFERRAL_STATUS_LABEL[r.status]}
            </Chip>
            <div {...stylex.props(s.lines)}>
              {lines.lines.map((l) => (
                <p key={l} {...stylex.props(s.line)}>
                  {l}
                </p>
              ))}
              {lines.note && <p {...stylex.props(s.note)}>{lines.note}</p>}
            </div>
          </div>
          {act && (
            <div {...stylex.props(s.actions)}>
              {r.status === 'open' && (
                <Button variant="secondary" size="touch" disabled={busy} onClick={() => void acknowledge(r.id)}>
                  <CheckIcon /> {busy ? 'Acknowledging…' : 'Acknowledge'}
                </Button>
              )}
              <Button variant="ghost" size="touch" disabled={busy} onClick={() => setOpen('close')}>
                <ReviewIcon /> Close…
              </Button>
            </div>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      )}
      <h3 {...stylex.props(s.h3)}>Meals, 24 h</h3>
      <MealsList meals={meals} alerts={alerts} canVoid={canVoid} onChanged={onMealChanged} />
      {(open === 'assign' || open === 'handBack') && (
        <Suspense fallback={null}>
          {open === 'assign' ? (
            <AssignDietitianDialog
              admissionId={admission.id}
              wardId={admission.ward_id}
              wardName={admission.ward_name}
              reload={reload}
              onClose={() => setOpen(null)}
              onDone={(message) => {
                setOpen(null)
                onChanged(message)
              }}
            />
          ) : (
            <ConfirmDialog
              title={HAND_BACK_CONFIRM}
              description="The patient goes back to the ward's dietitians. Referrals stay as they are."
              confirm="Hand back"
              run={() => dietitianAction(api, { op: 'handBack', admissionId: admission.id, wardName: admission.ward_name }, reload)}
              onClose={() => setOpen(null)}
              onDone={(message, ok) => {
                setOpen(null)
                if (ok) onChanged(message)
                else setRefused(message)
              }}
            />
          )}
        </Suspense>
      )}
      {(open === 'close' || referring) && (
        <Suspense fallback={null}>
          {open === 'close' && r ? (
            <CloseReferralDialog referralId={r.id} now={now} onClose={() => setOpen(null)} onDone={done} reload={reload} />
          ) : (
            <ReferralDialog
              admissionId={admission.id}
              bed={`${admission.ward_code}-${admission.bed}`}
              onClose={() => onReferringChange(false)}
              onDone={done}
              reload={reload}
            />
          )}
        </Suspense>
      )}
    </Section>
  )
}

const s = stylex.create({
  referral: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  head: { display: 'flex', alignItems: 'flex-start', gap: space.md, flexWrap: 'wrap' },
  lines: { display: 'flex', flexDirection: 'column', gap: space.sm, flexGrow: 1, flexBasis: 220, minWidth: 0 },
  line: { fontSize: text.md, overflowWrap: 'anywhere' },
  note: { fontSize: text.sm, color: color.muted, overflowWrap: 'anywhere' },
  actions: { display: 'flex', gap: space.md, flexWrap: 'wrap', justifyContent: 'flex-end' },
  h3: { fontSize: text.xs, fontWeight: weight.bold, letterSpacing: '0.05em', color: color.muted },
})
