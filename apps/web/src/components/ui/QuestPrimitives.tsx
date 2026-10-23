import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ControlButton } from './UiControls'
import { useDialogFocusTrap } from './DialogSurface'
import './QuestPrimitives.css'

/** Controls for the isolated quest-study theme, with their own token owner. */
export const QuestButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'outline' | 'promo' | 'club' | 'text' | 'choice' | 'icon' | 'icon-inverse' | 'nav' | 'row' | 'tab' | 'menu' | 'footer' | 'theme' | 'settings-nav'
  size?: 'default' | 'compact' | 'buzzer'
  selected?: boolean
}>(function QuestButton({ kind = 'primary', size = 'default', selected, className = '', ...props }, ref) {
  return <ControlButton ref={ref} className={`quest-button quest-button--${kind}${size !== 'default' ? ` quest-button--${size}` : ''}${selected ? ' is-selected' : ''} ${className}`.trim()} {...props} />
})

export const QuestInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function QuestInput({ className = '', ...props }, ref) {
  return <input ref={ref} className={`quest-input ${className}`.trim()} {...props} />
})

export function QuestOptionGroup<T extends string | number>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean
}) {
  const labelId = useId()
  return <fieldset className="quest-option-group" disabled={disabled}>
    <legend id={labelId}>{label}</legend>
    <div role="radiogroup" aria-labelledby={labelId} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option, index) => <QuestButton key={option.value} kind="choice" size="compact" role="radio" aria-checked={value === option.value} selected={value === option.value} tabIndex={value === option.value ? 0 : -1} disabled={disabled} onClick={() => onChange(option.value)} onKeyDown={event => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (!step && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + step + options.length) % options.length
        onChange(options[next].value)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
      }}>{option.label}</QuestButton>)}
    </div>
  </fieldset>
}

export function QuestSwitch({ label, checked, onChange, disabled = false }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean
}) {
  return <ControlButton className="quest-switch" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
    <span>{label}</span><span className="quest-switch__track" aria-hidden="true"><span /></span>
  </ControlButton>
}

export function QuestProgress({ value, max, label, tone = 'gold', caption }: { value: number; max: number; label: string; tone?: 'gold' | 'green' | 'blue'; caption?: string }) {
  return <div className={`quest-progress quest-progress--${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
    <span style={{ width: `${Math.min(100, Math.max(0, value / max * 100))}%` }} /><strong><span>{caption ?? `${value} / ${max}`}</span></strong>
  </div>
}

export function QuestCountdown({ remainingMs, durationMs, paused = false }: { remainingMs: number; durationMs: number; paused?: boolean }) {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000)
  const fraction = Math.min(1, Math.max(0, remainingMs / durationMs))
  return <div className={`quest-countdown${remainingMs <= 5000 ? ' quest-countdown--urgent' : ''}`} role="progressbar" aria-label="Время на ответ" aria-valuemin={0} aria-valuemax={durationMs / 1000} aria-valuenow={seconds} aria-valuetext={`${paused ? 'Пауза. ' : ''}Осталось ${seconds} сек.`}>
    <span style={{ transform: `scaleX(${fraction})` }} />
  </div>
}

export function QuestDialog({ title, description, children, onClose, footer, variant = 'default' }: { title: string; description?: string; children?: ReactNode; onClose: () => void; footer?: ReactNode; variant?: 'default' | 'confirmation' }) {
  const ref = useDialogFocusTrap<HTMLElement>(true, onClose)
  const hasContent = children !== undefined && children !== null && children !== false && children !== ''
  return <div className="quest-dialog-backdrop" onPointerDown={event => event.target === event.currentTarget && onClose()}>
    <section className={`quest-dialog${variant === 'confirmation' ? ' quest-dialog--confirmation' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header><div><h2>{title}</h2>{description && <p>{description}</p>}</div><QuestButton kind="icon" aria-label="Закрыть" onClick={onClose}><X size={23} /></QuestButton></header>
      {hasContent && <div className="quest-dialog__content">{children}</div>}{footer && <footer>{footer}</footer>}
    </section>
  </div>
}

/** A full-screen presentation with the same focus, scroll and Escape contract as dialogs. */
export function QuestTakeover({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useDialogFocusTrap<HTMLElement>(true, onClose)
  return <section className="quest-takeover" ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
    <QuestButton kind="icon" className="quest-takeover__close" aria-label="Закрыть" onClick={onClose}><X size={24} strokeWidth={2.2} /></QuestButton>
    {children}
  </section>
}
