import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import './DialogSurface.css'

const dialogFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocusTrap<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const dialogRef = useRef<T>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector)]
      .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
    const frame = window.requestAnimationFrame(() => (focusables()[0] ?? dialog).focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [open])

  return dialogRef
}

export function DialogSurface({
  onClose,
  children,
  backdropClassName = '',
  className = '',
  ariaLabel,
  ariaLabelledBy,
  closeOnBackdrop = true,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'children' | 'aria-label' | 'aria-labelledby'> & {
  onClose: () => void
  children: ReactNode
  backdropClassName?: string
  ariaLabel?: string
  ariaLabelledBy?: string
  closeOnBackdrop?: boolean
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>(true, onClose)
  return <div
    className={`ui-dialog-backdrop ${backdropClassName}`.trim()}
    role="presentation"
    onMouseDown={(event) => closeOnBackdrop && event.target === event.currentTarget && onClose()}
  >
    <section
      ref={dialogRef}
      className={`ui-dialog-surface ${className}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      tabIndex={-1}
      {...props}
    >{children}</section>
  </div>
}

export function DialogRegion({ children, className = '', ariaLabel, ariaLabelledBy, ...props }: Omit<HTMLAttributes<HTMLElement>, 'children' | 'aria-label' | 'aria-labelledby'> & {
  children: ReactNode
  ariaLabel?: string
  ariaLabelledBy?: string
}) {
  return <section
    className={`ui-dialog-region ${className}`.trim()}
    role="dialog"
    aria-modal="false"
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    {...props}
  >{children}</section>
}
