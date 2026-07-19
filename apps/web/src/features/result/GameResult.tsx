import type { ReactNode } from 'react'
import { FULL_HOUSE_MODE_IDS } from '@shoditsa/contracts'
import { Check, ChevronDown, Copy, Send, Share2, Ticket } from 'lucide-react'
import type { ChallengeOutcome } from '../challenge/challenge'
import { ContentReport, type ContentReportReason } from '../content-report/ContentReport'
import type { TitleMode } from '../../types'
import { publicAssetUrl } from '../../app/public-asset'

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
  newDailyStreak: number
  alreadyClaimed: boolean
}

type Props = {
  mode: TitleMode
  won: boolean
  attempts: number
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
  const rewardIcon = props.mode === 'diagnosis'
    ? <img className="result-dx-icon" src={diagnosisSystemRewardIcon} alt="" aria-hidden="true" loading="lazy" />
    : <Ticket />
  return <section className={`result-card ${props.won ? 'won' : 'lost'}`}>
    {props.poster}
    <div className="result-card__copy">
      <span>{props.won ? `Угадано с ${props.attempts}-й попытки` : 'Ответ открыт'}</span>
      <h2>{props.title}</h2>
      <p>{props.meta}</p>
      {!!props.tags.length && <div className="result-tags">{props.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
      <strong>{props.won ? `${props.attempts}/10 — верный ответ` : 'Правильный ответ открыт'}</strong>
      {props.completedToday !== undefined && props.nextRewardText && <div className="result-route">
        <strong>Сегодня: {props.completedToday} из {FULL_HOUSE_MODE_IDS.length}</strong>
        <span>{props.nextRewardText}</span>
      </div>}
      {props.opponentAttempts && props.challengeOutcome && <div className={`challenge-score challenge-score--${props.challengeOutcome}`}>
        <span>Вы — {props.attempts} · Друг — {props.opponentAttempts}</span>
        <strong>{outcomeText}</strong>
      </div>}
    </div>
    <div className="result-actions">
      <button type="button" className="result-next" onClick={props.onNext}>{props.nextLabel}</button>
      <button type="button" className="result-config" onClick={props.onConfigure}>{props.configureLabel}</button>
      {props.onChallenge && <button type="button" onClick={props.onChallenge}>{props.opponentAttempts ? 'Ответить вызовом' : 'Бросить вызов другу'} <Share2 /></button>}
      <button type="button" className="result-copy" onClick={props.onCopy}>{props.copied ? <Check /> : <Copy />}{props.copied ? 'Скопировано' : 'Скопировать результат'}</button>
    </div>
    {props.award && <details className="reward-breakdown result-card__wide">
      <summary><span>{rewardIcon} {props.award.alreadyClaimed ? 'Награда уже получена' : `Получено +${props.award.total} билета`}</span><ChevronDown /></summary>
      {!props.award.alreadyClaimed && <ul>
        <li><span>За завершение</span><strong>+{props.award.completed}</strong></li>
        {!!props.award.win && <li><span>За победу</span><strong>+{props.award.win}</strong></li>}
        {!!props.award.speed && <li><span>За скорость</span><strong>+{props.award.speed}</strong></li>}
        {!!props.award.firstDaily && <li><span>Первая игра дня</span><strong>+{props.award.firstDaily}</strong></li>}
        {!!props.award.milestoneBonus && <li><span>Маршрут дня</span><strong>+{props.award.milestoneBonus}</strong></li>}
        {!!props.award.fullHouse && <li><span>Полный маршрут</span><strong>+{props.award.fullHouse}</strong></li>}
      </ul>}
    </details>}
    {(props.streak !== undefined || props.telegramUrl || props.onReport || props.onHome) && <div className="result-utility result-card__wide">
      {props.streak !== undefined && <span className="result-streak">Серия: {props.streak} дней</span>}
      {props.telegramUrl && <a href={props.telegramUrl} target="_blank" rel="noreferrer"><Send /> Telegram</a>}
      {props.onReport && <ContentReport onSubmit={props.onReport} />}
      {props.onHome && <button type="button" className="result-home" onClick={props.onHome}>На главную</button>}
    </div>}
  </section>
}
