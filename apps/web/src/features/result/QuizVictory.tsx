import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Mascot } from '../../components/mascot/Mascot'
import type { GameCompletionType } from '@shoditsa/contracts'
import './QuizVictory.css'

export function victoryHeadline(attempts: number, completionType?: GameCompletionType | null) {
  if (completionType === 'final_choice_win') return 'До самого конца!'
  if (attempts === 1) return 'С первой попытки!'
  if (attempts <= 3) return 'Красиво сыграно!'
  if (attempts <= 6) return 'Всё сошлось!'
  return 'Есть победа!'
}

/** The same celebration for every attribute quiz, including special packs. */
export function QuizVictory({ attempts, completionType, context, resultLine, poster, title, meta, children }: {
  attempts: number
  maxAttempts?: number
  completionType?: GameCompletionType | null
  context: string
  resultLine: string
  poster: ReactNode
  title: string
  meta: string
  tags: string[]
  children?: ReactNode
}) {
  const sceneRef = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  // The result is often below the board: celebrate when it actually enters view.
  useEffect(() => {
    const element = sceneRef.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
    }, { threshold: 0.3 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <header ref={sceneRef} className={`quiz-victory${visible ? ' is-visible' : ''}`}>
    <div className="quiz-victory__stage">
      <div className="quiz-victory__copy">
        <span className="quiz-victory__context">{context}</span>
        <h2 className="quiz-victory__headline">{attempts === 1 && completionType !== 'final_choice_win' ? 'С первого раза!' : 'Сходится!'}</h2>
        <p className="quiz-victory__message">{resultLine}.</p>
        <p className="quiz-victory__praise">{victoryHeadline(attempts, completionType)}</p>
      </div>
      <div className="quiz-victory__scene" aria-hidden="true">
        <div className="quiz-victory__confetti">{Array.from({ length: 10 }, (_, index) => <i key={index} style={{ '--piece': index } as CSSProperties} />)}</div>
        <Mascot pose="victory" className="quiz-victory__mascot" width={240} height={240} draggable={false} />
      </div>
    </div>
    <div className="quiz-victory__answer">
      <div className="quiz-victory__poster">{poster}</div>
      <div className="quiz-victory__answer-copy">
        <h3>{title}</h3>
        {meta && <p>{meta.replace(/\s*[·•]\s*/g, ', ')}</p>}
      </div>
    </div>
    {children}
  </header>
}
