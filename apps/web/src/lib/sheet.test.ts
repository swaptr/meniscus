import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { SHEET_MAX, sheetMode } from './sheet.ts'

const src = (p: string) => readFileSync(new URL(`../components/${p}`, import.meta.url), 'utf8')
// Every dialog popup in the app goes through the one recipe (components/sheet.tsx and sheet.styles.ts).
const DIALOGS = [
  'bed-qr.tsx',
  'reason-dialog.tsx',
  'resolve.tsx',
  'missed-emptying.tsx',
  'amend-meal-dialog.tsx',
  'assign-dietitian-dialog.tsx',
  'entry-details.tsx',
  'close-referral-dialog.tsx',
  'care-forms.tsx',
  'switch-user-confirm.tsx',
  'referral-dialog.tsx',
]

// On the shared <Sheet>/<ConfirmSheet> itself, with no popup markup of their own.
const ON_SHEET = [
  'bed-qr.tsx',
  'reason-dialog.tsx',
  'resolve.tsx',
  'missed-emptying.tsx',
  'amend-meal-dialog.tsx',
  'assign-dietitian-dialog.tsx',
  'close-referral-dialog.tsx',
  'care-forms.tsx',
  'switch-user-confirm.tsx',
  'referral-dialog.tsx',
]

describe('one dialog layout', () => {
  it('[web/interface] One dialog layout: Focus stays inside past a disabled last button', () => {
    // No DOM here: the trap is Base UI's modal Dialog/AlertDialog popup (focus guards around the popup), which Sheet
    // always renders modal. With a natively disabled last button the guards had nothing to wrap from and Tab left the
    // dialog (seen in the browser), so the actions keep a disabled commit focusable (aria-disabled) through the
    // FocusableWhenDisabled context that Button reads. Browser check: 12 Tabs in "Assign dietitian", Assign disabled,
    // all stay inside.
    const t = src('sheet.tsx')
    assert.equal(t.match(/<FocusableWhenDisabled value>/g)?.length, 2, 'both Sheet and ConfirmSheet actions')
    assert.match(src('button.tsx'), /focusableWhenDisabled=\{keepFocusable\}/)
    assert.ok(!/modal=\{false\}/.test(t), 'Sheet is always modal')
    assert.match(t, /<Dialog\.Popup\b/)
    assert.match(t, /<AlertDialog\.Popup\b/)
    for (const f of ON_SHEET) {
      const d = src(f)
      assert.ok(/<(?:Confirm)?Sheet\b/.test(d), `${f} renders the shared Sheet`)
      assert.ok(!/<(?:Alert)?Dialog\.Popup\b/.test(d), `${f} has no popup of its own`)
      assert.ok(!/modal=\{false\}/.test(d), `${f} keeps the dialog modal`)
    }
    // A dialog with a popup of its own (the entry details' long sheet) keeps its disabled buttons focusable too.
    for (const f of DIALOGS.filter((x) => !ON_SHEET.includes(x))) {
      const d = src(f)
      if (/<(?:Alert)?Dialog\.Popup\b/.test(d))
        assert.match(d, /<FocusableWhenDisabled value>/, `${f} keeps a disabled last button focusable`)
    }
  })

  it('[web/interface] One dialog layout: Bed QR on a phone', () => {
    assert.equal(SHEET_MAX, 640)
    assert.equal(sheetMode(390), 'sheet')
    assert.equal(sheetMode(640), 'sheet')
    for (const f of DIALOGS) {
      const t = src(f)
      // Either through <Sheet> / <ConfirmSheet>, or a popup on the one recipe's `sheet.popup` and `sheet.backdrop`.
      for (const m of t.matchAll(/<(?:Alert)?Dialog\.(Popup|Backdrop)\b[^>]*>/g)) {
        assert.match(m[0], m[1] === 'Popup' ? /sheet\.popup/ : /sheet\.backdrop/, `${f}: ${m[0]}`)
      }
      assert.ok(/<(?:Confirm)?Sheet\b/.test(t) || /sheet\.popup/.test(t), `${f} uses the one dialog recipe`)
    }
  })

  it('[web/interface] One dialog layout: Reason to open another ward', () => {
    assert.equal(sheetMode(641), 'card')
    assert.equal(sheetMode(1100), 'card')
    // One backdrop and one 16 px padding for every popup.
    const styles = readFileSync(new URL('../components/sheet.styles.ts', import.meta.url), 'utf8')
    assert.match(styles, /padding: space\.xl/)
    assert.match(styles, /backdrop:/)
  })

  it('[web/interface] One dialog layout: Focus returns', () => {
    // The popup hands focus back to the control that opened it (Base UI finalFocus), never to the page top.
    const t = src('sheet.tsx')
    assert.match(t, /finalFocus=\{finalFocus\}/)
    assert.ok(!/finalFocus=\{false\}/.test(t))
  })

  it('[web/interface] Reduced motion: Dialog without reduced motion', () => {
    const t = readFileSync(new URL('../components/sheet.styles.ts', import.meta.url), 'utf8')
    assert.match(t, /transitionDuration: motion\.overlay/)
    assert.match(t, /transitionProperty: 'opacity, transform'/)
    assert.ok(!/transitionProperty: '[^']*(height|width|box-shadow)/.test(t))
  })
})
