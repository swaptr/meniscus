/**
 * A meal's dishes (web/ward "Dishes in the Nutrition section"): `<name> · <portion>` beside the dish kind, with the
 * amendment marks; removed dishes struck through, with the words saying so. "Show tray" fetches the kept tray photo
 * once per meal (`GET /api/media/<id>`) and draws it with the tray overlay. No model requests.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { Meal } from '@meniscus/shared'
import { api } from '../lib/api.ts'
import { dishRows, dishTray, trayMediaId, trayPhotos } from '../lib/dishes.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { PencilIcon } from './icons.tsx'
import { ui } from './ui.styles.ts'

// The photo viewer and overlay load with the first "Show tray".
const PhotoSource = lazy(() => import('./source-view.tsx').then((m) => ({ default: m.PhotoSource })))
/** One fetch per tray photo for the app's lifetime, across hide and show. */
const photos = trayPhotos(api)

export function DishList({ meal, alt }: { meal: Meal; alt: string }) {
  const rows = dishRows(meal)
  const mediaId = trayMediaId(meal)
  const [shown, setShown] = useState(false)
  if (!rows.length && mediaId === null) return null
  return (
    <div {...stylex.props(s.wrap)}>
      {rows.length > 0 && (
        <ul aria-label="Dishes" {...stylex.props(s.list)}>
          {rows.map((r) => (
            <li key={r.key} {...stylex.props(s.row)}>
              <span {...stylex.props(s.line)}>
                {r.removed ? <s {...stylex.props(s.removed)}>{r.text}</s> : <span>{r.text}</span>}
                <span {...stylex.props(s.kind)}>{r.kind}</span>
              </span>
              {r.mark && (
                <span {...stylex.props(s.mark)}>
                  <PencilIcon size={14} />
                  {r.mark}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {mediaId !== null && (
        <span>
          <Button variant="ghost" aria-expanded={shown} onClick={() => setShown(!shown)}>
            {shown ? 'Hide tray' : 'Show tray'}
          </Button>
        </span>
      )}
      {shown && mediaId !== null && <TrayPhoto mediaId={mediaId} meal={meal} alt={alt} />}
    </div>
  )
}

function TrayPhoto({ mediaId, meal, alt }: { mediaId: number; meal: Meal; alt: string }) {
  const [state, setState] = useState<{ blob: Blob | null; error: boolean }>({ blob: null, error: false })
  useEffect(() => {
    let live = true
    photos.get(mediaId).then(
      (blob) => live && setState({ blob, error: false }),
      () => live && setState({ blob: null, error: true }),
    )
    return () => {
      live = false
    }
  }, [mediaId])
  if (state.error) return <p {...stylex.props(ui.muted)}>The photo could not be loaded.</p>
  if (!state.blob) return <p {...stylex.props(ui.muted)}>Loading the tray photo…</p>
  return (
    <div {...stylex.props(s.tray)}>
      <Suspense fallback={<p {...stylex.props(ui.muted)}>Loading the tray photo…</p>}>
        <PhotoSource src={{ blob: state.blob }} evidence={null} tray={dishTray(meal)} alt={alt} />
      </Suspense>
    </div>
  )
}

const s = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.sm },
  list: { display: 'flex', flexDirection: 'column', gap: space.xs, margin: 0, padding: 0, listStyle: 'none' },
  row: { display: 'flex', flexDirection: 'column', gap: space.xs, fontSize: text.sm, overflowWrap: 'anywhere' },
  line: { display: 'flex', flexWrap: 'wrap', columnGap: space.sm, alignItems: 'baseline', fontWeight: weight.semibold },
  kind: { fontSize: text.xs, fontWeight: weight.regular, color: color.muted },
  removed: { color: color.muted },
  mark: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: text.xs, color: color.muted },
  tray: { maxWidth: 420 },
})
