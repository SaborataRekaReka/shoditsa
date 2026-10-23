import { useQuery } from '@tanstack/react-query'
import { LEADERBOARD_REFRESH_INTERVAL_MS } from '@shoditsa/contracts'
import { api } from '../../api/client'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { GeneratedShoditsaGlyph as Glyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import './LeaderboardScreen.css'

export function RatingProfileSummary({ signedIn, userId }: { signedIn: boolean; userId?: string }) {
  const rating = useQuery({
    queryKey: ['leaderboard', 'profile', userId], queryFn: () => api.leaderboard({ period: 'all', limit: 1 }),
    enabled: SERVER_RUNTIME && signedIn,
    staleTime: LEADERBOARD_REFRESH_INTERVAL_MS, gcTime: LEADERBOARD_REFRESH_INTERVAL_MS,
    refetchInterval: LEADERBOARD_REFRESH_INTERVAL_MS, refetchOnWindowFocus: false,
  })
  const entry = rating.data?.viewerEntry
  return <section className="qg-card rating-profile-summary" aria-labelledby="profile-rating-title">
    <Glyph name="league" size={64} />
    <div><h2 id="profile-rating-title">Твой рейтинг</h2>{signedIn && SERVER_RUNTIME ? <>
      <strong>{rating.data ? new Intl.NumberFormat('ru').format(entry?.totalRating ?? 0) : '—'} <small>очков</small></strong>
      <p>{entry ? `Место № ${entry.rank} в общем рейтинге` : rating.data ? 'Первая ежедневная игра начнёт твой рейтинг.' : rating.isError ? 'Не удалось обновить рейтинг.' : 'Загружаем результаты…'}</p>
    </> : <p>Ежедневные игры приносят очки. Сравнивай результаты за неделю и за всё время.</p>}
      {rating.isError && <QuestButton kind="text" onClick={() => void rating.refetch()}>Попробовать ещё раз</QuestButton>}
    </div><a className="quest-button quest-button--outline" href="/leaderboard">К рейтингу</a>
  </section>
}
