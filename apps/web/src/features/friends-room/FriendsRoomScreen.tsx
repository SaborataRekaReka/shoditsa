import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, DoorOpen, HelpCircle, Lightbulb, LoaderCircle, Plus, Popcorn, RefreshCw, Send, Sparkles } from 'lucide-react'
import {
  FRIENDS_ROOM_DEFAULT_PACK_VARIANTS,
  FRIENDS_ROOM_PACK_VARIANTS,
  friendsRoomMinimumRounds,
  type FriendsRoomGameType,
  type FriendsRoomConfigBody,
  type FriendsRoomPackSelection,
  type FriendsRoomPreview,
  type FriendsRoomSnapshot,
  type FriendsRoomSummary,
  type GameResponse,
  type GameSessionSnapshot,
  type PlayableCatalogGuessModeId,
  type PublicContentItem,
} from '@shoditsa/contracts'
import { ActionButton, AppHeader, type AppHeaderProps } from '../../components/app-shell/AppShell'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { api, danetkiEventsUrl, friendsRoomEventsUrl, queryKeys } from '../../api/client'
import { publicAssetUrl } from '../../app/public-asset'
import { trackClientEvent } from '../../app/client-events'
import { ensureServerSession } from '../../hooks/use-server-runtime'
import { currentFriendsRoomReturnUrl, friendsRoomRegistrationHref } from './friends-room-access'
import { friendsRoomTimeLeft } from './friends-room-time'
import { friendsRoomActionLabel, friendsRoomPhaseLabel, friendsRoomSummaryTitle } from './friends-room-summary'
import { ControlButton, DialogSurface, InlineAlert, TextArea, TextInput } from '../../components/ui'
import './FriendsRoomScreen.css'

type IconName = 'apps' | 'back' | 'chat' | 'check' | 'copy' | 'exit' | 'play' | 'remove' | 'replay' | 'send' | 'share' | 'shuffle' | 'timer' | 'trophy' | 'users'

const RoomIcon = ({ name }: { name: IconName }) => <i
  className="room-icon"
  aria-hidden="true"
  style={{ '--room-icon-url': `url("${publicAssetUrl(`images/friends-room/icons/${name}.svg`)}")` } as CSSProperties}
/>

const MODES: Array<{ id: PlayableCatalogGuessModeId; label: string; poster: string; color: string }> = [
  { id: 'series', label: 'Сериалы', poster: 'images/title-posters/series-ticket-poster.webp', color: 'var(--mode-series-brand)' },
  { id: 'movie', label: 'Кино', poster: 'images/title-posters/movie-ticket-poster.webp', color: 'var(--mode-movie-brand)' },
  { id: 'anime', label: 'Аниме', poster: 'images/title-posters/anime-ticket-poster.webp', color: 'var(--mode-anime-brand)' },
  { id: 'game', label: 'Игры', poster: 'images/title-posters/game-ticket-poster.webp', color: 'var(--mode-game-brand)' },
  { id: 'city', label: 'Города', poster: 'images/title-posters/city-ticket-poster.webp', color: 'var(--mode-city-brand)' },
  { id: 'music', label: 'Музыка', poster: 'images/title-posters/music-ticket-poster.webp', color: 'var(--mode-music-brand)' },
  { id: 'diagnosis', label: 'Диагнозы', poster: 'images/title-posters/diagnosis-ticket-poster.webp', color: 'var(--mode-diagnosis-brand)' },
  { id: 'animal', label: 'Животные', poster: 'images/title-posters/animal-ticket-poster.webp', color: 'var(--mode-animal-brand)' },
  { id: 'book', label: 'Книги', poster: 'images/title-posters/book-ticket-poster.svg', color: 'var(--mode-book-brand)' },
]
const DANETKI_MODE = { id: 'danetki' as const, label: 'Данетки', poster: 'images/title-posters/danetki-ticket-poster.webp', color: 'var(--mode-danetki-brand)' }
const ROOM_MODES = [...MODES, DANETKI_MODE]
type RoomMode = (typeof ROOM_MODES)[number]['id']
type FriendsRoomBootstrap = {
  room: FriendsRoomSnapshot | null
  rooms: FriendsRoomSummary[]
  preview: FriendsRoomPreview | null
}

const FRIENDS_ROOM_ROUND_MAX = 30
const FRIENDS_ROOM_ROUND_STEP = 3

