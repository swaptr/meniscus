import * as stylex from '@stylexjs/stylex'
import type { CareStatus } from '@meniscus/shared'
import { careBadges } from '../lib/care.ts'
import { space } from '../tokens.stylex.ts'
import { Chip } from './ui.tsx'

/** One neutral badge per active order (`NBM`, `IDDSI 2`, `Limit 1.5 L · 82%`…); the prompts carry the severity. Read-only. */
export function CareBadges({ care }: { care: CareStatus }) {
  const badges = careBadges(care)
  if (!badges.length) return null
  return (
    <ul aria-label="Care orders" {...stylex.props(s.list)}>
      {badges.map((b) => (
        <li key={b}>
          <Chip tone="neutral">{b}</Chip>
        </li>
      ))}
    </ul>
  )
}

const s = stylex.create({
  list: { display: 'flex', flexWrap: 'wrap', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' },
})
