import { GameArtwork } from '../../components/ui/GameArtwork'
import { ArrowRight } from 'lucide-react'
import { INDEXABLE_GAME_SEO, type GameSeoContent } from '../../app/seo-content'
import { publicAssetUrl } from '../../app/public-asset'
import { REFERENCE_HOME_CARD_COPY, REFERENCE_HOME_INTRO } from '../../features/home/reference-home-copy'
import { StudyGlyph } from './ShoditsaPresentation'
import './quest-games.css'

const games: readonly GameSeoContent[] = INDEXABLE_GAME_SEO

export function QuestGames({ tone }: { tone: string }) {
  return <section className="qc-games" aria-labelledby="qc-games-heading">
    <header className="qg-welcome qc-welcome">
      <div><h1 id="qc-games-heading">Все игры</h1><p>{REFERENCE_HOME_INTRO}</p></div>
      <figure aria-hidden="true"><span /><img src={publicAssetUrl('images/shoditsa-study/mascot-clue-v1.webp')} alt="" width="208" height="200" /></figure>
    </header>
    <div className="qc-game-grid">{games.map(game => {
      const href = `${game.canonicalPath}?tone=${encodeURIComponent(tone)}`
      return <a className="qg-card qc-game" href={href} key={game.mode} aria-label={game.shortName}>
        <GameArtwork mode={game.mode} alt="" width="88" height="88" loading="lazy" />
        <h2>{game.shortName}</h2><p>{REFERENCE_HOME_CARD_COPY[game.mode]}</p><ArrowRight size={20} aria-hidden="true" />
      </a>
    })}</div>
  </section>
}

export function QuestGamesAside() {
  return <section className="qg-card qc-aside"><StudyGlyph name="play" size={72} /><strong>Выбери свою игру</strong><p>{REFERENCE_HOME_INTRO}</p></section>
}
