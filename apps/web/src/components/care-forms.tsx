/**
 * The care order forms and the End confirmation, loaded on first use (like the reject and missed-entry dialogs), so
 * the bed review's route chunk carries none of the dialog code. Each Save or End is one request, then the reload.
 */
import { useState, type ComponentType, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  ACUITY_LEVELS,
  CARE_LABEL,
  CATHETER_MAX_AGE_DAYS,
  DIET_TYPES,
  IDDSI_FOOD_LEVELS,
  FLUID_LIMIT_RANGE,
  INTAKE_TARGET_CHECKS,
  INTAKE_TARGET_RANGE,
  type CareKind,
  type CareStatus,
  type CatheterType,
  type FluidScope,
  type FoodTexture,
  type ThickenedLevel,
} from '@meniscus/shared'
import { api } from '../lib/api.ts'
import {
  activeOf,
  applyCare,
  careInput,
  endConfirmText,
  everyChoice,
  everyChoices,
  everyOf,
  formDefaults,
  formFrom,
  DIET_TARGET_RANGES,
  DRAIN_CHOICES,
  STOMA_CHOICES,
  VOIDING_CHOICES,
  endButtonText,
  mayEditTargets,
  unmeasured,
  targetConflict,
  targetsLine,
  type CareFormValues,
} from '../lib/care.ts'
import { staffLabel } from '../lib/staff.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { ACUITY_LABEL, DIET_LABEL } from '../lib/labels.ts'
import { Button } from './button.tsx'
import { ChoiceChips } from './choice-chips.tsx'
import { ConsistencyField } from './consistency-field.tsx'
import { Segmented } from './segmented.tsx'
import { ConfirmSheet, Sheet as OneSheet } from './sheet.tsx'
import { sheet } from './sheet.styles.ts'
import { Notice, Stepper } from './ui.tsx'
import { f } from './form.styles.ts'
import { TimeField } from './form-fields.tsx'
import { clock, isoDate } from '../lib/format.ts'

export interface CareFormProps<K extends CareKind> {
  value: CareFormValues[K]
  onChange: (value: CareFormValues[K]) => void
  /** A target above the limit, or a limit below the target: shown, and Save is disabled. */
  conflict: string | null
  /** The bed's ward code, for the catheter's `Ward default (<h> h)`. */
  wardCode: string
}

const ymd = (d: Date) => isoDate(d)
/** A first "Until": four hours from now, on the hour. */
const laterHour = () => clock(new Date(2000, 0, 1, (new Date().getHours() + 4) % 24))
const THICKENED: readonly ThickenedLevel[] = [1, 2, 3, 4]
const SCOPES: readonly (readonly [FluidScope, string])[] = [
  ['total', 'Total intake'],
  ['oral', 'Oral intake'],
]
const CATHETERS: readonly (readonly [CatheterType, string])[] = [
  ['urethral', 'Urethral'],
  ['suprapubic', 'Suprapubic'],
]
const checks = INTAKE_TARGET_CHECKS.map((c) => `${Math.round(c.fraction * 100)}% by ${c.at}`).join(', ')

function Conflict({ conflict }: { conflict: string | null }) {
  return conflict ? <Notice tone="danger">{conflict}</Notice> : null
}

const DIET_CHIPS = DIET_TYPES.map((t) => [t, DIET_LABEL[t]] as const)
const TEXTURE_CHIPS = IDDSI_FOOD_LEVELS.map(
  (l) =>
    [
      String(l.level) as `${FoodTexture}`,
      <span key={l.level} {...stylex.props(s.twoLines)}>
        <span>IDDSI {l.level}</span>
        <span {...stylex.props(s.chipSub)}>{l.name}</span>
      </span>,
    ] as const,
)
const TARGET_WORDS = {
  kcal: { add: 'Add energy target', label: 'Energy target', unit: 'kcal' },
  protein_g: { add: 'Add protein target', label: 'Protein target', unit: 'g protein' },
} as const

