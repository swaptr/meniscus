import { renderSVG } from 'uqr'
import type { Admission } from '@meniscus/shared'

/** Plain URL so any phone camera opens the bed's capture screen. */
export const bedUrl = (origin: string, token: string) => `${origin}/a/bed/${encodeURIComponent(token)}`

/** Printable card. No patient name or MRN: cards sit on the bed in public view. */
export function bedCard(a: Pick<Admission, 'bed' | 'qr_token' | 'ward_code' | 'ward_name'>, origin: string) {
  const url = bedUrl(origin, a.qr_token)
  return { label: `${a.ward_code} · Bed ${a.bed}`, ward: a.ward_name, url, svg: renderSVG(url, { border: 1, ecc: 'M' }) }
}