const colorByKey: Record<string, string> = {
  'player-1': 'var(--mode-movie-brand)', 'player-2': 'var(--mode-series-brand)', 'player-3': 'var(--mode-anime-brand)', 'player-4': 'var(--mode-game-brand)',
  'player-5': 'var(--mode-music-brand)', 'player-6': 'var(--mode-diagnosis-brand)', 'player-7': '#c58d55', 'player-8': '#6f9d72',
  'player-9': '#b87575', 'player-10': '#7188b8', 'player-11': '#a982b3', 'player-12': '#7d9d9d',
}

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие'
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru-RU') || 'И'
const score = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
const packCountLabel = (count: number) => `${count} ${count === 1 ? 'пак' : count < 5 ? 'пака' : 'паков'}`
const activeMembers = (room: FriendsRoomSnapshot) => room.members.filter((member) => !member.leftAt && member.connected)
const idempotencyKey = () => crypto.randomUUID()
const localTime = (value: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const plural = (value: number, one: string, few: string, many: string) => {
  const absolute = Math.abs(value) % 100
  const last = absolute % 10
  if (absolute > 10 && absolute < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}
const withConfigDraft = (snapshot: FriendsRoomSnapshot, draft: FriendsRoomConfigBody): FriendsRoomSnapshot => {
  const packs = draft.packs ?? snapshot.packs
  return {
    ...snapshot,
    ...(draft.roundsTotal == null ? {} : { roundsTotal: draft.roundsTotal }),
    ...(draft.shufflePacks == null ? {} : { shufflePacks: draft.shufflePacks }),
    ...(draft.answerTimeSeconds == null ? {} : { answerTimeSeconds: draft.answerTimeSeconds }),
    ...(draft.packs == null ? {} : { packs }),
    ...(draft.gameType == null ? {} : { gameType: draft.gameType }),
    mode: draft.mode ?? draft.packs?.[0]?.mode ?? snapshot.mode,
  }
}

export function FriendsRoomScreen({ navigation, onExit, ticketBalance = 0 }: {
  navigation: AppHeaderProps
  onExit: () => void
  ticketBalance?: number
}) {
  const [room, setRoom] = useState<FriendsRoomSnapshot | null>(null)
  const [roomDirectory, setRoomDirectory] = useState<FriendsRoomSummary[] | null>(null)
  const [invitePreview, setInvitePreview] = useState<FriendsRoomPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [messageSending, setMessageSending] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<'connected' | 'reconnecting' | 'offline'>('reconnecting')
  const [answer, setAnswer] = useState('')
  const [answerItemId, setAnswerItemId] = useState<string | undefined>()
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [anonymousUser, setAnonymousUser] = useState(false)
  const [now, setNow] = useState(Date.now())
  const bootstrapRef = useRef<Promise<FriendsRoomBootstrap> | null>(null)
  const roomRef = useRef<FriendsRoomSnapshot | null>(null)
  const configQueueRef = useRef<Promise<void>>(Promise.resolve())
  const configMutationRef = useRef(0)
  const configDraftRef = useRef<FriendsRoomConfigBody>({})
  const intermissionEventRef = useRef('')
  const queryClient = useQueryClient()

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('.ui-dialog-backdrop, .modal-backdrop, .room-danetki-dialog-backdrop')) return
      event.preventDefault()
      onExit()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onExit])

  const applyIncomingRoom = useCallback((snapshot: FriendsRoomSnapshot) => {
    const next = withConfigDraft(snapshot, configDraftRef.current)
    roomRef.current = next
    setRoom(next)
  }, [])

  useEffect(() => {
    if (!bootstrapRef.current) {
      const search = new URLSearchParams(window.location.search)
      const code = search.get('room')?.trim().toUpperCase()
      const gameType: FriendsRoomGameType = search.get('mode') === 'danetki' ? 'danetki' : 'quiz'
      const createExplicitly = search.get('new') === '1' || gameType === 'danetki'
      bootstrapRef.current = ensureServerSession()
        .then(async (identity) => {
          setAnonymousUser(identity.user.isAnonymous)
          if (code) {
            const directory = await api.friendsRoomList()
            const current = directory.rooms.find((entry) => entry.code === code)
            if (current) return { room: (await api.friendsRoomSnapshot(current.id)).room, rooms: [], preview: null }
            return { room: null, rooms: [], preview: await api.friendsRoomPreview(code) }
          }
          if (createExplicitly) {
            if (identity.user.isAnonymous) {
              window.location.replace(friendsRoomRegistrationHref(currentFriendsRoomReturnUrl()))
              return { room: null, rooms: [], preview: null }
            }
            return { room: (await api.friendsRoomCreate({ gameType })).room, rooms: [], preview: null }
          }
          const directory = await api.friendsRoomList()
          return { room: null, rooms: directory.rooms, preview: null }
        })
    }
    let cancelled = false
    void bootstrapRef.current.then(({ room: snapshot, rooms, preview }) => {
      if (cancelled) return
      setInvitePreview(preview)
      setRoomDirectory(snapshot ? null : rooms)
      queryClient.setQueryData(queryKeys.friendsRooms, { rooms })
      setLoading(false)
      if (!snapshot) return
      roomRef.current = snapshot
      setRoom(snapshot)
      const url = new URL(window.location.href)
      if (url.searchParams.get('room') !== snapshot.code) {
        url.searchParams.set('room', snapshot.code)
      }
      url.searchParams.delete('mode')
      url.searchParams.delete('new')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.friendsRooms })
    }).catch((reason) => {
      if (cancelled) return
      setError(errorText(reason))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [queryClient])

  useEffect(() => {
    if (!room?.id) return
    let source: EventSource | null = null
    let poll: number | null = null
    const refresh = async () => {
      try { applyIncomingRoom((await api.friendsRoomSnapshot(room.id)).room) } catch { /* SSE will retry as well. */ }
    }
    const startPolling = () => {
      if (poll != null) return
      poll = window.setInterval(() => void refresh(), 5_000)
    }
    try {
      source = new EventSource(friendsRoomEventsUrl(room.id), { withCredentials: true })
      source.onopen = () => {
        setConnection('connected')
        if (poll != null) { window.clearInterval(poll); poll = null }
      }
      source.onerror = () => {
        setConnection(navigator.onLine ? 'reconnecting' : 'offline')
        startPolling()
      }
      source.addEventListener('room.snapshot', (event) => {
        applyIncomingRoom(JSON.parse((event as MessageEvent).data) as FriendsRoomSnapshot)
        setConnection('connected')
      })
      source.addEventListener('room.error', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { message?: string }
        setError(payload.message || 'Комната потеряла связь с сервером')
      })
    } catch {
      setConnection('reconnecting')
      startPolling()
    }
    const online = () => { setConnection('reconnecting'); void refresh() }
    const offline = () => setConnection('offline')
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      source?.close()
      if (poll != null) window.clearInterval(poll)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [applyIncomingRoom, room?.id])

  useEffect(() => {
    if (room?.phase !== 'active' && room?.phase !== 'countdown') return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [room?.phase])

  useEffect(() => {
    if (room?.phase === 'countdown' || room?.phase === 'active') {
      setAnswer('')
      setAnswerItemId(undefined)
    }
  }, [room?.currentRound, room?.phase])

  useEffect(() => {
    if (!room || room.phase !== 'intermission') return
    const key = `${room.id}:${room.currentRound}`
    if (intermissionEventRef.current === key) return
    intermissionEventRef.current = key
    trackClientEvent('friends_room_block_completed', {
      roomId: room.id,
      roundsCompleted: room.currentRound,
      rulesVersion: room.rulesVersion,
    })
    trackClientEvent('friends_room_intermission_view', {
      roomId: room.id,
      roundsCompleted: room.currentRound,
      required: room.continuation.cost,
      balance: room.continuation.balance,
      shortage: room.continuation.shortage,
      hasClub: room.continuation.accessSource === 'club',
      rulesVersion: room.rulesVersion,
    })
  }, [room])

  const run = useCallback(async (action: () => Promise<{ room: FriendsRoomSnapshot }>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const next = (await action()).room
      roomRef.current = next
      setRoom(next)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [busy])

  const copyInvite = async () => {
    if (!room) return
    const url = new URL('/games/together', window.location.origin)
    url.searchParams.set('room', room.code)
    await navigator.clipboard?.writeText(url.toString())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }

  const createNewRoom = async (gameTypeOverride?: FriendsRoomGameType) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const identity = await ensureServerSession()
      if (identity.user.isAnonymous) {
        window.location.assign(friendsRoomRegistrationHref('/games/together?new=1'))
        return
      }
      const snapshot = (await api.friendsRoomCreate({ gameType: gameTypeOverride ?? room?.gameType ?? 'quiz' })).room
      trackClientEvent('friends_room_created', { roomId: snapshot.id, gameType: snapshot.gameType, rulesVersion: snapshot.rulesVersion })
      setRoom(snapshot)
      setRoomDirectory(null)
      setInvitePreview(null)
      roomRef.current = snapshot
      setAnswer('')
      setAnswerItemId(undefined)
      const url = new URL(window.location.href)
      url.searchParams.set('room', snapshot.code)
      url.searchParams.delete('new')
      url.searchParams.delete('mode')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.friendsRooms })
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const openExistingRoom = async (summary: FriendsRoomSummary) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const identity = await ensureServerSession()
      const snapshot = (await api.friendsRoomJoin(summary.code)).room
      setAnonymousUser(identity.user.isAnonymous)
      if (identity.user.isAnonymous) {
        trackClientEvent('friends_room_guest_joined', { roomId: snapshot.id, roomMode: snapshot.gameType, rulesVersion: snapshot.rulesVersion })
      }
      roomRef.current = snapshot
      setRoom(snapshot)
      setRoomDirectory(null)
      setInvitePreview(null)
      const url = new URL(window.location.href)
      url.searchParams.set('room', snapshot.code)
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.friendsRooms })
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const joinInvitedRoom = async () => {
    if (!invitePreview || busy) return
    setBusy(true)
    setError('')
    try {
      const identity = await ensureServerSession()
      const snapshot = (await api.friendsRoomJoin(invitePreview.code)).room
      setAnonymousUser(identity.user.isAnonymous)
      if (identity.user.isAnonymous) {
        trackClientEvent('friends_room_guest_joined', { roomId: snapshot.id, roomMode: snapshot.gameType, rulesVersion: snapshot.rulesVersion })
      }
      roomRef.current = snapshot
      setRoom(snapshot)
      setRoomDirectory(null)
      setInvitePreview(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.friendsRooms })
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const leaveCurrentRoom = useCallback(async () => {
    const current = roomRef.current
    if (!current || busy) {
      if (!current) onExit()
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.friendsRoomLeave(current.id, idempotencyKey())
      roomRef.current = null
      setRoom(null)
      setRoomDirectory([])
      setInvitePreview(null)
      queryClient.setQueryData(queryKeys.friendsRooms, { rooms: [] })
      await queryClient.invalidateQueries({ queryKey: queryKeys.friendsRooms })
      onExit()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [busy, onExit, queryClient])

  const leaveDirectoryRoom = async (roomId: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.friendsRoomLeave(roomId, idempotencyKey())
      setRoomDirectory((items) => items?.filter((item) => item.id !== roomId) ?? [])
      void queryClient.invalidateQueries({ queryKey: queryKeys.friendsRooms })
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const updateConfig = useCallback((input: FriendsRoomConfigBody) => {
    const snapshot = roomRef.current
    if (!snapshot?.isHost || snapshot.phase !== 'lobby') return
    const mutation = ++configMutationRef.current
    configDraftRef.current = { ...configDraftRef.current, ...input }
    const optimistic = withConfigDraft(snapshot, input)
    roomRef.current = optimistic
    setRoom(optimistic)
    setConfigSaving(true)
    setError('')

    const execute = async () => {
      try {
        const response = await api.friendsRoomConfigure(snapshot.id, input)
        if (mutation === configMutationRef.current) {
          configDraftRef.current = {}
          roomRef.current = response.room
          setRoom(response.room)
          setConfigSaving(false)
        }
      } catch (reason) {
        if (mutation !== configMutationRef.current) return
        configDraftRef.current = {}
        setError(errorText(reason))
        setConfigSaving(false)
        try {
          const fresh = (await api.friendsRoomSnapshot(snapshot.id)).room
          roomRef.current = fresh
          setRoom(fresh)
        } catch { /* Keep the optimistic room visible while realtime reconnects. */ }
      }
    }
    configQueueRef.current = configQueueRef.current.then(execute, execute)
  }, [])
  const submitAnswer = (event: FormEvent) => {
    event.preventDefault()
    if (!room || !answer.trim()) return
    void run(() => api.friendsRoomAnswer(room.id, answer.trim(), idempotencyKey(), answerItemId))
  }
  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (!room || !message.trim() || messageSending) return
    const text = message.trim()
    setMessageSending(true)
    setError('')
    void api.friendsRoomMessage(room.id, text, idempotencyKey()).then((response) => {
      roomRef.current = response.room
      setRoom(response.room)
      setMessage((current) => current.trim() === text ? '' : current)
    }).catch((reason) => {
      setError(errorText(reason))
    }).finally(() => {
      setMessageSending(false)
    })
  }

  const currentMode = room?.round?.mode ?? room?.packs[0]?.mode ?? room?.mode
  const mode = MODES.find((entry) => entry.id === currentMode) ?? MODES[0]
  const members = room ? activeMembers(room) : []
  const currentMember = room?.members.find((member) => member.userId === room.currentUserId)
  const ranked = useMemo(() => [...members].sort((left, right) => right.score - left.score || left.joinedAt.localeCompare(right.joinedAt)), [members])
  const timeLeft = friendsRoomTimeLeft({
    endsAt: room?.round?.endsAt,
    clientNow: now,
    serverTime: room?.serverTime,
    maximum: room?.phase === 'countdown' ? 3 : room?.phase === 'active' ? room.answerTimeSeconds : 0,
  })

  const pageAccent = room?.gameType === 'danetki' ? DANETKI_MODE.color : room?.phase === 'lobby' ? 'var(--mode-series-brand)' : mode.color

  if (room?.gameType === 'danetki' && room.danetkiSessionId) {
    return <TogetherDanetkiGame
      room={room}
      navigation={navigation}
      onExit={onExit}
      onLeaveRoom={leaveCurrentRoom}
      busy={busy}
      message={message}
      onMessage={setMessage}
      onSend={sendMessage}
    />
  }

  return <div className="friends-room-page" style={{ '--room-accent': pageAccent } as CSSProperties}>
    <AppHeader {...navigation} onHome={onExit} onCreateRoom={() => void createNewRoom()} />
    <GameScreenShell
      variant="session"
      wide
      className="game-shell friends-room"
      onBack={onExit}
      backLabel="Вернуться к играм"
      status={error && !room && !roomDirectory && !invitePreview
        ? <span className="room-connection room-connection--offline"><AlertTriangle />Комната недоступна</span>
        : invitePreview
        ? <span className="room-connection room-connection--connected"><RoomIcon name="users" />Приглашение в комнату</span>
        : roomDirectory
        ? <span className="room-connection room-connection--connected"><RoomIcon name="trophy" />{roomDirectory.length ? 'Текущая комната' : 'Комната не создана'}</span>
        : <span className={`room-connection room-connection--${connection}`}><RoomIcon name="trophy" />{connection === 'connected' ? 'Онлайн-комната · на связи' : connection === 'offline' ? 'Онлайн-комната · нет сети' : 'Онлайн-комната · подключаемся'}</span>}
    >
      {error && (room || roomDirectory || invitePreview) && <InlineAlert tone="danger" className="room-alert" onDismiss={() => setError('')}>{error}</InlineAlert>}
      {loading && <RoomLoading />}
      {!loading && !room && invitePreview && <RoomInvitePreview preview={invitePreview} busy={busy} onJoin={() => void joinInvitedRoom()} onDecline={onExit} />}
      {!loading && !room && !invitePreview && roomDirectory && <RoomDirectory rooms={roomDirectory} busy={busy} onOpen={(summary) => void openExistingRoom(summary)} onLeave={(roomId) => void leaveDirectoryRoom(roomId)} onCreate={(gameType) => void createNewRoom(gameType)} />}
      {!loading && !room && !invitePreview && !roomDirectory && <RoomError onRetry={() => window.location.reload()} onExit={onExit} />}
      {room?.phase === 'lobby' && <Lobby room={room} mode={mode} members={members} copied={copied} busy={busy} messageSending={messageSending} configSaving={configSaving} danetkiGroupCost={room.danetkiLaunchCost} ticketBalance={ticketBalance} message={message} onMessage={setMessage} onSend={sendMessage} onGameType={(gameType, selectedMode) => updateConfig({
        gameType,
        ...(selectedMode ? { packs: [{ mode: selectedMode, variant: FRIENDS_ROOM_DEFAULT_PACK_VARIANTS[selectedMode] }] } : {}),
      })} onPacks={(packs) => updateConfig({ gameType: 'quiz', packs, ...(room.roundsTotal < packs.length ? { roundsTotal: friendsRoomMinimumRounds(packs.length) } : {}) })} onRounds={(value) => updateConfig({ roundsTotal: value })} onTime={(value) => updateConfig({ answerTimeSeconds: value })} onShuffle={() => updateConfig({ shufflePacks: !room.shufflePacks })} onCopy={copyInvite} onStart={() => void run(async () => {
        const response = await api.friendsRoomStart(room.id, idempotencyKey())
        const quote = room.continuation
        trackClientEvent('friends_room_started', { roomId: room.id, cost: quote?.cost ?? 0, accessSource: quote?.accessSource ?? 'free', rulesVersion: room.rulesVersion ?? 4 })
        if (quote?.accessSource === 'free') {
          trackClientEvent('friends_room_free_block_started', { roomId: room.id, roundsAdded: 6, rulesVersion: room.rulesVersion ?? 4 })
        }
        if ((quote?.cost ?? 0) > 0) trackClientEvent('ticket_spent', { sink: 'friends-room', amount: quote!.cost, roomId: room.id, rulesVersion: room.rulesVersion ?? 4 })
        return response
      })} />}
      {room?.phase === 'countdown' && <CountdownLayout room={room} ranked={ranked} value={Math.max(1, timeLeft)} message={message} messageSending={messageSending} onMessage={setMessage} onSend={sendMessage} />}
      {room && (room.phase === 'active' || room.phase === 'results') && <GameLayout room={room} mode={mode} ranked={ranked} timeLeft={timeLeft} answer={answer} message={message} busy={busy} messageSending={messageSending} submitted={Boolean(currentMember?.answered)} onAnswer={(value, itemId) => { setAnswer(value); setAnswerItemId(itemId) }} onSubmit={submitAnswer} onMessage={setMessage} onSend={sendMessage} onReveal={() => void run(() => api.friendsRoomReveal(room.id, idempotencyKey()))} onNext={() => void run(() => api.friendsRoomNext(room.id, idempotencyKey()))} />}
      {room?.phase === 'intermission' && <IntermissionScreen room={room} players={ranked} busy={busy} onContinue={() => void run(async () => {
        trackClientEvent('friends_room_continue_clicked', { roomId: room.id, required: room.continuation.cost, balance: room.continuation.balance, shortage: room.continuation.shortage, roundsAdded: room.continuation.roundsAdded, rulesVersion: room.rulesVersion })
        const response = await api.friendsRoomContinue(room.id, idempotencyKey())
        trackClientEvent('friends_room_continued', { roomId: room.id, cost: room.continuation.cost, accessSource: room.continuation.accessSource, nextRoundsTotal: room.continuation.nextRoundsTotal, rulesVersion: room.rulesVersion })
        if (room.continuation.cost > 0) trackClientEvent('ticket_spent', { sink: 'friends-room', amount: room.continuation.cost, roomId: room.id, rulesVersion: room.rulesVersion })
        return response
      })} onExit={() => {
        trackClientEvent('friends_room_ended_at_intermission', { roomId: room.id, roundsCompleted: room.currentRound, rulesVersion: room.rulesVersion })
        void leaveCurrentRoom()
      }} />}
      {room?.phase === 'finished' && <FinalScreen room={room} players={ranked} busy={busy} anonymousUser={anonymousUser} onAgain={() => void run(() => api.friendsRoomRestart(room.id, idempotencyKey()))} onExit={() => void leaveCurrentRoom()} />}
    </GameScreenShell>
  </div>
}

function TogetherDanetkiGame({ room, navigation, onExit, onLeaveRoom, busy, message, onMessage, onSend }: {
  room: FriendsRoomSnapshot
  navigation: AppHeaderProps
  onExit: () => void
  onLeaveRoom: () => Promise<void>
  busy: boolean
  message: string
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
}) {
  const sessionId = room.danetkiSessionId!
  const client = useQueryClient()
  const session = useQuery<GameResponse>({
    queryKey: queryKeys.game(sessionId),
    queryFn: () => api.game(sessionId),
    retry: 1,
  })
  const [connection, setConnection] = useState<'connected' | 'reconnecting' | 'offline'>('reconnecting')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<'guess' | 'hint' | 'surrender' | null>(null)
  const [guess, setGuess] = useState('')
  const protocolRef = useRef<HTMLDivElement>(null)
  const sendKey = useRef<string | null>(null)

  const refresh = useCallback(
    () => client.invalidateQueries({ queryKey: queryKeys.game(sessionId) }),
    [client, sessionId],
  )

  useEffect(() => {
    let source: EventSource | null = null
    let poll: number | null = null
    const startPolling = () => {
      if (poll != null) return
      poll = window.setInterval(() => void refresh(), 5_000)
    }
    try {
      source = new EventSource(danetkiEventsUrl(sessionId), { withCredentials: true })
      source.onopen = () => {
        setConnection('connected')
        if (poll != null) { window.clearInterval(poll); poll = null }
      }
      source.onerror = () => {
        setConnection(navigator.onLine ? 'reconnecting' : 'offline')
        startPolling()
      }
      source.addEventListener('session.snapshot', (event) => {
        const next = JSON.parse((event as MessageEvent).data) as GameSessionSnapshot
        client.setQueryData<GameResponse>(queryKeys.game(sessionId), { session: next })
        setConnection('connected')
      })
      for (const eventName of ['message.created', 'ai.status', 'session.finished', 'member.joined', 'member.left']) {
        source.addEventListener(eventName, () => void refresh())
      }
    } catch {
      setConnection('offline')
      startPolling()
    }
    return () => {
      source?.close()
      if (poll != null) window.clearInterval(poll)
    }
  }, [client, refresh, sessionId])

  const game = session.data?.session
  const state = game?.danetki
  const messageCount = state?.messages.length ?? 0
  useEffect(() => {
    protocolRef.current?.scrollTo({ top: protocolRef.current.scrollHeight, behavior: 'smooth' })
  }, [messageCount])
  useEffect(() => {
    if (!game || game.status === 'playing') return
    void client.invalidateQueries({ queryKey: queryKeys.friendsRooms })
  }, [client, game?.status])

  const sendQuestion = useMutation({
    mutationFn: ({ text, key }: { text: string; key: string }) => api.danetkiMessage(sessionId, text, key),
    onSuccess: async () => {
      sendKey.current = null
      setDraft('')
      setError('')
      await refresh()
    },
    onError: (reason) => setError(errorText(reason)),
  })
  const hint = useMutation({
    mutationFn: () => api.danetkiHint(sessionId, idempotencyKey()),
    onSuccess: async () => { setDialog(null); await refresh() },
    onError: (reason) => setError(errorText(reason)),
  })
  const finalGuess = useMutation({
    mutationFn: () => api.danetkiGuess(sessionId, guess, idempotencyKey()),
    onSuccess: async () => { setDialog(null); setGuess(''); await refresh() },
    onError: (reason) => setError(errorText(reason)),
  })
  const surrender = useMutation({
    mutationFn: () => api.danetkiSurrender(sessionId, idempotencyKey()),
    onSuccess: async () => { setDialog(null); await refresh() },
    onError: (reason) => setError(errorText(reason)),
  })

  const exit = useCallback(() => onExit(), [onExit])

  if (!game || !state) {
    return <div className="friends-room-page" style={{ '--room-accent': DANETKI_MODE.color } as CSSProperties}>
      <AppHeader {...navigation} onHome={exit} />
      <GameScreenShell variant="session" wide className="game-shell friends-room" onBack={exit} backLabel="Вернуться к играм">
        {session.isError
          ? <RoomError onRetry={() => void session.refetch()} onExit={() => void exit()} />
          : <RoomLoading />}
      </GameScreenShell>
    </div>
  }

  const players = state.members.filter((member) => !member.leftAt)
  const currentTurn = players.find((member) => member.userId === state.currentTurnUserId)
  const isMyTurn = state.currentTurnUserId === state.currentUserId
  const gameFinished = game.status !== 'playing'
  const resolvingGuess = game.status === 'won'
    ? [...state.messages].reverse().find((entry) => entry.messageType === 'guess' && entry.senderUserId)
    : null
  const resolvedBy = resolvingGuess?.senderUserId
    ? state.members.find((member) => member.userId === resolvingGuess.senderUserId) ?? null
    : null
  const hostReady = state.aiStatus !== 'queued' && state.aiStatus !== 'processing'
  const canAsk = game.status === 'playing' && state.questionsRemaining > 0 && isMyTurn && hostReady
  const hostStatus = gameFinished
    ? 'Сеанс завершён'
    : connection === 'offline'
    ? 'Ведущий не в сети'
    : connection === 'reconnecting'
      ? 'Восстанавливаем связь'
      : state.aiStatus === 'processing' || state.aiStatus === 'queued'
        ? 'Ведущий думает…'
        : state.aiStatus === 'error'
          ? 'Ведущий временно недоступен'
          : 'Ведущий на связи'
  const difficulty = state.puzzle.difficulty === 'easy' ? 'лёгкое' : state.puzzle.difficulty === 'hard' ? 'сложное' : 'среднее'
  const caseNumber = (state.puzzle.id.match(/\d+/g)?.join('') ?? game.puzzleDate.replace(/\D/g, '')).slice(-3).padStart(3, '0')
  const submitQuestion = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!canAsk || text.length < 2 || sendQuestion.isPending) return
    const key = sendKey.current ?? idempotencyKey()
    sendKey.current = key
    sendQuestion.mutate({ text, key })
  }

  return <div className="friends-room-page friends-room-page--danetki" style={{ '--room-accent': DANETKI_MODE.color } as CSSProperties}>
    <AppHeader {...navigation} onHome={exit} />
    <GameScreenShell
      variant="session"
      wide
      className="game-shell friends-room"
      onBack={exit}
      backLabel="Вернуться к играм"
      status={<span className={`room-connection room-connection--${gameFinished ? 'connected' : connection}`}><Popcorn />{gameFinished ? 'Онлайн-комната · дело закрыто' : connection === 'connected' ? 'Онлайн-комната · сеанс идёт' : connection === 'offline' ? 'Онлайн-комната · нет сети' : 'Онлайн-комната · подключаемся'}</span>}
    >
      {error && <InlineAlert tone="danger" className="room-alert" onDismiss={() => setError('')}>{error}</InlineAlert>}
      <div className="friends-room__columns friends-room__columns--danetki">
        <aside className="room-left-rail">
          <section className="room-panel room-panel--code">
            <span>Комната</span>
            <strong>{room.code}</strong>
            <small><RoomIcon name="users" /> {players.length} из {state.capacity} игроков</small>
            <p className="room-panel--code__finished"><RoomIcon name={gameFinished ? 'check' : 'play'} />{gameFinished ? 'Сеанс завершён' : 'Игра уже началась'}</p>
          </section>
          <section className={`room-panel room-progress room-danetki-progress${gameFinished ? ' is-finished' : ''}`}>
            <span>{gameFinished ? 'Итог расследования' : 'Ход расследования'}</span>
            {gameFinished
              ? <div>
                <strong>{game.status === 'won' ? 'Разгадка найдена' : 'Дело завершено'}</strong>
                <small><HelpCircle /> {state.questionCount} {plural(state.questionCount, 'вопрос', 'вопроса', 'вопросов')}</small>
                <small><Lightbulb /> {state.hintLevel ? `${state.hintLevel} ${plural(state.hintLevel, 'подсказка', 'подсказки', 'подсказок')}` : 'Без подсказок'}</small>
              </div>
              : <div>
                <strong>{state.questionCount} из {state.questionLimit} вопросов</strong>
                <small><HelpCircle /> Осталось <b>{state.questionsRemaining}</b></small>
                <small><Lightbulb /> Подсказки <b>{state.hintLevel}/3</b></small>
                <small><RoomIcon name="play" /> {isMyTurn ? 'Сейчас ваш ход' : `Ход: ${currentTurn?.displayName ?? '—'}`}</small>
              </div>}
          </section>
          <Chat room={room} message={message} busy={busy} onMessage={onMessage} onSend={onSend} />
        </aside>

        <section className="friends-room__stage room-cinema">
          <article className={`room-projector${game.status !== 'playing' ? ' is-finished' : ''}`}>
            <header className="room-projector__header">
              <div><span>Игра с друзьями · дело №{caseNumber}</span><h1>Данетки</h1></div>
              <div className={`room-projector__host is-${state.aiStatus}`}><i /><span><strong>{hostStatus}</strong><small>{difficulty} дело</small></span>{state.aiStatus === 'error' && <ActionButton surface="paper" variant="secondary" type="button" aria-label="Повторить запрос к ведущему" onClick={() => void api.danetkiRetryAi(sessionId, idempotencyKey()).then(() => refresh()).catch((reason) => setError(errorText(reason)))}><RefreshCw /></ActionButton>}</div>
            </header>

            <section className="room-projector__case">
              <span>Условие</span>
              <h2>{state.puzzle.titleRu}</h2>
              <p>{state.puzzle.condition}</p>
              <small>На экране у всех одна история. Ведущий отвечает только «да», «нет» или просит уточнить вопрос.</small>
            </section>

            {game.status === 'playing' ? <>
              <section className="room-projector__protocol">
                <header><span>Протокол на экране</span><small>{state.questionCount} {plural(state.questionCount, 'вопрос', 'вопроса', 'вопросов')}</small></header>
                <div ref={protocolRef} role="log" aria-live="polite">
                  {!state.messages.length && <div className="room-projector__empty"><Sparkles /><p>Расследование началось. Первый вопрос задаёт {currentTurn?.displayName ?? 'создатель комнаты'}.</p></div>}
                  {state.messages.map((entry) => {
                    if (entry.senderKind === 'system') return <div className="room-projector__system" key={entry.id}><span>{entry.text}</span><time>{localTime(entry.createdAt)}</time></div>
                    const sender = entry.senderUserId ? players.find((member) => member.userId === entry.senderUserId) : null
                    const isHost = entry.senderKind === 'ai'
                    return <article className={isHost ? 'is-host' : 'is-player'} key={entry.id}>
                      <i style={{ '--avatar': isHost ? DANETKI_MODE.color : colorByKey[sender?.colorKey ?? ''] ?? 'var(--mode-series-brand)' } as CSSProperties}>{isHost ? '?' : initials(entry.senderName ?? sender?.displayName ?? 'Игрок')}</i>
                      <div><strong>{isHost ? 'Ведущий' : entry.senderName ?? sender?.displayName ?? 'Игрок'}</strong><p>{entry.text}</p><time>{localTime(entry.createdAt)}</time></div>
                    </article>
                  })}
                  {sendQuestion.isPending && sendQuestion.variables && <article className="is-player is-pending"><i>В</i><div><strong>Вы</strong><p>{sendQuestion.variables.text}</p><time>отправляем…</time></div></article>}
                  {!hostReady && <div className="room-projector__typing"><LoaderCircle /> Ведущий обдумывает вопрос</div>}
                </div>
              </section>
              {!state.messages.length && isMyTurn && <div className="room-projector__starters"><span>Можно начать так</span><div>{state.puzzle.starterQuestions.slice(0, 3).map((question) => <ActionButton surface="paper" variant="secondary" type="button" key={question} onClick={() => setDraft(question)}>{question}</ActionButton>)}</div></div>}
              <form className="room-projector__composer" onSubmit={submitQuestion}>
                <TextArea surface="paper" aria-label="Вопрос ведущему" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={300} rows={1} disabled={!canAsk} placeholder={state.questionsRemaining <= 0 ? 'Лимит вопросов исчерпан' : !isMyTurn ? `Сейчас спрашивает ${currentTurn?.displayName ?? 'другой игрок'}` : !hostReady ? 'Дождитесь ответа ведущего…' : 'Задайте вопрос ведущему…'} />
                <ActionButton className="room-projector__send" type="submit" disabled={!canAsk || draft.trim().length < 2 || sendQuestion.isPending} aria-label="Отправить вопрос"><Send /></ActionButton>
              </form>
              <footer className="room-projector__actions">
                <span className={isMyTurn ? 'is-current' : ''}>{isMyTurn ? 'Ваш вопрос увидят все участники' : 'Ответ ведущего появится на общем экране'}</span>
                <div><ActionButton surface="paper" variant="hint" type="button" onClick={() => setDialog('hint')} disabled={state.hintLevel >= 3}><Lightbulb /> Подсказка {state.hintLevel}/3</ActionButton><ActionButton surface="paper" type="button" onClick={() => setDialog('guess')}><Check /> Я знаю разгадку</ActionButton><ActionButton surface="paper" variant="ghost" type="button" onClick={() => setDialog('surrender')}><DoorOpen /> Сдаться</ActionButton></div>
              </footer>
            </> : <section className="room-projector__outcome">
              <div className="room-projector__outcome-lead">
                <span><Check /> Дело закрыто</span>
                <h2>{game.status === 'won' ? 'Версия подтверждена' : 'Разгадка открыта'}</h2>
                <p>{game.status === 'won' && resolvedBy
                  ? `Версия игрока ${resolvedBy.displayName} подтвердилась — команда раскрыла историю.`
                  : 'Расследование завершено. Настоящая история теперь открыта всей комнате.'}</p>
              </div>
              <div className="room-projector__solution">
                <span>Настоящая разгадка</span>
                <p>{state.solution}</p>
              </div>
              <div className="room-projector__outcome-stats">
                <span><strong>{state.questionCount}</strong><small>{plural(state.questionCount, 'вопрос', 'вопроса', 'вопросов')}</small></span>
                <span><strong>{state.hintLevel}</strong><small>{plural(state.hintLevel, 'подсказка', 'подсказки', 'подсказок')}</small></span>
                <span><strong>{players.length}</strong><small>{plural(players.length, 'участник', 'участника', 'участников')}</small></span>
              </div>
              <footer>
                <p>Остальные смогут дочитать результат. После выхода эта комната исчезнет из вашего списка.</p>
                <ActionButton type="button" onClick={() => void onLeaveRoom()} disabled={busy}><DoorOpen />{busy ? 'Выходим…' : 'Покинуть комнату'}</ActionButton>
              </footer>
            </section>}
          </article>
        </section>

        <aside className="room-right-rail room-right-rail--danetki">
          <DanetkiParticipants
            players={players}
            capacity={state.capacity}
            currentUserId={state.currentUserId}
            currentTurnUserId={state.currentTurnUserId}
            finished={gameFinished}
            resolvedByUserId={resolvedBy?.userId ?? null}
          />
          <section className={`room-panel room-ai-host is-${gameFinished ? 'finished' : state.aiStatus}`}><span>{gameFinished ? 'Общий экран' : 'Ведущий'}</span><div><i /><strong>{hostStatus}</strong><small>{gameFinished ? 'Результат останется доступен, пока вы в комнате' : 'Отвечает на вопросы с общего экрана'}</small></div></section>
        </aside>
      </div>
    </GameScreenShell>

    {dialog && <DialogSurface backdropClassName="room-danetki-dialog-backdrop" className="room-danetki-dialog" onClose={() => setDialog(null)} ariaLabelledBy="room-danetki-dialog-title">
      {dialog === 'guess' && <><h2 id="room-danetki-dialog-title">Ваша разгадка</h2><p>Опишите всю причинно-следственную связь. Версию увидят все участники.</p><TextArea surface="dark" aria-label="Полная версия разгадки" rows={7} maxLength={1500} value={guess} onChange={(event) => setGuess(event.target.value)} autoFocus /><p className={guess.trim().length >= 20 ? 'room-danetki-dialog__meta is-ready' : 'room-danetki-dialog__meta'}>{guess.trim().length < 20 ? `Добавьте ещё ${20 - guess.trim().length} ${plural(20 - guess.trim().length, 'символ', 'символа', 'символов')}` : `${guess.trim().length} из 1500 символов · можно проверять`}</p><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Отмена</ActionButton><ActionButton disabled={guess.trim().length < 20 || finalGuess.isPending} onClick={() => finalGuess.mutate()}>{finalGuess.isPending ? 'Проверяем…' : 'Проверить версию'}</ActionButton></div></>}
      {dialog === 'hint' && <><h2 id="room-danetki-dialog-title">Открыть подсказку?</h2><p>Она появится на общем экране у всех участников. Уровень подсказок станет {Math.min(3, state.hintLevel + 1)} из 3; билеты дополнительно не списываются.</p><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Отмена</ActionButton><ActionButton disabled={hint.isPending} onClick={() => hint.mutate()}>Показать подсказку</ActionButton></div></>}
      {dialog === 'surrender' && <><h2 id="room-danetki-dialog-title">Завершить расследование?</h2><p>Ваш голос будет учтён. Для сдачи нужны голоса всех активных участников.</p><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Продолжить игру</ActionButton><ActionButton variant="danger" disabled={surrender.isPending} onClick={() => surrender.mutate()}>Сдаться</ActionButton></div></>}
    </DialogSurface>}
  </div>
}

