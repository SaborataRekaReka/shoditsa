import type { ReactNode } from 'react'
import { VictoryStage } from './VictoryStage'
import type { GameCompletionType } from '@shoditsa/contracts'
import './QuizVictory.css'

export function victoryHeadline(attempts: number, completionType?: GameCompletionType | null) {
  if (completionType === 'final_choice_win') return 'До самого конца!'
  if (attempts === 1) return 'С первой попытки!'
  return 'Всё сошлось!'
}

/** The same celebration for every attribute quiz, including special packs. */
export function QuizVictory({ attempts, completionType, context, resultLine, poster, title, meta, rewards, children }: {
  attempts: number
  completionType?: GameCompletionType | null
  context: string
  resultLine: string
  poster: ReactNode
  title: string
  meta: string
  rewards?: ReactNode
  children?: ReactNode
}) {
  return <header className="quiz-victory">
    <div className="quiz-victory__stage">
      <VictoryStage />
      <div className="quiz-victory__copy">
        <h2 className="quiz-victory__headline">{victoryHeadline(attempts, completionType)}</h2>
        <p className="quiz-victory__message">{resultLine}</p>
      </div>
    </div>
    <div className="quiz-victory__summary"><div className="quiz-victory__answer">
      <div className="quiz-victory__poster">{poster}</div>
      <div className="quiz-victory__answer-copy">
        <span className="quiz-victory__context">{context}</span>
        <h3>{title}</h3>
        {meta && <p>{meta}</p>}
      </div>
    </div>{rewards}</div>
    {children}
  </header>
}
