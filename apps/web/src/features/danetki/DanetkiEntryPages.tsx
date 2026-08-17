import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { DanetkiRoomMode, DashboardResponse, GameSessionSnapshot } from '@shoditsa/contracts'
import { Clock3, HelpCircle, LoaderCircle, LockKeyhole, Play, Sparkles, UserRound, Users } from 'lucide-react'
import { api, ApiClientError } from '../../api/client'
import { ActionButton, AppHeader, ScreenBack } from '../../components/app-shell/AppShell'
import { GameLaunchControls, GameOption, GameOptionSelect } from '../../components/game-launch-controls/GameLaunchControls'
import { GameArtifactSeoDetails } from '../../components/seo-content/SeoContent'
import { ensureServerSession } from '../../hooks/use-server-runtime'
import { publicAssetUrl } from '../../app/public-asset'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { AdmissionTitleTicket, TicketKicker } from '../../components/title-ticket'
import { InlineAlert, TextInput } from '../../components/ui'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { danetkiCatalogItemBySlug, danetkiDifficultyLabel, danetkiStoryPath } from './danetki-catalog'
import { rememberDanetkiTrafficContext } from './danetki-registration-attribution'
import './DanetkiGamePage.css'
import './DanetkiEntryPages.css'

const messageFor = (error: unknown) => error instanceof ApiClientError
  ? error.message
  : error instanceof Error ? error.message : 'Не удалось выполнить действие'

