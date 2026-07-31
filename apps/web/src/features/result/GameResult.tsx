import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FULL_HOUSE_MODE_IDS, type GameCompletionType } from '@shoditsa/contracts'
import {
  CalendarDays,
  ChevronDown,
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
import { publicAssetUrl } from '../../app/public-asset'
import { useAuthSession } from '../auth/use-auth-session'
import { formatDays } from '../../game'
import { countWord } from '../economy/economy-rules'
import { ResultActionBar } from './ResultActionBar'
import './GameResult.css'

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
  award: ResultAward | null
  streak?: number
  copied: boolean
  telegramUrl?: string
  challengeOutcome?: ChallengeOutcome
  opponentAttempts?: ChallengeResult
  onNext: () => void
  configureLabel: string
  onConfigure: () => void
  onChallenge?: () => void
  onCopy: () => void
  onReplay?: () => void
  replayCost?: number
  replayShortage?: number
  replayPending?: boolean
  replayAccessSource?: 'tickets' | 'club'
  onReport?: (reason: ContentReportReason, comment: string) => void
  autoScroll?: boolean
  packProgress?: {
    played: number
    won: number
    lost: number
    total: number
    roundScore: number
  }
}

export function GameResult(props: Props) {
  const [rewardOpen, setRewardOpen] = useState(false)
  const resultRef = useRef<HTMLElement>(null)
  const diagnosisResultKeyRef = useRef('')
  const { session: authSession, loading: authLoading } = useAuthSession()
  const isGuest = !authSession || authSession.isAnonymous
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
    if (props.mode !== 'diagnosis') return
    const resultKey = [props.title, props.won, props.attempts, props.completionType ?? 'standard'].join(':')
    if (diagnosisResultKeyRef.current === resultKey) return
    diagnosisResultKeyRef.current = resultKey
    trackDiagnosisGoal('result', {
      outcome: props.won ? 'won' : 'lost',
      attempts: props.attempts,
      completionType: props.completionType ?? 'standard',
    })
  }, [props.attempts, props.completionType, props.mode, props.title, props.won])
  const outcomeText = props.challengeOutcome === 'won' ? 'Вы победили!' : props.challengeOutcome === 'lost' ? 'Друг оказался быстрее' : 'Ничья!'
  const nextLabelSeparator = props.nextLabel.indexOf(':')
  const hasNextDestination = nextLabelSeparator >= 0
  const nextDestination = hasNextDestination
    ? props.nextLabel.slice(nextLabelSeparator + 1).trim()
    : props.nextLabel
  const nextVisualMode = (Object.keys(MODE_CONFIG) as TitleMode[])
    .find((mode) => MODE_CONFIG[mode].title === nextDestination) ?? props.mode
  const nextPresentation = MODE_PRESENTATION[nextVisualMode]
  const nextTicketNumber = props.completedToday !== undefined && hasNextDestination
    ? `${String(Math.min(props.completedToday + 1, FULL_HOUSE_MODE_IDS.length)).padStart(2, '0')}/${String(FULL_HOUSE_MODE_IDS.length).padStart(2, '0')}`
    : 'СЕАНС'
  const rewardIcon = props.mode === 'diagnosis'
    ? <img className="result-dx-icon" src={diagnosisSystemRewardIcon} alt="" aria-hidden="true" loading="lazy" />
    : <Ticket />
  const resultKicker = props.completionType === 'final_choice_win'
    ? 'Сошлось в последний момент'
    : props.completionType === 'final_choice_loss'
      ? 'Финальная сверка не сошлась'
      : props.completionType === 'answer_revealed'
        ? 'Ответ открыт'
        : props.won
          ? `Угадано с ${props.attempts}-й попытки`
          : 'Ответ открыт'
  const resultLine = props.completionType === 'final_choice_win'
    ? `${props.maxAttempts ?? 10} попыток + финальная сверка`
    : props.won
      ? `${props.attempts}/${props.maxAttempts ?? 10} — верный ответ`
      : 'Правильный ответ открыт'
  return <section
    ref={resultRef}
    className={`result-card ${props.won ? 'won' : 'lost'}`}
    style={{ '--result-next-color': nextPresentation.color } as CSSProperties}
  >
    {props.poster}
    <div className="result-card__copy">
      <span>{resultKicker}</span>
      <h2>{props.title}</h2>
      <p>{props.meta}</p>
      {!!props.tags.length && <div className="result-tags">{props.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
      <strong>{resultLine}</strong>
      {props.packProgress && <div className="result-route result-pack-progress">
        <strong>{props.packProgress.played} из {props.packProgress.total} сыграно</strong>
        <span>{props.packProgress.won} угадано · {props.packProgress.lost} не угадано</span>
        <b>+{props.packProgress.roundScore} баллов</b>
      </div>}
      {props.completedToday !== undefined && props.nextRewardText && <div className="result-route">
        <strong>Сегодня: {props.completedToday} из {FULL_HOUSE_MODE_IDS.length}</strong>
        <span>{props.nextRewardText}</span>
      </div>}
      {props.opponentAttempts && props.challengeOutcome && <div className={`challenge-score challenge-score--${props.challengeOutcome}`}>
        <span>Вы — {props.completionType === 'final_choice_win' ? 'Ф/10' : `${props.attempts}/10`} · Друг — {challengeResultLabel(props.opponentAttempts)}</span>
        <strong>{outcomeText}</strong>
      </div>}
    </div>
    <ResultActionBar
      nextLabel={props.nextLabel}
      nextDestination={nextDestination}
      nextArtworkUrl={nextPresentation.watermarkUrl}
      nextTicketNumber={nextTicketNumber}
      configureLabel={props.configureLabel}
      copied={props.copied}
      opponentAttempts={props.opponentAttempts}
      onNext={props.onNext}
      onConfigure={props.onConfigure}
      onChallenge={props.onChallenge}
      onCopy={props.onCopy}
      onReplay={props.onReplay}
      replayCost={props.replayCost}
      replayShortage={props.replayShortage}
      replayPending={props.replayPending}
      replayAccessSource={props.replayAccessSource}
      showTip={props.won}
      showCopy
      showReplayGate={props.completedToday !== undefined}
    />
    {props.mode === 'diagnosis' && <section className="diagnosis-result-funnel result-card__wide" aria-label="Что дальше">
      <div className="diagnosis-result-funnel__copy">
        <strong>Новый пациент — завтра</strong>
        <span>Вернитесь завтра или сыграйте в архиве.</span>
      </div>
      <div className="diagnosis-result-funnel__actions">
        {!authLoading && isGuest && <a href="/register" onClick={() => trackDiagnosisGoal('save', { placement: 'result' })}>
          <Save aria-hidden="true" /> Сохранить прогресс
        </a>}
        <a href="/club" onClick={() => trackDiagnosisGoal('archive', { placement: 'result' })}>
          <CalendarDays aria-hidden="true" /> Архив диагнозов
        </a>
      </div>
    </section>}
    {props.award && <details className="reward-breakdown result-card__wide" open={rewardOpen} onToggle={(event) => setRewardOpen(event.currentTarget.open)}>
      <summary role="button" aria-expanded={rewardOpen} aria-controls="result-reward-details"><span>{rewardIcon} {props.award.alreadyClaimed ? 'Награда уже получена' : `Получено +${props.award.total} ${countWord(props.award.total, ['билет', 'билета', 'билетов'])}`}</span><ChevronDown /></summary>
      {!props.award.alreadyClaimed && <ul id="result-reward-details">
        {!!props.award.completed && <li><span>За завершение</span><strong>+{props.award.completed}</strong></li>}
        {!!props.award.win && <li><span>За победу</span><strong>+{props.award.win}</strong></li>}
        {!!props.award.speed && <li><span>За эффективность</span><strong>+{props.award.speed}</strong></li>}
        {!!props.award.finalChoiceWin && <li><span>За финальную сверку</span><strong>+{props.award.finalChoiceWin}</strong></li>}
        {!!props.award.firstDaily && <li><span>Первая игра дня</span><strong>+{props.award.firstDaily}</strong></li>}
        {!!props.award.milestoneBonus && <li><span>Маршрут дня</span><strong>+{props.award.milestoneBonus}</strong></li>}
        {!!props.award.fullHouse && <li><span>Полный маршрут</span><strong>+{props.award.fullHouse}</strong></li>}
        {!!props.award.streakMilestone && <li><span>Бонус за серию</span><strong>+{props.award.streakMilestone}</strong></li>}
      </ul>}
    </details>}
    <div className="result-utility result-card__wide">
      {props.streak !== undefined && <span className="result-streak">Серия: {formatDays(props.streak)}</span>}
      {props.telegramUrl && <a href={props.telegramUrl} target="_blank" rel="noreferrer"><Send /> Telegram</a>}
      {props.onReport && <ContentReport mode={props.mode} onSubmit={props.onReport} />}
    </div>
  </section>
}