/**
 * The diet: type and texture as choice chips; the targets as steppers a dietitian adds and removes, and a read-only
 * line for everyone else (sent back unchanged; no disabled steppers, DESIGN.md 7.9).
 */
function DietForm({ value, onChange }: CareFormProps<'diet'>) {
  const staff = useStaff()
  const line = targetsLine(value)
  return (
    <>
      <ChoiceChips legend="Diet" options={DIET_CHIPS} value={value.type} onChange={(type) => onChange({ ...value, type })} />
      {value.type === null && <span {...stylex.props(s.hint)}>Pick the diet type to save.</span>}
      <ChoiceChips
        legend="Food texture (IDDSI)"
        options={TEXTURE_CHIPS}
        value={`${value.texture}`}
        onChange={(t) => onChange({ ...value, texture: Number(t) as FoodTexture })}
      />
      {mayEditTargets(staff) ? (
        (['kcal', 'protein_g'] as const).map((k) => {
          const words = TARGET_WORDS[k]
          const range = DIET_TARGET_RANGES[k]
          const v = value[k]
          return v === null ? (
            <span key={k}>
              <Button variant="secondary" size="touch" onClick={() => onChange({ ...value, [k]: range.default })}>
                {words.add}
              </Button>
            </span>
          ) : (
            <div key={k} {...stylex.props(sheet.field)}>
              {words.label}
              <div {...stylex.props(s.targetRow)}>
                <Stepper
                  label={words.label}
                  unit={words.unit}
                  value={v}
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  onChange={(n) => onChange({ ...value, [k]: n })}
                />
                <Button variant="ghost" size="touch" onClick={() => onChange({ ...value, [k]: null })}>
                  Remove
                </Button>
              </div>
            </div>
          )
        })
      ) : line ? (
        <p {...stylex.props(s.readOnly)}>{line}</p>
      ) : null}
    </>
  )
}