type DanetkiParticipant = NonNullable<GameSessionSnapshot['danetki']>['members'][number]

function DanetkiParticipants({ players, capacity, currentUserId, currentTurnUserId, finished, resolvedByUserId }: {
  players: DanetkiParticipant[]
  capacity: number
  currentUserId: string
  currentTurnUserId: string | null
  finished: boolean
  resolvedByUserId: string | null
}) {
  const currentIndex = players.findIndex((player) => player.userId === currentTurnUserId)
  const currentPlayer = currentIndex >= 0 ? players[currentIndex] : null

  return <section className={`room-panel room-participants${finished ? ' is-finished' : ''}`}>
    <header>
      <div><span>Участники</span><strong>{players.length} из {capacity}</strong></div>
      <p className={finished || currentTurnUserId === currentUserId ? 'is-you' : ''}>
        <RoomIcon name={finished ? 'check' : 'play'} />
        {finished ? 'Расследование завершено' : currentTurnUserId === currentUserId ? 'Ваш ход' : currentPlayer ? `Ходит ${currentPlayer.displayName}` : 'Ожидаем ход'}
      </p>
    </header>
    <div className="room-participants__list" role="list">
      {players.map((player, index) => {
        const isCurrent = player.userId === currentTurnUserId
        const distance = currentIndex < 0 ? index + 1 : (index - currentIndex + players.length) % players.length
        const status = finished
          ? player.userId === resolvedByUserId ? 'Разгадал' : 'Участвовал'
          : isCurrent ? 'Задаёт вопрос' : distance === 1 ? 'Следующий' : 'Ожидает'
        return <article className={!finished && isCurrent ? 'is-current' : player.userId === resolvedByUserId ? 'is-resolver' : ''} key={player.userId} role="listitem">
          <i className="room-participants__avatar" style={{ '--avatar': colorByKey[player.colorKey] ?? 'var(--mode-movie-brand)' } as CSSProperties}>{initials(player.displayName)}</i>
          <span className="room-participants__identity">
            <strong><b>{player.displayName}</b>{player.userId === currentUserId && <em>Вы</em>}</strong>
            <small>{player.role === 'owner'
              ? <><RoomIcon name="trophy" /> Создатель комнаты</>
              : finished ? 'Участник расследования' : `В очереди · №${index + 1}`}</small>
          </span>
          <span className="room-participants__status">{(finished ? player.userId === resolvedByUserId : isCurrent) && <RoomIcon name={finished ? 'check' : 'play'} />}<small>{status}</small></span>
        </article>
      })}
    </div>
  </section>
}

