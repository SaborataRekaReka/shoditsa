import type { ReactNode } from 'react'
import type { SeoGameMode } from '../../app/seo-content'
import { publicAssetUrl } from '../../app/public-asset'
import { GameArtwork } from '../../components/ui/GameArtwork'
import './quest-title-hero.css'

/** A shared cover; all actions and availability still come from the caller. */
export function QuestTitleHero({ mode, kicker, title, lead, children }: {
  mode: SeoGameMode
  kicker: ReactNode
  title: string
  lead: string
  children: ReactNode
}) {
  return <header className="qt-hero">
    <div className="qt-hero-stage">
      <div className="qt-hero-copy">
        <span className="qt-hero-kicker"><span aria-hidden="true" />{kicker}</span>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <figure className="qt-hero-scene" aria-hidden="true">
        <span className="qt-hero-halo" />
        <img className="qt-hero-mascot" src={publicAssetUrl('images/mascot/puzzle-detective-v1.webp')} alt="" width="768" height="768" fetchPriority="high" draggable={false} />
        <span className="qt-hero-topic"><GameArtwork mode={mode} alt="" width="112" height="112" draggable={false} /></span>
      </figure>
    </div>
    <div className="qt-hero-launch">{children}</div>
  </header>
}
