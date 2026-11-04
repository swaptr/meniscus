import { lazy, Suspense, use, useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  DISH_KINDS,
  MAX_MEAL_ITEMS,
  PORTIONS,
  type CareStatus,
  type DishKind,
  type DishValue,
  type MealKind,
  type Portion,
  type ServedTray,
} from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import { nbmWarning, saveLabel } from '../lib/care.ts'
import { DISH_LABEL } from '../lib/labels.ts'
import {
  comparisonNote,
  dishError,
  editDish,
  emptyMealForm,
  MEAL_LABEL,
  mealLocked,
  mealLockedReason,
  mealOnOpen,
  mealReviewText,
  mealReadForm,
  formFromRead,
  retakeMeal,
  PORTION_CHIP,
  PORTION_LABEL,
  decideMeal,
  saveMeal,
  saveMealText,
  type MealForm as Form,
} from '../lib/meals.ts'
import { shrinkPhoto } from '../lib/photo.ts'
import { chartedAt } from '../lib/resolve.ts'
import { holdUnsaved } from '../lib/unsaved.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { CameraIcon, MealIcon, PlusIcon, XIcon } from './icons.tsx'
import { Chip, Notice, Section, Stepper, ConfidenceChip } from './ui.tsx'
import { ui } from './ui.styles.ts'
import { f as field } from './form.styles.ts'
import { WhenField } from './when-field.tsx'
import { ChoiceChips } from './choice-chips.tsx'

// The tray photo with its dish outlines loads with the first read (the photo viewer's chunk).
const CapturedSource = lazy(() => import('./source-view.tsx').then((m) => ({ default: m.CapturedSource })))
// "Served tray": its own small chunk, loaded with the form.
const ServedTrayTile = lazy(() => import('./served-tray.tsx').then((m) => ({ default: m.ServedTrayTile })))

/** In display order through the day. */
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'] as const satisfies readonly MealKind[]

/**
 * Record a meal at the bed: by hand, or from one tray photo (3 model requests, 5 when the bed's served tray photo is
 * compared, or 1 in Spark-only mode, set by the server; never retried) that fills the form.
 * Saving is one request with no model call; a meal's fluid becomes a pending entry for the nurse.
 */
