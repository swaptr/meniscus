/**
 * "Add missed emptying" (nurses and matrons; loaded on first open). A backdated emptying between the fall's two
 * readings, at or above the level it fell from. One request, the bag reading; its entry waits for review. No model.
 */
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { BAG_MAX_ML } from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import {
  discardedText,
  duplicateText,
  missedForm,
  missedSubmit,
  postBagReading,
  saveAnyway,
  type BagOutcome,
  type BagRefused,
  type Fall,
} from '../lib/bags.ts'
import { BAG_NAME } from '../lib/labels.ts'
import { hhmm } from '../lib/timeline.ts'
import { staffLabel } from '../lib/staff.ts'
import { useStaff } from '../lib/use-staff.ts'
import { space } from '../tokens.stylex.ts'
import { DuplicatePanel } from './bag-reading.tsx'
import { Button } from './button.tsx'
import { f } from './form.styles.ts'
import { TimeField } from './form-fields.tsx'
import { Sheet } from './sheet.tsx'
import { Stepper } from './ui.tsx'

export function MissedEmptyingDialog({
  admissionId,
  admittedAt,
  fall,
  onClose,
  onDone,
}: {
  admissionId: number
  admittedAt: string
  fall: Fall
  onClose: () => void
  onDone: (message: string) => void
}) {
  const staff = useStaff()
  const [form] = useState(() => missedForm(fall, Date.now(), admittedAt))
  const [level, setLevel] = useState(form.level)
  // Starts halfway between the two readings, which is always inside the window.
  const [time, setTime] = useState(() => hhmm(new Date((form.from + form.to) / 2).toISOString()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The post answered 409: another nurse's emptying. Shown with "Save anyway" and "Cancel" until one is tapped. */
  const [refused, setRefused] = useState<{ refused: BagRefused; line: string } | null>(null)
  const sent = missedSubmit(form, time, level)
  const name = BAG_NAME[form.container]

  /** One post: the reading, or (after a 409) the same reading once more confirming the shown one. */
  const save = async (anyway?: () => Promise<BagOutcome>) => {
    const post = anyway ?? ('input' in sent ? () => postBagReading(api, admissionId, sent.input) : null)
    if (!post) return
    setBusy(true)
    setError(null)
    try {
      const o = await post()
      if ('duplicate' in o) {
        setRefused({ refused: o, line: duplicateText(o.duplicate, Date.now()) })
        setBusy(false)
        return
      }
      const r = o.saved.result
      onDone(
        r.entry
          ? `Added the emptying at ${time} (${level} mL): ${r.entry.volume_ml} mL charted, waiting for approval.`
          : `Added the emptying at ${time} (${level} mL): nothing more to chart.`,
      )
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      title="Add missed emptying"
      description={`${name} level fell from ${fall.reading.fell_from_ml} to ${fall.reading.volume_ml} mL with no emptying recorded. Add the emptying that was missed: when it happened and the level before it was emptied. Only the rise it adds is charted, and no other entry changes.`}
      savedAs={staff ? staffLabel(staff) : null}
      error={error}
      cancelLabel={refused ? null : 'Cancel'}
      actions={
        refused ? undefined : (
          <Button disabled={busy || 'error' in sent} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Add emptying'}
          </Button>
        )
      }
    >
      <div {...stylex.props(s.pair)}>
        <div {...stylex.props(f.field)}>
          <span {...stylex.props(f.label)}>Level when emptied</span>
          <Stepper label="Level when emptied" min={form.floor} max={BAG_MAX_ML} step={10} value={level} onChange={setLevel} />
        </div>
        <TimeField label="When was it emptied?" required value={time} onChange={setTime} error={'error' in sent ? sent.error : undefined} />
      </div>
      {refused && (
        // "Cancel" sends no post and reloads the bed review, so the other nurse's emptying shows.
        <DuplicatePanel
          line={refused.line}
          busy={busy}
          discardLabel="Cancel"
          onAnyway={() => void save(() => saveAnyway(api, admissionId, refused.refused))}
          onDiscard={() => onDone(discardedText(refused.refused.duplicate, Date.now()))}
        />
      )}
    </Sheet>
  )
}

const s = stylex.create({
  pair: { display: 'flex', flexWrap: 'wrap', gap: space.xl, alignItems: 'flex-start' },
})
