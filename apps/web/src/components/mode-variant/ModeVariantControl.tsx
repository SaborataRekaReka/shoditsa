import { Check, SlidersHorizontal } from 'lucide-react'
import { GAME_MODE_MANIFEST } from '@shoditsa/contracts'
import type { TitleMode } from '../../types'

export function ModeVariantControl({ mode, value, disabled = false, onChange }: {
  mode: TitleMode
  value: string | null
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const variants = GAME_MODE_MANIFEST[mode].variants
  if (!variants.length) return null

  return <fieldset className="mode-variant-control" disabled={disabled}>
    <legend><SlidersHorizontal /> Режим игры</legend>
    <div className="mode-variant-control__options">
      {variants.map((variant) => {
        const active = variant.id === value
        return <button
          type="button"
          className={`mode-variant-control__option ${active ? 'is-active' : ''}`}
          aria-pressed={active}
          key={variant.id}
          onClick={() => onChange(variant.id)}
        >
          <span><strong>{variant.label}</strong><small>{variant.description}</small></span>
          {active && <Check aria-hidden="true" />}
        </button>
      })}
    </div>
  </fieldset>
}
