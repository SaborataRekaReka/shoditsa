import type { CSSProperties, ReactNode } from 'react'
import { FULL_HOUSE_MODE_IDS } from '@shoditsa/contracts'
import {
  ChevronDown,
  Send,
  Ticket,
} from 'lucide-react'
import type { ChallengeOutcome } from '../challenge/challenge'
import { ContentReport, type ContentReportReason } from '../content-report/ContentReport'
import type { TitleMode } from '../../types'
import { MODE_CONFIG } from '../../app/mode-config'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { publicAssetUrl } from '../../app/public-asset'
import { formatDays } from '../../game'
import { ControlButton } from '../../components/ui'
import { ResultActionBar } from './ResultActionBar'
import './GameResult.css'

const diagnosisSystemRewardIcon = publicAssetUrl('images/diagnosis-systems/nervous.svg')

export type ResultAward = {
  total: number
  base: number
  completed: number
  win: number
  speed: number
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
  opponentAttempts?: number
  onNext: () => void
  configureLabel: string
  onConfigure: () => void
  onChallenge?: () => void
  onCopy: () => void
  onHome?: () => void
  onReport?: (reason: ContentReportReason, comment: string) => void
}

export function GameResult(props: Props) {
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
  return <section
    className={`result-card ${props.won ? 'won' : 'lost'}`}
    style={{ '--result-next-color': nextPresentation.color } as CSSProperties}
  >
    {props.poster}
    <div className="result-card__copy">
      <span>{props.won ? `Угадано с ${props.attempts}-й попытки` : 'Ответ открыт'}</span>
      <h2>{props.title}</h2>
      <p>{props.meta}</p>
      {!!props.tags.length && <div className="result-tags">{props.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
      <strong>{props.won ? `${props.attempts}/${props.maxAttempts ?? 10} — верный ответ` : 'Правильный ответ открыт'}</strong>
      {props.completedToday !== undefined && props.nextRewardText && <div className="result-route">
        <strong>Сегодня: {props.completedToday} из {FULL_HOUSE_MODE_IDS.length}</strong>
        <span>{props.nextRewardText}</span>
      </div>}
      {props.opponentAttempts && props.challengeOutcome && <div className={`challenge-score challenge-score--${props.challengeOutcome}`}>
        <span>Вы — {props.attempts} · Друг — {props.opponentAttempts}</span>
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
      showTip={props.won}
    />
    {props.award && <details className="reward-breakdown result-card__wide">
      <summary><span>{rewardIcon} {props.award.alreadyClaimed ? 'Награда уже получена' : `Получено +${props.award.total} билетов`}</span><ChevronDown /></summary>
      {!props.award.alreadyClaimed && <ul>
        <li><span>За завершение</span><strong>+{props.award.completed}</strong></li>
        {!!props.award.win && <li><span>За победу</span><strong>+{props.award.win}</strong></li>}
        {!!props.award.speed && <li><span>За эффективность</span><strong>+{props.award.speed}</strong></li>}
        {!!props.award.firstDaily && <li><span>Первая игра дня</span><strong>+{props.award.firstDaily}</strong></li>}
        {!!props.award.milestoneBonus && <li><span>Маршрут дня</span><strong>+{props.award.milestoneBonus}</strong></li>}
        {!!props.award.fullHouse && <li><span>Полный маршрут</span><strong>+{props.award.fullHouse}</strong></li>}
        {!!props.award.streakMilestone && <li><span>Бонус за серию</span><strong>+{props.award.streakMilestone}</strong></li>}
      </ul>}
    </details>}
    {(props.streak !== undefined || props.telegramUrl || props.onReport || props.onHome) && <div className="result-utility result-card__wide">
      {props.streak !== undefined && <span className="result-streak">Серия: {formatDays(props.streak)}</span>}
      {props.telegramUrl && <a href={props.telegramUrl} target="_blank" rel="noreferrer"><Send /> Telegram</a>}
      {props.onReport && <ContentReport onSubmit={props.onReport} />}
      {props.onHome && <ControlButton className="result-home" onClick={props.onHome}>На главную</ControlButton>}
    </div>}
  </section>
}
