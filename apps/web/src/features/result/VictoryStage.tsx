import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { Mascot } from '../../components/mascot/Mascot'
import { IconButton } from '../../components/ui'
import './VictoryStage.css'

function PaperWing() {
  return <svg viewBox="0 0 250 205" fill="none">
    <path className="victory-stage__paper-back" d="M239 202C177 192 90 111 66 22Q63 8 49 14L9 33Q0 38 4 53C32 132 120 192 239 202Z" />
    <path className="victory-stage__paper-middle" d="M239 202C169 191 108 148 76 77Q70 66 58 71L17 92Q6 98 14 109C64 171 143 199 239 202Z" />
    <path className="victory-stage__paper-front" d="M239 202C163 198 107 179 69 142Q59 132 48 140L14 164Q6 171 17 179C80 207 156 210 239 202Z" />
    <path className="victory-stage__paper-fold" d="M44 39Q94 154 217 197M46 98Q111 177 222 198M45 166Q119 199 221 201" />
    <path className="victory-stage__paper-highlight" d="M16 38L45 24M25 96L55 82M26 166L51 149" />
  </svg>
}

function Ribbon({ variant }: { variant: number }) {
  if (variant === 1) return <svg viewBox="0 0 46 70" fill="none"><path className="victory-stage__ribbon-edge" d="M12 4C34 9 35 23 18 30C1 37 8 50 33 56L29 65C-3 56-7 35 14 26C24 21 25 17 10 13Z" /><path className="victory-stage__ribbon-light" d="M14 8C29 13 31 22 17 28M13 40Q14 49 29 53" /></svg>
  if (variant === 2) return <svg viewBox="0 0 42 62" fill="none"><path className="victory-stage__ribbon-edge" d="M6 8Q37 0 34 22Q33 38 12 38Q3 38 13 54L5 59Q-12 29 10 28Q28 28 25 19Q23 14 8 17Z" /><path className="victory-stage__ribbon-light" d="M10 11Q28 7 29 19M10 33Q0 34 7 48" /></svg>
  return <svg viewBox="0 0 42 44" fill="none"><path className="victory-stage__ribbon-edge" d="M5 8Q20 15 34 7L38 20Q23 30 8 21Z" /><path className="victory-stage__ribbon-light" d="M9 12Q22 18 32 12" /></svg>
}

/** A victory reveal using whole artwork and independently moving paper. */
export function VictoryStage() {
  const root = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(true)
  const [pageVisible, setPageVisible] = useState(true)
  const [replay, setReplay] = useState(0)

  useEffect(() => {
    const element = root.current
    if (!element || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return <div ref={root} className="victory-stage" data-ready={ready || undefined} data-paused={paused || !visible || !pageVisible || undefined}>
    <div key={replay} className="victory-stage__art" aria-hidden="true">
      <div className="victory-stage__spotlight" />
      <div className="victory-stage__floor" />
      <div className="victory-stage__wing victory-stage__wing--left"><PaperWing /></div>
      <div className="victory-stage__wing victory-stage__wing--right"><PaperWing /></div>
      <div className="victory-stage__podium"><span /></div>
      <div className="victory-stage__shadow" />
      <div className="victory-stage__arrival"><div className="victory-stage__breathing">
        <Mascot pose="victory" className="quiz-victory__mascot" width={180} height={180} draggable={false} onLoad={() => setReady(true)} />
      </div></div>
      {[1, 2, 3, 4, 5, 6].map(n => <div key={n} className={`victory-stage__ribbon victory-stage__ribbon--${n}`}><div><Ribbon variant={n % 3} /></div></div>)}
      <span className="victory-stage__dot victory-stage__dot--1" />
      <span className="victory-stage__dot victory-stage__dot--2" />
      <span className="victory-stage__dot victory-stage__dot--3" />
    </div>
    <div className="victory-stage__controls">
      <IconButton size="sm" label="Повторить анимацию победы" className="victory-stage__control" onClick={() => { setPaused(false); setReplay(value => value + 1) }}><RotateCcw size={14} aria-hidden="true" /></IconButton>
      <IconButton size="sm" label={paused ? 'Продолжить анимацию победы' : 'Приостановить анимацию победы'} aria-pressed={paused} className="victory-stage__control" onClick={() => setPaused(value => !value)}>{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</IconButton>
    </div>
  </div>
}
