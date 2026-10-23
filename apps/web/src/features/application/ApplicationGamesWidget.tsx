import { GameArtwork } from '../../components/ui/GameArtwork'
import { ArrowRight, Check } from 'lucide-react'
import { getMoscowDate } from '@shoditsa/game-core'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import { useApplicationGames } from './useApplicationGames'

/** One account-backed widget for continuing games and today's completed results. */
export function ApplicationGamesWidget({ refreshKey }: { refreshKey?: string }) {
  const { active, today } = useApplicationGames(refreshKey)
  const completed = today.filter(game => ['won', 'lost'].includes(game.status))
  const games = [...active, ...completed].filter((game, index, all) => all.findIndex(item => item.id === game.id) === index).slice(0, 4)
  return <section className="qg-card study-section-widget application-games-widget" data-study-widget="games">
    <div className="qg-side-head"><h2>Игра идет</h2><Glyph name="play" size={42} /></div>
    {games.length ? <div className="study-widget-games">{games.map(game => <a className="study-widget-game" href={game.href} key={game.id}><GameArtwork mode={game.mode} alt="" width="40" height="40" /><span><strong>{game.title}</strong><small>{['won', 'lost'].includes(game.status) ? 'Завершено' : game.date === getMoscowDate() ? 'Продолжить' : `Продолжить · ${game.date.split('-').reverse().join('.')}`}</small></span>{['won', 'lost'].includes(game.status) ? <Check size={18} /> : <ArrowRight size={18} />}</a>)}</div> : <p>Начни любую игру. Здесь появятся твои партии и результаты.</p>}
    <a className="quest-button quest-button--outline study-widget-action" href={games.length ? '/archive' : '/'}>{games.length ? 'Вся история игр' : 'Выбрать игру'}</a>
  </section>
}
