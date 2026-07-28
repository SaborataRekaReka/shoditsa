import { useState, type ReactNode } from 'react'
import { ArrowRight, Check, Copy, RotateCcw, SlidersHorizontal, Swords, X } from 'lucide-react'
import { ControlButton } from '../../components/ui'
import { TipCheckoutTrigger } from '../commerce/TipCheckout'
import type { ChallengeResult } from '../challenge/challenge'
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
  compactNext = false,
  afterMeta,
  showReplayGate = false,
}: {
  nextLabel: string
  nextDestination: string
  nextArtworkUrl: string
  nextTicketNumber: string
  configureLabel: string
  copied: boolean
  opponentAttempts?: ChallengeResult
  onNext: () => void
  onConfigure: () => void
  onChallenge?: () => void
  onCopy: () => void
  showTip: boolean
  compactNext?: boolean
  afterMeta?: ReactNode
  showReplayGate?: boolean
}) {
  const [replayNoticeOpen, setReplayNoticeOpen] = useState(false)
  const hasNextDestination = nextDestination !== nextLabel
  return <>
    <div className={`result-primary-actions${compactNext ? ' is-compact' : ''}`}>
      <ControlButton className="result-next" onClick={onNext} aria-label={nextLabel}>
        <img className="result-next__art" src={nextArtworkUrl} alt="" aria-hidden="true" />
        <span className="result-next__copy">
          <small>{nextLabel === 'На главную' ? 'Маршрут завершён' : hasNextDestination ? 'Дальше по маршруту' : 'Продолжить игру'}</small>
          <strong>{nextDestination}</strong>
        </span>
        {compactNext && <span className="result-next__serial" aria-hidden="true">{nextTicketNumber}</span>}
        <span className="result-next__arrow" aria-hidden="true"><ArrowRight /></span>
      </ControlButton>
      {!compactNext && <ControlButton className="result-config" onClick={onConfigure}>
        <span className="result-config__icon" aria-hidden="true"><SlidersHorizontal /></span>
        <span className="result-config__copy"><small>Режим</small><strong>{configureLabel}</strong></span>
        <span className="result-config__serial" aria-hidden="true">{nextTicketNumber}</span>
      </ControlButton>}
    </div>
    <div className="result-after-actions result-card__wide">
      <span className="result-after-actions__label">После сеанса</span>
      {showReplayGate && <ControlButton className="result-replay" onClick={() => setReplayNoticeOpen(true)}>
        <RotateCcw />
        <span>Сыграть ещё раз</span>
      </ControlButton>}
      {onChallenge && <ControlButton className="result-challenge" onClick={onChallenge}>
        <Swords />
        <span>
          <small>{opponentAttempts ? 'Матч-реванш' : 'Игра на двоих'}</small>
          <strong>{opponentAttempts ? 'Ответить вызовом' : 'Бросить вызов другу'}</strong>
        </span>
      </ControlButton>}
      <ControlButton
        className="result-copy"
        onClick={onCopy}
        aria-label={copied ? 'Скопировано' : 'Скопировать результат'}
        title={copied ? 'Скопировано' : 'Скопировать результат'}
      >
        {copied ? <Check /> : <Copy />}
        {copied && <span className="result-copy__tooltip" role="status">Скопировано</span>}
      </ControlButton>
      {showTip && <TipCheckoutTrigger className="result-tip" label="Жетон кассиру" hint="99 · 299 · 699 ₽" />}
      {afterMeta && <div className="result-after-actions__meta">{afterMeta}</div>}
    </div>
    {replayNoticeOpen && <div className="result-replay-notice result-card__wide" role="status" aria-label="Лимит игр на сегодня">
      <div>
        <strong>Одна игра в день</strong>
        <p>Следующая ежедневная игра откроется завтра. В клубе доступны архив и дополнительные партии.</p>
      </div>
      <a href="/club">Вступить в клуб</a>
      <ControlButton className="result-replay-notice__close" onClick={() => setReplayNoticeOpen(false)} aria-label="Закрыть"><X /></ControlButton>
    </div>}
  </>
}
