/** Quick jump (web/interface "Quick jump", DESIGN.md 4.4): pure matching over what is already loaded; no request. */
import type { WardRef } from '@meniscus/shared'
import { bedTone, STATUS_LABEL } from './labels.ts'
import type { Snapshot } from './snapshot.ts'

export interface JumpResult {
  kind: 'ward' | 'bed'
  label: string
  href: string
}

/** Every jump target: the staff member's wards, then the beds of the ward loaded last. */
export function targets(wards: readonly WardRef[], snap: Snapshot): JumpResult[] {
  const out: JumpResult[] = wards.map((w) => {
    const name = snap.wards[w.id]?.name
    return { kind: 'ward', label: name ? `${w.code} ${name}` : w.code, href: `/n/w/${w.id}` }
  })
  for (const b of snap.beds?.items ?? [])
    out.push({
      kind: 'bed',
      label: `${b.ward_code} bed ${b.bed} · ${b.patient} · ${STATUS_LABEL[bedTone(b.alerts, b.pending)]}`,
      href: `/n/${b.id}`,
    })
  return out
}

/** Filters by ward code, bed number or patient name; every word of the query must match. */
export function matches(query: string, wards: readonly WardRef[], snap: Snapshot): JumpResult[] {
  const all = targets(wards, snap)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return all
  return all.filter((t) => {
    const hay = t.label.toLowerCase()
    const bedNo = t.kind === 'bed' ? /bed (\S+)/.exec(hay)?.[1] : undefined
    return words.every((w) => w === bedNo || hay.split(/[\s·]+/).some((part) => part.startsWith(w)) || (w.length >= 3 && hay.includes(w)))
  })
}

export { isJumpKey, isTypingTarget } from './jump-key.ts'
