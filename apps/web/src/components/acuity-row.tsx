import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { AcuityStatus } from '@meniscus/shared'
import { ACUITY_CHOICES, acuityRequest, acuityView, applyAcuity, type AcuityChoice } from '../lib/acuity.ts'
import { api } from '../lib/api.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { ChoiceChips } from './choice-chips.tsx'
import { CheckIcon } from './icons.tsx'
import { Chip, Notice } from './ui.tsx'

/**
 * The bed's acuity on the bed review (web/ward "Set or confirm acuity on the bed review"): its level and source, its
 * suggestion with "Review", and for a nurse or the matron the level choice and Confirm. Each tap is one PUT or DELETE,
 * then the reload; nothing is set without a tap, and nothing here calls a model.
 */
export function AcuityRow({
  admissionId,
  acuity,
  decide,
  reload,
}: {
  admissionId: number
  acuity: AcuityStatus
  decide: boolean
  reload: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  // The picked choice, sent only on Save: arrow keys move the chips' selection, so a pick alone must not send a request.
  const [draft, setDraft] = useState<AcuityChoice | null>(null)
  const view = acuityView(acuity, decide)
  const chosen = draft ?? view.controls?.value ?? 'ward'
  const change = acuityRequest(acuity, chosen)

  const pick = async (choice: AcuityChoice) => {
    const change = acuityRequest(acuity, choice)
    if (!change || busy) return
    setBusy(true)
    setNote(null)
    setNote(await applyAcuity(api, admissionId, change, reload))
    setDraft(null)
    setBusy(false)
  }

  return (
    <div {...stylex.props(s.row)}>
      <div {...stylex.props(s.top)}>
        <span {...stylex.props(s.label)}>Acuity</span>
        <Chip tone={view.tone} dot>
          {view.label}
        </Chip>
      </div>
      {view.suggestion && (
        <div {...stylex.props(s.suggestion)}>
          <span {...stylex.props(s.suggestionText)}>{view.suggestion}</span>
          {view.controls?.confirm && (
            <Button variant="secondary" size="touch" disabled={busy} onClick={() => void pick(view.controls!.confirm!)}>
              <CheckIcon /> Confirm
            </Button>
          )}
        </div>
      )}
      {view.controls && (
        <>
          <ChoiceChips legend="Set acuity" options={ACUITY_CHOICES} value={chosen} onChange={setDraft} />
          {change && (
            <div {...stylex.props(s.actions)}>
              <Button variant="ghost" size="touch" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="touch" disabled={busy} onClick={() => void pick(chosen)}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}
        </>
      )}
      {note && <Notice tone={note.ok ? 'ok' : 'danger'}>{note.text}</Notice>}
    </div>
  )
}

const s = stylex.create({
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: space.md, flexWrap: 'wrap' },
  top: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  label: { fontSize: text.md, fontWeight: weight.bold },
  suggestion: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  suggestionText: { flexGrow: 1, flexBasis: 220, fontSize: text.sm, fontWeight: weight.semibold, color: color.warn },
})
