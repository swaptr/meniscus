import { useId, useState, type ComponentProps, type ReactNode, type Ref } from 'react'
import * as stylex from '@stylexjs/stylex'
import { space } from '../tokens.stylex.ts'
import { f } from './form.styles.ts'
import { HideIcon, ShowIcon } from './icons.tsx'

type InputProps = Omit<ComponentProps<'input'>, 'className' | 'style' | 'id'> & {
  label: string
  /** Shown under the field, linked by aria-describedby. */
  hint?: string
  ref?: Ref<HTMLInputElement>
}

/** A labelled text input for sign-in style forms: 48 px tall, 17 px text (no zoom on iOS), a clear focus ring. */
export function TextField({ label, hint, ref, ...props }: InputProps) {
  const id = useId()
  return (
    <div {...stylex.props(f.field)}>
      <label htmlFor={id} {...stylex.props(f.label)}>
        {label}
      </label>
      <input ref={ref} id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} {...stylex.props(f.input)} />
      {hint && (
        <span id={`${id}-hint`} {...stylex.props(f.hint)}>
          {hint}
        </span>
      )}
    </div>
  )
}

/** A password input with a show/hide toggle (44 px). Never pre-filled, never stored. */
export function PasswordField({ label = 'Password', hint, ref, ...props }: Omit<InputProps, 'type' | 'label'> & { label?: string }) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <div {...stylex.props(f.field)}>
      <label htmlFor={id} {...stylex.props(f.label)}>
        {label}
      </label>
      <div {...stylex.props(f.wrap)}>
        <input
          ref={ref}
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...props}
          {...stylex.props(f.input, f.withToggle)}
        />
        <button
          type="button"
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((v) => !v)}
          {...stylex.props(f.toggle)}
        >
          {shown ? <HideIcon size={16} /> : <ShowIcon size={16} />}
        </button>
      </div>
      {hint && (
        <span id={`${id}-hint`} {...stylex.props(f.hint)}>
          {hint}
        </span>
      )}
    </div>
  )
}

/** A labelled native select on the form-row recipe (DESIGN.md 4.7): 48 px, 17 px text, a clear focus ring. */
export function SelectField<V extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string
  /** Null or undefined shows `placeholder` as a disabled, unset first option until a value is picked. */
  value: V | null | undefined
  options: readonly { readonly id: V; readonly label: string }[]
  onChange: (v: V) => void
  placeholder?: string
}) {
  const id = useId()
  return (
    <div {...stylex.props(f.field)}>
      <label htmlFor={id} {...stylex.props(f.label)}>
        {label}
      </label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value as V)} {...stylex.props(f.input, f.select)}>
        {value == null && (
          <option value="" disabled>
            {placeholder ?? `Choose ${label.toLowerCase()}`}
          </option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** A field's hint or error line under its control (DESIGN.md 5.17): one set for every form. */
export function FieldNote({ id, hint, error }: { id: string; hint?: ReactNode; error?: ReactNode }) {
  if (error)
    return (
      <span id={`${id}-note`} role="alert" {...stylex.props(f.fieldError)}>
        {error}
      </span>
    )
  if (hint)
    return (
      <span id={`${id}-note`} {...stylex.props(f.hint)}>
        {hint}
      </span>
    )
  return null
}

/**
 * A native time input (48 px, 17 px) with the chosen time echoed `Set to 21:38` beside it, since a native input may show
 * 12-hour text on an en-US device (web/interface "Times and dates written one way").
 */
export function TimeField({
  label,
  value,
  onChange,
  hint,
  error,
  hideLabel = false,
  required,
  min,
  max,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: ReactNode
  error?: ReactNode
  /** The label is given by a surrounding group (still the input's accessible name). */
  hideLabel?: boolean
  required?: boolean
  min?: string
  max?: string
}) {
  const id = useId()
  return (
    <div {...stylex.props(f.field)}>
      {!hideLabel && (
        <label htmlFor={id} {...stylex.props(f.label)}>
          {label}
        </label>
      )}
      <div {...stylex.props(t.row)}>
        <input
          id={id}
          type="time"
          aria-label={hideLabel ? label : undefined}
          aria-describedby={hint || error ? `${id}-note` : undefined}
          aria-invalid={error ? true : undefined}
          required={required}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...stylex.props(f.input, t.time)}
        />
        {/^\d\d:\d\d$/.test(value) && <span {...stylex.props(f.echo)}>{`Set to ${value}`}</span>}
      </div>
      <FieldNote id={id} hint={hint} error={error} />
    </div>
  )
}

/** A labelled textarea on the form row. ` (optional)` marks optional fields; required ones carry no marker. */
export function TextArea({
  label,
  hint,
  error,
  optional = false,
  ref,
  ...props
}: Omit<ComponentProps<'textarea'>, 'className' | 'style' | 'id'> & {
  label: string
  hint?: ReactNode
  error?: ReactNode
  optional?: boolean
  ref?: Ref<HTMLTextAreaElement>
}) {
  const id = useId()
  return (
    <div {...stylex.props(f.field)}>
      <label htmlFor={id} {...stylex.props(f.label)}>
        {label}
        {optional && <span {...stylex.props(f.optional)}> (optional)</span>}
      </label>
      <textarea
        ref={ref}
        id={id}
        aria-describedby={hint || error ? `${id}-note` : undefined}
        aria-invalid={error ? true : undefined}
        {...props}
        {...stylex.props(f.input, f.textarea)}
      />
      <FieldNote id={id} hint={hint} error={error} />
    </div>
  )
}

const t = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  time: { width: 148, fontVariantNumeric: 'tabular-nums' },
})
