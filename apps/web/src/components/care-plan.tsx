import { lazy, Suspense, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  CARE_LABEL,
  type AcuityStatus,
  type BagChart,
  type CareKind,
  type CareOrder,
  type CareStatus,
  type StaffRef,
} from '@meniscus/shared'
import { api } from '../lib/api.ts'
import { addControl, addableKinds, applyCare, carePlanView, rowActions, type CareBar } from '../lib/care.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { AcuityRow } from './acuity-row.tsx'
import { Button } from './button.tsx'
import { CareIcon, CheckIcon, PencilIcon, PlusIcon, XIcon } from './icons.tsx'
import { Notice, Section } from './ui.tsx'
import { ui } from './ui.styles.ts'

// The forms and the End confirmation load on first use, keeping dialog code out of the route bundle.
const CareFormDialog = lazy(() => import('./care-forms.tsx').then((m) => ({ default: m.CareFormDialog })))
const EndCareDialog = lazy(() => import('./care-forms.tsx').then((m) => ({ default: m.EndCareDialog })))

type Open = { kind: 'form'; care: CareKind; changing: boolean } | { kind: 'end'; care: CareKind } | null

/**
 * The bed's care plan: each active order, the limit and target bars ("today since 08:00"), the catheter day and its
 * review, and the history. Nurses and the matron add, change and end orders and record "Reviewed today"; attendants
 * read. Everything shown comes from the bed review's own load; each action is one request, then the reload.
 */
