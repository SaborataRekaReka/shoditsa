import { useId, useState, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Copy, RotateCcw, SlidersHorizontal, Swords, X } from 'lucide-react'
import { ControlButton } from '../../components/ui'
import { formatTickets } from '../economy/economy-rules'
import type { ChallengeResult } from '../challenge/challenge'
import './ResultActionBar.css'

export function ResultActionBar({
  nextLabel,
  nextDestination,
  nextArtworkUrl,
  nextTicketNumber,
  nextActionLabel,
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
  compactNext = false,
  persistence,
  afterMeta,
  afterLabel = null,
  showCopy = false,
  showReplayGate = false,
}: {
  nextLabel: string
  nextDestination: string
  nextArtworkUrl: string
  nextTicketNumber: string
  nextActionLabel: 'Играть' | 'Перейти'
  configureLabel: string
  copied: boolean
  opponentAttempts?: ChallengeResult
  onNext: () => void
  onConfigure: () => void
  onChallenge?: () => void
  onCopy?: () => void
  onReplay?: () => void
  replayCost?: number
  replayShortage?: number
  replayPending?: boolean
  replayAccessSource?: 'tickets' | 'club'
  compactNext?: boolean
  persistence?: ReactNode
  afterMeta?: ReactNode
  afterLabel?: string | null
  showCopy?: boolean
  showReplayGate?: boolean
}) {
  const [replayNoticeOpen, setReplayNoticeOpen] = useState(false)
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const secondaryActionsId = useId()
  const hasNamedNextDestination = nextDestination !== nextLabel
  const replayCostValue = Math.max(0, Math.trunc(replayCost))
  const replayShortageValue = Math.max(0, Math.trunc(replayShortage))
  const replayBalance = Math.max(0, replayCostValue - replayShortageValue)
  const paidReplay = Boolean(onReplay)
  const hasSecondaryActions = showReplayGate || !compactNext || Boolean(onChallenge) || Boolean(showCopy && onCopy) || Boolean(afterMeta)
  const nextKicker = nextActionLabel === 'Перейти'
    ? nextLabel === 'На главную' ? 'Маршрут завершён' : 'Раунд завершён'
    : hasNamedNextDestination
      ? 'Следующая игра маршрута'
      : nextLabel.toLocaleLowerCase('ru-RU').includes('следующая')
        ? 'Продолжить подборку'
        : 'Продолжить сессию'
  const confirmReplay = () => {
    if (!onReplay || replayPending || replayShortageValue > 0) return
    onReplay()
  }

  return <>
    <div className={`result-primary-actions result-card__wide${compactNext ? ' is-compact' : ''}`}>
      <ControlButton className="result-next" onClick={onNext} aria-label={nextLabel}>
        <img className="result-next__art" src={nextArtworkUrl} alt="" aria-hidden="true" loading="lazy" />
        <span className="result-next__copy">
          <small>{nextKicker}</small>
          <strong>{nextDestination}</strong>
          {nextTicketNumber !== 'СЕАНС' && <em>{nextTicketNumber} · по маршруту</em>}
        </span>
        <span className="result-next__arrow" aria-hidden="true"><span>{nextActionLabel}</span><ArrowRight /></span>
      </ControlButton>
    </div>

    {persistence}

    {hasSecondaryActions && <section className={`result-secondary-actions result-card__wide${compactNext ? ' is-compact' : ''}${moreActionsOpen ? ' is-open' : ''}`} aria-label="Другие действия">
      <ControlButton className="result-more-toggle" onClick={() => setMoreActionsOpen((open) => !open)} aria-expanded={moreActionsOpen} aria-controls={secondaryActionsId}>
        <span>Другие действия</span><ChevronDown aria-hidden="true" />
      </ControlButton>
      <div className="result-after-actions" id={secondaryActionsId}>
        {afterLabel && <span className="result-after-actions__label">{afterLabel}</span>}
        {showReplayGate && <ControlButton className="result-replay" onClick={() => setReplayNoticeOpen(true)} disabled={replayPending}>
          <RotateCcw />
          <span>{replayPending ? 'Запускаем новую игру…' : 'Сыграть ещё раз'}</span>
        </ControlButton>}
        {!compactNext && <ControlButton className="result-config" onClick={onConfigure}>
          <SlidersHorizontal />
          <span><strong>Настроить игру</strong><small>{configureLabel}</small></span>
        </ControlButton>}
        {onChallenge && <ControlButton className="result-challenge" onClick={onChallenge}>
          {copied ? <Check /> : <Swords />}
          <span>{copied ? 'Ссылка скопирована' : opponentAttempts ? 'Ответить вызовом' : 'Бросить вызов другу'}</span>
        </ControlButton>}
        {onChallenge && <span className="result-copy-status" role="status" aria-live="polite" aria-atomic="true">{copied ? 'Ссылка на вызов скопирована' : ''}</span>}
        {showCopy && onCopy && <ControlButton
          className="result-copy"
          onClick={onCopy}
          aria-label={copied ? 'Скопировано' : 'Скопировать результат'}
        >
          {copied ? <Check /> : <Copy />}
          <span>{copied ? 'Скопировано' : 'Скопировать результат'}</span>
        </ControlButton>}
        {afterMeta && <div className="result-after-actions__meta">{afterMeta}</div>}
      </div>
    </section>}

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
          ? <a className="result-replay-notice__action" href="/club">Получить билеты</a>
          : <ControlButton className="result-replay-notice__action" onClick={confirmReplay} disabled={replayPending}>
              {replayPending
                ? 'Запускаем…'
                : replayAccessSource === 'club'
                  ? 'Начать новую игру'
                  : `Начать за ${formatTickets(replayCostValue)}`}
            </ControlButton>
        : <a className="result-replay-notice__action" href="/club">Открыть клуб</a>}
      <ControlButton className="result-replay-notice__close" onClick={() => setReplayNoticeOpen(false)} aria-label="Закрыть"><X /></ControlButton>
    </div>}
  </>
}
