/** Dialogs and large peeks are bottom sheets up to 640 px wide and centred cards from 641 px (DESIGN.md 2.6, 5.2). Pure. */
export const SHEET_MAX = 640
export const sheetMode = (width: number): 'sheet' | 'card' => (width <= SHEET_MAX ? 'sheet' : 'card')
export const PHONE_MEDIA = `@media (max-width: ${SHEET_MAX}px)`