export function CarePlan({
  admissionId,
  wardCode,
  bags,
  care,
  acuity,
  history,
  now,
  decide,
  staff,
  reload,
}: {
  admissionId: number
  /** For the catheter form's `Ward default (<h> h)`. */
  wardCode: string
  /** The chart read's bag interval: the catheter row's `Bag reading every <h> h`. */
  bags: Pick<BagChart, 'interval_h' | 'interval_from'>
  care: CareStatus
  /** Shown in its own row, above the orders; never one of the order rows or the add-order kinds. */
  acuity: AcuityStatus
  history: CareOrder[]
  now: number
  /** Acuity and "Reviewed today": nurses and the matron. */
  decide: boolean
  /** Which kinds this person may add, change and end (CARE_ORDER_ROLES: a dietitian, diets only). */
  staff: Pick<StaffRef, 'role'> | null
  reload: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const view = carePlanView(care, history, now, showAll, bags)
  const addable = addableKinds(care, staff)
  const add = addControl(addable)

  const done = (text: string) => {
    setOpen(null)
    setNote({ ok: true, text })
  }
  const review = async () => {
    setBusy(true)
    setNote(null)
    setNote(await applyCare(api, admissionId, { op: 'review' }, reload))
    setBusy(false)
  }

  return (
    <Section
      icon={<CareIcon />}
      title="Care plan"
      subtitle="Orders made by the clinical team. Prompts ask for review; nothing is blocked."
      actions={
        add &&
        (add.direct ? (
          <Button
            variant="secondary"
            size="touch"
            onClick={() => {
              setNote(null)
              setOpen({ kind: 'form', care: add.direct!, changing: false })
            }}
          >
            <PlusIcon /> {add.label}
          </Button>
        ) : (
          <Button variant="secondary" size="touch" aria-expanded={adding} aria-controls="care-add" onClick={() => setAdding(!adding)}>
            <PlusIcon /> {add.label}
          </Button>
        ))
      }
    >
      {adding && add && !add.direct && (
        <div id="care-add" role="group" aria-label="Add an order" {...stylex.props(s.add)}>
          {addable.map((k) => (
            <Button
              key={k}
              variant="secondary"
              size="touch"
              onClick={() => {
                setAdding(false)
                setNote(null)
                setOpen({ kind: 'form', care: k, changing: false })
              }}
            >
              {CARE_LABEL[k]}
            </Button>
          ))}
        </div>
      )}
      {note && <Notice tone={note.ok ? 'ok' : 'danger'}>{note.text}</Notice>}

      <AcuityRow admissionId={admissionId} acuity={acuity} decide={decide} reload={reload} />

      {view.empty ? (
        <p {...stylex.props(ui.muted)}>{view.empty}</p>
      ) : (
        <ul {...stylex.props(s.rows)}>
          {view.rows.map((r) => {
            const may = rowActions(r.order, staff)
            return (
              <li key={r.order.kind} {...stylex.props(s.row)}>
                <div {...stylex.props(s.rowTop)}>
                  <strong {...stylex.props(s.rowText)}>{r.text}</strong>
                  {may.change && (
                    <span {...stylex.props(s.rowActions)}>
                      <Button
                        variant="ghost"
                        size="touch"
                        aria-label={`Change ${CARE_LABEL[r.order.kind].toLowerCase()}`}
                        onClick={() => {
                          setNote(null)
                          setOpen({ kind: 'form', care: r.order.kind, changing: true })
                        }}
                      >
                        <PencilIcon /> Change…
                      </Button>
                      {may.end && (
                        <Button
                          variant="ghost"
                          size="touch"
                          aria-label={`End ${CARE_LABEL[r.order.kind].toLowerCase()}`}
                          onClick={() => {
                            setNote(null)
                            setOpen({ kind: 'end', care: r.order.kind })
                          }}
                        >
                          <XIcon /> End…
                        </Button>
                      )}
                    </span>
                  )}
                </div>
                {may.note && <span {...stylex.props(s.interval)}>{may.note}</span>}
                {r.interval && <span {...stylex.props(s.interval)}>{r.interval}</span>}
                {r.bar && <Bar bar={r.bar} label={CARE_LABEL[r.order.kind]} />}
                {r.review && (
                  <div {...stylex.props(s.review)}>
                    <span {...stylex.props(r.review.offered ? s.reviewDue : s.reviewDone)}>{r.review.text}</span>
                    {decide && r.review.offered && (
                      <Button size="touch" disabled={busy} onClick={() => void review()}>
                        <CheckIcon /> Reviewed today
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {view.history.length > 0 && (
        <div {...stylex.props(s.history)}>
          <h3 {...stylex.props(s.h3)}>History</h3>
          <ol {...stylex.props(s.historyList)}>
            {view.history.map((line, i) => (
              <li key={i} {...stylex.props(s.historyRow)}>
                {line}
              </li>
            ))}
          </ol>
          {(view.more > 0 || showAll) && (
            <span>
              <Button variant="ghost" size="touch" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all (${view.more} more)`}
              </Button>
            </span>
          )}
        </div>
      )}

      {open && (
        <Suspense fallback={null}>
          {open.kind === 'form' ? (
            <CareFormDialog
              kind={open.care}
              changing={open.changing}
              admissionId={admissionId}
              wardCode={wardCode}
              care={care}
              reload={reload}
              onClose={() => setOpen(null)}
              onDone={done}
            />
          ) : (
            <EndCareDialog kind={open.care} admissionId={admissionId} reload={reload} onClose={() => setOpen(null)} onDone={done} />
          )}
        </Suspense>
      )}
    </Section>
  )
}

/** A progress bar that reads out its caption, so colour is never the only signal. */
function Bar({ bar, label }: { bar: CareBar; label: string }) {
  return (
    <div {...stylex.props(s.barWrap)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, bar.percent)}
        aria-valuetext={bar.caption}
        {...stylex.props(s.track)}
      >
        <div {...stylex.props(s.fill, fills[bar.tone], s.width(`${Math.min(100, bar.percent)}%`))} />
      </div>
      <span {...stylex.props(s.caption, captions[bar.tone])}>{bar.caption}</span>
    </div>
  )
}

const fills = stylex.create({
  neutral: { backgroundColor: color.intake },
  warn: { backgroundColor: color.warn },
  danger: { backgroundColor: color.danger },
})
const captions = stylex.create({
  neutral: { color: color.muted },
  warn: { color: color.warn },
  danger: { color: color.danger },
})

const s = stylex.create({
  add: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  rows: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    paddingBlock: space.lg,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  rowTop: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  rowText: { flexGrow: 1, flexBasis: 220, fontSize: text.md, fontWeight: weight.semibold },
  rowActions: { display: 'flex', gap: space.sm, flexWrap: 'wrap', marginBlock: -6 },
  barWrap: { display: 'flex', flexDirection: 'column', gap: space.sm },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: color.subtle, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  width: (w: string) => ({ width: w }),
  caption: { fontSize: text.sm, fontWeight: weight.semibold, fontVariantNumeric: 'tabular-nums' },
  interval: { fontSize: text.sm, color: color.muted },
  review: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  reviewDue: { flexGrow: 1, fontSize: text.sm, fontWeight: weight.semibold, color: color.info },
  reviewDone: { flexGrow: 1, fontSize: text.sm, fontWeight: weight.semibold, color: color.ok },
  history: { display: 'flex', flexDirection: 'column', gap: space.sm },
  h3: { fontSize: text.xs, fontWeight: weight.bold, letterSpacing: '0.05em', color: color.muted },
  historyList: { display: 'flex', flexDirection: 'column', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' },
  historyRow: { fontSize: text.sm, color: color.fg, overflowWrap: 'anywhere' },
})
