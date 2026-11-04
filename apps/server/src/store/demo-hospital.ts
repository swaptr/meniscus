/**
 * The demo hospital seeded into an empty store, standing in for the hospital census.
 * Every patient and MRN is fictional (MRNs use the visibly fake `AT-` prefix).
 */
import type { AcuityLevel, StaffRef } from '@meniscus/shared'

export const HOSPITAL_NAME = 'Meniscus Demo Hospital'

export interface DemoPatient {
  bed: string
  patient: string
  weight_kg: number
  mrn: string
}

export interface DemoWard {
  code: string
  name: string
  specialty: string
  capacity: number
  /** charting/acuity "Ward default acuity"; `stable` when left out. */
  default_acuity?: AcuityLevel
  patients: DemoPatient[]
}

export const DEMO_HOSPITAL: DemoWard[] = [
  {
    code: '2C',
    name: 'Surgical Ward 2C',
    specialty: 'General surgery',
    capacity: 6,
    patients: [
      { bed: '1', patient: 'Arjun Nair', weight_kg: 72, mrn: 'AT-100211' },
      { bed: '2', patient: 'Grace Okafor', weight_kg: 64, mrn: 'AT-100212' },
      { bed: '3', patient: 'Deepa Rao', weight_kg: 58, mrn: 'AT-100213' },
      { bed: '5', patient: 'Samuel Brooks', weight_kg: 88, mrn: 'AT-100215' },
      { bed: '6', patient: 'Fatima Khan', weight_kg: 61, mrn: 'AT-100216' },
    ],
  },
  {
    code: '3A',
    name: 'Medical Ward 3A',
    specialty: 'General medicine',
    capacity: 8,
    patients: [
      { bed: '1', patient: 'Vikram Singh', weight_kg: 80, mrn: 'AT-100301' },
      { bed: '2', patient: 'Ana Pereira', weight_kg: 57, mrn: 'AT-100302' },
      { bed: '3', patient: 'Rohan Das', weight_kg: 69, mrn: 'AT-100303' },
      { bed: '4', patient: 'Mei Lin', weight_kg: 52, mrn: 'AT-100304' },
      { bed: '5', patient: 'Joseph Mwangi', weight_kg: 75, mrn: 'AT-100305' },
      { bed: '6', patient: 'Priya Iyer', weight_kg: 63, mrn: 'AT-100306' },
      { bed: '7', patient: 'Hugo Martin', weight_kg: 82, mrn: 'AT-100307' },
    ],
  },
  {
    code: '5B',
    name: 'Neurology Ward 5B',
    specialty: 'Neurology',
    capacity: 6,
    patients: [
      { bed: '1', patient: 'Asha Verma', weight_kg: 62, mrn: 'AT-100501' },
      { bed: '2', patient: 'Ravi Menon', weight_kg: 78, mrn: 'AT-100502' },
      { bed: '3', patient: 'Meera Joshi', weight_kg: 55, mrn: 'AT-100503' },
      { bed: '4', patient: 'Tomas Silva', weight_kg: 84, mrn: 'AT-100504' },
      { bed: '5', patient: 'Lina Haddad', weight_kg: 59, mrn: 'AT-100505' },
      { bed: '6', patient: 'Kofi Mensah', weight_kg: 71, mrn: 'AT-100506' },
    ],
  },
  {
    code: 'HDU',
    name: 'Renal HDU',
    default_acuity: 'critical',
    specialty: 'Nephrology',
    capacity: 4,
    patients: [
      { bed: '1', patient: 'Nadia Rahman', weight_kg: 66, mrn: 'AT-100901' },
      { bed: '2', patient: 'Karan Mehta', weight_kg: 74, mrn: 'AT-100902' },
      { bed: '3', patient: 'Elena Novak', weight_kg: 60, mrn: 'AT-100903' },
    ],
  },
]

/** Fictional ward staff. Username and demo password: the lowercase first name (see DEMO_PASSWORD_HASHES). */
export const DEMO_STAFF: (StaffRef & { username: string })[] = [
  { id: 1, name: 'Ravi Kumar', role: 'attendant', username: 'ravi' },
  { id: 2, name: 'Sunita Devi', role: 'attendant', username: 'sunita' },
  { id: 3, name: 'Mohan Das', role: 'attendant', username: 'mohan' },
  { id: 4, name: 'Anita Thomas', role: 'nurse', username: 'anita' },
  { id: 5, name: 'Grace Lee', role: 'nurse', username: 'grace' },
  { id: 6, name: 'Meera Pillai', role: 'nurse', username: 'meera' },
  { id: 7, name: 'Nikhil Bose', role: 'nurse', username: 'nikhil' },
  { id: 8, name: 'Divya Kapoor', role: 'nurse', username: 'divya' },
  { id: 9, name: 'Rekha Gupta', role: 'attendant', username: 'rekha' },
  { id: 10, name: 'Lakshmi Iyer', role: 'matron', username: 'lakshmi' },
  { id: 11, name: 'Sana Mirza', role: 'dietitian', username: 'sana' },
]

/** Each demo staff member's wards by code, in rank order: home ward first, then cover. The matron's are the wards she oversees. */
export const DEMO_TEAMS: Record<number, readonly string[]> = {
  1: ['3A', '2C'],
  2: ['3A'],
  3: ['5B', '2C'],
  4: ['3A', '5B'],
  5: ['5B', '3A'],
  6: ['2C', '3A'],
  7: ['HDU'],
  8: ['HDU'],
  9: ['2C'],
  10: ['2C', '3A', '5B', 'HDU'],
  // A dietitian: the wards she covers, none of them a home ward.
  11: ['2C', '3A', '5B', 'HDU'],
}

/** The nurse in charge of each ward for the shift current at seeding. */
export const DEMO_IN_CHARGE: Record<string, number> = { '2C': 6, '3A': 4, '5B': 5, HDU: 7 }

/** HDU is one nurse to two patients on the demo shift. */
const HDU_BEDS: Record<string, number> = { '1': 7, '2': 7, '3': 8 }

/** Bed assignments for the shift current at seeding: the nurse in charge has every bed, except on HDU. */
export const DEMO_ASSIGNMENTS: { ward: string; bed: string; staff_id: number }[] = DEMO_HOSPITAL.flatMap((w) =>
  w.patients.map((p) => ({ ward: w.code, bed: p.bed, staff_id: (w.code === 'HDU' ? HDU_BEDS[p.bed] : DEMO_IN_CHARGE[w.code])! })),
)
