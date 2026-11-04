import * as stylex from '@stylexjs/stylex'
import type { EntryEvidence, NoteEvidence, PhotoEvidence } from '@meniscus/shared'
import { agreement, markAmounts } from '../lib/evidence.ts'
import { CONTAINER_LABEL, ISSUE_LABEL, STEP_LABEL } from '../lib/labels.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Chip } from './ui.tsx'

/** Everything the read produced, in plain terms (the entry details sheet; the photo itself is `PhotoOverlay`). */
export function EvidencePanel({ evidence }: { evidence: EntryEvidence | null }) {
  if (!evidence) return <p {...stylex.props(s.muted)}>No AI evidence (entered by hand, or saved before evidence was kept).</p>
  return evidence.kind === 'photo' ? <PhotoFacts e={evidence} /> : <NoteFacts e={evidence} />
}

function PhotoFacts({ e }: { e: PhotoEvidence }) {
  const r = e.reading
  const a = agreement(r, e.segmentation)
  return (
    <div {...stylex.props(s.panel)}>
      {a ? (
        <div {...stylex.props(s.agree)}>
          <span>{a.read}</span>
          <span>{a.sam}</span>
          <Chip tone={a.agree ? 'ok' : 'warn'} dot>
            {a.agree ? 'agree' : 'check photo'}
          </Chip>
        </div>
      ) : (
        <p>{r.volume_ml === null ? 'AI read no volume' : `AI read ${r.volume_ml} mL${r.capacity_ml ? ` of ${r.capacity_ml} mL` : ''}`}</p>
      )}
      <dl {...stylex.props(s.facts)}>
        <Fact label="Container">{CONTAINER_LABEL[r.container]}</Fact>
        <Fact label="Confidence">{Math.round(r.confidence * 100)}%</Fact>
        <Fact label="Marks visible">{r.marks_visible ? 'Yes' : 'No'}</Fact>
        <Fact label="Mode">{e.mode === 'sam+spark' ? 'SAM 3.1 + Muse Spark' : 'Muse Spark only'}</Fact>
      </dl>
      {r.reading_basis && <blockquote {...stylex.props(s.quote)}>“{r.reading_basis}”</blockquote>}
      {(r.appearance || e.colour) && (
        <p {...stylex.props(s.row)}>
          {e.colour && <span aria-hidden {...stylex.props(s.colour(e.colour))} />}
          <span>
            {r.appearance ?? 'Colour'}
            {e.colour ? ` · sampled ${e.colour}` : ''}
          </span>
        </p>
      )}
      {(r.issues.length > 0 || e.review_reasons.length > 0) && (
        <div {...stylex.props(s.chips)}>
          {r.issues.map((i) => (
            <Chip key={i} tone="warn" dot>
              {ISSUE_LABEL[i]}
            </Chip>
          ))}
          {e.review_reasons.map((x) => (
            <Chip key={x} tone="info">
              {x}
            </Chip>
          ))}
        </div>
      )}
      <Calls trace={e.trace} />
    </div>
  )
}

function NoteFacts({ e }: { e: NoteEvidence }) {
  return (
    <div {...stylex.props(s.panel)}>
      <p {...stylex.props(s.label)}>{e.kind === 'voice' ? 'Heard' : 'Typed'}</p>
      <blockquote {...stylex.props(s.quote)}>
        “
        {markAmounts(e.transcript).map((p, i) =>
          p.mark ? (
            <mark key={i} {...stylex.props(s.mark)}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
        ”
      </blockquote>
      <p>{e.draft_ml === null ? 'AI drafted no volume' : `AI drafted ${e.draft_ml} mL`}</p>
      <Calls trace={e.trace} />
    </div>
  )
}

function Calls({ trace }: { trace: { step: string; model: string; ms: number }[] }) {
  if (!trace.length) return null
  return (
    <div>
      <p {...stylex.props(s.label)}>Model calls</p>
      <ol {...stylex.props(s.calls)}>
        {trace.map((t, i) => (
          <li key={i} {...stylex.props(s.call)}>
            <span>{STEP_LABEL[t.step] ?? t.step}</span>
            <span {...stylex.props(s.muted)}>
              {t.model} · {(t.ms / 1000).toFixed(1)} s
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div {...stylex.props(s.fact)}>
      <dt {...stylex.props(s.label)}>{label}</dt>
      <dd {...stylex.props(s.factValue)}>{children}</dd>
    </div>
  )
}

const s = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: space.md, fontSize: text.md },
  agree: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.md, fontWeight: weight.semibold },
  facts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: space.md, margin: 0 },
  fact: { display: 'flex', flexDirection: 'column', gap: space.xs },
  factValue: { margin: 0, fontWeight: weight.semibold },
  label: { fontSize: text.xs, fontWeight: weight.bold, letterSpacing: '0.04em', color: color.muted },
  quote: {
    margin: 0,
    paddingInlineStart: space.lg,
    borderInlineStartWidth: 3,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: color.border,
    color: color.fg,
    fontStyle: 'italic',
  },
  mark: {
    backgroundColor: color.warnBg,
    color: color.fg,
    fontStyle: 'normal',
    fontWeight: weight.bold,
    paddingInline: space.xs,
    borderRadius: radius.sm,
  },
  row: { display: 'flex', alignItems: 'center', gap: space.md },
  colour: (hex: string) => ({
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    backgroundColor: hex,
  }),
  chips: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  calls: { display: 'flex', flexDirection: 'column', gap: space.sm, margin: 0, paddingInlineStart: 0, listStyle: 'none' },
  call: { display: 'flex', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap', fontSize: text.sm },
  muted: { color: color.muted, fontSize: text.sm },
})
