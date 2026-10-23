import { GameArtwork } from '../../components/ui/GameArtwork'
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { Mascot } from '../../components/mascot/Mascot'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import type { TitleMode } from '../../types'
import { CATALOG_ENTRY_PRESENTATION } from './catalog-entry-presentation'
import './CatalogEntryHero.css'

function HeroScene({ mode }: { mode: TitleMode }) {
  return <div className="entry-scene" aria-hidden="true">
    <div className="entry-scene__mascot">
      <span className="entry-scene__mint" />
      <div className="entry-scene__pose">
        <Mascot className="entry-scene__think" pose="think" width={1254} height={1254} draggable={false} />
        <Mascot className="entry-scene__celebrate" pose="celebrate" width={1254} height={1254} draggable={false} />
      </div>
    </div>
    <div className="entry-scene__cinema">
      <span className="entry-scene__lilac" />
      <GameArtwork mode={mode} alt="" width="250" height="250" draggable={false} />
    </div>
  </div>
}

export function CatalogEntryHero({ mode, launchControls, extra }: { mode: TitleMode; launchControls: ReactNode; extra?: ReactNode }) {
  const design = CATALOG_ENTRY_PRESENTATION[mode]
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

  return <section className="entry-hero" aria-labelledby={`entry-title-${mode}`}>
    <div ref={stageRef} className="entry-hero__stage" onPointerMove={moveScene} onPointerLeave={resetScene}>
      <HeroScene mode={mode} />
      <div className="entry-hero__intro">
        <h1 id={`entry-title-${mode}`}>Угадай {design.subject}</h1>
        <p>Каждый ответ открывает новые детали.<br />{design.invitation}</p>
      </div>

      <div className="entry-hero__launch-group">
        <div className="entry-hero__actions">
          {launchControls}
        </div>
        {extra && <div className="entry-hero__extra">{extra}</div>}
        <div className="entry-hero__criteria">
          <span id={`entry-criteria-${mode}`}>Что сравниваем</span>
          <ul aria-labelledby={`entry-criteria-${mode}`}>{design.criteria.map(({ label, icon }) => <li key={label}><ReferenceIcon name={icon} size={16} /><span>{label}</span></li>)}</ul>
        </div>
      </div>
    </div>
  </section>
}
