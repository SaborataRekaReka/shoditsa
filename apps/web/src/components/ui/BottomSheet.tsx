import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useDialogFocusTrap } from './DialogSurface'
import { IconButton } from './UiControls'
import './BottomSheet.css'

/** A scoped mobile task with a fixed footer and independently scrolling content. */
export function BottomSheet({ title, description, onClose, children, footer, initialFocusRef }: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>(true, onClose)
  const [viewport, setViewport] = useState(() => ({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 }))
  const startY = useRef<number | null>(null)
  useEffect(() => {
    const update = () => setViewport({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 })
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => { window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [])
  useEffect(() => {
    if (!initialFocusRef) return
    const frame = requestAnimationFrame(() => initialFocusRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [initialFocusRef])
  return <div className="ui-bottom-sheet-backdrop" style={{ height: viewport.height, top: viewport.top }} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ui-bottom-sheet" ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="ui-bottom-sheet__handle" aria-hidden="true" onPointerDown={event => { if (event.pointerType === 'touch') { startY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId) } }} onPointerUp={event => { if (startY.current !== null && event.clientY - startY.current > 64) onClose(); startY.current = null }} onPointerCancel={() => { startY.current = null }}><span /></div>
      <header className="ui-bottom-sheet__header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><IconButton label="Закрыть" onClick={onClose}><X /></IconButton></header>
      <div className="ui-bottom-sheet__content">{children}</div>
      {footer && <footer className="ui-bottom-sheet__footer">{footer}</footer>}
    </section>
  </div>
}