function RoomDirectory({ rooms, busy, onOpen, onLeave, onCreate }: {
  rooms: FriendsRoomSummary[]
  busy: boolean
  onOpen: (room: FriendsRoomSummary) => void
  onLeave: (roomId: string) => void
  onCreate: (gameType: FriendsRoomGameType) => void
}) {
  const room = rooms[0]
  const presentation = room?.gameType === 'danetki'
    ? DANETKI_MODE
    : room
      ? MODES.find((entry) => entry.id === (room.packs[0]?.mode ?? room.mode)) ?? MODES[0]
      : null
  const progress = room && (room.phase === 'active' || room.phase === 'results')
    ? `Раунд ${room.currentRound} из ${room.roundsTotal}`
    : room
      ? friendsRoomPhaseLabel(room.phase)
      : ''
  return <section className="room-directory">
    <header className="room-directory__heading">
      <div>
        <span className="room-kicker">Игра с друзьями · онлайн-комната</span>
        <h1>{room ? 'Вернуться в комнату' : 'Создать комнату'}</h1>
        <p>{room
          ? 'Комната остаётся открытой, когда вы уходите на другую страницу. Вернитесь в игру или покиньте её, чтобы создать новую.'
          : 'Открытых комнат пока нет. Создайте лобби, выберите игру и пригласите друзей.'}</p>
      </div>
    </header>
    {room && presentation && <div className="room-directory__list">
      <article className={`room-directory-card is-${room.gameType}`}>
          <div className="room-directory-card__poster">
            <img src={publicAssetUrl(presentation.poster)} alt="" />
            <span>{room.gameType === 'danetki' ? 'Расследование' : 'Комната'}</span>
          </div>
          <div className="room-directory-card__body">
            <span>{room.isHost ? 'Вы ведущий' : 'Вы игрок'} · {room.code}</span>
            <h2>{friendsRoomSummaryTitle(room)}</h2>
            <p>{progress}</p>
            <small><RoomIcon name="users" /> {room.players} из {room.capacity} игроков</small>
          </div>
          <div className="room-directory-card__actions">
            <ControlButton type="button" onClick={() => onOpen(room)} disabled={busy}>{friendsRoomActionLabel(room)}</ControlButton>
            <ControlButton type="button" onClick={() => onLeave(room.id)} disabled={busy} title="Комната исчезнет из вашего списка"><DoorOpen />Покинуть</ControlButton>
          </div>
        </article>
    </div>}
    {!room && <footer className="room-directory__create">
      <div><span>Новая встреча</span><strong>Что будет на проекторе?</strong></div>
      <ControlButton type="button" onClick={() => onCreate('quiz')} disabled={busy}><Plus />Создать игровую комнату</ControlButton>
      <ControlButton type="button" onClick={() => onCreate('danetki')} disabled={busy}><HelpCircle />Создать Данетку</ControlButton>
    </footer>}
  </section>
}

