/** Test fixtures for the audit views: fictional staff, synthetic entries. Not imported by the app. */
import type { Entry, EntryEvent, StaffRef } from '@meniscus/shared'

export const RAVI: StaffRef = { id: 1, name: 'Ravi Kumar', role: 'attendant' }
export const SUNITA: StaffRef = { id: 2, name: 'Sunita Devi', role: 'attendant' }
export const ANITA: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }
export const GRACE: StaffRef = { id: 5, name: 'Grace Lee', role: 'nurse' }

/** 2 Nov 2026 at hh:mm local time, as ISO. */
export const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m).toISOString()

export const entry = (over: Partial<Entry> = {}): Entry => ({
  labeled_media: null,
  id: 1,
  admission_id: 13,
  direction: 'in',
  category: 'water',
  volume_ml: 200,
  item: null,
  notes: null,
  source: 'manual',
  confidence: null,
  status: 'pending',
  created_at: at(10),
  reviewed_at: null,
  has_photo: false,
  recorded_ml: over.volume_ml ?? 200,
  evidence: null,
  recorded_at: over.created_at ?? at(10),
  late: false,
  created_by: null,
  reviewed_by: null,
  approved_ml: null,
  amended_at: null,
  reject_reason: null,
  urine_colour: null,
  urine_rgb: null,
  media: null,
  levels: null,
  iddsi_level: null,
  drink: null,
  ...over,
})

export const event = (over: Partial<EntryEvent> & Pick<EntryEvent, 'kind' | 'at'>): EntryEvent => ({
  by: null,
  from_ml: null,
  to_ml: null,
  from_category: null,
  to_category: null,
  reason: null,
  note: null,
  from_colour: null,
  to_colour: null,
  from_iddsi: null,
  to_iddsi: null,
  from_drink: null,
  to_drink: null,
  from_item: null,
  to_item: null,
  ...over,
})
