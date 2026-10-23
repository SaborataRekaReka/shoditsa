import { useContext, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { REFERENCE_PRESENTATION } from '../../app/local-presentation'
import { EmbeddedApplicationContext } from '../../features/application/EmbeddedApplicationContext'
import { ActionButton } from '../app-shell/AppShell'
import { QuestButton } from '../ui/QuestPrimitives'
import { AnchoredMenu } from '../ui'
import './GameLaunchControls.css'
import './GameLaunchControls.application.css'

/** The controller is shared with the platform version; the public control is not. */
export function GameLaunchButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const embedded = useContext(EmbeddedApplicationContext)
  return embedded
    ? <QuestButton {...props} className="launch-start"><span className="launch-start__label">{children}</span><ArrowRight size={21} aria-hidden="true" /></QuestButton>
    : <ActionButton {...props} className={className}>{children}</ActionButton>
}

export function GameLaunchControls({ mode, action, option, density = 'default' }: {
  mode: string
  action: ReactNode
  option?: ReactNode
  density?: 'default' | 'compact'
}) {
  return <div className={`game-launch-controls game-launch-controls--${mode}${density === 'compact' ? ' game-launch-controls--compact' : ''} ${option ? 'has-option' : 'is-action-only'}`}>
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
  const embedded = useContext(EmbeddedApplicationContext)
  return <AnchoredMenu
    portal={embedded}
    label={menuLabel}
    className={`game-option-select ${className}`.trim()}
    menuClassName={embedded ? 'launch-choice-menu' : `game-option-menu ${menuClassName}`.trim()}
    disabled={disabled}
    resetKey={resetKey}
    trigger={({ expanded, toggle, triggerRef }) => embedded ? <QuestButton
      ref={triggerRef} kind="choice" className="launch-option-trigger" disabled={disabled}
      aria-expanded={expanded} aria-haspopup="listbox" aria-label={`${label}: ${typeof value === 'string' ? value : ''}`}
      onClick={(event) => { event.stopPropagation(); toggle() }}
    >
      <span className="launch-option-art" aria-hidden="true">{valueIcon || labelIcon}</span>
      <span className="launch-option-copy"><small>{label}</small><strong>{value}</strong></span>
      <ChevronDown size={18} aria-hidden="true" />
    </QuestButton> : <button
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
        {REFERENCE_PRESENTATION ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </span>
    </button>}
  >
    {(close) => <>
      <span className={embedded ? 'launch-choice-menu__head' : 'game-option-menu__head'}>{menuLabel}</span>
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
  const embedded = useContext(EmbeddedApplicationContext)
  if (embedded) return <QuestButton kind="choice" type={type} className="launch-option-trigger" {...props}>
    <span className="launch-option-art" aria-hidden="true">{valueIcon || labelIcon}</span>
    <span className="launch-option-copy"><small>{label}</small><strong>{value}</strong></span>
    <ChevronRight size={18} aria-hidden="true" />
  </QuestButton>
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
  const embedded = useContext(EmbeddedApplicationContext)
  const trailingStatus = status ?? (selected
    ? { label: 'Выбрано', tone: 'available' as const, icon: <Check /> }
    : null)

  if (embedded) return <QuestButton kind="choice" className="launch-choice" role="option" aria-selected={selected} selected={selected} disabled={disabled}
    onClick={(event) => { event.stopPropagation(); onSelect() }}>
    <span className="launch-choice__icon" aria-hidden="true">{icon}</span>
    <span className="launch-choice__copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
    {trailingStatus && <span className={`launch-choice__status launch-choice__status--${trailingStatus.tone}`}>{trailingStatus.icon}{trailingStatus.label}</span>}
  </QuestButton>
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
