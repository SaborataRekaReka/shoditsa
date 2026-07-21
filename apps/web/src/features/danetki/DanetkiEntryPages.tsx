import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { DanetkiRoomMode, DashboardResponse, GameSessionSnapshot } from '@shoditsa/contracts'
import { Clock3, HelpCircle, LoaderCircle, Play, Sparkles, UserRound, Users } from 'lucide-react'
import { api, ApiClientError } from '../../api/client'
import { ActionButton, AppHeader, ScreenBack } from '../../components/app-shell/AppShell'
import { GameLaunchControls, GameOption, GameOptionSelect } from '../../components/game-launch-controls/GameLaunchControls'
import { GameArtifactSeoDetails } from '../../components/seo-content/SeoContent'
import { ensureServerSession } from '../../hooks/use-server-runtime'
import { publicAssetUrl } from '../../app/public-asset'
import { DanetkiShell } from './DanetkiShell'
import './DanetkiGamePage.css'

const messageFor = (error: unknown) => error instanceof ApiClientError
  ? error.message
  : error instanceof Error ? error.message : 'Не удалось выполнить действие'

export function DanetkiLobbyPage({ date, access, ticketBalance = 0, onHome, onBack, onArchive, onStats, onRules, onReview, onStart, onContinue, onStartFreePlay, busy, error }: {
  date: string
  access?: DashboardResponse['danetkiAccess']
  ticketBalance?: number
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onStart: (roomMode: DanetkiRoomMode) => void
  onContinue?: () => void
  onStartFreePlay?: (roomMode: DanetkiRoomMode) => void
  busy: boolean
  error?: string
}) {
  const [roomMode, setRoomMode] = useState<DanetkiRoomMode>('solo')
  const dailyAvailable = (access?.dailyRoomsStarted ?? 0) === 0
  const launchCost = dailyAvailable ? 0 : roomMode === 'solo' ? access?.nextSoloCost ?? 0 : access?.nextGroupCost ?? 0
  const launchShortage = Math.max(0, launchCost - ticketBalance)
  const canLaunch = !busy && launchShortage === 0 && (dailyAvailable || Boolean(onStartFreePlay))
  const launch = () => dailyAvailable ? onStart(roomMode) : onStartFreePlay?.(roomMode)
  const launchLabel = busy
    ? 'Запускаем…'
    : launchShortage > 0
      ? `Не хватает ${launchShortage} билетов`
      : launchCost > 0
        ? `Начать игру · ${launchCost} билетов`
        : 'Начать игру'
  const displayDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00+03:00`))
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onBack(); return }
      if (event.key !== 'Enter' || !canLaunch || event.target instanceof HTMLInputElement) return
      event.preventDefault()
      launch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canLaunch, dailyAvailable, onBack, onStart, onStartFreePlay, roomMode])
  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <DanetkiShell onBack={onBack} className="title-screen danetki-title-screen">
      <section className="title-stage danetki-title-stage">
        <div className="title-game-mark">
          <span><Sparkles aria-hidden="true" /></span>
          <i>Игра дня · совместное расследование</i>
          <h1>Данетки</h1>
        </div>
        <time dateTime={date}>{displayDate}</time>
        <p>Раскройте необычную историю вопросами, на которые ведущий может ответить «да» или «нет».</p>
      <section className="admit-ticket admit-ticket--dossier danetki-title-ticket" aria-labelledby="ticket-danetki">
        <div className="admit-ticket__stub admit-ticket__stub--poster admit-ticket__stub--danetki" aria-hidden="true">
          <img className="admit-ticket__stub-art" src={publicAssetUrl('images/title-posters/danetki-ticket-poster.webp')} alt="" decoding="async" fetchPriority="high" />
          <span>ДЕЛО</span><strong>ОТКРЫТО</strong><small>№ {date.slice(8, 10)}</small><em>{date.slice(8, 10)}.{date.slice(5, 7)}</em><i />
        </div>
        <div className="admit-ticket__body">
          <div className="ticket-kicker"><span>Данетка дня</span><i /><small>ИИ-ведущий на связи</small></div>
          <h2 id="ticket-danetki">Ваше расследование</h2>
          <p>Одна новая Данетка в день бесплатна. Создатель получает +10 билетов после завершения.</p>
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
              <GameOption title="Вместе" description="Общая комната до 6 игроков" icon={<Users />} selected={roomMode === 'group'} onSelect={() => { setRoomMode('group'); close() }} />
            </>}</GameOptionSelect>}
          />
          {busy && <p className="danetki-entry__status">Готовим расследование…</p>}
          {error && <p className="danetki-entry__inline-error" role="alert">{error}</p>}
        </div>
        <GameArtifactSeoDetails mode="danetki" />
      </section>
      </section>
    </DanetkiShell>
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
        <form onSubmit={submit}><label>Как вас показывать другим игрокам<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={1} maxLength={40} autoFocus placeholder="Ваше имя" /></label><ActionButton type="submit" disabled={join.isPending || !displayName.trim()}>{join.isPending ? <><LoaderCircle /> Входим…</> : <><Users /> Присоединиться</>}</ActionButton></form>
      </section>}
    </main>
  </>
}
