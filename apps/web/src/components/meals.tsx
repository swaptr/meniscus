import { lazy, Suspense, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { Alert, Meal } from '@meniscus/shared'
import { mealFlags } from '../lib/care.ts'
import { amendedLine, canAmend } from '../lib/meal-amend.ts'
import { CATEGORY_HUE } from '../lib/hues.ts'
import { aiReadFluids, aiReadLines, mealRow } from '../lib/meals.ts'
import { DrinkIcon } from './drink-label.tsx'
import { mealSource } from '../lib/sources.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { DishList } from './dish-list.tsx'
import { CameraIcon, PencilIcon, SparkIcon, VoidIcon } from './icons.tsx'
import { Chip, type Tone, ConfidenceChip } from './ui.tsx'
import { ui } from './ui.styles.ts'

// Loads on first use, with the other fix-it dialogs.
const VoidMealDialog = lazy(() => import('./resolve.tsx').then((m) => ({ default: m.VoidMealDialog })))
const AmendMealDialog = lazy(() => import('./amend-meal-dialog.tsx').then((m) => ({ default: m.AmendMealDialog })))
// The photo viewer loads, and the tray photo is fetched, only when "What the AI read" is opened.
const PhotoSource = lazy(() => import('./source-view.tsx').then((m) => ({ default: m.PhotoSource })))
// A meal saved with its tray proof shows that instead, with the photo inside it.
const TrayProof = lazy(() => import('./tray-proof.tsx').then((m) => ({ default: m.TrayProof })))

const FLUID_TONE: Record<NonNullable<Meal['entry_status']>, Tone> = { pending: 'pending', approved: 'in', rejected: 'neutral' }

interface MealsProps {
  meals: Meal[]
  /** The chart's prompts: a meal eaten while nil by mouth is badged. */
  alerts?: Alert[]
  canVoid: boolean
  onChanged: (message: string) => void
}

/** The last 24 hours' meals, newest first, with what the AI read and a void with a reason, inside the card that holds them (the bed review's Nutrition section). No model requests. */
export function MealsList({ meals, alerts = [], canVoid, onChanged }: MealsProps) {
  const [voiding, setVoiding] = useState<Meal | null>(null)
  const [amending, setAmending] = useState<Meal | null>(null)
  const staff = useStaff()
  return (
    <>
      {meals.length === 0 ? (
        <p {...stylex.props(ui.muted)}>No meals recorded in the last 24 hours.</p>
      ) : (
        <ul {...stylex.props(s.list)}>
          {meals.map((m) => (
            <MealItem
              key={m.id}
              meal={m}
              alerts={alerts}
              onVoid={canVoid ? () => setVoiding(m) : null}
              onAmend={canAmend(staff, m) ? () => setAmending(m) : null}
            />
          ))}
        </ul>
      )}
      {amending && (
        <Suspense fallback={null}>
          <AmendMealDialog
            meal={amending}
            onClose={() => setAmending(null)}
            onDone={(message) => {
              setAmending(null)
              onChanged(message)
            }}
          />
        </Suspense>
      )}
      {voiding && (
        <Suspense fallback={null}>
          <VoidMealDialog
            meal={voiding}
            onClose={() => setVoiding(null)}
            onDone={(message) => {
              setVoiding(null)
              onChanged(message)
            }}
          />
        </Suspense>
      )}
    </>
  )
}

/** `onVoid` and `onAmend` null: no "Void…" or "Amend…" (an attendant asks a nurse). */
function MealItem({
  meal: m,
  alerts,
  onVoid,
  onAmend,
}: {
  meal: Meal
  alerts: Alert[]
  onVoid: (() => void) | null
  onAmend: (() => void) | null
}) {
  const r = mealRow(m)
  const amended = amendedLine(m)
  const read = aiReadLines(m)
  const tray = mealSource(m)
  const alt = `Tray photo, ${r.meal.toLowerCase()} at ${r.time}`
  const [open, setOpen] = useState(false)
  const voided = r.voided !== null
  return (
    <li {...stylex.props(s.row)}>
      <span {...stylex.props(s.time, voided && s.struck)}>{r.time}</span>
      <div {...stylex.props(s.main)}>
        <div {...stylex.props(s.head, voided && s.struck)}>
          <strong {...stylex.props(s.meal)}>{r.meal}</strong>
          <span role="img" aria-label={`${r.portion} eaten`} {...stylex.props(s.bar, voided && s.dim)}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                {...stylex.props(s.part)}
                // The charts' food hue, so a meal reads as the same thing everywhere.
                style={i < r.parts ? { backgroundColor: CATEGORY_HUE.food } : undefined}
              />
            ))}
          </span>
          <span {...stylex.props(s.portion)}>{r.portion}</span>
          {!voided && (onVoid || onAmend) && (
            <span {...stylex.props(s.end)}>
              {onAmend && (
                <Button variant="ghost" onClick={onAmend} aria-label={`Amend ${r.meal.toLowerCase()} at ${r.time}`}>
                  <PencilIcon size={14} />
                  Amend…
                </Button>
              )}
              {onVoid && (
                <Button variant="ghost" onClick={onVoid} aria-label={`Void ${r.meal.toLowerCase()} at ${r.time}`}>
                  <VoidIcon size={14} />
                  Void…
                </Button>
              )}
            </span>
          )}
        </div>
        {r.items && <span {...stylex.props(s.items, voided && s.struck)}>{r.items}</span>}
        <DishList meal={m} alt={alt} />
        <div {...stylex.props(s.meta)}>
          {mealFlags(m, alerts).map((b) => (
            <Chip key={b.text} tone={b.tone} dot>
              {b.text}
            </Chip>
          ))}
          {r.fluid && <Chip tone={m.voided_at || !m.entry_status ? 'neutral' : FLUID_TONE[m.entry_status]}>{r.fluid}</Chip>}
          <span {...stylex.props(s.by)}>
            {m.source === 'photo' ? <CameraIcon size={14} /> : <PencilIcon size={14} />}
            {r.by}
          </span>
        </div>
        {amended && (
          <span {...stylex.props(s.by)}>
            <PencilIcon size={14} />
            {amended}
          </span>
        )}
        {r.voided && (
          <span {...stylex.props(s.voided)}>
            <VoidIcon size={14} />
            {r.voided}
          </span>
        )}
        {read && (
          <details onToggle={(e) => setOpen(e.currentTarget.open)} {...stylex.props(s.read)}>
            <summary {...stylex.props(s.summary)}>
              <SparkIcon size={14} />
              What the AI read
              {m.confidence !== null && <ConfidenceChip source="Photo" confidence={m.confidence} />}
            </summary>
            {m.proof && open && (
              <Suspense fallback={<p {...stylex.props(ui.muted, s.pad)}>Loading the tray proof…</p>}>
                <TrayProof meal={m} alt={alt} />
              </Suspense>
            )}
            <dl {...stylex.props(s.readGrid)}>
              <dt {...stylex.props(s.dt)}>Items</dt>
              <dd {...stylex.props(s.dd)}>{read.items.length ? read.items.join(', ') : 'none seen'}</dd>
              <dt {...stylex.props(s.dt)}>Fluids</dt>
              <dd {...stylex.props(s.dd)}>
                {read.fluids.length
                  ? aiReadFluids(m).map((f, i) => (
                      <span key={i} {...stylex.props(s.fluid)}>
                        <DrinkIcon kind={f.kind} size={14} />
                        {f.text}
                        {i < read.fluids.length - 1 ? ', ' : ''}
                      </span>
                    ))
                  : 'none'}
              </dd>
              {read.notes && (
                <>
                  <dt {...stylex.props(s.dt)}>Notes</dt>
                  <dd {...stylex.props(s.dd)}>{read.notes}</dd>
                </>
              )}
              <dt {...stylex.props(s.dt)}>Model</dt>
              <dd {...stylex.props(s.dd)}>{read.steps.join(', ')}</dd>
            </dl>
            {tray && open && !m.proof && (
              <div {...stylex.props(s.tray)}>
                <Suspense fallback={<p {...stylex.props(ui.muted)}>Loading the tray photo…</p>}>
                  <PhotoSource src={tray} evidence={null} alt={alt} />
                </Suspense>
              </div>
            )}
          </details>
        )}
      </div>
    </li>
  )
}

