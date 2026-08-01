import { useState, type ReactNode } from 'react'
import { ArrowRight, Check, Copy, RotateCcw, SlidersHorizontal, Swords, X } from 'lucide-react'
import { ControlButton } from '../../components/ui'
import { TipCheckoutTrigger } from '../commerce/TipCheckout'
import { formatTickets } from '../economy/economy-rules'
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
  onReplay,
  replayCost = 0,
  replayShortage = 0,
  replayPending = false,
  replayAccessSource = 'tickets',
  showTip,
  compactNext = false,
  afterMeta,
  afterLabel = 'После сеанса',
  showCopy = true,
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
  onReplay?: () => void
  replayCost?: number
  replayShortage?: number
  replayPending?: boolean
  replayAccessSource?: 'tickets' | 'club'
  showTip: boolean
  compactNext?: boolean
  afterMeta?: ReactNode
  afterLabel?: string | null
  showCopy?: boolean
  showReplayGate?: boolean
}) {
  const [replayNoticeOpen, setReplayNoticeOpen] = useState(false)
  const hasNextDestination = nextDestination !== nextLabel
  const replayCostValue = Math.max(0, Math.trunc(replayCost))
  const replayShortageValue = Math.max(0, Math.trunc(replayShortage))
  const replayBalance = Math.max(0, replayCostValue - replayShortageValue)
  const paidReplay = Boolean(onReplay)
  const confirmReplay = () => {
    if (!onReplay || replayPending || replayShortageValue > 0) return
    onReplay()
  }
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
      {afterLabel && <span className="result-after-actions__label">{afterLabel}</span>}
      {showReplayGate && <ControlButton
        className="result-replay"
        onClick={() => setReplayNoticeOpen(true)}
        disabled={replayPending}
        aria-label={replayPending ? 'Запускаем новую игру' : 'Сыграть ещё раз'}
      >
        <RotateCcw />
        <span>{replayPending ? 'Запускаем…' : 'Играть ещё'}</span>
      </ControlButton>}
      {onChallenge && <ControlButton className="result-challenge" onClick={onChallenge}>
        <Swords />
        <span>
          <small>{opponentAttempts ? 'Матч-реванш' : 'Игра на двоих'}</small>
          <strong>{opponentAttempts ? 'Ответить вызовом' : 'Бросить вызов другу'}</strong>
        </span>
      </ControlButton>}
      {showCopy && <ControlButton
        className="result-copy"
        onClick={onCopy}
        aria-label={copied ? 'Скопировано' : 'Скопировать результат'}
        title={copied ? 'Скопировано' : 'Скопировать результат'}
      >
        {copied ? <Check /> : <Copy />}
        {copied && <span className="result-copy__tooltip" role="status">Скопировано</span>}
      </ControlButton>}
      {showTip && <TipCheckoutTrigger className="result-tip" label="Жетон кассиру" hint="99 · 299 · 699 ₽" />}
      {afterMeta && <div className="result-after-actions__meta">{afterMeta}</div>}
    </div>
    {replayNoticeOpen && <div className="result-replay-notice result-card__wide" role="status" aria-label={paidReplay ? 'Повторная игра' : 'Лимит игр на сегодня'}>
      {paidReplay
        ? <div>
            <strong>{replayShortageValue > 0
              ? `Не хватает ${formatTickets(replayShortageValue)}`
              : replayAccessSource === 'club'
                ? 'Новая игра по клубному абонементу'
                : `Новая игра за ${formatTickets(replayCostValue)}`}</strong>
            <p>{replayShortageValue > 0
              ? `Нужно ${formatTickets(replayCostValue)}, на балансе ${formatTickets(replayBalance)}.`
              : 'Загадка будет новой. Дневная серия и награды за повторную партию не изменятся.'}</p>
          </div>
        : <div>
            <strong>Одна игра в день</strong>
            <p>Следующая ежедневная игра откроется завтра. В клубе доступны архив и дополнительные партии.</p>
          </div>}
      {paidReplay
        ? replayShortageValue > 0
          ? <a className="result-replay-notice__action" href="/club">Получить билетики</a>
          : <ControlButton className="result-replay-notice__action" onClick={confirmReplay} disabled={replayPending}>
              {replayPending
                ? 'Запускаем…'
                : replayAccessSource === 'club'
                  ? 'Начать новую игру'
                  : `Начать за ${formatTickets(replayCostValue)}`}
            </ControlButton>
        : <a className="result-replay-notice__action" href="/club">Вступить в клуб</a>}
      <ControlButton className="result-replay-notice__close" onClick={() => setReplayNoticeOpen(false)} aria-label="Закрыть"><X /></ControlButton>
    </div>}
  </>
}
