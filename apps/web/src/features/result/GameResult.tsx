import { lazy, Suspense, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FULL_HOUSE_MODE_IDS, type GameCompletionType } from '@shoditsa/contracts'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Flame,
  Route,
  Save,
  Send,
  Ticket,
} from 'lucide-react'
import { challengeResultLabel, type ChallengeOutcome, type ChallengeResult } from '../challenge/challenge'
import { ContentReport, type ContentReportReason } from '../content-report/ContentReport'
import type { TitleMode } from '../../types'
import { MODE_CONFIG } from '../../app/mode-config'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { trackDiagnosisGoal } from '../../app/diagnosis-analytics'
import { trackMetrikaGoal } from '../../app/metrics'
import { publicAssetUrl } from '../../app/public-asset'
import { useAuthSession } from '../auth/use-auth-session'
import { formatDays } from '../../game'
import { countWord } from '../economy/economy-rules'
import { ResultActionBar } from './ResultActionBar'
import { ControlButton } from '../../components/ui'
import './GameResult.css'

const TipCheckoutTrigger = lazy(() => import('../commerce/TipCheckout').then((module) => ({ default: module.TipCheckoutTrigger })))
const diagnosisSystemRewardIcon = publicAssetUrl('images/diagnosis-systems/nervous.svg')

export type ResultAward = {
  total: number
  base: number
  completed: number
  win: number
  speed: number
  finalChoiceWin?: number
  firstDaily: number
  milestoneBonus: number
  fullHouse: number
  streakMilestone: number
  newDailyStreak: number
  alreadyClaimed: boolean
}

type AccountState = 'auto' | 'guest' | 'authenticated'

type Props = {
  mode: TitleMode
  won: boolean
  completionType?: GameCompletionType | null
  attempts: number
  maxAttempts?: number
  poster: ReactNode
  title: string
  meta: string
  tags: string[]
  completedToday?: number
  nextRewardText?: string
  nextLabel: string
  nextActionLabel: 'Играть' | 'Перейти'
  nextMode?: TitleMode
  recommendedModes?: TitleMode[]
  award: ResultAward | null
  streak?: number
  copied: boolean
  telegramUrl?: string
  challengeOutcome?: ChallengeOutcome
  opponentAttempts?: ChallengeResult
  onNext: () => void
  onRecommendedMode?: (mode: TitleMode) => void
  configureLabel: string
  onConfigure: () => void
  onChallenge?: () => void
  onReplay?: () => void
  replayCost?: number
  replayShortage?: number
  replayPending?: boolean
  replayAccessSource?: 'tickets' | 'club'
  onReport?: (reason: ContentReportReason, comment: string) => void
  autoScroll?: boolean
  accountState?: AccountState
  packProgress?: {
    played: number
    won: number
    lost: number
    total: number
    roundScore: number
  }
}

