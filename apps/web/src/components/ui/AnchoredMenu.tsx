import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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
  portal = false,
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
  portal?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [opensUp, setOpensUp] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState(MENU_HEIGHT_LIMIT)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [portalStyle, setPortalStyle] = useState<CSSProperties>({})
  const close = useCallback(() => setOpen(false), [])
  const selectAndClose = useCallback(() => { close(); triggerRef.current?.focus() }, [close])

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
    if (portal) {
      const viewportWidth = viewport?.width ?? window.innerWidth
      const viewportLeft = viewport?.offsetLeft ?? 0
      const mobile = viewportWidth <= 560
      const width = mobile ? viewportWidth - 2 * VIEWPORT_GUTTER : Math.min(Math.max(rect.width, 360), viewportWidth - 2 * VIEWPORT_GUTTER)
      setPortalStyle({
        position: 'fixed', zIndex: 140, width, minWidth: 0, maxWidth: width,
        left: mobile ? viewportLeft + VIEWPORT_GUTTER : Math.max(viewportLeft + VIEWPORT_GUTTER, Math.min(rect.right - width, viewportLeft + viewportWidth - width - VIEWPORT_GUTTER)),
        right: 'auto',
        top: mobile || nextOpensUp ? 'auto' : rect.bottom + MENU_GAP,
        bottom: mobile ? window.innerHeight - viewportBottom + 88 : nextOpensUp ? window.innerHeight - rect.top + MENU_GAP : 'auto',
        maxHeight: mobile ? Math.max(96, Math.min(320, (viewport?.height ?? window.innerHeight) - STICKY_HEADER_HEIGHT - 112)) : Math.max(MIN_USEFUL_SPACE, Math.min(MENU_HEIGHT_LIMIT, available)),
      })
    }
  }, [portal])

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
    // The reference title has its own page-level Escape shortcut. Consume the
    // menu dismissal in capture phase before that earlier listener can navigate.
    const captureEscape = ['reference', 'quest-study'].includes(document.documentElement.dataset.publicTheme ?? '')
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const withinMenu = wrapRef.current?.contains(document.activeElement) || menuRef.current?.contains(document.activeElement)
      if (event.key === 'Tab' && withinMenu) {
        close()
        triggerRef.current?.focus()
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && withinMenu) {
        const options = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])]
        if (!options.length) return
        event.preventDefault()
        const index = options.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index < 0 ? event.key === 'ArrowUp' ? options.length - 1 : 0 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
        options[next]?.focus()
      }
      if (event.key === 'Escape') {
        if (captureEscape) {
          event.preventDefault()
          event.stopPropagation()
        }
        close()
        triggerRef.current?.focus()
      }
    }
    const onViewportChange = () => positionMenu()
    const onScroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) positionMenu() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, captureEscape)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onScroll, true)
    window.visualViewport?.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('scroll', onViewportChange)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, captureEscape)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onScroll, true)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('scroll', onViewportChange)
    }
  }, [close, open, positionMenu])

  const surface = open && <div ref={menuRef} className={`ui-anchored-menu__surface ${menuClassName}`.trim()} style={portal ? portalStyle : undefined} role="listbox" aria-label={label}>
    {children(selectAndClose)}
  </div>

  return <div
    ref={wrapRef}
    className={`ui-anchored-menu ${className} ${open ? 'is-open' : ''} ${opensUp ? 'opens-up' : ''}`.trim()}
    style={{ '--ui-anchored-menu-max-height': `${menuMaxHeight}px` } as CSSProperties}
  >
    {trigger({ expanded: open, toggle, triggerRef })}
    {surface && (portal ? createPortal(surface, document.body) : surface)}
  </div>
}
