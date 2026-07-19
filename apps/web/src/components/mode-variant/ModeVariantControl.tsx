import { SlidersHorizontal } from 'lucide-react'
import { GAME_MODE_MANIFEST } from '@shoditsa/contracts'
import type { TitleMode } from '../../types'
import { GameOption, GameOptionSelect } from '../game-launch-controls/GameLaunchControls'

export function ModeVariantControl({ mode, value, disabled = false, onChange }: {
  mode: TitleMode
  value: string | null
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const variants = GAME_MODE_MANIFEST[mode].variants
  const current = variants.find((variant) => variant.id === value) ?? variants[0]

  if (!current) return null

  return <GameOptionSelect
    label="Режим"
    labelIcon={<SlidersHorizontal />}
    value={current.shortLabel}
    valueIcon={<span className={`mode-variant-bars mode-variant-bars--${current.id}`} aria-hidden="true"><i /><i /><i /></span>}
    menuLabel={`Режим игры «${GAME_MODE_MANIFEST[mode].label}»`}
    disabled={disabled}
    className="mode-variant-select"
    triggerClassName="mode-variant-trigger"
    menuClassName="mode-variant-menu"
    resetKey={mode}
  >
    {(close) => <>{variants.map((variant) => {
        const active = variant.id === value
        return <GameOption
          className={`mode-variant-option ${active ? 'active' : ''}`}
          key={variant.id}
          title={variant.label}
          description={variant.description}
          icon={<span className={`mode-variant-bars mode-variant-bars--${variant.id}`}><i /><i /><i /></span>}
          selected={active}
          tone={active ? 'positive' : 'default'}
          onSelect={() => {
            onChange(variant.id)
            close()
          }}
        />
      })}</>}
  </GameOptionSelect>
}