const s = stylex.create({
  list: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.md,
    paddingBlock: space.lg,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  time: { width: 44, flexShrink: 0, paddingTop: space.xs, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  main: { display: 'flex', flexDirection: 'column', gap: space.sm, flexGrow: 1, minWidth: 0 },
  head: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xs },
  meal: { fontSize: text.md, fontWeight: weight.bold },
  bar: { display: 'inline-flex', gap: space.xs },
  dim: { opacity: 0.4 },
  part: { width: 14, height: 8, borderRadius: radius.sm, backgroundColor: color.border },
  portion: { fontSize: text.sm, fontWeight: weight.semibold, color: color.muted },
  end: { display: 'inline-flex', gap: space.sm, marginLeft: 'auto', marginBlock: -6 },
  items: { fontSize: text.sm, overflowWrap: 'anywhere' },
  meta: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  tray: { maxWidth: 420, paddingInline: space.md, paddingBottom: space.md },
  pad: { paddingInline: space.md },
  by: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: text.xs, color: color.muted },
  struck: { textDecorationLine: 'line-through', color: color.muted },
  voided: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    color: color.danger,
  },
  read: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
  },
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingInline: space.md,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    color: color.accent,
    cursor: 'pointer',
    listStyle: 'none',
  },
  readGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    columnGap: space.md,
    rowGap: space.sm,
    margin: 0,
    paddingInline: space.md,
    paddingBottom: space.md,
    fontSize: text.sm,
  },
  dt: { fontWeight: weight.semibold, color: color.muted },
  fluid: { display: 'inline-flex', alignItems: 'center', gap: space.sm, marginInlineEnd: space.sm },
  dd: { margin: 0, overflowWrap: 'anywhere' },
})
