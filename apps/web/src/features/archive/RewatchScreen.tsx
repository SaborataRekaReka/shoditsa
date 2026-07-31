import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Lock, RotateCcw } from 'lucide-react'
import { MODE_CONFIG, MODE_TABS } from '../../app/mode-config'
import { isPlayableModeId } from '@shoditsa/contracts'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { api, queryKeys } from '../../api/client'
import { apiErrorMessage } from '../../api/error-message'
import { ActionButton, AppHeader, Modal } from '../../components/app-shell/AppShell'
import { TitlePoster as Poster } from '../../components/title-poster'
import { ControlButton, InlineAlert, SelectControl, Tabs } from '../../components/ui'
import { PERIODS, prettyDate, resolveMusicRedirectId } from '../../game'
import { dayNumber } from '../../game/day-number'
import { useServerRuntime, SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import type { PeriodKey, SavedGame, TitleItem, TitleMode } from '../../types'
import { archiveItemToSavedGame, isCatalogArchiveItem, publicItemToTitle } from '../server-runtime/adapters'
import './RewatchScreen.css'

const modeMeta = (mode: TitleMode) => MODE_CONFIG[mode]
type ArchiveSection = TitleMode | 'connections'

function ArchiveModePicker({
  mode,
  setMode,
  connectionsEnabled = false,
}: {
  mode: ArchiveSection
  setMode: (mode: ArchiveSection) => void
  connectionsEnabled?: boolean
}) {
  const sections: { id: ArchiveSection; label: string }[] = [
    ...MODE_TABS.map((tabMode) => ({ id: tabMode, label: modeMeta(tabMode).plural })),
    ...(connectionsEnabled ? [{ id: 'connections' as const, label: 'Связи' }] : []),
  ]
  return <div className="rewatch-toolbar">
    <Tabs
      className="mode-tabs"
      activeClassName="active"
      label="Режим архива"
      items={sections}
      value={mode}
      onChange={setMode}
    />
    <label className="rewatch-mode-select">
      <span>Раздел архива</span>
      <SelectControl
        surface="dark"
        aria-label="Раздел архива"
        value={mode}
        onChange={(event) => setMode(event.currentTarget.value as ArchiveSection)}
      >
        {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
      </SelectControl>
    </label>
  </div>
}

type RewatchScreenProps = {
  mode: TitleMode
  setMode: (mode: TitleMode) => void
  period: PeriodKey
  dates: string[]
  games: SavedGame[]
  titles: TitleItem[]
  onOpen: (date: string, game: SavedGame | null) => void
  onOpenConnections: (date: string, sessionId: string | null) => void
  onHome: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onClub: () => void
}

export function RewatchScreen(props: RewatchScreenProps) {
  return SERVER_RUNTIME ? <ServerRewatchScreen {...props} /> : <LocalRewatchScreen {...props} />
}

function ServerRewatchScreen({ mode, setMode, period, dates, onOpen, onOpenConnections, onHome, onStats, onRules, onReview, onClub }: RewatchScreenProps) {
  const serverRuntime = useServerRuntime()
  const [lockedDate, setLockedDate] = useState<string | null>(null)
  const [archiveSection, setArchiveSection] = useState<ArchiveSection>(mode)
  const connectionsEnabled = serverRuntime.meta?.features.connectionsEnabled !== false
  const selectArchiveSection = (section: ArchiveSection) => {
    setArchiveSection(section)
    if (section !== 'connections') setMode(section)
  }
  useEffect(() => {
    setArchiveSection((current) => current === 'connections' ? current : mode)
  }, [mode])
  const playableMode = isPlayableModeId(mode) ? mode : 'movie'
  const archive = useQuery({
    queryKey: queryKeys.archiveCalendar({ mode: playableMode, period, from: dates.at(-1), to: dates[0] }),
    queryFn: () => api.archiveCalendar({ mode: playableMode, period, from: dates.at(-1)!, to: dates[0]! }),
    enabled: Boolean(serverRuntime.me),
  })
  const connectionsArchive = useQuery({
    queryKey: queryKeys.archiveCalendar({ mode: 'connections', from: dates.at(-1), to: dates[0] }),
    queryFn: () => api.archiveCalendar({ mode: 'connections', from: dates.at(-1)!, to: dates[0]! }),
    enabled: Boolean(serverRuntime.me) && serverRuntime.meta?.features.connectionsEnabled !== false,
  })
  const sessions = useMemo<SavedGame[]>(() => {
    return (archive.data?.items ?? []).flatMap((item) => (
      item.session && isCatalogArchiveItem(item.session) ? [archiveItemToSavedGame(item.session)] : []
    ))
  }, [archive.data])
  const accessByDate = useMemo(() => new Map((archive.data?.items ?? []).map((item) => [item.date, item.access])), [archive.data])
  const latestByDate = useMemo(() => {
    const byDate = new Map<string, SavedGame | null>()
    for (const itemDate of dates) {
      const sameDay = sessions.filter((game) => game.date === itemDate && game.mode === mode)
      const selectedPeriod = sameDay.find((game) => game.period === period)
      byDate.set(itemDate, selectedPeriod ?? sameDay.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null)
    }
    return byDate
  }, [dates, mode, period, sessions])
  const sessionPreviewIds = useMemo(() => {
    const ids = new Set<string>()
    for (const played of latestByDate.values()) {
      if (!played?.key.startsWith('server:') || (played.status !== 'won' && played.status !== 'lost')) continue
      ids.add(played.key.slice('server:'.length))
    }
    return [...ids]
  }, [latestByDate])
  const sessionPreviewQueries = useQueries({
    queries: sessionPreviewIds.map((id) => ({
      queryKey: queryKeys.game(id),
      queryFn: () => api.game(id),
      enabled: Boolean(serverRuntime.me),
      staleTime: 30_000,
    })),
  })
  const posterBySessionId = useMemo(() => {
    const map = new Map<string, TitleItem>()
    for (const query of sessionPreviewQueries) {
      const session = query.data?.session
      if (!session || (session.status !== 'won' && session.status !== 'lost')) continue
      const previewItem = session.answer ?? session.attempts.at(-1)?.item ?? null
      if (previewItem) map.set(session.id, publicItemToTitle(previewItem))
    }
    return map
  }, [sessionPreviewQueries])

  useEffect(() => {
    if (!lockedDate) return
    const archiveAgeDays = Math.max(0, dates.indexOf(lockedDate))
    trackClientEvent('archive_paywall_view', { mode, archiveAgeDays, hasClub: serverRuntime.dashboard?.membership.active ?? false })
    trackMetrikaGoal('archive_paywall_view', { mode, archiveAgeDays })
  }, [dates, lockedDate, mode, serverRuntime.dashboard?.membership.active])

  return <>
    <AppHeader onHome={onHome} onArchive={() => undefined} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="rewatch-screen">
      <div className="rewatch-heading"><RotateCcw /><h1>Архив</h1><p>Последние семь дат доступны всем. Полный архив с даты запуска открыт клубу.</p></div>
      <ArchiveModePicker mode={archiveSection} setMode={selectArchiveSection} connectionsEnabled={connectionsEnabled} />
      {connectionsEnabled && archiveSection === 'connections' && <section className="rewatch-connections rewatch-connections--tab" aria-labelledby="rewatch-connections-title">
        <header>
          <div><span>Ежедневная головоломка</span><h2 id="rewatch-connections-title">Связи</h2></div>
          <p>Вернитесь к точной версии раунда, опубликованной в выбранный день.</p>
        </header>
        {connectionsArchive.isError && <InlineAlert tone="danger" className="server-error">{apiErrorMessage(connectionsArchive.error)}</InlineAlert>}
        <div className="rewatch-connections__grid">{dates.map((itemDate, index) => {
          const item = connectionsArchive.data?.items.find((entry) => entry.date === itemDate)
          const session = item?.session?.mode === 'connections' ? item.session : null
          const unavailable = item?.available === false
          const locked = item?.access === 'locked' && !session
          const status = session?.status
          return <ControlButton
            className={`rewatch-connection ${status ?? ''} ${locked || unavailable ? 'rewatch-connection--disabled' : ''}`}
            key={itemDate}
            disabled={connectionsArchive.isLoading || unavailable}
            onClick={() => {
              if (locked) {
                setLockedDate(itemDate)
                trackClientEvent('archive_paywall_clicked', { mode: 'connections', archiveAgeDays: index, hasClub: serverRuntime.dashboard?.membership.active ?? false })
                trackMetrikaGoal('archive_paywall_clicked', { mode: 'connections', archiveAgeDays: index })
                return
              }
              onOpenConnections(itemDate, session?.id ?? null)
            }}
          >
            <span className="rewatch-connection__day">{index === 0 ? 'Сегодня' : index === 1 ? 'Вчера' : prettyDate(itemDate)}</span>
            <strong>#{dayNumber(itemDate)}</strong>
            <small>{connectionsArchive.isLoading
              ? 'Загружаем…'
              : unavailable
                ? 'Нет раунда'
                : locked
                  ? <><Lock /> Полный архив</>
                  : status === 'won'
                    ? 'Собрано'
                    : status === 'lost'
                      ? 'Не собрано'
                      : status === 'playing'
                        ? 'В процессе'
                        : 'Не сыграно'}</small>
          </ControlButton>
        })}</div>
      </section>}
      {archiveSection !== 'connections' && archive.isError && <InlineAlert tone="danger" className="server-error">{apiErrorMessage(archive.error)}</InlineAlert>}
      {archiveSection !== 'connections' && <section className="rewatch-grid">{dates.map((itemDate, index) => {
        const played = latestByDate.get(itemDate) ?? null
        const access = accessByDate.get(itemDate) ?? 'locked'
        const sessionId = played?.key.startsWith('server:') ? played.key.slice('server:'.length) : null
        const posterItem = sessionId ? posterBySessionId.get(sessionId) : undefined
        return <ControlButton className={`rewatch-item ${played?.status ?? ''} ${access === 'locked' && !played ? 'rewatch-item--locked' : ''}`} key={itemDate} onClick={() => {
          if (access === 'locked' && !played) {
            setLockedDate(itemDate)
            trackClientEvent('archive_paywall_clicked', { mode, archiveAgeDays: index, hasClub: serverRuntime.dashboard?.membership.active ?? false })
            trackMetrikaGoal('archive_paywall_clicked', { mode, archiveAgeDays: index })
            return
          }
          onOpen(itemDate, played)
        }} disabled={archive.isLoading}>
          <div className="rewatch-poster">{posterItem ? <><Poster item={posterItem} className="rewatch-poster__media" /><small className="rewatch-poster__day">#{dayNumber(itemDate)}</small></> : <span className="rewatch-poster__fallback-day">{access === 'locked' ? <Lock /> : `#${dayNumber(itemDate)}`}</span>}<i>{played?.status === 'won' ? `${played.attempts.length}/10` : played?.status === 'lost' ? '×' : played?.status === 'playing' || played?.status === 'final_choice' ? `${played.attempts.length}/10` : ''}</i></div>
          <strong>{index === 0 ? 'Сегодня' : index === 1 ? 'Вчера' : prettyDate(itemDate)}</strong>
          <small>{archive.isLoading ? 'Загружаем…' : played ? `${played.status === 'won' ? 'Угадан' : played.status === 'lost' ? 'Не угадан' : 'В процессе'}${['movie', 'series', 'anime', 'music'].includes(played.mode) ? ` · ${PERIODS[played.period].short}` : ''}` : access === 'locked' ? 'Полный архив клуба' : 'Не сыгран'}</small>
        </ControlButton>
      })}</section>}
      <ActionButton variant="secondary" className="back-to-premiere" onClick={onHome}>На главный экран</ActionButton>
    </main>
    {lockedDate && <Modal title="Полный архив клуба" onClose={() => setLockedDate(null)}><p className="modal-lead">Эта дата входит в полный архив клуба. Сегодня и предыдущие шесть дней доступны всем.</p><ActionButton onClick={() => { setLockedDate(null); onClub() }}>Узнать о клубе</ActionButton></Modal>}
  </>
}

function LocalRewatchScreen({ mode, setMode, period, dates, games, titles, onOpen, onHome, onStats, onRules, onReview }: RewatchScreenProps) {
  const latestByUpdatedAt = (items: SavedGame[]): SavedGame | null => {
    if (!items.length) return null
    return items.reduce((best, current) => current.updatedAt > best.updatedAt ? current : best)
  }
  const titleById = useMemo(() => {
    const map = new Map<string, TitleItem>()
    for (const item of titles) map.set(item.id, item)
    return map
  }, [titles])

  return <>
    <AppHeader onHome={onHome} onArchive={() => undefined} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="rewatch-screen">
      <div className="rewatch-heading"><RotateCcw /><h1>Архив</h1><p>История по всем режимам: сегодня и шесть предыдущих дней.</p></div>
      <ArchiveModePicker mode={mode} setMode={(section) => section !== 'connections' && setMode(section)} />
      <section className="rewatch-grid">{dates.map((itemDate, index) => {
        const dayGames = games.filter((game) => game.date === itemDate && game.mode === mode)
        const playedInCurrentPeriod = dayGames.find((game) => game.period === period)
        const played = playedInCurrentPeriod ?? latestByUpdatedAt(dayGames)
        const normalizedAnswerId = played?.mode === 'music' ? resolveMusicRedirectId(played.answerId) : played?.answerId
        const latestAttemptId = played?.attempts.at(-1)?.titleId
        const normalizedLatestAttemptId = played?.mode === 'music' && latestAttemptId ? resolveMusicRedirectId(latestAttemptId) : latestAttemptId
        const posterItem = played && (played.status === 'won' || played.status === 'lost')
          ? titleById.get(normalizedAnswerId ?? '') ?? (normalizedLatestAttemptId ? titleById.get(normalizedLatestAttemptId) : undefined)
          : undefined
        return <ControlButton className={`rewatch-item ${played?.status ?? ''}`} key={itemDate} onClick={() => onOpen(itemDate, played)}>
          <div className="rewatch-poster">
            {posterItem
              ? <>
                <Poster item={posterItem} className="rewatch-poster__media" />
                <small className="rewatch-poster__day">#{dayNumber(itemDate)}</small>
              </>
              : <span className="rewatch-poster__fallback-day">#{dayNumber(itemDate)}</span>}
            <i>{played?.status === 'won' ? `${played.attempts.length}/10` : played?.status === 'lost' ? '×' : ''}</i>
          </div>
          <strong>{index === 0 ? 'Сегодня' : index === 1 ? 'Вчера' : prettyDate(itemDate)}</strong>
          <small>{played
            ? `${played.status === 'won' ? 'Угадан' : played.status === 'lost' ? 'Не угадан' : 'В процессе'}${played.mode === 'movie' || played.mode === 'series' || played.mode === 'anime' || played.mode === 'music' ? ` · ${PERIODS[played.period].short}` : ''}`
            : 'Не сыгран'}</small>
        </ControlButton>
      })}</section>
      <ActionButton variant="secondary" className="back-to-premiere" onClick={onHome}>На главный экран</ActionButton>
    </main>
  </>
}
