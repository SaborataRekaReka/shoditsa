import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import './UiControls.css'

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')

export const ControlButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ControlButton({
  className = '',
  type = 'button',
  ...props
}, ref) {
  return <button ref={ref} type={type} className={classes('ui-control', className)} {...props} />
})

export const ActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'hint'
}>(function ActionButton({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}, ref) {
  return <ControlButton ref={ref} type={type} className={classes('ui-button', `ui-button--${variant}`, className)} {...props} />
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  size?: 'sm' | 'md'
}>(function IconButton({
  label,
  size = 'md',
  className = '',
  children,
  ...props
}, ref) {
  return <ControlButton
    ref={ref}
    className={classes('ui-icon-button', `ui-icon-button--${size}`, className)}
    aria-label={label}
    title={props.title ?? label}
    {...props}
  >{children}</ControlButton>
})

export const TextButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function TextButton({
  className = '',
  ...props
}, ref) {
  return <ControlButton ref={ref} className={classes('ui-text-button', className)} {...props} />
})

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({
  className = '',
  ...props
}, ref) {
  return <input ref={ref} className={classes('ui-input', className)} {...props} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({
  className = '',
  ...props
}, ref) {
  return <textarea ref={ref} className={classes('ui-textarea', className)} {...props} />
})

export const SelectControl = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function SelectControl({
  className = '',
  ...props
}, ref) {
  return <select ref={ref} className={classes('ui-select', className)} {...props} />
})

export function FormField({ label, htmlFor, hint, error, required = false, className = '', children }: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
}) {
  return <div className={classes('ui-field', Boolean(error) && 'is-invalid', className)}>
    <label htmlFor={htmlFor}>{label}{required && <span aria-hidden="true"> *</span>}</label>
    {children}
    {error
      ? <small className="ui-field__error" role="alert">{error}</small>
      : hint && <small className="ui-field__hint">{hint}</small>}
  </div>
}