const joinList = (items: string[]) => {
  if (items.length < 2) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} и ${items[1]}`
  return `${items.slice(0, -1).join(', ')} и ${items.at(-1)}`
}

const currentRegistrationHref = () => {
  if (typeof window === 'undefined') return '/register'
  const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
  return `/register?returnUrl=${encodeURIComponent(returnUrl)}`
}

export function GameResult(props: Props) {
  const [rewardOpen, setRewardOpen] = useState(false)
  const resultRef = useRef<HTMLElement>(null)
  const resultViewKeyRef = useRef('')
  const rewardDetailsId = useId()
  const { session: authSession, loading: authLoading } = useAuthSession()

  useEffect(() => {
    if (props.autoScroll === false) return
    let innerFrame = 0
    const frame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(innerFrame)
    }
  }, [props.autoScroll])

  useEffect(() => {
    const resultKey = [props.mode, props.title, props.won, props.attempts, props.completionType ?? 'standard'].join(':')
    if (resultViewKeyRef.current === resultKey) return
    resultViewKeyRef.current = resultKey
    const payload = {
      mode: props.mode,
      outcome: props.won ? 'won' : 'lost',
      attempts: props.attempts,
      completionType: props.completionType ?? 'standard',
    }
    trackMetrikaGoal('result_card_view', payload)
    if (props.mode === 'diagnosis') trackDiagnosisGoal('result', payload)
  }, [props.attempts, props.completionType, props.mode, props.title, props.won])

  const outcomeText = props.challengeOutcome === 'won'
    ? 'Вы победили!'
    : props.challengeOutcome === 'lost'
      ? 'Друг оказался быстрее'
      : 'Ничья!'
  const nextLabelSeparator = props.nextLabel.indexOf(':')
  const hasNamedNextDestination = nextLabelSeparator >= 0
  const nextDestination = hasNamedNextDestination
    ? props.nextLabel.slice(nextLabelSeparator + 1).trim()
    : props.nextLabel
  const inferredNextMode = (Object.keys(MODE_CONFIG) as TitleMode[])
    .find((mode) => MODE_CONFIG[mode].title === nextDestination)
  const nextVisualMode = props.nextMode ?? inferredNextMode ?? props.mode
  const nextPresentation = MODE_PRESENTATION[nextVisualMode]
  const hasNextGame = Boolean(props.nextMode || hasNamedNextDestination)
  const nextTicketNumber = props.completedToday !== undefined && hasNextGame
    ? `${String(Math.min(props.completedToday + 1, FULL_HOUSE_MODE_IDS.length)).padStart(2, '0')}/${String(FULL_HOUSE_MODE_IDS.length).padStart(2, '0')}`
    : 'СЕАНС'
  const rewardIcon = props.mode === 'diagnosis'
    ? <img className="result-dx-icon" src={diagnosisSystemRewardIcon} alt="" aria-hidden="true" loading="lazy" />
    : <Ticket />
  const attemptsText = `${props.attempts} ${countWord(props.attempts, ['попытку', 'попытки', 'попыток'])}`
  const resultKicker = props.completionType === 'final_choice_win'
    ? 'Победа в финальном выборе'
    : props.completionType === 'final_choice_loss'
      ? 'Финальный выбор не совпал'
      : props.completionType === 'expired'
        ? 'Время вышло'
        : props.won
          ? 'Победа'
          : 'Раунд завершён'
  const resultLine = props.completionType === 'final_choice_win'
    ? `${props.maxAttempts ?? 10} попыток и финальная сверка`
    : props.completionType === 'final_choice_loss'
      ? 'Правильный ответ открыт после финальной сверки'
      : props.completionType === 'answer_revealed'
        ? `Правильный ответ открыт · использовано ${props.attempts}/${props.maxAttempts ?? 10}`
        : props.completionType === 'attempts_exhausted'
          ? 'Лимит попыток исчерпан — правильный ответ открыт'
          : props.completionType === 'expired'
            ? 'Правильный ответ открыт — попробуйте следующую игру'
            : props.won
              ? `Угадали за ${attemptsText}`
              : `Не угадали за ${attemptsText} — правильный ответ открыт`
  const visibleTags = props.tags
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag.toLocaleLowerCase('ru-RU') !== 'нет данных')
    .slice(0, 2)

  const accountState = props.accountState && props.accountState !== 'auto'
    ? props.accountState
    : authLoading
      ? null
      : !authSession || authSession.isAnonymous
        ? 'guest'
        : 'authenticated'
  const positiveStreak = typeof props.streak === 'number' && props.streak > 0 ? props.streak : null
  const routeProgress = Math.max(0, Math.min(props.completedToday ?? 0, FULL_HOUSE_MODE_IDS.length))
  const progressItems = [
    props.packProgress
      ? `подборка ${props.packProgress.played}/${props.packProgress.total}`
      : props.completedToday !== undefined
        ? `маршрут ${props.completedToday}/${FULL_HOUSE_MODE_IDS.length}`
        : '',
    positiveStreak !== null ? `серия ${formatDays(positiveStreak)}` : '',
    props.award && props.award.total > 0
      ? `${props.award.total} ${countWord(props.award.total, ['билет', 'билета', 'билетов'])}`
      : '',
  ].filter(Boolean)
  const progressSummary = joinList(progressItems)
  const persistence = accountState === 'guest'
    ? <section className="result-persistence result-card__wide" aria-label="Сохранить прогресс">
        <span className="result-persistence__icon" aria-hidden="true"><Save /></span>
        <div className="result-persistence__copy">
          <strong>{props.won ? 'Сохраните победу и прогресс' : 'Сохраните результат и прогресс'}</strong>
          <p>{progressSummary
            ? `В аккаунте: ${progressSummary}. Продолжите завтра с любого устройства.`
            : 'Результат будет доступен в аккаунте — продолжите завтра с любого устройства.'}</p>
        </div>
        <a href={currentRegistrationHref()} onClick={() => {
          const payload = { mode: props.mode, completedToday: props.completedToday ?? 0, tickets: props.award?.total ?? 0 }
          trackMetrikaGoal('result_save_progress', payload)
          if (props.mode === 'diagnosis') trackDiagnosisGoal('save', { placement: 'result' })
        }}>Сохранить в аккаунте</a>
      </section>
    : accountState === 'authenticated'
      ? <section className="result-persistence result-persistence--saved result-card__wide" aria-label="Прогресс сохранён">
          <span className="result-persistence__icon" aria-hidden="true"><CheckCircle2 /></span>
          <div className="result-persistence__copy">
            <strong>Прогресс сохранён в профиле</strong>
            <p>Этот результат уже доступен на всех ваших устройствах.</p>
          </div>
        </section>
      : null

  const rewardMetrics = props.packProgress
    ? [
        { key: 'score', icon: <Ticket />, value: `+${props.packProgress.roundScore}`, label: 'баллов за раунд' },
        { key: 'pack', icon: <Route />, value: `${props.packProgress.played}/${props.packProgress.total}`, label: 'пройдено в подборке' },
        { key: 'record', icon: <CheckCircle2 />, value: `${props.packProgress.won} · ${props.packProgress.lost}`, label: 'угадано · не угадано' },
      ]
    : [
        ...(props.award ? [{
          key: 'tickets',
          icon: <Ticket />,
          value: props.award.alreadyClaimed && props.award.total <= 0 ? 'Учтено' : `${props.award.alreadyClaimed ? '' : '+'}${props.award.total}`,
          label: props.award.alreadyClaimed
            ? 'билеты уже начислены'
            : 'получено за раунд',
        }] : []),
        ...(props.completedToday !== undefined ? [{
          key: 'route',
          icon: <Route />,
          value: `${props.completedToday}/${FULL_HOUSE_MODE_IDS.length}`,
          label: props.completedToday >= FULL_HOUSE_MODE_IDS.length ? 'маршрут завершён' : 'маршрут сегодня',
        }] : []),
        ...(positiveStreak !== null ? [{
          key: 'streak',
          icon: <Flame />,
          value: formatDays(positiveStreak),
          label: 'текущая серия',
        }] : []),
      ]
  const showContextualTip = props.won
    && props.completedToday !== undefined
    && props.completedToday >= FULL_HOUSE_MODE_IDS.length

  return <section
    ref={resultRef}
    className={`result-card result-card--${props.mode} ${props.won ? 'won' : 'lost'}`}
    style={{
      '--result-mode-color': MODE_PRESENTATION[props.mode].color,
      '--result-next-color': nextPresentation.color,
    } as CSSProperties}
  >
    <div className="result-card__hero result-card__wide">
      <div className="result-card__poster">{props.poster}</div>
      <div className="result-card__copy">
        <div className="result-verdict">
          {props.won && <CheckCircle2 aria-hidden="true" />}
          <span>{resultKicker}</span>
        </div>
        <h2>{props.title}</h2>
        <p>{props.meta}</p>
        {!!visibleTags.length && <div className="result-tags">{visibleTags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
        <strong>{resultLine}</strong>
        {props.opponentAttempts && props.challengeOutcome && <div className={`challenge-score challenge-score--${props.challengeOutcome}`}>
          <span>Вы — {props.completionType === 'final_choice_win' ? 'Ф/10' : `${props.attempts}/10`} · Друг — {challengeResultLabel(props.opponentAttempts)}</span>
          <strong>{outcomeText}</strong>
        </div>}
      </div>
    </div>

    {!!rewardMetrics.length && <section className={`result-rewards result-card__wide result-rewards--${Math.min(rewardMetrics.length, 3)}`} aria-label="Награда и прогресс">
      {rewardMetrics.map((metric) => <article className={`result-reward result-reward--${metric.key}`} key={metric.key} title={metric.key === 'route' ? props.nextRewardText : undefined}>
        <span aria-hidden="true">{metric.icon}</span>
        <div>
          <strong>{metric.value}</strong>
          <small>{metric.label}</small>
          {metric.key === 'route' && props.completedToday !== undefined && <i className="result-route-track" aria-hidden="true">
            {Array.from({ length: FULL_HOUSE_MODE_IDS.length }, (_, index) => <b
              className={`${index < routeProgress ? 'is-complete' : ''}${index === routeProgress - 1 ? ' is-current' : ''}`}
              key={index}
            />)}
          </i>}
        </div>
      </article>)}
    </section>}

    <ResultActionBar
      nextLabel={props.nextLabel}
      nextDestination={nextDestination}
      nextArtworkUrl={nextPresentation.watermarkUrl}
      nextTicketNumber={nextTicketNumber}
      nextActionLabel={props.nextActionLabel}
      configureLabel={props.configureLabel}
      copied={props.copied}
      opponentAttempts={props.opponentAttempts}
      onNext={props.onNext}
      onConfigure={props.onConfigure}
      onChallenge={props.onChallenge}
      onReplay={props.onReplay}
      replayCost={props.replayCost}
      replayShortage={props.replayShortage}
      replayPending={props.replayPending}
      replayAccessSource={props.replayAccessSource}
      persistence={persistence}
      showReplayGate={Boolean(props.onReplay) || props.completedToday !== undefined}
    />

    {!!props.recommendedModes?.length && props.onRecommendedMode && <section className="result-recommendations result-card__wide" aria-label="Другие игры после результата">
      <header><div><span>Продолжить</span><strong>Выберите следующую игру</strong></div><small>Животные, персонажи или книги</small></header>
      <div>{props.recommendedModes.map((mode) => {
        const presentation = MODE_PRESENTATION[mode]
        const Icon = presentation.icon
        return <ControlButton
          type="button"
          key={mode}
          style={{ '--result-recommendation-color': presentation.color } as CSSProperties}
          onClick={() => props.onRecommendedMode?.(mode)}
        >
          <span className="result-recommendations__art" aria-hidden="true"><img src={presentation.watermarkUrl} alt="" loading="lazy" /></span>
          <span className="result-recommendations__copy"><i><Icon /> Ещё одна игра</i><strong>{MODE_CONFIG[mode].title}</strong><small>{presentation.description}</small></span>
        </ControlButton>
      })}</div>
    </section>}

    {props.award && !props.award.alreadyClaimed && <details className="reward-breakdown result-card__wide" open={rewardOpen} onToggle={(event) => setRewardOpen(event.currentTarget.open)}>
      <summary role="button" aria-expanded={rewardOpen} aria-controls={rewardDetailsId}><span>{rewardIcon} Как начислены билеты</span><ChevronDown /></summary>
      <ul id={rewardDetailsId}>
        {!!props.award.completed && <li><span>За завершение</span><strong>+{props.award.completed}</strong></li>}
        {!!props.award.win && <li><span>За победу</span><strong>+{props.award.win}</strong></li>}
        {!!props.award.speed && <li><span>За эффективность</span><strong>+{props.award.speed}</strong></li>}
        {!!props.award.finalChoiceWin && <li><span>За финальную сверку</span><strong>+{props.award.finalChoiceWin}</strong></li>}
        {!!props.award.firstDaily && <li><span>Первая игра дня</span><strong>+{props.award.firstDaily}</strong></li>}
        {!!props.award.milestoneBonus && <li><span>Маршрут дня</span><strong>+{props.award.milestoneBonus}</strong></li>}
        {!!props.award.fullHouse && <li><span>Полный маршрут</span><strong>+{props.award.fullHouse}</strong></li>}
        {!!props.award.streakMilestone && <li><span>Бонус за серию</span><strong>+{props.award.streakMilestone}</strong></li>}
      </ul>
    </details>}

    <div className="result-utility result-card__wide">
      {props.mode === 'diagnosis' && <a href="/club" onClick={() => trackDiagnosisGoal('archive', { placement: 'result' })}><CalendarDays /> Архив диагнозов</a>}
      {props.telegramUrl && <a href={props.telegramUrl} target="_blank" rel="noreferrer"><Send /> Отправить результат в Telegram</a>}
      {showContextualTip && <Suspense fallback={null}><TipCheckoutTrigger className="result-support" label="Поддержать проект" hint="Жетон кассиру" /></Suspense>}
      {props.onReport && <ContentReport mode={props.mode} onSubmit={props.onReport} />}
    </div>
  </section>
}
