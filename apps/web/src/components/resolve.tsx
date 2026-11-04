import { useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  CATEGORY_DIRECTION,
  DRINK_LABEL,
  ENTRY_CATEGORIES,
  REJECT_REASONS,
  type Entry,
  type EntryCategory,
  type CareStatus,
  type DrinkKind,
  type EntryDirection,
  type IddsiLevel,
  type Meal,
  type RejectReason,
} from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import { consistencyDefault, iddsiChip, nbmWarning, saveLabel, thinnerNotice } from '../lib/care.ts'
import { CATEGORY_LABEL, REJECT_LABEL } from '../lib/labels.ts'
import { MEAL_LABEL, voidBody, voidMeal } from '../lib/meals.ts'
import { addMissedEntry, amendBody, chartedAt, MIN_REASON, offersConsistency, offersDrink, rejectBody } from '../lib/resolve.ts'
import { rejectSourceText } from '../lib/sources.ts'
import { canDecide, DECISION_NOTICE, staffLabel } from '../lib/staff.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { ConsistencyField } from './consistency-field.tsx'
import { DrinkPicker } from './drink-picker.tsx'
import { sheet } from './sheet.styles.ts'
import { Notice, Stepper } from './ui.tsx'
import { f } from './form.styles.ts'
import { TimeField } from './form-fields.tsx'
import { entrySwatch } from '../lib/urine.ts'
import { UrineSwatch } from './urine-swatch.tsx'
import { clock } from '../lib/format.ts'
import { ChoiceChips } from './choice-chips.tsx'
import { Sheet } from './sheet.tsx'

const hhmm = (d: Date) => clock(d)
const categoriesOf = (d: EntryDirection) => ENTRY_CATEGORIES.filter((c) => CATEGORY_DIRECTION[c] === d)

/** Shell shared by the three dialogs. Controlled by the caller; closing never saves. */
function ResolveSheet({
  title,
  description,
  onClose,
  error,
  children,
  actions,
  decision = false,
}: {
  title: string
  description: ReactNode
  onClose: () => void
  error: string | null
  children: ReactNode
  actions: ReactNode
  /** Reject, amend and void are a nurse's: anyone else gets the notice instead of the action. */
  decision?: boolean
}) {
  const staff = useStaff()
  const refused = decision && !canDecide(staff)
  return (
    <Sheet
      onClose={onClose}
      layer="nested"
      title={title}
      description={description}
      savedAs={staff ? staffLabel(staff) : null}
      error={error}
      actions={!refused && actions}
    >
      {refused && <Notice tone="info">{DECISION_NOTICE}</Notice>}
      {children}
    </Sheet>
  )
}

