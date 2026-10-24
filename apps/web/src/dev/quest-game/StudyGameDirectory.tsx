import { GameArtwork } from '../../components/ui/GameArtwork'
import { ArrowUpRight } from 'lucide-react'
import { DANETKI_DISCOVERY_LINKS } from '../../app/danetki-discovery-links'
import type { PublicSeoGameMode } from '../../app/seo-content'
import './study-game-directory.css'

export function StudyGameDirectory({ games, title = 'Все игры' }: {
  games: readonly { mode: PublicSeoGameMode; href: string; label: string }[]
  title?: string
}) {
  return <div className="study-game-directory">
    <section><h3>{title}</h3><nav className="study-directory-games" aria-label="Все ежедневные игры">{games.map(game => {
      return <a key={game.mode} href={game.href}><GameArtwork mode={game.mode} alt="" width="28" height="28" loading="lazy" /><span>{game.label}</span><ArrowUpRight size={15} aria-hidden="true" /></a>
    })}</nav></section>
    <section><h3>Данетки с ответами</h3><nav className="study-directory-stories" aria-label="Данетки с ответами">{DANETKI_DISCOVERY_LINKS.map(link => <a key={link.href} href={link.href}><span>{link.label}</span><ArrowUpRight size={15} aria-hidden="true" /></a>)}</nav></section>
  </div>
}