function RoomLoading() {
  return <section className="room-state" role="status"><span className="room-state__spinner" /><h1>Готовим комнату</h1><p>Подключаемся к комнате и загружаем игровую сессию.</p></section>
}

function RoomError({ onRetry, onExit }: { onRetry: () => void; onExit: () => void }) {
  return <section className="room-state room-state--error" role="alert"><AlertTriangle /><h1>Комната не открылась</h1><p>Проверьте ссылку или попробуйте создать новую комнату.</p><div><ActionButton type="button" onClick={onRetry}>Повторить</ActionButton><ActionButton variant="secondary" type="button" onClick={onExit}>На главную</ActionButton></div></section>
}

function RoomInvitePreview({ preview, busy, onJoin, onDecline }: {
  preview: FriendsRoomPreview
  busy: boolean
  onJoin: () => void
  onDecline: () => void
}) {
  const presentation = preview.gameType === 'danetki'
    ? DANETKI_MODE
    : MODES.find((entry) => entry.id === (preview.packs[0]?.mode ?? preview.mode)) ?? MODES[0]
  return <section className={`room-invite is-${preview.gameType}`}>
    <div className="room-invite__mark" aria-hidden="true">
      <img src={publicAssetUrl('images/friends-room/friends-ticket-art-v2.webp')} alt="" />
    </div>
    <div className="room-invite__body">
      <span className="room-kicker">Приглашение · комната {preview.code}</span>
      <h1>{preview.hostName} приглашает в {presentation.label}</h1>
      <p>{preview.gameType === 'danetki'
        ? 'Вас ждёт общее расследование: одна история, общий протокол и вопросы ИИ-ведущему по очереди.'
        : 'Вы увидите те же подсказки, что и друзья, и отправите свой ответ одновременно с остальными.'}</p>
      <div className="room-invite__facts">
        <span><RoomIcon name="users" /><strong>{preview.players} из {preview.capacity}</strong><small>уже в комнате</small></span>
        <span><RoomIcon name="timer" /><strong>{friendsRoomPhaseLabel(preview.phase)}</strong><small>состояние комнаты</small></span>
        {preview.gameType === 'danetki' && <span><RoomIcon name="play" /><strong>{preview.danetkiLaunchCost} билетов</strong><small>оплатит создатель</small></span>}
      </div>
      <div className="room-invite__actions">
        <ActionButton type="button" onClick={onJoin} disabled={busy}>{busy ? 'Входим…' : 'Войти в комнату'}</ActionButton>
        <ActionButton type="button" variant="secondary" onClick={onDecline} disabled={busy}>Не сейчас</ActionButton>
      </div>
    </div>
  </section>
}

