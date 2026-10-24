import { GameDiscovery } from '../../components/game-information/GameInformation'
import '../../components/game-information/GameInformation.css'
import { publicAssetUrl } from '../../app/public-asset'
import { DANETKI_DISCOVERY_LINKS } from '../../app/danetki-discovery-links'
import type { PublicSeoGameMode } from '../../app/seo-content'
import './study-game-directory.css'

export function StudyGameDirectory({ games, title = 'Все игры' }: {
  games: readonly { mode: PublicSeoGameMode; href: string; label: string }[]
  title?: string
}) {
  return <div className="study-game-directory">
    <GameDiscovery title={title} label="Все игры" baseUrl={publicAssetUrl('')} links={games.map(game => ({ ...game, id: game.mode }))} />
    <GameDiscovery title="Данетки с ответами" baseUrl={publicAssetUrl('')} links={DANETKI_DISCOVERY_LINKS.map(link => ({ ...link, id: link.href }))} />
  </div>
}
