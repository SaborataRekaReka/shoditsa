import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { useId, useState, type ReactNode, type Ref } from 'react'
import { ArrowRight, Check, ChevronDown, Copy, RotateCcw, Share2, SlidersHorizontal, Swords, X } from 'lucide-react'
import { ActionButton, ActionLink, ControlButton, TextButton } from '../../components/ui'
import { REFERENCE_PRESENTATION } from '../../app/local-presentation'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { referenceModeIllustration } from '../game/reference-mode-art'
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
  primaryReplay = false,
  primaryRef,
  onReplayOfferClick,
  replayTitle = 'Следующий случай',
  replayModeLabel = 'Диагнозы',
  celebration = false,
  onShare,
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
  replayAccessSource?: 'tickets' | 'club' | 'registration_bonus' | 'free_archive'
  primaryReplay?: boolean
  primaryRef?: Ref<HTMLDivElement>
  onReplayOfferClick?: () => void
  replayTitle?: string
  replayModeLabel?: string
  compactNext?: boolean
  persistence?: ReactNode
  afterMeta?: ReactNode
  afterLabel?: string | null
  showCopy?: boolean
  showReplayGate?: boolean
  celebration?: boolean
  onShare?: () => void
}) {
  const [replayNoticeOpen, setReplayNoticeOpen] = useState(false)
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const secondaryActionsId = useId()
  const referenceArtworkMode = REFERENCE_PRESENTATION
    ? Object.entries(MODE_PRESENTATION).find(([, presentation]) => presentation.watermarkUrl === nextArtworkUrl)?.[0]
    : undefined
  const artworkUrl = referenceArtworkMode ? referenceModeIllustration(referenceArtworkMode) : nextArtworkUrl
  const hasNamedNextDestination = nextDestination !== nextLabel
  const replayCostValue = Math.max(0, Math.trunc(replayCost))
  const replayShortageValue = Math.max(0, Math.trunc(replayShortage))
  const replayBalance = Math.max(0, replayCostValue - replayShortageValue)
  const paidReplay = Boolean(onReplay)
  const freeArchiveReplay = replayAccessSource === 'free_archive'
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
    {celebration ? <div ref={primaryRef} className="result-celebration-actions result-card__wide">
      <div className="result-celebration-actions__buttons">
        <ActionButton onClick={primaryReplay ? () => { onReplayOfferClick?.(); if (replayShortageValue > 0) setReplayNoticeOpen(true); else confirmReplay() } : onNext} disabled={primaryReplay && replayPending}>
          <span>{primaryReplay ? replayPending ? 'Запускаем…' : replayShortageValue > 0 ? 'Сыграть ещё' : freeArchiveReplay ? 'Следующий диагноз' : replayCostValue > 0 && replayAccessSource === 'tickets' ? `Ещё за ${formatTickets(replayCostValue)}` : 'Сыграть ещё' : nextActionLabel === 'Перейти' ? nextDestination : hasNamedNextDestination ? 'Следующая игра' : nextDestination}</span><ArrowRight aria-hidden="true" />
        </ActionButton>
        {onShare && <ActionButton variant="secondary" onClick={onShare}><Share2 aria-hidden="true" /><span>{copied ? 'Результат скопирован' : 'Поделиться победой'}</span></ActionButton>}
      </div>
      <p className="result-celebration-actions__hint">{primaryReplay ? freeArchiveReplay ? 'Бесплатная игра из архива' : replayShortageValue > 0 ? 'Выберите способ продолжить' : replayAccessSource === 'club' ? 'Входит в клубный билет' : replayAccessSource === 'registration_bonus' ? 'Бонусная партия без списания билетов' : 'Новая загадка, новая победа' : hasNamedNextDestination ? `Дальше — ${nextDestination}` : onShare ? 'Друзья увидят результат, а ответ останется секретом' : ''}</p>
      <span className="result-copy-status" role="status" aria-live="polite">{copied ? 'Результат и ссылка скопированы' : ''}</span>
    </div> : <div ref={primaryRef} className={`result-primary-actions result-card__wide${compactNext ? ' is-compact' : ''}${primaryReplay ? ' is-replay' : ''}`}>
      <ControlButton className={`result-next${referenceArtworkMode ? ' result-next--reference-art' : ''}`} disabled={primaryReplay && replayPending} onClick={primaryReplay ? () => { onReplayOfferClick?.(); if (replayShortageValue > 0) setReplayNoticeOpen(true); else confirmReplay() } : onNext} aria-label={primaryReplay ? freeArchiveReplay ? 'Следующий диагноз — бесплатно' : `${replayTitle} · ${replayShortageValue > 0 ? 'недостаточно билетов' : replayAccessSource === 'club' ? 'по клубному билету' : replayAccessSource === 'registration_bonus' ? 'за регистрационный бонус' : formatTickets(replayCostValue)}` : nextLabel}>
        <ThemedArtwork className="result-next__art" src={artworkUrl} alt="" aria-hidden="true" loading="lazy" />
        <span className="result-next__copy">
          <small>{primaryReplay ? freeArchiveReplay ? 'Бесплатно · из архива' : `Продолжить «${replayModeLabel}»` : nextKicker}</small>
          <strong>{primaryReplay ? freeArchiveReplay ? 'Следующий диагноз' : replayTitle : nextDestination}</strong>
          {primaryReplay ? <em>{freeArchiveReplay ? 'Непройденный случай из последних семи дней' : replayShortageValue > 0 ? 'Выберите способ продолжить' : replayAccessSource === 'club' ? 'Входит в клубный билет' : replayAccessSource === 'registration_bonus' ? 'Бонусная партия · без списания билетов' : `${formatTickets(replayCostValue)} · новая загадка`}</em> : nextTicketNumber !== 'СЕАНС' && <em>{nextTicketNumber} · по маршруту</em>}
        </span>
        <span className={`result-next__arrow${REFERENCE_PRESENTATION ? ' ui-button ui-button--primary' : ''}`} aria-hidden="true"><span>{primaryReplay ? replayPending ? 'Запускаем…' : replayShortageValue > 0 ? 'Дальше' : replayCostValue > 0 ? `За ${replayCostValue}` : 'Играть' : nextActionLabel}</span><ArrowRight /></span>
      </ControlButton>
    </div>}

    {!celebration && persistence}

    {hasSecondaryActions && <section className={`result-secondary-actions result-card__wide${compactNext ? ' is-compact' : ''}${moreActionsOpen ? ' is-open' : ''}${celebration ? ' result-secondary-actions--celebration' : ''}`} aria-label="Другие действия">
      {celebration ? <TextButton className="result-more-toggle" onClick={() => setMoreActionsOpen((open) => !open)} aria-expanded={moreActionsOpen} aria-controls={secondaryActionsId}>Ещё<ChevronDown aria-hidden="true" /></TextButton> : <ActionButton variant="secondary" className="result-more-toggle" onClick={() => setMoreActionsOpen((open) => !open)} aria-expanded={moreActionsOpen} aria-controls={secondaryActionsId}>
        <span>Другие действия</span><ChevronDown aria-hidden="true" />
      </ActionButton>}
      <div className="result-after-actions" id={secondaryActionsId}>
        {afterLabel && <span className="result-after-actions__label">{afterLabel}</span>}
        {primaryReplay && <ActionButton variant="secondary" className="result-replay" onClick={onNext}><ArrowRight /><span>{nextLabel}</span></ActionButton>}
        {showReplayGate && !primaryReplay && <ActionButton variant="secondary" className="result-replay" onClick={() => setReplayNoticeOpen(true)} disabled={replayPending}>
          <RotateCcw />
          <span>{replayPending ? 'Запускаем новую игру…' : 'Сыграть ещё раз'}</span>
        </ActionButton>}
        {!compactNext && <ActionButton variant="secondary" className="result-config" onClick={onConfigure}>
          <SlidersHorizontal />
          <span><strong>Настроить игру</strong><small>{configureLabel}</small></span>
        </ActionButton>}
        {onChallenge && <ActionButton variant="secondary" className="result-challenge" onClick={onChallenge}>
          {copied ? <Check /> : <Swords />}
          <span>{copied ? 'Ссылка скопирована' : opponentAttempts ? 'Ответить вызовом' : 'Бросить вызов другу'}</span>
        </ActionButton>}
        {onChallenge && <span className="result-copy-status" role="status" aria-live="polite" aria-atomic="true">{copied ? 'Ссылка на вызов скопирована' : ''}</span>}
        {showCopy && onCopy && <ActionButton variant="secondary"
          className="result-copy"
          onClick={onCopy}
          aria-label={copied ? 'Скопировано' : 'Скопировать результат'}
        >
          {copied ? <Check /> : <Copy />}
          <span>{copied ? 'Скопировано' : 'Скопировать результат'}</span>
        </ActionButton>}
        {afterMeta && <div className="result-after-actions__meta">{afterMeta}</div>}
      </div>
    </section>}

    {celebration && persistence}

    {replayNoticeOpen && <div className="result-replay-notice result-card__wide" role="status" aria-label={paidReplay ? 'Повторная игра' : 'Лимит игр на сегодня'}>
      {paidReplay
        ? <div>
            <strong>{replayShortageValue > 0
              ? `Не хватает ${formatTickets(replayShortageValue)}`
              : replayAccessSource === 'club'
                ? 'Новая игра по клубному абонементу'
                : replayAccessSource === 'registration_bonus'
                  ? 'Новая партия за регистрационный бонус'
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
          ? <ActionLink variant="primary" className="result-replay-notice__action" href={primaryReplay ? '/club?from=diagnosis#club-offers' : '/club'}>Посмотреть клубный билет</ActionLink>
          : <ActionButton variant="secondary" className="result-replay-notice__action" onClick={confirmReplay} disabled={replayPending}>
              {replayPending
                ? 'Запускаем…'
                : replayAccessSource === 'club' || replayAccessSource === 'registration_bonus'
                  ? 'Начать новую игру'
                  : `Начать за ${formatTickets(replayCostValue)}`}
            </ActionButton>
        : <ActionLink variant="primary" className="result-replay-notice__action" href="/club">Открыть клуб</ActionLink>}
      <ControlButton className="result-replay-notice__close" onClick={() => setReplayNoticeOpen(false)} aria-label="Закрыть"><X /></ControlButton>
    </div>}
  </>
}
