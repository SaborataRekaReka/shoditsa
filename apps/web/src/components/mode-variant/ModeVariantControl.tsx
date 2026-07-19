import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { GAME_MODE_MANIFEST } from '@shoditsa/contracts'
import type { TitleMode } from '../../types'

export function ModeVariantControl({ mode, value, disabled = false, onChange }: {
  mode: TitleMode
  value: string | null
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const variants = GAME_MODE_MANIFEST[mode].variants
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const current = variants.find((variant) => variant.id === value) ?? variants[0]

  useEffect(() => {
    setOpen(false)
  }, [mode])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  if (!current) return null

  return <div ref={wrapRef} className={`mode-variant-select ${open ? 'is-open' : ''}`} data-mode={mode}>
    <button
      type="button"
      className="mode-variant-trigger"
      disabled={disabled}
      aria-expanded={open}
      aria-haspopup="listbox"
      onClick={(event) => {
        event.stopPropagation()
        setOpen((isOpen) => !isOpen)
      }}
    >
      <span className="mode-variant-trigger__label"><SlidersHorizontal /> Режим</span>
      <span className="mode-variant-trigger__value">
        <span className={`mode-variant-bars mode-variant-bars--${current.id}`} aria-hidden="true"><i /><i /><i /></span>
        <strong>{current.shortLabel}</strong>
        <ChevronRight aria-hidden="true" />
      </span>
    </button>
    {open && <div className="mode-variant-menu" role="listbox" aria-label={`Режим игры «${GAME_MODE_MANIFEST[mode].label}»`}>
      <span className="mode-variant-menu__head">Круг возможных ответов</span>
      {variants.map((variant) => {
        const active = variant.id === value
        return <button
          type="button"
          role="option"
          aria-selected={active}
          className={`mode-variant-option ${active ? 'active' : ''}`}
          key={variant.id}
          onClick={(event) => {
            event.stopPropagation()
            onChange(variant.id)
            setOpen(false)
          }}
        >
          <span className={`mode-variant-bars mode-variant-bars--${variant.id}`} aria-hidden="true"><i /><i /><i /></span>
          <span className="mode-variant-option__copy"><strong>{variant.label}</strong><small>{variant.description}</small></span>
          {active && <Check className="mode-variant-option__check" aria-hidden="true" />}
        </button>
      })}
    </div>}
  </div>
}
