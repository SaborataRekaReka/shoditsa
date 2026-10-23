import { publicAssetUrl } from '../../app/public-asset'
import { useEffect, useRef, type PointerEvent, type Ref } from 'react'
import { ArrowRight, ChevronDown, Ticket } from 'lucide-react'
import { Mascot } from '../../components/mascot/Mascot'
import { ReferenceIcon, type ReferenceIconName } from '../../components/ui/ReferenceIcon'
import { MOVIE_POSTERS, PosterReel } from './PosterReel'
import './fresh-hero.css'

const criteria: Array<{ label: string; icon: ReferenceIconName }> = [
  { label: 'Год', icon: 'calendar' },
  { label: 'Жанры', icon: 'movie' },
  { label: 'Актёры', icon: 'user' },
  { label: 'Страна', icon: 'globe' },
  { label: 'Рейтинг', icon: 'idea' },
]

function HeroScene() {
  return <div className="fresh-scene" aria-hidden="true">
    <div className="fresh-scene__mascot">
      <span className="fresh-scene__mint" />
      <div className="fresh-scene__pose">
        <Mascot className="fresh-scene__think" pose="think" width={1254} height={1254} draggable={false} />
        <Mascot className="fresh-scene__celebrate" pose="celebrate" width={1254} height={1254} draggable={false} />
      </div>
    </div>
    <div className="fresh-scene__cinema">
      <span className="fresh-scene__lilac" />
      <img src={publicAssetUrl('images/home-doodle/movie.webp')} alt="" width="250" height="250" draggable={false} />
    </div>
  </div>
}

export function FreshHero({ onStart, startRef }: { onStart: () => void; startRef: Ref<HTMLButtonElement> }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const motionFrame = useRef<number | null>(null)
  useEffect(() => () => { if (motionFrame.current !== null) cancelAnimationFrame(motionFrame.current) }, [])

  const resetScene = () => {
    if (motionFrame.current !== null) cancelAnimationFrame(motionFrame.current)
    motionFrame.current = null
    for (const axis of ['x', 'y']) {
      stageRef.current?.style.setProperty(`--scene-${axis}`, '0px')
      stageRef.current?.style.setProperty(`--scene-counter-${axis}`, '0px')
    }
  }
  const moveScene = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || !matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches) return
    const stage = event.currentTarget
    const bounds = stage.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1)) * 6
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1)) * 4
    if (motionFrame.current !== null) cancelAnimationFrame(motionFrame.current)
    motionFrame.current = requestAnimationFrame(() => {
      stage.style.setProperty('--scene-x', `${x.toFixed(2)}px`)
      stage.style.setProperty('--scene-y', `${y.toFixed(2)}px`)
      stage.style.setProperty('--scene-counter-x', `${(-x * .7).toFixed(2)}px`)
      stage.style.setProperty('--scene-counter-y', `${(-y * .7).toFixed(2)}px`)
      motionFrame.current = null
    })
  }

  return <section className="fresh-hero" aria-labelledby="mini-title">
    <div ref={stageRef} className="fresh-hero__stage" onPointerMove={moveScene} onPointerLeave={resetScene}>
      <HeroScene />
      <div className="fresh-hero__intro">
        <h1 id="mini-title">Угадай фильм</h1>
        <p>Каждый ответ открывает новые детали.<br />Найди фильм дня.</p>
      </div>

      <div className="fresh-hero__launch-group">
        <div className="fresh-hero__actions">
          <button ref={startRef} className="mini-primary fresh-hero__start" type="button" onClick={onStart}>
            <span>Начать игру</span><ArrowRight size={17} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <label className="fresh-period">
            <span className="fresh-period__label">Период</span>
            <select aria-label="Период фильмов" defaultValue="all"><option value="all">Все годы</option></select>
            <ChevronDown size={14} aria-hidden="true" />
            <span className="fresh-period__cost"><Ticket size={13} aria-hidden="true" /><span aria-label="15 билетов">15</span></span>
          </label>
        </div>
        <div className="fresh-hero__criteria">
          <span id="fresh-criteria-title">Что сравниваем</span>
          <ul aria-labelledby="fresh-criteria-title">{criteria.map(({ label, icon }) => <li key={label}><ReferenceIcon name={icon} size={16} /><span>{label}</span></li>)}</ul>
        </div>
      </div>
    </div>
    <PosterReel posters={MOVIE_POSTERS} />
  </section>
}
