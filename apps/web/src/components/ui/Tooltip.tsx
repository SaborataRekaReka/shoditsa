import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

type TriggerProps = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onBlur: () => void
  onClickCapture: () => void
}

/** A portal keeps the label clear of the rail's stacking and overflow contexts. */
export function Tooltip({ label, disabled = false, minViewportWidth = 0, children }: {
  label: string
  disabled?: boolean
  minViewportWidth?: number
  children: (props: TriggerProps, descriptionId?: string) => ReactNode
}) {
  const id = useId()
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clear = () => clearTimeout(timer.current)
  const close = () => { clear(); setPosition(null) }
  const show = (target: HTMLElement, delay: number) => {
    clear()
    if (disabled || window.innerWidth < minViewportWidth) return
    const rect = target.getBoundingClientRect()
    const next = { left: rect.right + 12, top: Math.max(26, Math.min(window.innerHeight - 26, rect.top + rect.height / 2)) }
    if (delay) timer.current = setTimeout(() => setPosition(next), delay)
    else setPosition(next)
  }
  const leave = () => { clear(); timer.current = setTimeout(() => setPosition(null), 100) }
  useEffect(() => { if (disabled) close() }, [disabled])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!position) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close()
    }
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [position])
  const open = !disabled && position
  return <>{children({
    onPointerEnter: event => { if (event.pointerType !== 'touch') show(event.currentTarget, 180) },
    onPointerLeave: leave,
    onFocus: event => show(event.currentTarget, 0),
    onBlur: close,
    onClickCapture: close,
  }, open ? id : undefined)}{open && createPortal(<span id={id} role="tooltip" className="ui-tooltip" style={open} onPointerEnter={clear} onPointerLeave={leave}>{label}</span>, document.body)}</>
}
