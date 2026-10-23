import { GameArtwork } from '../../components/ui/GameArtwork'
import { useId } from 'react'
import { ArrowRight, Check, Globe2 } from 'lucide-react'
import { prettyDate } from '@shoditsa/game-core'
import type { DashboardResponse } from '@shoditsa/contracts'
import { queryKeys } from '../../api/client'
import { INDEXABLE_GAME_SEO } from '../../app/seo-content'
import { useDailyReset } from '../../hooks/use-daily-reset'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { useGameAvailability, supportsClubFreePlay, type GameAvailabilityMap } from '../quest-home/game-availability'
import { AVAILABILITY_PRESENTATION } from '../quest-home/GameAvailabilityBadge'
import { useStudyAccountCache } from './study-account-cache'
import { serverTodayAvailability } from './today-availability'
import './StudyTodayWidget.css'

const games = INDEXABLE_GAME_SEO

export function TodayCard({ date, availability, clubActive = false }: { date: string; availability: GameAvailabilityMap | null; clubActive?: boolean }) {
  const headingId = useId()
  return <section className="hs-today" aria-labelledby={headingId}>
    <h2 id={headingId}>{date.slice(8, 10)}<span>{prettyDate(date).replace(/^\d+\s*/, '')}</span></h2>
    <div className="hs-today-icons" aria-label="Доступность игр">{games.map(game => {
      const state = availability?.[game.mode]
      const unlimited = clubActive && supportsClubFreePlay(game.mode) && state !== 'completed'
      const detail = unlimited ? 'Свободные партии Клуба без ограничений' : state ? AVAILABILITY_PRESENTATION[state].detail : 'Открыть игру'
      return <a className={`hs-today-game hs-today-game--${unlimited ? 'club' : state ?? 'unknown'}`} key={game.mode} href={game.canonicalPath} title={`${game.shortName}: ${detail}`} aria-label={`${game.shortName}: ${detail}`} data-day-game={game.mode}>
        <GameArtwork mode={game.mode} alt="" width="42" height="42" />
        {(unlimited || state) && <span className="hs-today-marker" aria-hidden="true">{unlimited ? '∞' : state === 'new' ? '1' : state === 'completed' ? <Check size={12} strokeWidth={3} /> : state === 'in-progress' ? <ArrowRight size={12} strokeWidth={3} /> : <Globe2 size={11} />}</span>}
      </a>
    })}</div>
  </section>
}

export function StudyTodayWidget({ refreshKey }: { refreshKey?: string }) {
  const { date } = useDailyReset()
  const dashboard = useStudyAccountCache<DashboardResponse>(queryKeys.dashboard)
  if (!SERVER_RUNTIME) return <LocalTodayWidget date={date} refreshKey={refreshKey} />
  return <TodayCard date={date} availability={serverTodayAvailability(dashboard, date)} clubActive={dashboard?.membership.active} />
}

function LocalTodayWidget({ date, refreshKey }: { date: string; refreshKey?: string }) {
  const availability = useGameAvailability(date, refreshKey)
  return <TodayCard date={date} availability={availability} />
}