/** One form per kind; a kind missing here is a compile error. */
const CARE_FORMS: { [K in CareKind]: ComponentType<CareFormProps<K>> } = {
  // Not offered by the add-order control (acuity has its own row on the bed review); kept for the registry.
  acuity: ({ value, onChange }) => (
    <ChoiceChips
      legend="Acuity"
      options={ACUITY_LEVELS.map((l) => [l, ACUITY_LABEL[l]] as const)}
      value={value.level}
      onChange={(level) => onChange({ level })}
    />
  ),
  nil_by_mouth: ({ value, onChange }) => (
    <div {...stylex.props(sheet.field)}>
      Planned end
      <Segmented
        label="Planned end"
        size="lg"
        value={value.until === null ? 'none' : 'until'}
        options={[
          ['none', 'No planned end'],
          ['until', 'Until'],
        ]}
        onChange={(v) => onChange({ until: v === 'none' ? null : laterHour() })}
      />
      {value.until !== null && <TimeField label="Until" hideLabel required value={value.until} onChange={(until) => onChange({ until })} />}
      <span {...stylex.props(s.hint)}>
        {value.until === null
          ? 'It stays until a nurse ends it.'
          : 'A time earlier than now means tomorrow. It never ends on its own: a prompt asks for review after this time.'}
      </span>
    </div>
  ),
  thickened_fluids: ({ value, onChange }) => (
    <>
      <ConsistencyField label="Drink level (IDDSI)" levels={THICKENED} value={value.level} onChange={(level) => onChange({ level })} />
      {value.level === null && <span {...stylex.props(s.hint)}>Pick the ordered level to save.</span>}
    </>
  ),
  fluid_limit: ({ value, onChange, conflict }) => (
    <>
      <div {...stylex.props(sheet.field)}>
        Limit per day
        <Stepper
          label="Fluid limit"
          value={value.ml}
          min={FLUID_LIMIT_RANGE.min}
          max={FLUID_LIMIT_RANGE.max}
          step={FLUID_LIMIT_RANGE.step}
          onChange={(ml) => onChange({ ...value, ml })}
        />
      </div>
      <div {...stylex.props(sheet.field)}>
        Counts
        <Segmented label="Counts" size="lg" value={value.scope} options={SCOPES} onChange={(scope) => onChange({ ...value, scope })} />
        <span {...stylex.props(s.hint)}>
          {value.scope === 'total' ? 'Drinks, food fluid and IV' : 'Drinks and food fluid, not IV'}, today since 08:00, pending included.
        </span>
      </div>
      <Conflict conflict={conflict} />
    </>
  ),
  intake_target: ({ value, onChange, conflict }) => (
    <>
      <div {...stylex.props(sheet.field)}>
        Target per day
        <Stepper
          label="Intake target"
          value={value.ml}
          min={INTAKE_TARGET_RANGE.min}
          max={INTAKE_TARGET_RANGE.max}
          step={INTAKE_TARGET_RANGE.step}
          onChange={(ml) => onChange({ ml })}
        />
        <span {...stylex.props(s.hint)}>Oral intake today since 08:00, pending included. Checked at {checks}.</span>
      </div>
      <Conflict conflict={conflict} />
    </>
  ),
  catheter: ({ value, onChange, wardCode }) => {
    const today = new Date()
    const earliest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - CATHETER_MAX_AGE_DAYS + 1)
    return (
      <>
        <div {...stylex.props(sheet.field)}>
          Type
          <Segmented label="Type" size="lg" value={value.type} options={CATHETERS} onChange={(type) => onChange({ ...value, type })} />
        </div>
        <label {...stylex.props(sheet.field)}>
          Inserted
          <input
            type="date"
            required
            value={value.inserted}
            min={ymd(earliest)}
            max={ymd(today)}
            onChange={(e) => onChange({ ...value, inserted: e.target.value })}
            {...stylex.props(f.input, s.date)}
          />
          <span {...stylex.props(s.hint)}>The day of insertion is catheter day 1. A review is asked for each day from the next.</span>
        </label>
        <ChoiceChips
          legend="Bag reading every"
          options={everyChoices({ ward_code: wardCode })}
          value={everyChoice(value.every)}
          onChange={(c) => onChange({ ...value, every: everyOf(c) })}
        />
      </>
    )
  },
  stoma: ({ value, onChange }) => (
    <>
      <ChoiceChips legend="Stoma" options={STOMA_CHOICES} value={value.type} onChange={(type) => onChange({ type })} />
      {value.type === null && <span {...stylex.props(s.hint)}>Pick the stoma type to save.</span>}
    </>
  ),
  drain: ({ value, onChange }) => (
    <>
      <ChoiceChips legend="Drain site" options={DRAIN_CHOICES} value={value.site} onChange={(site) => onChange({ site })} />
      {value.site === null && <span {...stylex.props(s.hint)}>Pick the drain site to save.</span>}
    </>
  ),
  voiding: ({ value, onChange }) => (
    <>
      <ChoiceChips legend="Urine collection" options={VOIDING_CHOICES} value={value.method} onChange={(method) => onChange({ method })} />
      <span {...stylex.props(s.hint)}>
        {unmeasured(value.method)
          ? 'Urine is not measured: low output and overload are not prompted, and the balance leaves urine out.'
          : 'How this patient passes urine while there is no catheter. A catheter takes precedence.'}
      </span>
    </>
  ),
  diet: DietForm,
}

/** Shell shared by the form and the End confirmation: title, body, who saves, the error and the actions. */
/**
 * Add an order of a kind that is not active, or change the active one ("Change…" ends it and starts the new value, in
 * one request). Save stays disabled while the form is incomplete or in conflict; nothing is sent then.
 */