export function MealForm({
  served,
  admission,
  care,
  onCancel,
  onSaved,
}: {
  /** The one served-tray lookup sent when Meal was opened (null when it failed); the form waits for it. */
  served: Promise<ServedTray | null>
  admission: { id: number; admitted_at: string }
  /** The bed's care orders: nil by mouth warns before saving a meal with some portion eaten or some fluid. */
  care: CareStatus
  onCancel: () => void
  onSaved: (message: string) => void
}) {
  const servedTray = use(served)
  const [opened] = useState(() => mealOnOpen(new Date(), servedTray))
  const [form, setForm] = useState<Form>(() => ({ ...emptyMealForm(new Date()), meal: opened.meal }))
  const [when, setWhen] = useState<string | null>(null)
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The tray photo the form was read from; uploaded once with the meal. */
  const [tray, setTray] = useState<Blob | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // An open meal form is unsaved work: "Switch user" asks first.
  useEffect(() => holdUnsaved(), [])
  // Leaving mid-read drops the answer; the preview URL is released with the form.
  useEffect(() => () => abortRef.current?.abort(), [])

  const now = new Date()
  const charted = when === null ? null : chartedAt(when, now, admission.admitted_at)
  const warning = nbmWarning(care, form, now.getTime())
  const whenError = charted && 'error' in charted ? charted.error : null
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const setDish = (i: number, patch: Partial<Omit<DishValue, 'index'>>) => setForm((f) => editDish(f, i, patch))
  const unnamed = dishError(form)

  const onTray = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    const c = new AbortController()
    abortRef.current = c
    setBusy('read')
    try {
      const photo = await shrinkPhoto(file)
      // One tray read = 3 model requests, 5 with a served photo, or 1 in Spark-only mode (the server decides). Never
      // retried automatically. It names the bed and the selected meal, which find the served photo.
      // The meal chips are disabled while it reads, so the meal sent is the form's.
      const r = await api.readMeal(photo, mealReadForm(admission.id, form), c.signal)
      setTray(photo)
      setForm((f) => formFromRead(f, r))
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(errorText(err))
    } finally {
      abortRef.current = null
      setBusy(null)
    }
  }

  const onSave = async () => {
    setError(null)
    setBusy('save')
    try {
      // The first attempt fixes whether the tray read is linked; the form keeps that for a retry.
      const decided = decideMeal(form)
      setForm(decided)
      const m = await saveMeal(api, admission.id, decided, charted, tray ? { kind: 'photo', blob: tray } : undefined)
      onSaved(m.warning ? `${saveMealText(m)} ${m.warning}` : saveMealText(m))
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  const review = form.read ? mealReviewText(form.read) : null
  const compared = comparisonNote(form.read)
  const locked = mealLocked(form)
  const lockedReason = mealLockedReason(form)
  const onPhoto = () => {
    // A read bound to a served photo fixes the meal: retaking clears it first, so another meal can be picked.
    if (locked) {
      setForm(retakeMeal)
      setTray(null)
    }
    fileRef.current?.click()
  }
  return (
    <Section
      title="Meal"
      icon={<MealIcon />}
      actions={
        <Button variant="ghost" onClick={onCancel} disabled={busy === 'save'}>
          <XIcon />
          Cancel
        </Button>
      }
    >
      <div {...stylex.props(s.tray)}>
        {!tray && (
          <span {...stylex.props(s.thumb, s.thumbEmpty)}>
            <CameraIcon size={24} />
          </span>
        )}
        <div {...stylex.props(s.trayText)}>
          {busy === 'read' ? (
            <>
              <span aria-live="polite" {...stylex.props(s.trayTitle)}>
                Reading the tray…
              </span>
              <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="lg" onClick={onPhoto} disabled={busy !== null}>
                <CameraIcon />
                {form.read ? 'Retake tray photo' : 'Photo of the tray'}
              </Button>
              <span {...stylex.props(ui.muted)}>
                {form.read ? 'Muse Spark filled the form. Check each value.' : 'Or fill the form by hand.'}
              </span>
            </>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          void onTray(f)
        }}
        {...stylex.props(ui.hiddenInput)}
        tabIndex={-1}
        aria-hidden
      />
      {tray && form.read && (
        <Suspense fallback={<p {...stylex.props(ui.muted)}>Loading the tray photo…</p>}>
          <CapturedSource
            source={{
              kind: 'photo',
              blob: tray,
              segmentation: null,
              // Labelled from the form's dishes, so an edit shows on the photo.
              tray: { segmentation: form.read.segmentation, dishes: form.dishes, fluids: form.read.reading.fluids },
            }}
          />
        </Suspense>
      )}
      {form.read && (
        <div {...stylex.props(ui.row)}>
          <ConfidenceChip source="Photo" confidence={form.read.reading.confidence} />
          {form.read.reading.notes && <span {...stylex.props(ui.muted)}>{form.read.reading.notes}</span>}
        </div>
      )}
      {review && <Notice tone="warn">{review}</Notice>}
      {compared && <Notice tone="info">{compared}</Notice>}
      {!form.read && (
        <Suspense fallback={null}>
          <ServedTrayTile admissionId={admission.id} meal={form.meal} disabled={busy !== null} />
        </Suspense>
      )}

      <fieldset {...stylex.props(s.fieldset)}>
        <legend {...stylex.props(s.label)}>Meal</legend>
        {opened.waiting && !form.read && <span {...stylex.props(ui.muted)}>{opened.waiting}</span>}
        <ChoiceChips
          legend="Meal"
          hideLegend
          options={MEAL_ORDER.map((m) => [m, MEAL_LABEL[m]] as const)}
          value={form.meal}
          disabled={locked || busy === 'read'}
          onChange={(m) => set({ meal: m })}
        />
        {lockedReason && (
          <span id="meal-locked" {...stylex.props(ui.muted)}>
            {lockedReason}
          </span>
        )}
        {/* When belongs with which meal: one group of controls (web/interface "Attendant screens stay simple"). */}
        <WhenField value={when} onChange={setWhen} error={whenError} />
      </fieldset>

      <fieldset {...stylex.props(s.fieldset)}>
        <legend {...stylex.props(s.label)}>
          How much was eaten? <span {...stylex.props(s.labelValue)}>{PORTION_LABEL[form.portion]}</span>
        </legend>
        <ChoiceChips
          legend="How much"
          hideLegend
          options={PORTIONS.map((p: Portion) => [String(p), <PortionChip key={p} p={p} name={PORTION_LABEL[p]} />] as const)}
          value={String(form.portion)}
          onChange={(p) => set({ portion: Number(p) as Portion })}
        />
      </fieldset>

      <fieldset {...stylex.props(s.fieldset, s.details)}>
        <legend {...stylex.props(ui.srOnly)}>What was on the tray</legend>
        {form.dishes.length > 0 ? (
          <div {...stylex.props(s.field)}>
            <span {...stylex.props(s.label)}>Dishes</span>
            <ol {...stylex.props(s.dishes)}>
              {form.dishes.map((d, i) => (
                <DishRow
                  key={i}
                  n={i}
                  dish={d}
                  measured={form.read?.reading.dishes[i]?.basis === 'measured' && form.read.reading.dishes[i].index === d.index}
                  onChange={(patch) => setDish(i, patch)}
                />
              ))}
            </ol>
          </div>
        ) : (
          <label {...stylex.props(s.field)}>
            <span {...stylex.props(s.label)}>Items (optional)</span>
            <input
              value={form.items}
              maxLength={MAX_MEAL_ITEMS}
              onChange={(e) => set({ items: e.target.value })}
              placeholder="e.g. rice, dal, roti"
              {...stylex.props(field.input)}
            />
          </label>
        )}

        <div {...stylex.props(s.field)}>
          <span {...stylex.props(s.label)}>Fluid with the meal (optional)</span>
          {form.fluid_ml === null ? (
            <div>
              <Button variant="secondary" onClick={() => set({ fluid_ml: 150 })}>
                <PlusIcon />
                Soup, milk, tea or juice
              </Button>
            </div>
          ) : (
            <div {...stylex.props(ui.row)}>
              <Stepper label="Fluid" value={form.fluid_ml} onChange={(v) => set({ fluid_ml: v })} />
              <Button variant="ghost" onClick={() => set({ fluid_ml: null })}>
                No fluid
              </Button>
            </div>
          )}
          {form.fluid_ml !== null && <span {...stylex.props(ui.muted)}>Charted as food intake, waiting for nurse approval.</span>}
        </div>
      </fieldset>

      {warning && <Notice tone="warn">{warning}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button size="lg" block onClick={() => void onSave()} disabled={busy !== null || !!whenError || !!unnamed}>
        {busy === 'save' ? 'Saving…' : saveLabel(warning, `Save ${MEAL_LABEL[form.meal].toLowerCase()}`)}
      </Button>
    </Section>
  )
}

/** One dish from the tray read: its region number, name, kind and how much of it was eaten. */
function DishRow({
  n,
  dish: d,
  measured,
  onChange,
}: {
  n: number
  dish: DishValue
  /** The read measured this dish's portion against the served tray. */
  measured: boolean
  onChange: (patch: Partial<Omit<DishValue, 'index'>>) => void
}) {
  const id = `dish-${n}`
  const label = d.name.trim() || `dish ${n + 1}`
  return (
    <li {...stylex.props(s.dish)}>
      <div {...stylex.props(s.dishHead)}>
        <span aria-label={d.index > 0 ? `Dish ${d.index} on the photo` : 'Not in an outlined dish'} role="img" {...stylex.props(s.badge)}>
          {d.index > 0 ? d.index : '–'}
        </span>
        <div {...stylex.props(s.dishFields)}>
          <label {...stylex.props(field.field)}>
            <span {...stylex.props(field.label)}>Name</span>
            <input
              value={d.name}
              maxLength={80}
              aria-invalid={!d.name.trim() || undefined}
              aria-describedby={!d.name.trim() ? `${id}-error` : undefined}
              onChange={(e) => onChange({ name: e.target.value })}
              {...stylex.props(field.input)}
            />
            {!d.name.trim() && (
              <span id={`${id}-error`} role="alert" {...stylex.props(s.error)}>
                Enter a name for this dish.
              </span>
            )}
          </label>
          <label {...stylex.props(field.field)}>
            <span {...stylex.props(field.label)}>Kind</span>
            <select
              value={d.dish_kind}
              onChange={(e) => onChange({ dish_kind: e.target.value as DishKind })}
              {...stylex.props(field.input)}
            >
              {DISH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DISH_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <fieldset {...stylex.props(s.fieldset)}>
        <legend {...stylex.props(field.label)}>
          Eaten <span {...stylex.props(s.labelValue)}>{PORTION_LABEL[d.portion]}</span>
          {measured && (
            <span {...stylex.props(s.measured)}>
              <Chip tone="info">measured</Chip>
            </span>
          )}
        </legend>
        <ChoiceChips
          legend="How much"
          hideLegend
          options={PORTIONS.map(
            (p: Portion) => [String(p), <PortionChip key={p} p={p} name={`${PORTION_LABEL[p]} of ${label}`} />] as const,
          )}
          value={String(d.portion)}
          onChange={(p) => onChange({ portion: Number(p) as Portion })}
        />
      </fieldset>
    </li>
  )
}

const s = stylex.create({
  details: { display: 'flex', flexDirection: 'column', gap: space.lg },
  dishes: { display: 'flex', flexDirection: 'column', gap: space.md, margin: 0, padding: 0, listStyle: 'none' },
  // DESIGN.md 7.2: form rows inside an inset panel, one per dish.
  dish: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
  },
  dishHead: { display: 'flex', alignItems: 'flex-start', gap: space.lg },
  dishFields: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 640px)': 'minmax(0, 1fr) minmax(0, 1fr)' },
    gap: space.lg,
    flexGrow: 1,
    minWidth: 0,
  },
  badge: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: 28,
    height: 28,
    marginTop: `calc(${space.xl} + ${space.sm} + ${space.xs})`,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    backgroundColor: color.bg,
    color: color.fg,
    fontSize: text.sm,
    fontWeight: weight.bold,
    fontVariantNumeric: 'tabular-nums',
  },
  error: { fontSize: text.sm, fontWeight: weight.semibold, color: color.danger },
  tray: { display: 'flex', alignItems: 'center', gap: space.lg },
  thumb: { width: 72, height: 96, flexShrink: 0, borderRadius: radius.md, objectFit: 'cover', backgroundColor: color.subtle },
  thumbEmpty: { display: 'grid', placeItems: 'center', color: color.muted },
  trayText: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space.sm, minWidth: 0 },
  trayTitle: { fontWeight: weight.bold },
  fieldset: { display: 'flex', flexDirection: 'column', gap: space.sm, borderWidth: 0, padding: 0, margin: 0, minWidth: 0 },
  field: { display: 'flex', flexDirection: 'column', gap: space.sm },
  label: { padding: 0, fontSize: text.sm, fontWeight: weight.bold },
  labelValue: { fontWeight: weight.semibold, color: color.muted },
  measured: { marginInlineStart: space.sm },
})

/** A portion chip: the short mark shown, the words read. */
function PortionChip({ p, name }: { p: Portion; name: string }) {
  return (
    <>
      <span aria-hidden>{PORTION_CHIP[p]}</span>
      <span {...stylex.props(ui.srOnly)}>{name}</span>
    </>
  )
}