export function DanetkiLobbyPage({ date, access, ticketBalance = 0, canCreateGroupRoom, onHome, onBack, onArchive, onStats, onRules, onReview, onStart, onContinue, onStartFreePlay, onCreateRoom, busy, error }: {
  date: string
  access?: DashboardResponse['danetkiAccess']
  ticketBalance?: number
  canCreateGroupRoom: boolean
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onStart: (roomMode: DanetkiRoomMode, itemId?: string) => void
  onContinue?: () => void
  onStartFreePlay?: (roomMode: DanetkiRoomMode, itemId?: string) => void
  onCreateRoom: () => void
  busy: boolean
  error?: string
}) {
  const [roomMode, setRoomMode] = useState<DanetkiRoomMode>('solo')
  const selectedStory = typeof window === 'undefined'
    ? null
    : danetkiCatalogItemBySlug(new URLSearchParams(window.location.search).get('story'))
  const trafficParams = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
  const entrySource = trafficParams?.get('from') ?? 'direct'
  const entryCollection = trafficParams?.get('collection') ?? undefined
  const dailyAvailable = (access?.dailyRoomsStarted ?? 0) === 0
  const groupStartCost = access?.nextGroupCost ?? 0
  const launchCost = roomMode === 'group' || dailyAvailable ? 0 : access?.nextSoloCost ?? 0
  const launchShortage = Math.max(0, launchCost - ticketBalance)
  const canLaunch = !busy && (roomMode === 'group'
    ? canCreateGroupRoom
    : launchShortage === 0 && (dailyAvailable || Boolean(onStartFreePlay)))
  const launch = () => {
    const source = entrySource
    const selectedItemId = roomMode === 'solo' ? selectedStory?.id : undefined
    const payload = { roomMode, source, collection: entryCollection ?? null, dailyAvailable, mode: 'danetki', story: selectedStory?.slug ?? null, itemId: selectedItemId ?? null }
    trackClientEvent('danetki_start_clicked', payload)
    trackMetrikaGoal('danetki_start_clicked', payload)
    if (roomMode === 'group') {
      if (!canCreateGroupRoom) return
      onCreateRoom()
      return
    }
    if (dailyAvailable) onStart('solo', selectedItemId)
    else onStartFreePlay?.('solo', selectedItemId)
  }
  const launchLabel = busy
    ? 'Запускаем…'
    : roomMode === 'group'
      ? 'Создать комнату'
    : launchShortage > 0
      ? `Не хватает ${launchShortage} билетов`
      : launchCost > 0
        ? `Начать игру · ${launchCost} билетов`
        : 'Начать игру'
  const displayDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00+03:00`))
  useEffect(() => {
    rememberDanetkiTrafficContext(entrySource, entryCollection)
    const payload = { mode: 'danetki', source: entrySource, collection: entryCollection ?? null, route: '/games/danetki', story: selectedStory?.slug ?? null, itemId: selectedStory?.id ?? null }
    trackClientEvent('danetki_landing_view', payload)
    trackMetrikaGoal('danetki_landing_view', payload)
  }, [entryCollection, entrySource, selectedStory?.id, selectedStory?.slug])
  useEffect(() => {
    if (!canCreateGroupRoom && roomMode === 'group') setRoomMode('solo')
  }, [canCreateGroupRoom, roomMode])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onBack(); return }
      if (event.key !== 'Enter' || !canLaunch || event.target instanceof HTMLInputElement) return
      event.preventDefault()
      launch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canLaunch, dailyAvailable, onBack, onCreateRoom, onStart, onStartFreePlay, roomMode])
  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell variant="title" onBack={onBack} wide className="title-screen danetki-title-screen">
      <section className="title-stage danetki-title-stage">
        <div className="title-game-mark">
          <span><Sparkles aria-hidden="true" /></span>
          <i>Игра дня · совместное расследование</i>
          <h1>Данетки онлайн</h1>
        </div>
        <time dateTime={date}>{displayDate}</time>
        <p>Раскройте необычную историю вопросами, на которые ведущий может ответить «да» или «нет».</p>
      <AdmissionTitleTicket
        id="ticket-danetki"
        mode="danetki"
        posterUrl={publicAssetUrl('images/title-posters/danetki-ticket-poster.webp')}
        stubLabel="ДЕЛО"
        stubTitle="ОТКРЫТО"
        stubMeta={`№ ${date.slice(8, 10)}`}
        stubEnd={`${date.slice(8, 10)}.${date.slice(5, 7)}`}
        className="danetki-title-ticket"
        eager
        details={<GameArtifactSeoDetails mode="danetki" />}
      >
          <TicketKicker title="Данетка дня" detail="ИИ-ведущий на связи" />
          <h2 id="ticket-danetki">Игра с ИИ-ведущим</h2>
          <p>Одна новая данетка в день доступна бесплатно. ИИ-ведущий отвечает «да» или «нет», а обязательная регистрация для одиночной игры не нужна.</p>
          {selectedStory && <aside className="danetki-selected-story" aria-label="Выбранная данетка">
            <span>Выбрано из каталога</span>
            <strong>{selectedStory.titleRu}</strong>
            <small>{danetkiDifficultyLabel(selectedStory.difficulty)} · около {selectedStory.estimatedMinutes} минут</small>
            <a href={danetkiStoryPath(selectedStory)}>Вернуться к условию</a>
            {roomMode === 'group' && <em>Для совместной комнаты будет выбрана случайная история.</em>}
          </aside>}
          {onContinue && <ActionButton type="button" variant="secondary" className="danetki-title-continue" onClick={onContinue}><Clock3 /> Продолжить расследование</ActionButton>}
          <GameLaunchControls
            mode="danetki"
            action={<ActionButton type="button" className="play-button game-launch-controls__play" onClick={launch} disabled={!canLaunch}>
              {busy ? <LoaderCircle className="danetki-spinner" aria-hidden="true" /> : <Play aria-hidden="true" />}
              {launchLabel}
              {canLaunch && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}
            </ActionButton>}
            option={<GameOptionSelect
              label="Формат игры"
              labelIcon={<Users aria-hidden="true" />}
              value={roomMode === 'solo' ? 'Одному' : 'Вместе'}
              menuLabel="Выберите формат"
              disabled={busy}
              resetKey={roomMode}
            >{(close) => <>
              <GameOption title="Одному" description="С ИИ-ведущим" icon={<UserRound />} selected={roomMode === 'solo'} onSelect={() => { setRoomMode('solo'); close() }} />
              <GameOption
                title="Вместе"
                description={canCreateGroupRoom
                  ? `До 4 игроков · запуск ${groupStartCost > 0 ? `${groupStartCost} билетов` : 'бесплатный'}`
                  : 'До 4 игроков · нужен клубный билет'}
                icon={canCreateGroupRoom ? <Users /> : <LockKeyhole />}
                status={canCreateGroupRoom ? undefined : { label: 'Только клуб', tone: 'locked', icon: <LockKeyhole /> }}
                selected={roomMode === 'group'}
                disabled={!canCreateGroupRoom}
                onSelect={() => { setRoomMode('group'); close() }}
              />
            </>}</GameOptionSelect>}
          />
          {busy && <p className="danetki-entry__status">Готовим расследование…</p>}
          {error && <InlineAlert tone="danger" className="danetki-entry__inline-error">{error}</InlineAlert>}
      </AdmissionTitleTicket>
      </section>
    </GameScreenShell>
  </>
}

export function DanetkiJoinPage({ token, onHome, onArchive, onStats, onRules, onReview, onJoined }: {
  token: string
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onJoined: (session: GameSessionSnapshot) => void
}) {
  const [displayName, setDisplayName] = useState('')
  const preview = useQuery({ queryKey: ['danetki', 'invite', token], queryFn: () => api.danetkiInvitePreview(token), retry: false })
  const join = useMutation({
    mutationFn: async () => {
      await ensureServerSession()
      return api.danetkiJoin(token, displayName.trim(), crypto.randomUUID())
    },
    onSuccess: ({ session }) => onJoined(session),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!displayName.trim() || join.isPending) return
    join.mutate()
  }
  const error = preview.error ?? join.error

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="danetki-join-screen">
      <ScreenBack onBack={onHome} label="На главную" />
      {preview.isLoading && <section className="danetki-join-card"><LoaderCircle className="danetki-spinner" /><h1>Проверяем приглашение…</h1></section>}
      {error && <section className="danetki-join-card is-error"><HelpCircle /><h1>Не получилось войти в комнату</h1><p>{messageFor(error)}</p><ActionButton type="button" variant="secondary" onClick={onHome}>На главную</ActionButton></section>}
      {preview.data && !join.isSuccess && <section className="danetki-join-card">
        <Sparkles /><span>Приглашение в расследование</span><h1>{preview.data.title}</h1>
        <p>Вас приглашает <strong>{preview.data.ownerName}</strong>. В комнате {preview.data.participants} из {preview.data.capacity} участников.</p>
        <form onSubmit={submit}><label>Как вас показывать другим игрокам<TextInput surface="paper" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={1} maxLength={40} autoFocus placeholder="Ваше имя" /></label><ActionButton type="submit" disabled={join.isPending || !displayName.trim()}>{join.isPending ? <><LoaderCircle /> Входим…</> : <><Users /> Присоединиться</>}</ActionButton></form>
      </section>}
    </main>
  </>
}
