import { CirclePlay } from 'lucide-react'
import { useApplicationGames } from '../../features/application/useApplicationGames'

/** This indicator belongs to Games; selecting the item still opens the catalogue. */
export function StudyGamesCounter({ descriptionId, refreshKey }: { descriptionId: string; refreshKey?: string }) {
  const { active } = useApplicationGames(refreshKey)
  const count = active.length
  const description = count ? `Незавершённых игр: ${count}` : 'Все игры'
  return <>
    <span id={descriptionId} className="qg-live">{description}</span>
    {count > 0 && <span className="study-games-counter" title={description} aria-hidden="true" data-active-games={count}><CirclePlay size={15} /><strong>{count}</strong></span>}
  </>
}
