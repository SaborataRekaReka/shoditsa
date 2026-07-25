import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import './AnchoredMenu.css'

const MENU_HEIGHT_LIMIT = 280
const MIN_USEFUL_SPACE = 96
const MENU_GAP = 8
const VIEWPORT_GUTTER = 12
const STICKY_HEADER_HEIGHT = 64

export function AnchoredMenu({
  label,
  trigger,
  children,
  disabled = false,
  className = '',
  menuClassName = '',
  resetKey,
}: {
  label: string
  trigger: (controls: {
    expanded: boolean
    toggle: () => void
    triggerRef: React.RefObject<HTMLButtonElement | null>
  }) => ReactNode
  children: (close: () => void) => ReactNode
  disabled?: boolean
  className?: string
  menuClassName?: string
  resetKey?: string
}) {
  const [open, setOpen] = useState(false)
  const [opensUp, setOpensUp] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState(MENU_HEIGHT_LIMIT)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => setOpen(false), [])

  const positionMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
    const safeTop = viewportTop + STICKY_HEADER_HEIGHT + VIEWPORT_GUTTER
    const safeBottom = viewportBottom - VIEWPORT_GUTTER
    const spaceBelow = Math.max(0, safeBottom - rect.bottom - MENU_GAP)
    const spaceAbove = Math.max(0, rect.top - safeTop - MENU_GAP)
    // Keep the menu below the trigger whenever it has a useful scroll area.
    // Opening upward is a fallback for controls close to the viewport edge.
    const nextOpensUp = spaceBelow < MIN_USEFUL_SPACE && spaceAbove > spaceBelow
    const available = nextOpensUp ? spaceAbove : spaceBelow
    setOpensUp(nextOpensUp)
    setMenuMaxHeight(Math.max(MIN_USEFUL_SPACE, Math.min(MENU_HEIGHT_LIMIT, Math.floor(available))))
  }, [])

  const toggle = useCallback(() => {
    if (disabled) return
    if (open) {
      close()
      return
    }
    positionMenu()
    setOpen(true)
  }, [close, disabled, open, positionMenu])

  useEffect(() => close(), [close, resetKey])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        triggerRef.current?.focus()
      }
    }
    const onViewportChange = () => positionMenu()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('scroll', onViewportChange)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('scroll', onViewportChange)
    }
  }, [close, open, positionMenu])

  return <div
    ref={wrapRef}
    className={`ui-anchored-menu ${className} ${open ? 'is-open' : ''} ${opensUp ? 'opens-up' : ''}`.trim()}
    style={{ '--ui-anchored-menu-max-height': `${menuMaxHeight}px` } as CSSProperties}
  >
    {trigger({ expanded: open, toggle, triggerRef })}
    {open && <div className={`ui-anchored-menu__surface ${menuClassName}`.trim()} role="listbox" aria-label={label}>
      {children(close)}
    </div>}
  </div>
}
