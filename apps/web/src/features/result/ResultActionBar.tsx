import { ArrowRight, Check, Copy, SlidersHorizontal, Swords } from 'lucide-react'
import { ControlButton } from '../../components/ui'
import { TipCheckoutTrigger } from '../commerce/TipCheckout'
import './ResultActionBar.css'

export function ResultActionBar({
  nextLabel,
  nextDestination,
  nextArtworkUrl,
  nextTicketNumber,
  configureLabel,
  copied,
  opponentAttempts,
  onNext,
  onConfigure,
  onChallenge,
  onCopy,
  showTip,
}: {
  nextLabel: string
  nextDestination: string
  nextArtworkUrl: string
  nextTicketNumber: string
  configureLabel: string
  copied: boolean
  opponentAttempts?: number
  onNext: () => void
  onConfigure: () => void
  onChallenge?: () => void
  onCopy: () => void
  showTip: boolean
}) {
  const hasNextDestination = nextDestination !== nextLabel
  return <>
    <div className="result-primary-actions">
      <ControlButton className="result-next" onClick={onNext} aria-label={nextLabel}>
        <img className="result-next__art" src={nextArtworkUrl} alt="" aria-hidden="true" />
        <span className="result-next__copy">
          <small>{hasNextDestination ? 'Дальше по маршруту' : 'Продолжить игру'}</small>
          <strong>{nextDestination}</strong>
        </span>
        <span className="result-next__arrow" aria-hidden="true"><ArrowRight /></span>
      </ControlButton>
      <ControlButton className="result-config" onClick={onConfigure}>
        <span className="result-config__icon" aria-hidden="true"><SlidersHorizontal /></span>
        <span className="result-config__copy"><small>Режим</small><strong>{configureLabel}</strong></span>
        <span className="result-config__serial" aria-hidden="true">{nextTicketNumber}</span>
      </ControlButton>
    </div>
    <div className="result-after-actions result-card__wide">
      <span className="result-after-actions__label">После сеанса</span>
      {onChallenge && <ControlButton className="result-challenge" onClick={onChallenge}>
        <Swords />
        <span>
          <small>{opponentAttempts ? 'Матч-реванш' : 'Игра на двоих'}</small>
          <strong>{opponentAttempts ? 'Ответить вызовом' : 'Бросить вызов другу'}</strong>
        </span>
      </ControlButton>}
      <ControlButton className="result-copy" onClick={onCopy}>{copied ? <Check /> : <Copy />}{copied ? 'Скопировано' : 'Скопировать результат'}</ControlButton>
      {showTip && <TipCheckoutTrigger className="result-tip" label="Поддержать проект" hint="Чаевые · 99–699 ₽" />}
    </div>
  </>
}
