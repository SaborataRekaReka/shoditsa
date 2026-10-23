import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarDays, LockKeyhole } from 'lucide-react'
import { getMoscowDate } from '@shoditsa/game-core'
import { api, queryKeys } from '../../api/client'
import { apiErrorMessage } from '../../api/error-message'
import { INDEXABLE_GAME_SEO, type SeoGameMode } from '../../app/seo-content'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { ControlButton, SelectControl, TextInput } from '../../components/ui'
import type { ApplicationGame } from './useApplicationGames'

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const label = (date: string) => new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

/** Keep the real archive calendar and access checks in the new visual system. */
export function ApplicationArchiveCalendar({ games }: { games: ApplicationGame[] }) {
  const runtime = useServerRuntime()
  const today = getMoscowDate()
  const [mode, setMode] = useState<SeoGameMode>('movie')
  const [until, setUntil] = useState(today)
  const first = SERVER_RUNTIME ? runtime.meta?.commerce.archiveFirstDate ?? today : shift(today, -6)
  const end = until > today ? today : until < first ? first : until
  const dates = Array.from({ length: 14 }, (_, index) => shift(end, -index)).filter(date => date >= first)
  const modes = INDEXABLE_GAME_SEO.filter(game => game.mode !== 'danetki' && (game.mode !== 'connections' || SERVER_RUNTIME && runtime.meta?.features.connectionsEnabled !== false))
  const calendar = useQuery({
    queryKey: queryKeys.archiveCalendar({ mode, from: dates.at(-1), to: end, period: 'all' }),
    queryFn: () => api.archiveCalendar({ mode, from: dates.at(-1)!, to: end, period: 'all' }),
    enabled: SERVER_RUNTIME && !!runtime.me && dates.length > 0,
  })
  const launch = useMutation({
    mutationFn: (date: string) => api.start({ kind: date === today ? 'daily' : 'archive', mode, period: 'all', archiveDate: date === today ? null : date }, crypto.randomUUID()),
    onSuccess: response => window.location.assign(`/sessions/${encodeURIComponent(response.session.id)}`),
  })
  return <section className="application-archive-calendar" aria-label="Загадки по дням">
    <div className="application-calendar-filters">
      <label>Игра<SelectControl variant="soft" value={mode} onChange={event => { setMode(event.target.value as SeoGameMode); launch.reset() }}>{modes.map(game => <option key={game.mode} value={game.mode}>{game.shortName}</option>)}</SelectControl></label>
      <label>По какое число<TextInput variant="soft" type="date" min={first} max={today} value={end} onChange={event => { if (event.target.value) setUntil(event.target.value) }} /></label>
    </div>
    {calendar.isError ? <div className="qg-card application-empty"><p>Не удалось загрузить архив.</p><QuestButton kind="outline" onClick={() => void calendar.refetch()}>Повторить</QuestButton></div> : <div className="application-calendar-grid">{dates.map(date => {
      const item = calendar.data?.items.find(entry => entry.date === date)
      const saved = games.find(game => game.mode === mode && game.date === date)
      const sessionHref = item?.session ? `/sessions/${encodeURIComponent(item.session.id)}` : saved?.href
      const locked = item?.access === 'locked' && !sessionHref
      const unavailable = item?.available === false
      const status = item?.session?.status ?? saved?.status
      const body = <><span>{locked ? <LockKeyhole size={23} /> : <CalendarDays size={23} />}</span><strong>{date === today ? 'Сегодня' : date === shift(today, -1) ? 'Вчера' : label(date)}</strong><small>{unavailable ? 'Нет загадки' : calendar.isLoading ? 'Загружаем…' : locked ? 'С клубным билетом' : status === 'won' ? 'Разгадано' : status === 'lost' ? 'Завершено' : status ? 'Продолжить' : 'Не сыграно'}</small></>
      const className = `qg-card application-calendar-day${locked ? ' is-locked' : ''}`
      return locked ? <a className={className} href="/club/membership" key={date}>{body}</a> : sessionHref || !SERVER_RUNTIME ? <a className={className} href={sessionHref ?? `/play/${mode}?date=${date}`} key={date}>{body}</a> : <ControlButton className={className} type="button" disabled={unavailable || calendar.isLoading || !runtime.me || launch.isPending} onClick={() => launch.mutate(date)} key={date}>{body}</ControlButton>
    })}</div>}
    {launch.isError && <p className="application-calendar-error" role="alert">{apiErrorMessage(launch.error)}</p>}
    {dates.length > 0 && dates.at(-1)! > first && <QuestButton kind="outline" onClick={() => setUntil(shift(dates.at(-1)!, -1))}>Предыдущие дни</QuestButton>}
  </section>
}
