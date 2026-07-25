import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { AnchoredMenu } from '../ui'
import './GameLaunchControls.css'

export function GameLaunchControls({ mode, action, option }: {
  mode: string
  action: ReactNode
  option?: ReactNode
}) {
  return <div className={`game-launch-controls game-launch-controls--${mode} ${option ? 'has-option' : 'is-action-only'}`}>
    <div className="game-launch-controls__action">{action}</div>
    {option && <div className="game-launch-controls__option">{option}</div>}
  </div>
}

export function GameOptionSelect({
  label,
  labelIcon,
  value,
  valueIcon,
  endLabel,
  menuLabel,
  children,
  disabled = false,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  resetKey,
}: {
  label: string
  labelIcon: ReactNode
  value: ReactNode
  valueIcon?: ReactNode
  endLabel?: ReactNode
  menuLabel: string
  children: (close: () => void) => ReactNode
  disabled?: boolean
  className?: string
  triggerClassName?: string
  menuClassName?: string
  resetKey?: string
}) {
  return <AnchoredMenu
    label={menuLabel}
    className={`game-option-select ${className}`.trim()}
    menuClassName={`game-option-menu ${menuClassName}`.trim()}
    disabled={disabled}
    resetKey={resetKey}
    trigger={({ expanded, toggle, triggerRef }) => <button
      ref={triggerRef}
      type="button"
      className={`game-option-trigger ${triggerClassName}`.trim()}
      disabled={disabled}
      aria-expanded={expanded}
      aria-haspopup="listbox"
      onClick={(event) => {
        event.stopPropagation()
        toggle()
      }}
    >
      <span className="game-option-trigger__meta">
        <span className="game-option-trigger__label">{labelIcon}{label}</span>
        {endLabel && <span className="game-option-trigger__end">{endLabel}</span>}
      </span>
      <span className="game-option-trigger__value">
        {valueIcon}
        <strong>{value}</strong>
        <ChevronRight aria-hidden="true" />
      </span>
    </button>}
  >
    {(close) => <>
      <span className="game-option-menu__head">{menuLabel}</span>
      {children(close)}
    </>}
  </AnchoredMenu>
}

export function GameOptionAction({
  label,
  labelIcon,
  value,
  valueIcon,
  endLabel,
  className = '',
  type = 'button',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string
  labelIcon: ReactNode
  value: ReactNode
  valueIcon?: ReactNode
  endLabel?: ReactNode
}) {
  return <button
    type={type}
    className={`game-option-trigger game-option-action ${className}`.trim()}
    {...props}
  >
    <span className="game-option-trigger__meta">
      <span className="game-option-trigger__label">{labelIcon}{label}</span>
      {endLabel && <span className="game-option-trigger__end">{endLabel}</span>}
    </span>
    <span className="game-option-trigger__value">
      {valueIcon}
      <strong>{value}</strong>
      <ChevronRight aria-hidden="true" />
    </span>
  </button>
}

export function GameOption({
  title,
  description,
  icon,
  status,
  selected = false,
  disabled = false,
  tone = 'default',
  className = '',
  onSelect,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  status?: {
    label: ReactNode
    tone: 'completed' | 'available' | 'unlockable' | 'locked' | 'neutral'
    icon?: ReactNode
  }
  selected?: boolean
  disabled?: boolean
  tone?: 'default' | 'muted' | 'positive' | 'special'
  className?: string
  onSelect: () => void
}) {
  const trailingStatus = status ?? (selected
    ? { label: 'Выбрано', tone: 'available' as const, icon: <Check /> }
    : null)

  return <button
    type="button"
    role="option"
    aria-selected={selected}
    disabled={disabled}
    className={`game-option ${selected ? 'is-selected' : ''} game-option--${tone} ${className}`.trim()}
    onClick={(event) => {
      event.stopPropagation()
      onSelect()
    }}
  >
    <span className="game-option__icon" aria-hidden="true">{icon}</span>
    <span className="game-option__copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
    {trailingStatus && <span className={`game-option__status game-option__status--${trailingStatus.tone}`}>
      {trailingStatus.icon && <span aria-hidden="true">{trailingStatus.icon}</span>}
      <span>{trailingStatus.label}</span>
    </span>}
  </button>
}
