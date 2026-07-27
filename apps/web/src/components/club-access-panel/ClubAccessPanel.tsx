import { Crown, LockKeyhole } from 'lucide-react'
import { ActionButton, TextButton } from '../ui'
import './ClubAccessPanel.css'

export function ClubAccessPanel({
  title,
  description,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  ariaLabel = 'Доступ только в Клубе',
}: {
  title: string
  description: string
  primaryLabel: string
  secondaryLabel?: string
  onPrimary: () => void
  onSecondary?: () => void
  ariaLabel?: string
}) {
  return <div className="club-access-panel" role="region" aria-label={ariaLabel}>
    <LockKeyhole aria-hidden="true" />
    <div className="club-access-panel__copy">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
    <div className="club-access-panel__actions">
      <ActionButton onClick={onPrimary}><Crown />{primaryLabel}</ActionButton>
      {secondaryLabel && onSecondary && <TextButton className="club-access-panel__secondary" onClick={onSecondary}>{secondaryLabel}</TextButton>}
    </div>
  </div>
}