function Lobby({ room, mode, members, copied, busy, messageSending, configSaving, danetkiGroupCost, ticketBalance, message, onMessage, onSend, onGameType, onPacks, onRounds, onTime, onShuffle, onCopy, onStart }: {
  room: FriendsRoomSnapshot
  mode: (typeof MODES)[number]
  members: FriendsRoomSnapshot['members']
  copied: boolean
  busy: boolean
  messageSending: boolean
  configSaving: boolean
  danetkiGroupCost: number
  ticketBalance: number
  message: string
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
  onGameType: (gameType: FriendsRoomGameType, selectedMode?: PlayableCatalogGuessModeId) => void
  onPacks: (value: FriendsRoomPackSelection[]) => void
  onRounds: (value: number) => void
  onTime: (value: 15 | 20 | 30 | 45) => void
  onShuffle: () => void
  onCopy: () => void
  onStart: () => void
}) {
  const minimumRounds = friendsRoomMinimumRounds(room.packs.length)
  const togglePack = (modeId: PlayableCatalogGuessModeId) => {
    const existing = room.packs.find((pack) => pack.mode === modeId)
    if (existing) {
      if (room.packs.length > 1) onPacks(room.packs.filter((pack) => pack.mode !== modeId))
      return
    }
    onPacks([...room.packs, { mode: modeId, variant: FRIENDS_ROOM_DEFAULT_PACK_VARIANTS[modeId] }])
  }
  const selectVariant = (modeId: PlayableCatalogGuessModeId, variant: string) => {
    onPacks(room.packs.map((pack) => pack.mode === modeId ? { ...pack, variant } : pack))
  }
  const selectMode = (modeId: RoomMode) => {
    if (modeId === 'danetki') {
      if (room.gameType !== 'danetki') onGameType('danetki')
      return
    }
    if (room.gameType === 'danetki') {
      onGameType('quiz', modeId)
      return
    }
    togglePack(modeId)
  }
  const isDanetki = room.gameType === 'danetki'
  const quote = room.continuation ?? {
    canContinue: false,
    roundsAdded: 6,
    nextRoundsTotal: room.roundsTotal,
    accessSource: 'free' as const,
    cost: 0,
    balance: ticketBalance,
    shortage: 0,
  }
  const clubRoom = quote.accessSource === 'club'
  const quizShortage = isDanetki ? 0 : quote.shortage
  return <section className={`room-lobby${isDanetki ? ' is-danetki' : ''}`}>
    <div className="room-lobby__intro">
      <span className="room-kicker">Игра с друзьями · общая онлайн-комната</span>
      <h1>Онлайн-комната</h1>
      <p>{isDanetki
        ? 'Пригласите до трёх друзей. После запуска вы будете вместе раскрывать одну необычную историю и задавать вопросы ИИ-ведущему по очереди.'
        : `Выберите один или несколько паков и правила. В комнате могут играть до ${room.capacity} человек — все одновременно увидят подсказки и отправят по одному ответу.`}</p>
      <div className={`room-code-card${copied ? ' is-copied' : ''}`}><span>Код игры</span><strong>{room.code}</strong><ControlButton type="button" onClick={onCopy} title="Копировать ссылку-приглашение"><RoomIcon name={copied ? 'check' : 'copy'} />{copied ? 'Скопировано' : 'Копировать'}</ControlButton></div>
      <LobbyCommunity room={room} members={members} message={message} busy={messageSending} onMessage={onMessage} onSend={onSend} />
    </div>
    <div className="room-lobby__settings">
      <header className="room-settings-heading"><span>Режим комнаты</span><strong>{isDanetki ? DANETKI_MODE.label : room.packs.length === 1 ? mode.label : packCountLabel(room.packs.length)}</strong></header>
      <fieldset className="room-mode-picker" disabled={!room.isHost}>
        <legend>Во что играем <small>{isDanetki ? 'один режим на комнату' : 'паки можно сочетать'}</small></legend>
        <div>{ROOM_MODES.map((entry) => {
          const order = entry.id === 'danetki'
            ? isDanetki ? 0 : -1
            : isDanetki ? -1 : room.packs.findIndex((pack) => pack.mode === entry.id)
          return <ControlButton key={entry.id} type="button" className={order >= 0 ? 'is-active' : ''} aria-pressed={order >= 0} style={{ '--mode-color': entry.color } as CSSProperties} onClick={() => selectMode(entry.id)}><img src={publicAssetUrl(entry.poster)} alt="" /><span>{entry.label}</span>{order >= 0 && entry.id !== 'danetki' && <em>{order + 1}</em>}</ControlButton>
        })}</div>
      </fieldset>
      {isDanetki ? <DanetkiRoomBrief cost={danetkiGroupCost} ticketBalance={ticketBalance} isHost={room.isHost} ownerName={members.find((member) => member.role === 'owner')?.displayName ?? 'Создатель'} /> : <>
      <div className="room-pack-options">
        {room.packs.map((pack, index) => {
          const packMode = MODES.find((entry) => entry.id === pack.mode) ?? MODES[0]
          const variants = FRIENDS_ROOM_PACK_VARIANTS[pack.mode]
          return <section key={pack.mode} style={{ '--mode-color': packMode.color } as CSSProperties}>
            <header><span>{index + 1}</span><div><strong>{packMode.label}</strong><small>{variants.find((variant) => variant.id === pack.variant)?.description}</small></div></header>
            <div>{variants.map((variant) => <ControlButton type="button" key={variant.id} className={variant.id === pack.variant ? 'is-active' : ''} disabled={!room.isHost} onClick={() => selectVariant(pack.mode, variant.id)}>{variant.label}</ControlButton>)}</div>
          </section>
        })}
      </div>
      <ControlButton className={`room-shuffle${room.shufflePacks ? ' is-active' : ''}`} type="button" aria-pressed={room.shufflePacks} disabled={!room.isHost} onClick={onShuffle}><RoomIcon name="shuffle" /><span><strong>Перемешивать паки</strong><small>{room.shufflePacks ? 'Порядок будет случайным для этой игры' : 'Сейчас паки идут в порядке выбора'}</small></span><em>{room.shufflePacks ? 'Включено' : 'Выключено'}</em></ControlButton>
      <div className="room-rule-grid">
        <fieldset className="room-rounds" disabled={!room.isHost || !clubRoom}><legend>Раундов <output>{room.roundsTotal}</output></legend><TextInput type="range" min={minimumRounds} max={FRIENDS_ROOM_ROUND_MAX} step={FRIENDS_ROOM_ROUND_STEP} value={room.roundsTotal} onChange={(event) => onRounds(Number(event.currentTarget.value))} aria-label="Количество раундов" /><div className="room-rounds__scale" aria-hidden="true"><span>{minimumRounds}</span><span>30</span></div><small>{room.packs.length > 1 ? `Для ${packCountLabel(room.packs.length)} минимум ${minimumRounds} ${plural(minimumRounds, 'раунд', 'раунда', 'раундов')}. ` : ''}{clubRoom ? 'Участникам Клуба доступно до 30 раундов.' : 'Первый блок — 6 раундов. После него можно продолжить.'}</small></fieldset>
        <fieldset disabled={!room.isHost}><legend>Время на ответ</legend><div>{([15, 20, 30, 45] as const).map((value) => <ControlButton type="button" className={room.answerTimeSeconds === value ? 'is-active' : ''} key={value} onClick={() => onTime(value)}>{value} сек</ControlButton>)}</div></fieldset>
      </div>
      </>}
      {room.isHost
        ? <ControlButton className="room-start" type="button" onClick={onStart} disabled={busy || configSaving || (isDanetki ? danetkiGroupCost > ticketBalance : quizShortage > 0)}><RoomIcon name="play" />{busy ? 'Запускаем…' : (isDanetki ? danetkiGroupCost > ticketBalance : quizShortage > 0) ? 'Не хватает билетов' : isDanetki ? 'Начать расследование' : 'Начать игру'}<span>{isDanetki ? `${members.length} из ${room.capacity} · вопросы по очереди` : `${packCountLabel(room.packs.length)} · ${room.roundsTotal} ${plural(room.roundsTotal, 'раунд', 'раунда', 'раундов')} · ${quote.cost ? `${quote.cost} билетов` : 'бесплатно'}`}</span></ControlButton>
        : <div className="room-waiting-host"><RoomIcon name="timer" /><span><strong>Ждём ведущего</strong><small>Настройки и запуск доступны создателю комнаты</small></span></div>}
    </div>
  </section>
}

function DanetkiRoomBrief({ cost, ticketBalance, isHost, ownerName }: { cost: number; ticketBalance: number; isHost: boolean; ownerName: string }) {
  const shortage = isHost ? Math.max(0, cost - ticketBalance) : 0
  return <div className="room-danetki">
    <section className="room-danetki__brief">
      <div><span>Совместный режим</span><h2>Общее расследование</h2><p>ИИ-ведущий отвечает «да», «нет» или просит уточнить вопрос. Условие откроется всем одновременно после старта.</p></div>
    </section>
    <div className="room-danetki__rules">
      <article><RoomIcon name="users" /><span><strong>До 4 игроков</strong><small>У всех одна история и общий протокол</small></span></article>
      <article><RoomIcon name="timer" /><span><strong>Вопросы по очереди</strong><small>Следующий ход передаётся автоматически</small></span></article>
      <article><RoomIcon name="play" /><span><strong>{cost > 0 ? `${cost} ${plural(cost, 'билет', 'билета', 'билетов')}` : 'Без доплаты'}</strong><small>{shortage > 0 ? `Не хватает ${shortage} ${plural(shortage, 'билета', 'билетов', 'билетов')}` : cost === 0 ? 'Списаний при запуске не будет' : isHost ? `При запуске спишется ${cost}` : `${ownerName} оплатит запуск`}</small></span></article>
    </div>
  </div>
}

