/**
 * A photo meal's proof, in "What the AI read" (loaded lazily, on open): the tray photo with its dish overlay, who took
 * it and its fingerprint, paired with the served tray photo when there is one (before and after, with the eaten-share
 * stat line between); one row per dish, the AI read beside the value saved; who saved it. Each kept photo is one
 * request (`GET /api/media/<id>`), and none once it is deleted. No model requests.
 */
import * as stylex from '@stylexjs/stylex'
import type { Meal } from '@meniscus/shared'
import { proofView, type ProofPhoto, type TrayView } from '../lib/tray.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { NoPhotoIcon } from './icons.tsx'
import { PairLayout, PhotoSource } from './source-view.tsx'

export function TrayProof({ meal, alt }: { meal: Meal; alt: string }) {
  const v = proofView(meal)
  if (!v) return null
  const after = <ProofPhotoView photo={v.photo} tray={v.tray} sha256={meal.proof!.photo.sha256} alt={alt} />
  return (
    <section aria-labelledby={`tray-proof-${meal.id}`} {...stylex.props(s.proof, v.served && s.wide)}>
      <h3 id={`tray-proof-${meal.id}`} {...stylex.props(s.overline)}>
        Tray proof
      </h3>
      {v.served ? (
        <PairLayout
          before={
            <ProofPhotoView
              photo={v.served}
              tray={v.servedTray}
              sha256={meal.proof!.served!.sha256}
              alt={`Served tray photo, ${alt.replace(/^Tray photo, /, '')}`}
            />
          }
          drop={v.stat}
          after={after}
        />
      ) : (
        after
      )}
      {v.rows.length > 0 && (
        <ul aria-label="Dishes: AI read and saved" {...stylex.props(s.rows)}>
          {v.rows.map((r) => (
            <li key={r.text} {...stylex.props(s.row, r.changed && s.changed)}>
              {r.text}
            </li>
          ))}
        </ul>
      )}
      <p {...stylex.props(s.meta)}>{v.saved}</p>
    </section>
  )
}

/** One photo of the proof: the photo with its overlay, line and fingerprint, or the line alone once it is deleted. */
function ProofPhotoView({ photo, tray, sha256, alt }: { photo: ProofPhoto; tray: TrayView | null; sha256: string; alt: string }) {
  if (photo.media_id === null)
    return (
      <div {...stylex.props(s.gone)}>
        <NoPhotoIcon size={16} />
        {photo.line}
      </div>
    )
  return (
    <PhotoSource
      src={{ media_id: photo.media_id }}
      labeled={photo.labeled}
      evidence={null}
      tray={tray}
      sha256={sha256}
      alt={alt}
      caption={<p {...stylex.props(s.meta)}>{photo.line}</p>}
    />
  )
}

const s = stylex.create({
  proof: { display: 'flex', flexDirection: 'column', gap: space.md, paddingInline: space.md, paddingBottom: space.md, maxWidth: 420 },
  // A served and collected pair sits side by side on wide screens.
  wide: { maxWidth: 860 },
  overline: { margin: 0, fontSize: text.xs, fontWeight: weight.bold, letterSpacing: '0.05em', color: color.muted },
  meta: { margin: 0, fontSize: text.sm, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  gone: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingInline: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    backgroundColor: color.bg,
    color: color.muted,
    fontSize: text.sm,
    fontVariantNumeric: 'tabular-nums',
  },
  rows: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none', fontSize: text.sm },
  row: {
    paddingBlock: space.sm,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: color.border,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  // DESIGN.md 7.2: a changed value in 700.
  changed: { fontWeight: weight.bold },
})
