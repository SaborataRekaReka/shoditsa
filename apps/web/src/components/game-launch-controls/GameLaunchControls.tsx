import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
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
  const [open, setOpen] = useState(false)
  const [opensUp, setOpensUp] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState(280)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const positionMenu = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top
    const nextOpensUp = spaceBelow < 280 && spaceAbove > spaceBelow
    const available = nextOpensUp ? spaceAbove : spaceBelow
    setOpensUp(nextOpensUp)
    setMenuMaxHeight(Math.max(120, Math.floor(available - 12)))
  }, [])

  useEffect(() => setOpen(false), [resetKey])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close()
    }
    const onViewportChange = () => positionMenu()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('resize', onViewportChange)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
    }
  }, [close, open, positionMenu])

  return <div
    ref={wrapRef}
    className={`game-option-select ${className} ${open ? 'is-open' : ''} ${opensUp ? 'opens-up' : ''}`.trim()}
    style={{ '--game-option-menu-max-height': `${menuMaxHeight}px` } as CSSProperties}
  >
    <button
      type="button"
      className={`game-option-trigger ${triggerClassName}`.trim()}
      disabled={disabled}
      aria-expanded={open}
      aria-haspopup="listbox"
      onClick={(event) => {
        event.stopPropagation()
        if (open) {
          close()
          return
        }
        positionMenu()
        setOpen(true)
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
    </button>
    {open && <div className={`game-option-menu ${menuClassName}`.trim()} role="listbox" aria-label={menuLabel}>
      <span className="game-option-menu__head">{menuLabel}</span>
      {children(close)}
    </div>}
  </div>
}

export function GameOption({
  title,
  description,
  icon,
  selected = false,
  disabled = false,
  tone = 'default',
  className = '',
  onSelect,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  selected?: boolean
  disabled?: boolean
  tone?: 'default' | 'muted' | 'positive' | 'special'
  className?: string
  onSelect: () => void
}) {
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
    {selected && <Check className="game-option__check" aria-hidden="true" />}
  </button>
}