function LobbyCommunity({ room, members, message, busy, onMessage, onSend }: {
  room: FriendsRoomSnapshot
  members: FriendsRoomSnapshot['members']
  message: string
  busy: boolean
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
}) {
  return <section className="room-lobby-community">
    <header><span>Участники</span><strong>{members.length} из {room.capacity}</strong></header>
    <div className="room-lobby-community__members">
      {members.map((member) => <article key={member.userId}>
        <i style={{ '--avatar': colorByKey[member.colorKey] ?? 'var(--mode-movie-brand)' } as CSSProperties}>{initials(member.displayName)}</i>
        <span><strong>{member.displayName}{member.userId === room.currentUserId && <em>Вы</em>}</strong><small>{member.role === 'owner' ? 'Создатель комнаты' : 'В комнате'}</small></span>
        <b title="Подключён" aria-label="Подключён" />
      </article>)}
    </div>
    <div className="room-lobby-community__chat" role="log" aria-live="polite">
      {room.messages.length
        ? room.messages.slice(-4).map((entry) => <p key={entry.id}><strong>{entry.userId === room.currentUserId ? 'Вы' : entry.displayName}</strong>{entry.text}</p>)
        : <small>Поздоровайтесь, пока друзья собираются.</small>}
    </div>
    <form onSubmit={onSend}>
      <TextInput surface="paper" aria-label="Сообщение в чат" value={message} onChange={(event) => onMessage(event.target.value)} placeholder="Сообщение в комнату…" maxLength={300} />
      <ControlButton type="submit" aria-label="Отправить" disabled={!message.trim() || busy}><RoomIcon name="send" /></ControlButton>
    </form>
  </section>
}

function Countdown({ room, value }: { room: FriendsRoomSnapshot; value: number }) {
  return <section className="room-countdown" aria-live="polite"><span>Раунд {room.currentRound} из {room.roundsTotal}</span><strong>{value}</strong><p>Приготовьтесь</p></section>
}

function CountdownLayout({ room, ranked, value, message, messageSending, onMessage, onSend }: {
  room: FriendsRoomSnapshot
  ranked: FriendsRoomSnapshot['members']
  value: number
  message: string
  messageSending: boolean
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
}) {
  return <div className="friends-room__columns">
    <LeftRail room={room} ranked={ranked} timeLeft={value} message={message} busy={messageSending} onMessage={onMessage} onSend={onSend} />
    <section className="friends-room__stage"><Countdown room={room} value={value} /><ActivityLog room={room} players={ranked} /></section>
    <PlayersPanel room={room} players={ranked} />
  </div>
}

function GameLayout({ room, mode, ranked, timeLeft, answer, message, busy, messageSending, submitted, onAnswer, onSubmit, onMessage, onSend, onReveal, onNext }: {
  room: FriendsRoomSnapshot
  mode: (typeof MODES)[number]
  ranked: FriendsRoomSnapshot['members']
  timeLeft: number
  answer: string
  message: string
  busy: boolean
  messageSending: boolean
  submitted: boolean
  onAnswer: (value: string, itemId?: string) => void
  onSubmit: (event: FormEvent) => void
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
  onReveal: () => void
  onNext: () => void
}) {
  const answeredCount = ranked.filter((player) => player.answered).length
  const allAnswered = ranked.length > 0 && answeredCount === ranked.length
  return <div className="friends-room__columns">
    <LeftRail room={room} ranked={ranked} timeLeft={timeLeft} message={message} busy={messageSending} onMessage={onMessage} onSend={onSend} />
    <section className="friends-room__stage">
      <article className={`room-ticket ${room.phase === 'results' ? 'is-results' : ''}`}>
        <div className="room-ticket__stub"><img src={publicAssetUrl(mode.poster)} alt="" /><span>Вход<br /><strong>один</strong></span><small>№ {String(room.currentRound).padStart(3, '0')}</small></div>
        <div className="room-ticket__body">
          <div className="room-ticket__meta">Игра с друзьями · Раунд №{String(room.currentRound).padStart(3, '0')}</div>
          <h1>{mode.label}</h1>
          {room.phase === 'results'
            ? <Results room={room} mode={mode} isHost={room.isHost} busy={busy} onNext={onNext} />
            : <><div className="room-ticket__question"><span>Задание</span><h2>{room.round?.prompt}</h2></div><div className="room-hints">{room.round?.hints.map((value) => <span key={value}>{value}</span>)}</div><AnswerForm room={room} answer={answer} submitted={submitted} busy={busy} onAnswer={onAnswer} onSubmit={onSubmit} />{room.isHost && <div className="room-ticket__foot"><span>{allAnswered ? 'Все ответы получены' : `Ждём ответы: ${answeredCount} из ${ranked.length}`}</span><ControlButton type="button" onClick={() => { if (window.confirm('Показать результаты всем участникам? После этого ответы изменить нельзя.')) onReveal() }} disabled={busy || !allAnswered} title={allAnswered ? undefined : 'Раунд завершится автоматически по таймеру или после ответа всех игроков'}>Показать результаты</ControlButton></div>}</>}
        </div>
      </article>
      <ActivityLog room={room} players={ranked} />
    </section>
    <PlayersPanel room={room} players={ranked} />
  </div>
}

function LeftRail({ room, ranked, timeLeft, message, busy, onMessage, onSend }: {
  room: FriendsRoomSnapshot
  ranked: FriendsRoomSnapshot['members']
  timeLeft: number
  message: string
  busy: boolean
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
}) {
  const answeredCount = ranked.filter((member) => member.answered).length
  return <aside className="room-left-rail">
    <section className="room-panel room-panel--code"><span>Комната</span><strong>{room.code}</strong><small><RoomIcon name="users" /> {ranked.length} игроков</small></section>
    <section className="room-panel room-progress"><span>Прогресс игры</span><div><strong>Раунд {room.currentRound} из {room.roundsTotal}</strong><small><RoomIcon name="timer" /> {room.phase === 'countdown' ? `Старт через ${timeLeft} сек` : `${String(Math.floor(timeLeft / 60)).padStart(2, '0')}:${String(timeLeft % 60).padStart(2, '0')}`}</small><small><RoomIcon name="check" /> Ответили {answeredCount} / {ranked.length}</small></div></section>
    <Chat room={room} message={message} busy={busy} onMessage={onMessage} onSend={onSend} />
  </aside>
}

function AnswerForm({ room, answer, submitted, busy, onAnswer, onSubmit }: {
  room: FriendsRoomSnapshot
  answer: string
  submitted: boolean
  busy: boolean
  onAnswer: (value: string, itemId?: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  const [suggestions, setSuggestions] = useState<PublicContentItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const query = answer.trim()

  useEffect(() => {
    if (submitted || dismissed || query.length < 2) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ mode: room.round?.mode ?? room.mode, q: query, limit: '6' })
      void api.search(params).then((response) => {
        if (cancelled) return
        setSuggestions(response.items)
        setActiveIndex(0)
      }).catch(() => {
        if (!cancelled) setSuggestions([])
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dismissed, query, room.mode, room.round?.mode, room.round?.position, submitted])

  const choose = (item: PublicContentItem) => {
    onAnswer(item.titleRu, item.id)
    setDismissed(true)
    setSuggestions([])
  }

  if (submitted) return <form className="room-answer is-submitted" onSubmit={onSubmit}><div><RoomIcon name="check" /><span><small>Ответ принят сервером</small><strong>{answer || 'Ждём остальных игроков'}</strong></span></div></form>

  return <form className="room-answer" onSubmit={onSubmit}>
    <TextInput surface="paper" id="friends-answer" aria-label="Ваш ответ" aria-autocomplete="list" aria-controls="friends-answer-suggestions" aria-expanded={suggestions.length > 0} autoFocus value={answer} onChange={(event) => { onAnswer(event.target.value, undefined); setDismissed(false) }} onKeyDown={(event) => {
      if (!suggestions.length) return
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, suggestions.length - 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)) }
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); setSuggestions([]) }
      if (event.key === 'Enter') { event.preventDefault(); choose(suggestions[activeIndex] ?? suggestions[0]) }
    }} placeholder={(room.round?.mode ?? room.mode) === 'city' ? 'Введите город…' : 'Введите название…'} autoComplete="off" />
    <ControlButton type="submit" disabled={!answer.trim() || busy}>Отправить</ControlButton>
    {suggestions.length > 0 && <div className="room-answer__suggestions" id="friends-answer-suggestions" role="listbox">{suggestions.map((item, index) => <ControlButton type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'is-active' : ''} key={item.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}>{item.titleRu}{item.titleOriginal && item.titleOriginal !== item.titleRu ? <small>{item.titleOriginal}{item.year ? ` · ${item.year}` : ''}</small> : item.year ? <small>{item.year}</small> : null}</ControlButton>)}</div>}
  </form>
}

function Chat({ room, message, busy, onMessage, onSend }: { room: FriendsRoomSnapshot; message: string; busy: boolean; onMessage: (value: string) => void; onSend: (event: FormEvent) => void }) {
  return <section className="room-panel room-chat"><span><RoomIcon name="chat" /> Чат комнаты</span><div role="log" aria-live="polite">{room.messages.length ? room.messages.slice(-20).map((entry) => <p className={entry.userId === room.currentUserId ? 'is-you' : ''} key={entry.id}><strong>{entry.userId === room.currentUserId ? 'Вы' : entry.displayName}</strong>{entry.text}</p>) : <small>Здесь появятся сообщения игроков.</small>}</div><form onSubmit={onSend}><TextInput surface="dark" id="friends-chat" aria-label="Сообщение в чат" value={message} onChange={(event) => onMessage(event.target.value)} placeholder="Сообщение…" maxLength={300} /><ControlButton type="submit" aria-label="Отправить" disabled={!message.trim() || busy}><RoomIcon name="send" /></ControlButton></form></section>
}

