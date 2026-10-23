import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown } from 'lucide-react'
import './UiControls.css'

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
export type UiSurface = 'paper' | 'dark'
type FieldVariant = 'default' | 'soft'
type ActionVariant = 'primary' | 'secondary' | 'ghost' | 'hint' | 'danger'

export const ControlButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ControlButton({
  className = '',
  type = 'button',
  ...props
}, ref) {
  return <button ref={ref} type={type} className={classes('ui-control', className)} {...props} />
})

export const ActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ActionVariant
  surface?: UiSurface
  size?: 'compact'
}>(function ActionButton({
  variant = 'primary',
  surface,
  size,
  className = '',
  type = 'button',
  ...props
}, ref) {
  return <ControlButton ref={ref} type={type} className={classes('ui-button', `ui-button--${variant}`, surface && `ui-button--${surface}`, size && `ui-button--${size}`, className)} {...props} />
})

/** Navigation keeps anchor semantics while sharing the action control's variants. */
export const ActionLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ActionVariant
  surface?: UiSurface
}>(function ActionLink({ variant = 'primary', surface, className = '', ...props }, ref) {
  return <a ref={ref} className={classes('ui-control', 'ui-button', `ui-button--${variant}`, surface && `ui-button--${surface}`, className)} {...props} />
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

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { surface?: UiSurface; variant?: FieldVariant }>(function TextInput({
  className = '',
  surface,
  variant = 'default',
  ...props
}, ref) {
  return <input ref={ref} className={classes('ui-input', surface && `ui-input--${surface}`, variant === 'soft' && 'ui-input--soft', className)} {...props} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { surface?: UiSurface }>(function TextArea({
  className = '',
  surface,
  ...props
}, ref) {
  return <textarea ref={ref} className={classes('ui-textarea', surface && `ui-textarea--${surface}`, className)} {...props} />
})

export const SelectControl = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { surface?: UiSurface; variant?: FieldVariant }>(function SelectControl({
  className = '',
  surface,
  variant = 'default',
  ...props
}, ref) {
  const select = <select ref={ref} className={classes('ui-select', surface && `ui-select--${surface}`, variant === 'soft' && 'ui-select--soft', className)} {...props} />
  return variant === 'soft' ? <span className="ui-select-shell">{select}<ChevronDown size={20} aria-hidden="true" /></span> : select
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