/** Reject a pending entry with a reason from the list (and an optional note). One request. */
export function RejectDialog({ entry: e, onClose, onDone }: { entry: Entry; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState<RejectReason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const media = rejectSourceText(e)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.review(e.id, rejectBody(reason, note))
      onDone(`Rejected ${e.volume_ml} mL ${CATEGORY_LABEL[e.category].toLowerCase()}${reason ? `: ${REJECT_LABEL[reason]}` : ''}.`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <ResolveSheet
      decision
      title={`Reject ${e.volume_ml} mL ${CATEGORY_LABEL[e.category].toLowerCase()}?`}
      description={`It stays in the log, marked rejected, and is left out of the totals.${media ? ` ${media.before}` : ''}`}
      onClose={onClose}
      error={error}
      actions={
        <Button variant="danger" disabled={busy || !reason} onClick={() => void save()}>
          {busy ? 'Rejecting…' : 'Reject entry'}
        </Button>
      }
    >
      {entrySwatch(e) && <UrineSwatch swatch={entrySwatch(e)!} />}
      <ChoiceChips legend="Why?" options={REJECT_REASONS.map((r) => [r, REJECT_LABEL[r]] as const)} value={reason} onChange={setReason} />
      <label {...stylex.props(sheet.field)}>
        Note (optional)
        <input
          value={note}
          maxLength={200}
          onChange={(ev) => setNote(ev.target.value)}
          placeholder="e.g. same bag photographed twice"
          {...stylex.props(f.input)}
        />
      </label>
    </ResolveSheet>
  )
}

/** Change an approved entry's volume or type, with a reason. The original stays in its history. One request. */
export function AmendDialog({ entry: e, onClose, onDone }: { entry: Entry; onClose: () => void; onDone: (message: string) => void }) {
  const [volume, setVolume] = useState(e.volume_ml)
  const [category, setCategory] = useState<EntryCategory>(e.category)
  const [level, setLevel] = useState<IddsiLevel | null>(e.iddsi_level)
  const [kind, setKind] = useState<DrinkKind | null>(e.drink)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drink = offersConsistency(category)
  const drinkable = offersDrink(category)
  const body = amendBody(e, volume, category, reason, level, kind)
  const save = async () => {
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      await api.amend(e.id, body)
      const consistency = body.iddsi_level === undefined ? '' : `, IDDSI ${iddsiChip(body.iddsi_level)}`
      const what = body.drink ? DRINK_LABEL[body.drink].toLowerCase() : CATEGORY_LABEL[category].toLowerCase()
      onDone(`Amended to ${volume} mL ${what}${consistency}. The original stays in its history.`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <ResolveSheet
      decision
      title="Amend this entry"
      description={`Approved as ${e.volume_ml} mL ${CATEGORY_LABEL[e.category].toLowerCase()}. The change and your reason are kept in its history.`}
      onClose={onClose}
      error={error}
      actions={
        <Button disabled={busy || !body} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save amendment'}
        </Button>
      }
    >
      {entrySwatch(e) && <UrineSwatch swatch={entrySwatch(e)!} />}
      <div {...stylex.props(sheet.field)}>
        Volume
        <Stepper label="Volume" value={volume} onChange={setVolume} />
      </div>
      <label {...stylex.props(sheet.field)}>
        Type
        <select value={category} onChange={(ev) => setCategory(ev.target.value as EntryCategory)} {...stylex.props(f.input)}>
          {categoriesOf(e.direction).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      {drinkable && <DrinkPicker value={kind} onChange={setKind} />}
      {drink && <ConsistencyField value={level} onChange={setLevel} />}
      <label {...stylex.props(sheet.field)}>
        Reason
        <input
          value={reason}
          maxLength={200}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="e.g. jug re-measured"
          aria-describedby="amend-reason-hint"
          {...stylex.props(f.input)}
        />
        <span id="amend-reason-hint" {...stylex.props(s.hint)}>
          At least {MIN_REASON} characters. Change the volume, the type{drinkable ? `, the drink${drink ? ' or the consistency' : ''}` : ''}{' '}
          to save.
        </span>
      </label>
    </ResolveSheet>
  )
}

/**
 * A drink or output that was never charted: saved by hand for the time it happened, then approved (two requests). An
 * attendant's is saved for a nurse to approve (one request).
 */
export function MissedEntryDialog({
  admissionId,
  admittedAt,
  care,
  initial = 'water',
  onClose,
  onDone,
}: {
  admissionId: number
  admittedAt: string
  /** The bed's care orders: the nil-by-mouth warning and a drink's consistency. */
  care: CareStatus
  initial?: EntryCategory
  onClose: () => void
  onDone: (message: string, entry: Entry) => void
}) {
  const [category, setCategory] = useState<EntryCategory>(initial)
  const [level, setLevel] = useState<IddsiLevel | undefined>(() => consistencyDefault(care, initial))
  const [volume, setVolume] = useState(200)
  const [item, setItem] = useState('')
  const [when, setWhen] = useState(() => hhmm(new Date(Date.now() - 3_600_000)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const approve = canDecide(useStaff())
  const now = new Date()
  const charted = chartedAt(when, now, admittedAt)
  const warning = nbmWarning(care, category, now.getTime())
  const ordered = consistencyDefault(care, category) !== undefined
  const pick = (c: EntryCategory) => {
    setCategory(c)
    setLevel(consistencyDefault(care, c))
  }
  const save = async () => {
    if ('error' in charted) return
    setBusy(true)
    setError(null)
    try {
      const draft = { direction: CATEGORY_DIRECTION[category], category, volume_ml: volume, item: item.trim() || null, notes: null }
      const r = await addMissedEntry(api, admissionId, draft, charted.iso, {
        approve,
        ...(ordered && level !== undefined && { iddsi_level: level }),
      })
      const what = `${volume} mL ${CATEGORY_LABEL[category].toLowerCase()} at ${when}`
      if (!approve) onDone(`Added ${what}, marked as entered by hand. It waits for a nurse to approve it.`, r.entry)
      else if (r.error) onDone(`Added ${what}, but it was not approved: ${errorText(r.error)} Approve it from the list.`, r.entry)
      else onDone(`Added ${what}, approved and marked as entered by hand.`, r.entry)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <ResolveSheet
      title="Add missed entry"
      description={
        approve
          ? 'For intake or output that happened but was never charted. It is saved by hand for the time it happened and approved in your name.'
          : 'For intake or output that happened but was never charted. It is saved by hand for the time it happened, for a nurse to approve.'
      }
      onClose={onClose}
      error={error}
      actions={
        <Button disabled={busy || 'error' in charted} onClick={() => void save()}>
          {busy ? 'Saving…' : saveLabel(warning, approve ? 'Add and approve' : 'Add for approval')}
        </Button>
      }
    >
      <fieldset {...stylex.props(s.fieldset)}>
        <legend {...stylex.props(sheet.field, s.legend)}>What</legend>
        {(['in', 'out'] as const).map((d) => (
          <ChoiceChips
            key={d}
            legend={d === 'in' ? 'Intake' : 'Output'}
            options={categoriesOf(d).map((c) => [c, CATEGORY_LABEL[c]] as const)}
            value={categoriesOf(d).includes(category) ? category : null}
            onChange={pick}
          />
        ))}
      </fieldset>
      <div {...stylex.props(s.pair)}>
        <div {...stylex.props(sheet.field)}>
          Volume
          <Stepper label="Volume" value={volume} onChange={setVolume} />
        </div>
        <TimeField
          label="When did it happen?"
          required
          value={when}
          onChange={setWhen}
          error={'error' in charted ? charted.error : undefined}
          hint="A time later than now means yesterday."
        />
      </div>
      <label {...stylex.props(sheet.field)}>
        Item (optional)
        <input value={item} maxLength={200} onChange={(ev) => setItem(ev.target.value)} placeholder="e.g. tea" {...stylex.props(f.input)} />
      </label>
      {ordered && <ConsistencyField value={level} onChange={setLevel} notice={thinnerNotice(level, care)} />}
      {warning && <Notice tone="warn">{warning}</Notice>}
    </ResolveSheet>
  )
}

/** Void a meal recorded by mistake, with a reason. It stays listed, struck through; pending fluid is rejected. One request. */
export function VoidMealDialog({ meal: m, onClose, onDone }: { meal: Meal; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = voidBody(reason) !== null
  const name = MEAL_LABEL[m.meal].toLowerCase()
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await voidMeal(api, m.id, reason)
      onDone(`Voided ${name} at ${hhmm(new Date(m.created_at))}.${m.entry_status === 'pending' ? ' Its pending fluid was rejected.' : ''}`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <ResolveSheet
      decision
      title={`Void ${name} at ${hhmm(new Date(m.created_at))}?`}
      description={
        m.entry_status === 'approved'
          ? 'It stays in the list, struck through, with your reason. Its fluid was already approved and stays charted: amend it from the log if it is wrong.'
          : 'It stays in the list, struck through, with your reason.' +
            (m.entry_status === 'pending' ? ` Its ${m.fluid_ml} mL waiting for approval is rejected.` : '')
      }
      onClose={onClose}
      error={error}
      actions={
        <Button variant="danger" disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Voiding…' : 'Void meal'}
        </Button>
      }
    >
      <label {...stylex.props(sheet.field)}>
        Reason
        <input
          value={reason}
          maxLength={200}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="e.g. wrong bed, same tray recorded twice"
          aria-describedby="void-reason-hint"
          {...stylex.props(f.input)}
        />
        <span id="void-reason-hint" {...stylex.props(s.hint)}>
          At least {MIN_REASON} characters.
        </span>
      </label>
    </ResolveSheet>
  )
}

const s = stylex.create({
  legend: { padding: 0, marginBottom: space.sm },
  fieldset: { display: 'flex', flexDirection: 'column', gap: space.md, borderWidth: 0, padding: 0, margin: 0, minWidth: 0 },
  pair: { display: 'flex', flexWrap: 'wrap', gap: space.xl, alignItems: 'flex-start' },
  hint: { fontSize: text.xs, fontWeight: weight.regular, color: color.muted },
})