function Results({ room, mode, isHost, busy, onNext }: { room: FriendsRoomSnapshot; mode: (typeof MODES)[number]; isHost: boolean; busy: boolean; onNext: () => void }) {
  const correct = room.answers.filter((entry) => entry.correct).length
  const partial = room.answers.filter((entry) => !entry.correct && entry.points > 0).length
  const ownAnswer = room.answers.find((entry) => entry.userId === room.currentUserId)
  const card = room.round?.answerCard
  const people = card?.showrunners?.length
    ? { label: 'Создатели сериала', value: card.showrunners.map((person) => person.nameRu || person.nameOriginal).join(', ') }
    : card?.directors?.length
      ? { label: 'Режиссёр', value: card.directors.map((person) => person.nameRu || person.nameOriginal).join(', ') }
      : card?.developers?.length
        ? { label: 'Разработчик', value: card.developers.join(', ') }
        : card?.studios?.length
          ? { label: 'Студия', value: card.studios.join(', ') }
          : null
  const facts = [
    card?.year ? { label: 'Год', value: String(card.year) } : null,
    card?.countries?.length ? { label: 'Страна', value: card.countries.join(', ') } : null,
    card?.genres?.length ? { label: 'Жанры', value: card.genres.slice(0, 3).join(', ') } : null,
    people,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry?.value))
  return <div className="room-reveal"><div className="room-reveal__card"><div className="room-reveal__poster"><img src={publicAssetUrl(card?.posterUrl || mode.poster)} alt={card?.titleRu || room.round?.answer || 'Правильный ответ'} /></div><div className="room-reveal__copy"><span>Правильный ответ</span><h2>{room.round?.answer}</h2>{room.round?.answerOriginal && room.round.answerOriginal !== room.round.answer && <small>{room.round.answerOriginal}</small>}<div className="room-reveal__facts">{facts.map((fact) => <span key={`${fact.label}-${fact.value}`}><small>{fact.label}</small><strong>{fact.value}</strong></span>)}</div><p>{correct} ответили точно{partial > 0 ? ` · ${partial} получили очки за совпавшие признаки` : ''}</p>{ownAnswer && ownAnswer.scoreBreakdown.length > 0 && <div className="room-score-breakdown" aria-label="Как начислены ваши очки"><strong>Ваши +{ownAnswer.points}</strong>{ownAnswer.scoreBreakdown.map((part) => <span key={part.key}><small>{part.label}</small><b>+{part.points}</b></span>)}</div>}{isHost ? <ControlButton type="button" onClick={onNext} disabled={busy}>{room.currentRound >= room.roundsTotal ? 'Показать итоги' : 'Следующий раунд'}<RoomIcon name="play" /></ControlButton> : <div className="room-reveal__waiting"><RoomIcon name="timer" />Ждём следующий раунд</div>}</div></div></div>
}

function PlayersPanel({ room, players }: { room: FriendsRoomSnapshot; players: FriendsRoomSnapshot['members'] }) {
  const podium = [...players].sort((left, right) => {
    const leftPoints = room.answers.find((entry) => entry.userId === left.userId)?.points ?? 0
    const rightPoints = room.answers.find((entry) => entry.userId === right.userId)?.points ?? 0
    return rightPoints - leftPoints
  }).slice(0, 3)
  const scoresVisible = room.phase === 'results' || room.phase === 'intermission' || room.phase === 'finished'
  return <aside className="room-right-rail"><section className="room-panel room-players"><span>Игроки ({players.length})</span><div>{players.map((player, index) => <article key={player.userId}><i style={{ '--avatar': colorByKey[player.colorKey] ?? 'var(--mode-movie-brand)' } as CSSProperties}>{initials(player.displayName)}</i><strong>{player.displayName}{player.userId === room.currentUserId ? ' (вы)' : ''}</strong>{scoresVisible && index === 0 && <RoomIcon name="trophy" />}<small>{scoresVisible ? score(player.score) : '—'}</small></article>)}</div></section><section className="room-panel room-answers"><span>Ответы раунда</span>{room.phase === 'results' ? <div>{players.map((player) => { const answer = room.answers.find((entry) => entry.userId === player.userId); return <article className={answer && !answer.correct && answer.points > 0 ? 'is-partial' : ''} key={player.userId}><i style={{ '--avatar': colorByKey[player.colorKey] ?? 'var(--mode-movie-brand)' } as CSSProperties}>{initials(player.displayName)}</i><span><strong>{player.displayName}</strong><small>{answer ? `${answer.text} · +${answer.points}` : 'Нет ответа'}</small></span><RoomIcon name={answer && answer.points > 0 ? 'check' : 'remove'} /></article> })}</div> : <div className="room-waiting"><RoomIcon name="chat" /><p>Ответы откроются одновременно после завершения раунда</p></div>}</section>{room.phase === 'results' && <section className="room-panel room-podium"><span>Счёт за раунд</span><div>{podium.map((player, index) => <article key={player.userId} className={`place-${index + 1}`}><strong>{index + 1}</strong><small>+{room.answers.find((entry) => entry.userId === player.userId)?.points ?? 0}</small></article>)}</div></section>}</aside>
}

function ActivityLog({ room, players }: { room: FriendsRoomSnapshot; players: FriendsRoomSnapshot['members'] }) {
  const events = room.phase === 'results'
    ? room.answers.slice(0, 3).map((answer) => ({ answer, player: players.find((entry) => entry.userId === answer.userId) })).filter((entry) => entry.player)
    : players.filter((player) => player.answered).slice(0, 3).map((player) => ({ answer: undefined, player }))
  return <section className="room-activity" aria-live="polite"><span>Ход игры</span><article><i><RoomIcon name="play" /></i><div><strong>Раунд {room.currentRound} начался</strong><small>Угадайте ответ по подсказкам</small></div><time>сейчас</time></article>{events.map(({ answer: eventAnswer, player }) => player && <article key={player.userId}><i><RoomIcon name={eventAnswer && eventAnswer.points === 0 ? 'remove' : 'check'} /></i><div><strong>{player.displayName} {room.phase === 'results' ? eventAnswer?.correct ? 'дал точный ответ' : eventAnswer && eventAnswer.points > 0 ? 'нашёл совпавшие признаки' : 'не получил очков' : 'отправил ответ'}</strong>{room.phase === 'results' && <small>+{eventAnswer?.points ?? 0} очков</small>}</div><time>сейчас</time></article>)}</section>
}

function IntermissionScreen({ room, players, busy, onContinue, onExit }: {
  room: FriendsRoomSnapshot
  players: FriendsRoomSnapshot['members']
  busy: boolean
  onContinue: () => void
  onExit: () => void
}) {
  const quote = room.continuation
  const ownerCanPay = quote.shortage === 0
  return <section className="room-intermission">
    <div className="room-intermission__card">
      <span>Перерыв после {room.currentRound} раундов</span>
      <RoomIcon name="timer" />
      <h1>Продолжим?</h1>
      <p>{quote.accessSource === 'club'
        ? 'Для участников Клуба следующий блок включён.'
        : quote.cost === 0
          ? 'Следующий блок из 6 раундов бесплатный.'
          : `Следующий блок из 6 раундов стоит ${quote.cost} билетов.`}</p>
      <div className="room-intermission__leaders">
        {players.slice(0, 3).map((player, index) => <article key={player.userId}><i>{index + 1}</i><span>{player.displayName}</span><strong>{score(player.score)}</strong></article>)}
      </div>
      {room.isHost ? <>
        {!ownerCanPay && <InlineAlert tone="warning">Не хватает {quote.shortage} билетов. Баланс: {quote.balance ?? 0}.</InlineAlert>}
        <ControlButton type="button" onClick={onContinue} disabled={busy || !quote.canContinue || !ownerCanPay}>
          <RoomIcon name="play" />{busy ? 'Запускаем…' : quote.cost > 0 ? `Продолжить за ${quote.cost} билетов` : 'Продолжить бесплатно'}
        </ControlButton>
        {!ownerCanPay && <a className="ui-button ui-button--secondary" href="/club">Вступить в Клуб</a>}
      </> : <div className="room-waiting-host"><RoomIcon name="timer" /><span><strong>Решает ведущий</strong><small>Следующий блок запускает создатель комнаты</small></span></div>}
      <ControlButton type="button" onClick={onExit} disabled={busy}><RoomIcon name="exit" />Завершить для себя</ControlButton>
    </div>
  </section>
}

function FinalScreen({ room, players, busy, anonymousUser, onAgain, onExit }: { room: FriendsRoomSnapshot; players: FriendsRoomSnapshot['members']; busy: boolean; anonymousUser: boolean; onAgain: () => void; onExit: () => void }) {
  const winner = players[0]
  const soloResult = players.length === 1
  return <section className="room-final"><div className="room-final__ticket"><span>Сеанс завершён</span><RoomIcon name="trophy" /><small>{soloResult ? 'Ваш результат' : 'Победитель'}</small><h1>{winner?.displayName ?? 'Ничья'}</h1><strong>{score(winner?.score ?? 0)} очков</strong><div>{players.slice(0, 3).map((player, index) => <article key={player.userId}><i>{index + 1}</i><span>{player.displayName}</span><strong>{score(player.score)}</strong></article>)}</div>{anonymousUser && <a className="ui-button ui-button--primary" href={friendsRoomRegistrationHref(`/games/together?room=${room.code}`)}>Сохранить результат и играть снова</a>}{room.isHost && <><ControlButton type="button" onClick={onAgain} disabled={busy}><RoomIcon name="apps" />Создать новую комнату</ControlButton><small>Текущая комната и её чат закроются.</small></>}<ControlButton type="button" onClick={onExit} disabled={busy}><RoomIcon name="exit" />{busy ? 'Выходим…' : 'Покинуть комнату'}</ControlButton></div></section>
}
