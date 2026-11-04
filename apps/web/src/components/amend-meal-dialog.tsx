/**
 * "Amend…" on a meal (web/ward "Amend a meal from the bed review"): its portion, its dish rows or items, and a reason;
 * one `POST /api/meals/<id>/amend`, then the bed reloads. No model requests. DESIGN.md 4.11, on the sheet recipe.
 */
import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import * as stylex from '@stylexjs/stylex'
import { DISH_KINDS, MAX_MEAL_ITEMS, PORTIONS, type DishKind, type DishValue, type Meal, type Portion } from '@meniscus/shared'
import { errorText, api } from '../lib/api.ts'
import { DISH_LABEL } from '../lib/labels.ts'
import { AMEND_REASON_MAX, AMEND_REASON_MIN, amendBody, amendForm, saveAmend, type AmendForm } from '../lib/meal-amend.ts'
import { MEAL_LABEL, PORTION_CHIP, PORTION_LABEL } from '../lib/meals.ts'
import { staffLabel } from '../lib/staff.ts'
import { hhmm } from '../lib/timeline.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, radius, space } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { ChoiceChips } from './choice-chips.tsx'
import { f as field } from './form.styles.ts'
import { PlusIcon, XIcon } from './icons.tsx'
import { sheet } from './sheet.styles.ts'
import { Sheet } from './sheet.tsx'

const PORTION_OPTIONS = PORTIONS.map((p) => [String(p), PORTION_CHIP[p]] as const)
const toPortion = (v: string) => Number(v) as Portion

export function AmendMealDialog({ meal: m, onClose, onDone }: { meal: Meal; onClose: () => void; onDone: (message: string) => void }) {
  const staff = useStaff()
  const [form, setForm] = useState<AmendForm>(() => amendForm(m))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = amendBody(m, form)
  const name = MEAL_LABEL[m.meal].toLowerCase()
  const set = (patch: Partial<AmendForm>) => setForm((x) => ({ ...x, ...patch }))
  const setDish = (i: number, patch: Partial<DishValue>) =>
    setForm((x) => ({ ...x, dishes: x.dishes.map((d, k) => (k === i ? { ...d, ...patch } : d)) }))
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      // The bed reloads (its meals included) through onDone.
      if (await saveAmend(api, m, form, () => undefined)) onDone(`Amended ${name} at ${hhmm(m.created_at)}.`)
      else setBusy(false)
    } catch (err) {
      setError(err instanceof Error && !('status' in err) ? err.message : errorText(err))
      setBusy(false)
    }
  }
  const reasonShort = form.reason.trim().length > 0 && form.reason.trim().length < AMEND_REASON_MIN
  return (
    <Sheet
      onClose={onClose}
      title={`Amend ${name} at ${hhmm(m.created_at)}`}
      description="The values saved before stay in the meal’s history with your reason."
      aside={
        <Dialog.Close render={<Button variant="ghost" icon aria-label="Close" />}>
          <XIcon />
        </Dialog.Close>
      }
      savedAs={staffLabel(staff)}
      error={error}
      actions={
        <Button disabled={busy || body === null} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <ChoiceChips
        legend={`How much was eaten? ${PORTION_LABEL[form.portion]}`}
        options={PORTION_OPTIONS}
        value={String(form.portion)}
        onChange={(v) => set({ portion: toPortion(v) })}
      />
      {m.dishes.length > 0 ? (
        <section {...stylex.props(sheet.section)} aria-labelledby={`amend-dishes-${m.id}`}>
          <h3 id={`amend-dishes-${m.id}`} {...stylex.props(sheet.h3)}>
            Dishes
          </h3>
          <ol {...stylex.props(s.dishes)}>
            {form.dishes.map((d, i) => (
              <li key={i} {...stylex.props(s.dish)}>
                <div {...stylex.props(s.dishHead)}>
                  <label {...stylex.props(field.field, s.grow)}>
                    <span {...stylex.props(field.label)}>Name</span>
                    <input
                      value={d.name}
                      maxLength={80}
                      aria-invalid={!d.name.trim() || undefined}
                      onChange={(e) => setDish(i, { name: e.target.value })}
                      {...stylex.props(field.input)}
                    />
                  </label>
                  <Button
                    variant="ghost"
                    icon
                    aria-label={`Remove ${d.name.trim() || `dish ${i + 1}`}`}
                    onClick={() => set({ dishes: form.dishes.filter((_, k) => k !== i) })}
                  >
                    <XIcon />
                  </Button>
                </div>
                <label {...stylex.props(field.field)}>
                  <span {...stylex.props(field.label)}>Kind</span>
                  <select
                    value={d.dish_kind}
                    onChange={(e) => setDish(i, { dish_kind: e.target.value as DishKind })}
                    {...stylex.props(field.input)}
                  >
                    {DISH_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {DISH_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <ChoiceChips
                  legend={`Eaten of ${d.name.trim() || `dish ${i + 1}`}: ${PORTION_LABEL[d.portion]}`}
                  options={PORTION_OPTIONS}
                  value={String(d.portion)}
                  onChange={(v) => setDish(i, { portion: toPortion(v) })}
                />
              </li>
            ))}
          </ol>
          <div>
            <Button
              variant="secondary"
              onClick={() => set({ dishes: [...form.dishes, { index: 0, name: '', dish_kind: 'other', portion: 100 }] })}
            >
              <PlusIcon />
              Add dish
            </Button>
          </div>
        </section>
      ) : (
        <label {...stylex.props(field.field)}>
          <span {...stylex.props(field.label)}>Items</span>
          <input
            value={form.items}
            maxLength={MAX_MEAL_ITEMS}
            onChange={(e) => set({ items: e.target.value })}
            {...stylex.props(field.input)}
          />
        </label>
      )}
      <div {...stylex.props(field.field)}>
        <label htmlFor={`amend-reason-${m.id}`} {...stylex.props(field.label)}>
          Reason
        </label>
        <input
          id={`amend-reason-${m.id}`}
          value={form.reason}
          maxLength={AMEND_REASON_MAX}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="e.g. tray rechecked"
          aria-describedby={`amend-reason-${m.id}-hint`}
          aria-invalid={reasonShort || undefined}
          {...stylex.props(field.input)}
        />
        <span id={`amend-reason-${m.id}-hint`} {...stylex.props(field.hint)}>
          {`At least ${AMEND_REASON_MIN} characters. Save is on once something changed.`}
        </span>
      </div>
    </Sheet>
  )
}

const s = stylex.create({
  dishes: { display: 'flex', flexDirection: 'column', gap: space.md, margin: 0, padding: 0, listStyle: 'none' },
  // DESIGN.md 7.2: form rows inside an inset panel, one per dish.
  dish: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
  },
  dishHead: { display: 'flex', alignItems: 'flex-end', gap: space.sm },
  grow: { flexGrow: 1 },
})