export function CareFormDialog({
  kind,
  changing,
  admissionId,
  wardCode,
  care,
  reload,
  onClose,
  onDone,
}: {
  kind: CareKind
  changing: boolean
  admissionId: number
  wardCode: string
  care: CareStatus
  /** Awaited before the dialog closes. */
  reload: () => unknown
  onClose: () => void
  onDone: (message: string) => void
}) {
  return (
    <FormFor
      kind={kind}
      changing={changing}
      admissionId={admissionId}
      wardCode={wardCode}
      care={care}
      reload={reload}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

function FormFor<K extends CareKind>({
  kind,
  changing,
  admissionId,
  wardCode,
  care,
  reload,
  onClose,
  onDone,
}: {
  kind: K
  changing: boolean
  admissionId: number
  wardCode: string
  care: CareStatus
  /** Awaited before the dialog closes. */
  reload: () => unknown
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [value, setValue] = useState<CareFormValues[K]>(() => {
    const active = changing ? activeOf(care, kind) : undefined
    return active ? formFrom(active) : formDefaults(kind, care)
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const Form: ComponentType<CareFormProps<K>> = CARE_FORMS[kind]
  const ml = (value as { ml?: number }).ml
  const conflict = ml === undefined ? null : targetConflict(care, kind, ml)
  const input = careInput(kind, value, care, new Date())
  const name = CARE_LABEL[kind].toLowerCase()

  const save = async () => {
    if (!input) return
    setBusy(true)
    setError(null)
    const r = await applyCare(api, admissionId, { op: 'set', kind, value: input }, reload)
    if (r.ok) onDone(r.text)
    else {
      setError(r.text)
      setBusy(false)
    }
  }
  return (
    <Sheet
      title={`${changing ? 'Change' : 'Add'} ${name}`}
      description={
        changing
          ? 'The current order ends now and the new one starts. Both stay in the history.'
          : 'Records an order made by the clinical team. Meniscus prompts for review; it never blocks a save.'
      }
      onClose={onClose}
      error={error}
      actions={
        <Button size="touch" disabled={busy || !input} onClick={() => void save()}>
          {busy ? 'Saving…' : `Save ${name}`}
        </Button>
      }
    >
      <Form value={value} onChange={setValue} conflict={conflict} wardCode={wardCode} />
    </Sheet>
  )
}

function Sheet({
  title,
  description,
  onClose,
  error,
  actions,
  children,
}: {
  title: string
  description: string
  onClose: () => void
  error: string | null
  actions: ReactNode
  children: ReactNode
}) {
  const staff = useStaff()
  return (
    <OneSheet
      onClose={onClose}
      title={title}
      description={description}
      savedAs={staff ? staffLabel(staff) : null}
      error={error}
      actions={actions}
    >
      {children}
    </OneSheet>
  )
}

/** `End nil by mouth?` (or `Catheter removed?`): one DELETE, then the reload. The order stays in the history. */
export function EndCareDialog({
  kind,
  admissionId,
  reload,
  onClose,
  onDone,
}: {
  kind: CareKind
  admissionId: number
  reload: () => void
  onClose: () => void
  onDone: (message: string) => void
}) {
  const staff = useStaff()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = async () => {
    setBusy(true)
    setError(null)
    const r = await applyCare(api, admissionId, { op: 'end', kind }, reload)
    if (r.ok) onDone(r.text)
    else {
      setError(r.text)
      setBusy(false)
    }
  }
  return (
    <ConfirmSheet
      onClose={onClose}
      title={endConfirmText(kind)}
      description="The order ends now. It stays in the care plan history, with who ended it."
      savedAs={staff ? staffLabel(staff) : null}
      error={error}
      actions={
        <Button variant="danger" disabled={busy} onClick={() => void end()}>
          {busy ? 'Saving…' : endButtonText(kind)}
        </Button>
      }
    />
  )
}

const s = stylex.create({
  hint: { fontSize: text.xs, fontWeight: weight.regular, color: color.muted },
  twoLines: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space.xs, paddingBlock: space.sm },
  chipSub: { fontWeight: weight.regular, opacity: 0.8 },
  targetRow: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  readOnly: { margin: 0, fontSize: text.sm, color: color.muted },
  date: { width: 200, minHeight: 48 },
})
