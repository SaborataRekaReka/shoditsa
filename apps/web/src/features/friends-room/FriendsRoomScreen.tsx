import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import {
  FRIENDS_ROOM_DEFAULT_PACK_VARIANTS,
  FRIENDS_ROOM_PACK_VARIANTS,
  friendsRoomMinimumRounds,
  type FriendsRoomConfigBody,
  type FriendsRoomPackSelection,
  type FriendsRoomSnapshot,
  type PlayableMode,
  type PublicContentItem,
} from '@shoditsa/contracts'
import { AppHeader, type AppHeaderProps } from '../../components/app-shell/AppShell'
import { api, friendsRoomEventsUrl } from '../../api/client'
import { publicAssetUrl } from '../../app/public-asset'
import { ensureServerSession } from '../../hooks/use-server-runtime'
import { friendsRoomTimeLeft } from './friends-room-time'
import './FriendsRoomScreen.css'

type IconName = 'apps' | 'back' | 'chat' | 'check' | 'copy' | 'exit' | 'play' | 'remove' | 'replay' | 'send' | 'share' | 'shuffle' | 'timer' | 'trophy' | 'users'

const RoomIcon = ({ name }: { name: IconName }) => <i
  className="room-icon"
  aria-hidden="true"
  style={{ '--room-icon-url': `url("${publicAssetUrl(`images/friends-room/icons/${name}.svg`)}")` } as CSSProperties}
/>

const MODES: Array<{ id: PlayableMode; label: string; poster: string; color: string }> = [
  { id: 'series', label: 'Сериалы', poster: 'images/title-posters/series-ticket-poster.webp', color: '#d6a546' },
  { id: 'movie', label: 'Кино', poster: 'images/title-posters/movie-ticket-poster.webp', color: '#57b777' },
  { id: 'anime', label: 'Аниме', poster: 'images/title-posters/anime-ticket-poster.webp', color: '#cf7a5d' },
  { id: 'game', label: 'Игры', poster: 'images/title-posters/game-ticket-poster.webp', color: '#5270ab' },
  { id: 'city', label: 'Города', poster: 'images/title-posters/city-ticket-poster.webp', color: '#67aa7c' },
  { id: 'music', label: 'Музыка', poster: 'images/title-posters/music-ticket-poster.webp', color: '#9a6c96' },
  { id: 'diagnosis', label: 'Диагнозы', poster: 'images/title-posters/diagnosis-ticket-poster.webp', color: '#4f9fa6' },
]

const FRIENDS_ROOM_ROUND_MAX = 30
const FRIENDS_ROOM_ROUND_STEP = 3

const colorByKey: Record<string, string> = {
  'player-1': '#57b777', 'player-2': '#d6a546', 'player-3': '#cf7a5d', 'player-4': '#5270ab',
  'player-5': '#9a6c96', 'player-6': '#4f9fa6', 'player-7': '#c58d55', 'player-8': '#6f9d72',
  'player-9': '#b87575', 'player-10': '#7188b8', 'player-11': '#a982b3', 'player-12': '#7d9d9d',
}

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие'
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru-RU') || 'И'
const score = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
const packCountLabel = (count: number) => `${count} ${count === 1 ? 'пак' : count < 5 ? 'пака' : 'паков'}`
const activeMembers = (room: FriendsRoomSnapshot) => room.members.filter((member) => !member.leftAt)
const idempotencyKey = () => crypto.randomUUID()
const withConfigDraft = (snapshot: FriendsRoomSnapshot, draft: FriendsRoomConfigBody): FriendsRoomSnapshot => {
  const packs = draft.packs ?? snapshot.packs
  return {
    ...snapshot,
    ...(draft.roundsTotal == null ? {} : { roundsTotal: draft.roundsTotal }),
    ...(draft.shufflePacks == null ? {} : { shufflePacks: draft.shufflePacks }),
    ...(draft.answerTimeSeconds == null ? {} : { answerTimeSeconds: draft.answerTimeSeconds }),
    ...(draft.packs == null ? {} : { packs }),
    mode: draft.mode ?? draft.packs?.[0]?.mode ?? snapshot.mode,
  }
}

export function FriendsRoomScreen({ navigation, onExit }: { navigation: AppHeaderProps; onExit: () => void }) {
  const [room, setRoom] = useState<FriendsRoomSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<'connected' | 'reconnecting' | 'offline'>('reconnecting')
  const [answer, setAnswer] = useState('')
  const [answerItemId, setAnswerItemId] = useState<string | undefined>()
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())
  const bootstrapRef = useRef<Promise<FriendsRoomSnapshot> | null>(null)
  const roomRef = useRef<FriendsRoomSnapshot | null>(null)
  const configQueueRef = useRef<Promise<void>>(Promise.resolve())
  const configMutationRef = useRef(0)
  const configDraftRef = useRef<FriendsRoomConfigBody>({})

  const applyIncomingRoom = useCallback((snapshot: FriendsRoomSnapshot) => {
    const next = withConfigDraft(snapshot, configDraftRef.current)
    roomRef.current = next
    setRoom(next)
  }, [])

  useEffect(() => {
    if (!bootstrapRef.current) {
      const code = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase()
      bootstrapRef.current = ensureServerSession()
        .then(() => code ? api.friendsRoomJoin(code) : api.friendsRoomCreate())
        .then((response) => response.room)
    }
    let cancelled = false
    void bootstrapRef.current.then((snapshot) => {
      if (cancelled) return
      roomRef.current = snapshot
      setRoom(snapshot)
      setLoading(false)
      const url = new URL(window.location.href)
      if (url.searchParams.get('room') !== snapshot.code) {
        url.searchParams.set('room', snapshot.code)
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
    }).catch((reason) => {
      if (cancelled) return
      setError(errorText(reason))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

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

  const run = useCallback(async (action: () => Promise<{ room: FriendsRoomSnapshot }>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try { setRoom((await action()).room) } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }, [busy])

  const leave = useCallback(async () => {
    if (room) {
      try { await api.friendsRoomLeave(room.id, idempotencyKey()) } catch { /* Exit remains available offline. */ }
    }
    onExit()
  }, [onExit, room])

  const copyInvite = async () => {
    if (!room) return
    const url = new URL('/games/together', window.location.origin)
    url.searchParams.set('room', room.code)
    await navigator.clipboard?.writeText(url.toString())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }

  const createNewRoom = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await ensureServerSession()
      const snapshot = (await api.friendsRoomCreate()).room
      if (room) {
        try { await api.friendsRoomLeave(room.id, idempotencyKey()) } catch { /* The new room is already ready. */ }
      }
      setRoom(snapshot)
      setAnswer('')
      setAnswerItemId(undefined)
      const url = new URL(window.location.href)
      url.searchParams.set('room', snapshot.code)
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
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
    if (!room || !message.trim()) return
    const text = message.trim()
    setMessage('')
    void run(() => api.friendsRoomMessage(room.id, text, idempotencyKey()))
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

  const pageAccent = room?.phase === 'lobby' ? '#d6a546' : mode.color

  return <div className="friends-room-page" style={{ '--room-accent': pageAccent } as CSSProperties}>
    <AppHeader {...navigation} onHome={() => void leave()} onCreateRoom={() => void createNewRoom()} />
    <main className="friends-room">
      <header className="friends-room__utility">
        <button type="button" onClick={() => void leave()}><RoomIcon name="back" /> Выйти из комнаты</button>
        <span className={`room-connection room-connection--${connection}`}><RoomIcon name="trophy" />{connection === 'connected' ? 'Онлайн-комната · на связи' : connection === 'offline' ? 'Онлайн-комната · нет сети' : 'Онлайн-комната · подключаемся'}</span>
      </header>

      {error && <div className="room-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>Закрыть</button></div>}
      {loading && <RoomLoading />}
      {!loading && !room && <RoomError onRetry={() => window.location.reload()} onExit={onExit} />}
      {room?.phase === 'lobby' && <Lobby room={room} mode={mode} members={members} copied={copied} busy={busy} configSaving={configSaving} onPacks={(packs) => updateConfig({ packs, ...(room.roundsTotal < packs.length ? { roundsTotal: friendsRoomMinimumRounds(packs.length) } : {}) })} onRounds={(value) => updateConfig({ roundsTotal: value })} onTime={(value) => updateConfig({ answerTimeSeconds: value })} onShuffle={() => updateConfig({ shufflePacks: !room.shufflePacks })} onCopy={copyInvite} onStart={() => void run(() => api.friendsRoomStart(room.id, idempotencyKey()))} />}
      {room?.phase === 'countdown' && <CountdownLayout room={room} ranked={ranked} value={Math.max(1, timeLeft)} message={message} copied={copied} busy={busy} onMessage={setMessage} onSend={sendMessage} onCopy={copyInvite} />}
      {room && (room.phase === 'active' || room.phase === 'results') && <GameLayout room={room} mode={mode} ranked={ranked} timeLeft={timeLeft} answer={answer} message={message} copied={copied} busy={busy} submitted={Boolean(currentMember?.answered)} onAnswer={(value, itemId) => { setAnswer(value); setAnswerItemId(itemId) }} onSubmit={submitAnswer} onMessage={setMessage} onSend={sendMessage} onCopy={copyInvite} onReveal={() => void run(() => api.friendsRoomReveal(room.id, idempotencyKey()))} onNext={() => void run(() => api.friendsRoomNext(room.id, idempotencyKey()))} />}
      {room?.phase === 'finished' && <FinalScreen room={room} players={ranked} busy={busy} onAgain={() => void run(() => api.friendsRoomRestart(room.id, idempotencyKey()))} onExit={() => void leave()} />}
    </main>
  </div>
}

function RoomLoading() {
  return <section className="room-state" role="status"><span className="room-state__spinner" /><h1>Готовим комнату</h1><p>Подключаем realtime и загружаем игровую сессию.</p></section>
}

function RoomError({ onRetry, onExit }: { onRetry: () => void; onExit: () => void }) {
  return <section className="room-state"><h1>Комната не открылась</h1><p>Проверьте ссылку или попробуйте создать новую комнату.</p><div><button className="room-button room-button--primary" type="button" onClick={onRetry}>Повторить</button><button className="room-button" type="button" onClick={onExit}>На главную</button></div></section>
}

function Lobby({ room, mode, members, copied, busy, configSaving, onPacks, onRounds, onTime, onShuffle, onCopy, onStart }: {
  room: FriendsRoomSnapshot
  mode: (typeof MODES)[number]
  members: FriendsRoomSnapshot['members']
  copied: boolean
  busy: boolean
  configSaving: boolean
  onPacks: (value: FriendsRoomPackSelection[]) => void
  onRounds: (value: number) => void
  onTime: (value: 15 | 20 | 30 | 45) => void
  onShuffle: () => void
  onCopy: () => void
  onStart: () => void
}) {
  const minimumRounds = friendsRoomMinimumRounds(room.packs.length)
  const togglePack = (modeId: PlayableMode) => {
    const existing = room.packs.find((pack) => pack.mode === modeId)
    if (existing) {
      if (room.packs.length > 1) onPacks(room.packs.filter((pack) => pack.mode !== modeId))
      return
    }
    onPacks([...room.packs, { mode: modeId, variant: FRIENDS_ROOM_DEFAULT_PACK_VARIANTS[modeId] }])
  }
  const selectVariant = (modeId: PlayableMode, variant: string) => {
    onPacks(room.packs.map((pack) => pack.mode === modeId ? { ...pack, variant } : pack))
  }
  return <section className="room-lobby">
    <div className="room-lobby__intro">
      <span className="room-kicker">Игра с друзьями · онлайн-комната</span>
      <h1>Соберите свою<br />игровую комнату</h1>
      <p>Выберите один или несколько паков и правила. В комнате могут играть до {room.capacity} человек — все одновременно увидят подсказки и отправят по одному ответу.</p>
      <div className="room-code-card"><span>Код комнаты</span><strong>{room.code}</strong><button type="button" onClick={onCopy}><RoomIcon name={copied ? 'check' : 'copy'} />{copied ? 'Скопировано' : 'Копировать ссылку'}</button></div>
      <MemberStack members={members} capacity={room.capacity} />
    </div>
    <div className="room-lobby__settings">
      <header className="room-settings-heading"><span>Настройки сеанса</span><strong>{room.packs.length === 1 ? mode.label : packCountLabel(room.packs.length)}</strong></header>
      <fieldset className="room-mode-picker" disabled={!room.isHost}>
        <legend>Игровые паки <small>можно несколько</small></legend>
        <div>{MODES.map((entry) => {
          const order = room.packs.findIndex((pack) => pack.mode === entry.id)
          return <button key={entry.id} type="button" className={order >= 0 ? 'is-active' : ''} aria-pressed={order >= 0} style={{ '--mode-color': entry.color } as CSSProperties} onClick={() => togglePack(entry.id)}><img src={publicAssetUrl(entry.poster)} alt="" /><span>{entry.label}</span>{order >= 0 && <em>{order + 1}</em>}</button>
        })}</div>
      </fieldset>
      <div className="room-pack-options">
        {room.packs.map((pack, index) => {
          const packMode = MODES.find((entry) => entry.id === pack.mode) ?? MODES[0]
          const variants = FRIENDS_ROOM_PACK_VARIANTS[pack.mode]
          return <section key={pack.mode} style={{ '--mode-color': packMode.color } as CSSProperties}>
            <header><span>{index + 1}</span><div><strong>{packMode.label}</strong><small>{variants.find((variant) => variant.id === pack.variant)?.description}</small></div></header>
            <div>{variants.map((variant) => <button type="button" key={variant.id} className={variant.id === pack.variant ? 'is-active' : ''} disabled={!room.isHost} onClick={() => selectVariant(pack.mode, variant.id)}>{variant.label}</button>)}</div>
          </section>
        })}
      </div>
      <button className={`room-shuffle${room.shufflePacks ? ' is-active' : ''}`} type="button" aria-pressed={room.shufflePacks} disabled={!room.isHost} onClick={onShuffle}><RoomIcon name="shuffle" /><span><strong>Перемешивать паки</strong><small>{room.shufflePacks ? 'Порядок будет случайным для этой игры' : 'Сейчас паки идут в порядке выбора'}</small></span><em>{room.shufflePacks ? 'Включено' : 'Выключено'}</em></button>
      <div className="room-rule-grid">
        <fieldset className="room-rounds" disabled={!room.isHost}><legend>Раундов <output>{room.roundsTotal}</output></legend><input type="range" min={minimumRounds} max={FRIENDS_ROOM_ROUND_MAX} step={FRIENDS_ROOM_ROUND_STEP} value={room.roundsTotal} onChange={(event) => onRounds(Number(event.currentTarget.value))} aria-label="Количество раундов" /><div className="room-rounds__scale" aria-hidden="true"><span>{minimumRounds}</span><span>30</span></div><small>Не меньше одного раунда на пак. Дальше паки повторяются по кругу.</small></fieldset>
        <fieldset disabled={!room.isHost}><legend>Время на ответ</legend><div>{([15, 20, 30, 45] as const).map((value) => <button type="button" className={room.answerTimeSeconds === value ? 'is-active' : ''} key={value} onClick={() => onTime(value)}>{value} сек</button>)}</div></fieldset>
      </div>
      {room.isHost
        ? <button className="room-start" type="button" onClick={onStart} disabled={busy || configSaving}><RoomIcon name="play" />{busy ? 'Запускаем…' : 'Начать игру'}<span>{packCountLabel(room.packs.length)} · {room.roundsTotal} раундов · {room.answerTimeSeconds} сек</span></button>
        : <div className="room-waiting-host"><RoomIcon name="timer" /><span><strong>Ждём ведущего</strong><small>Настройки и запуск доступны создателю комнаты</small></span></div>}
    </div>
  </section>
}

function MemberStack({ members, capacity }: { members: FriendsRoomSnapshot['members']; capacity: number }) {
  return <div className="room-lobby__people">{members.map((member) => <span key={member.userId} style={{ '--avatar': colorByKey[member.colorKey] ?? '#57b777' } as CSSProperties}>{initials(member.displayName)}</span>)}<small>{members.length} из {capacity} игроков в комнате</small></div>
}

function Countdown({ room, value }: { room: FriendsRoomSnapshot; value: number }) {
  return <section className="room-countdown" aria-live="polite"><span>Раунд {room.currentRound} из {room.roundsTotal}</span><strong>{value}</strong><p>Приготовьтесь</p></section>
}

function CountdownLayout({ room, ranked, value, message, copied, busy, onMessage, onSend, onCopy }: {
  room: FriendsRoomSnapshot
  ranked: FriendsRoomSnapshot['members']
  value: number
  message: string
  copied: boolean
  busy: boolean
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
  onCopy: () => void
}) {
  return <div className="friends-room__columns">
    <LeftRail room={room} ranked={ranked} timeLeft={0} message={message} copied={copied} busy={busy} onMessage={onMessage} onSend={onSend} onCopy={onCopy} />
    <section className="friends-room__stage"><Countdown room={room} value={value} /><ActivityLog room={room} players={ranked} /></section>
    <PlayersPanel room={room} players={ranked} />
  </div>
}

function GameLayout({ room, mode, ranked, timeLeft, answer, message, copied, busy, submitted, onAnswer, onSubmit, onMessage, onSend, onCopy, onReveal, onNext }: {
  room: FriendsRoomSnapshot
  mode: (typeof MODES)[number]
  ranked: FriendsRoomSnapshot['members']
  timeLeft: number
  answer: string
  message: string
  copied: boolean
  busy: boolean
  submitted: boolean
  onAnswer: (value: string, itemId?: string) => void
  onSubmit: (event: FormEvent) => void
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
  onCopy: () => void
  onReveal: () => void
  onNext: () => void
}) {
  return <div className="friends-room__columns">
    <LeftRail room={room} ranked={ranked} timeLeft={timeLeft} message={message} copied={copied} busy={busy} onMessage={onMessage} onSend={onSend} onCopy={onCopy} />
    <section className="friends-room__stage">
      <article className={`room-ticket ${room.phase === 'results' ? 'is-results' : ''}`}>
        <div className="room-ticket__stub"><img src={publicAssetUrl(mode.poster)} alt="" /><span>Вход<br /><strong>один</strong></span><small>№ {String(room.currentRound).padStart(3, '0')}</small></div>
        <div className="room-ticket__body">
          <div className="room-ticket__meta">Игра с друзьями · Раунд №{String(room.currentRound).padStart(3, '0')}</div>
          <h1>{mode.label}</h1>
          {room.phase === 'results'
            ? <Results room={room} mode={mode} isHost={room.isHost} busy={busy} onNext={onNext} />
            : <><div className="room-ticket__question"><span>Задание</span><h2>{room.round?.prompt}</h2></div><div className="room-hints">{room.round?.hints.map((value) => <span key={value}>{value}</span>)}</div><AnswerForm room={room} answer={answer} submitted={submitted} busy={busy} onAnswer={onAnswer} onSubmit={onSubmit} />{room.isHost && <div className="room-ticket__foot"><span>Можно отправить только один вариант</span><button type="button" onClick={onReveal} disabled={busy}>Показать результаты</button></div>}</>}
        </div>
      </article>
      <ActivityLog room={room} players={ranked} />
    </section>
    <PlayersPanel room={room} players={ranked} />
  </div>
}

function LeftRail({ room, ranked, timeLeft, message, copied, busy, onMessage, onSend, onCopy }: {
  room: FriendsRoomSnapshot
  ranked: FriendsRoomSnapshot['members']
  timeLeft: number
  message: string
  copied: boolean
  busy: boolean
  onMessage: (value: string) => void
  onSend: (event: FormEvent) => void
  onCopy: () => void
}) {
  const answeredCount = room.members.filter((member) => !member.leftAt && member.answered).length
  return <aside className="room-left-rail">
    <section className="room-panel room-panel--code"><span>Комната</span><strong>{room.code}</strong><small><RoomIcon name="users" /> {ranked.length} игроков</small><button type="button" onClick={onCopy}><RoomIcon name={copied ? 'check' : 'share'} />{copied ? 'Ссылка скопирована' : 'Пригласить друзей'}</button></section>
    <section className="room-panel room-progress"><span>Прогресс игры</span><div><strong>Раунд {room.currentRound} из {room.roundsTotal}</strong><small><RoomIcon name="timer" /> {String(Math.floor(timeLeft / 60)).padStart(2, '0')}:{String(timeLeft % 60).padStart(2, '0')}</small><small><RoomIcon name="check" /> Ответили {answeredCount} / {ranked.length}</small></div></section>
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
    <input id="friends-answer" aria-label="Ваш ответ" aria-autocomplete="list" aria-controls="friends-answer-suggestions" aria-expanded={suggestions.length > 0} autoFocus value={answer} onChange={(event) => { onAnswer(event.target.value, undefined); setDismissed(false) }} onKeyDown={(event) => {
      if (!suggestions.length) return
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, suggestions.length - 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)) }
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); setSuggestions([]) }
      if (event.key === 'Enter') { event.preventDefault(); choose(suggestions[activeIndex] ?? suggestions[0]) }
    }} placeholder={(room.round?.mode ?? room.mode) === 'city' ? 'Введите город…' : 'Введите название…'} autoComplete="off" />
    <button type="submit" disabled={!answer.trim() || busy}>Отправить</button>
    {suggestions.length > 0 && <div className="room-answer__suggestions" id="friends-answer-suggestions" role="listbox">{suggestions.map((item, index) => <button type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'is-active' : ''} key={item.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}>{item.titleRu}{item.titleOriginal && item.titleOriginal !== item.titleRu ? <small>{item.titleOriginal}{item.year ? ` · ${item.year}` : ''}</small> : item.year ? <small>{item.year}</small> : null}</button>)}</div>}
  </form>
}

function Chat({ room, message, busy, onMessage, onSend }: { room: FriendsRoomSnapshot; message: string; busy: boolean; onMessage: (value: string) => void; onSend: (event: FormEvent) => void }) {
  return <section className="room-panel room-chat"><span><RoomIcon name="chat" /> Чат комнаты</span><div role="log" aria-live="polite">{room.messages.length ? room.messages.slice(-20).map((entry) => <p className={entry.userId === room.currentUserId ? 'is-you' : ''} key={entry.id}><strong>{entry.userId === room.currentUserId ? 'Вы' : entry.displayName}</strong>{entry.text}</p>) : <small>Здесь появятся сообщения игроков.</small>}</div><form onSubmit={onSend}><input id="friends-chat" aria-label="Сообщение в чат" value={message} onChange={(event) => onMessage(event.target.value)} placeholder="Сообщение…" maxLength={300} /><button type="submit" aria-label="Отправить" disabled={!message.trim() || busy}><RoomIcon name="send" /></button></form></section>
}

function Results({ room, mode, isHost, busy, onNext }: { room: FriendsRoomSnapshot; mode: (typeof MODES)[number]; isHost: boolean; busy: boolean; onNext: () => void }) {
  const correct = room.answers.filter((entry) => entry.correct).length
  const partial = room.answers.filter((entry) => !entry.correct && entry.points > 0).length
  const ownAnswer = room.answers.find((entry) => entry.userId === room.currentUserId)
  const card = room.round?.answerCard
  const people = card?.showrunners?.length
    ? { label: 'Шоураннер', value: card.showrunners.map((person) => person.nameRu || person.nameOriginal).join(', ') }
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
  return <div className="room-reveal"><div className="room-reveal__card"><div className="room-reveal__poster"><img src={publicAssetUrl(card?.posterUrl || mode.poster)} alt={card?.titleRu || room.round?.answer || 'Правильный ответ'} /></div><div className="room-reveal__copy"><span>Правильный ответ</span><h2>{room.round?.answer}</h2>{room.round?.answerOriginal && room.round.answerOriginal !== room.round.answer && <small>{room.round.answerOriginal}</small>}<div className="room-reveal__facts">{facts.map((fact) => <span key={`${fact.label}-${fact.value}`}><small>{fact.label}</small><strong>{fact.value}</strong></span>)}</div><p>{correct} ответили точно{partial > 0 ? ` · ${partial} получили очки за совпавшие признаки` : ''}</p>{ownAnswer && ownAnswer.scoreBreakdown.length > 0 && <div className="room-score-breakdown" aria-label="Как начислены ваши очки"><strong>Ваши +{ownAnswer.points}</strong>{ownAnswer.scoreBreakdown.map((part) => <span key={part.key}><small>{part.label}</small><b>+{part.points}</b></span>)}</div>}{isHost ? <button type="button" onClick={onNext} disabled={busy}>{room.currentRound >= room.roundsTotal ? 'Показать итоги' : 'Следующий раунд'}<RoomIcon name="play" /></button> : <div className="room-reveal__waiting"><RoomIcon name="timer" />Ждём следующий раунд</div>}</div></div></div>
}

function PlayersPanel({ room, players }: { room: FriendsRoomSnapshot; players: FriendsRoomSnapshot['members'] }) {
  const podium = [...players].sort((left, right) => {
    const leftPoints = room.answers.find((entry) => entry.userId === left.userId)?.points ?? 0
    const rightPoints = room.answers.find((entry) => entry.userId === right.userId)?.points ?? 0
    return rightPoints - leftPoints
  }).slice(0, 3)
  return <aside className="room-right-rail"><section className="room-panel room-players"><span>Игроки ({players.length})</span><div>{players.map((player, index) => <article key={player.userId}><i style={{ '--avatar': colorByKey[player.colorKey] ?? '#57b777' } as CSSProperties}>{initials(player.displayName)}</i><strong>{player.displayName}{player.userId === room.currentUserId ? ' (вы)' : ''}</strong>{index === 0 && <RoomIcon name="trophy" />}<small>{score(player.score)}</small></article>)}</div></section><section className="room-panel room-answers"><span>Ответы раунда</span>{room.phase === 'results' ? <div>{players.map((player) => { const answer = room.answers.find((entry) => entry.userId === player.userId); return <article className={answer && !answer.correct && answer.points > 0 ? 'is-partial' : ''} key={player.userId}><i style={{ '--avatar': colorByKey[player.colorKey] ?? '#57b777' } as CSSProperties}>{initials(player.displayName)}</i><span><strong>{player.displayName}</strong><small>{answer ? `${answer.text} · +${answer.points}` : 'Нет ответа'}</small></span><RoomIcon name={answer && answer.points > 0 ? 'check' : 'remove'} /></article> })}</div> : <div className="room-waiting"><RoomIcon name="chat" /><p>Ответы откроются одновременно после завершения раунда</p></div>}</section>{room.phase === 'results' && <section className="room-panel room-podium"><span>Счёт за раунд</span><div>{podium.map((player, index) => <article key={player.userId} className={`place-${index + 1}`}><strong>{index + 1}</strong><small>+{room.answers.find((entry) => entry.userId === player.userId)?.points ?? 0}</small></article>)}</div></section>}</aside>
}

function ActivityLog({ room, players }: { room: FriendsRoomSnapshot; players: FriendsRoomSnapshot['members'] }) {
  const events = room.phase === 'results'
    ? room.answers.slice(0, 3).map((answer) => ({ answer, player: players.find((entry) => entry.userId === answer.userId) })).filter((entry) => entry.player)
    : players.filter((player) => player.answered).slice(0, 3).map((player) => ({ answer: undefined, player }))
  return <section className="room-activity" aria-live="polite"><span>Ход игры</span><article><i><RoomIcon name="play" /></i><div><strong>Раунд {room.currentRound} начался</strong><small>Угадайте ответ по подсказкам</small></div><time>сейчас</time></article>{events.map(({ answer: eventAnswer, player }) => player && <article key={player.userId}><i><RoomIcon name={eventAnswer && eventAnswer.points === 0 ? 'remove' : 'check'} /></i><div><strong>{player.displayName} {room.phase === 'results' ? eventAnswer?.correct ? 'дал точный ответ' : eventAnswer && eventAnswer.points > 0 ? 'нашёл совпавшие признаки' : 'не получил очков' : 'отправил ответ'}</strong>{room.phase === 'results' && <small>+{eventAnswer?.points ?? 0} очков</small>}</div><time>сейчас</time></article>)}</section>
}

function FinalScreen({ room, players, busy, onAgain, onExit }: { room: FriendsRoomSnapshot; players: FriendsRoomSnapshot['members']; busy: boolean; onAgain: () => void; onExit: () => void }) {
  const winner = players[0]
  return <section className="room-final"><div className="room-final__ticket"><span>Сеанс завершён</span><RoomIcon name="trophy" /><small>Победитель</small><h1>{winner?.displayName ?? 'Ничья'}</h1><strong>{score(winner?.score ?? 0)} очков</strong><div>{players.slice(0, 3).map((player, index) => <article key={player.userId}><i>{index + 1}</i><span>{player.displayName}</span><strong>{score(player.score)}</strong></article>)}</div>{room.isHost && <><button type="button" onClick={onAgain} disabled={busy}><RoomIcon name="replay" />Сыграть ещё раз</button><button type="button" onClick={onAgain} disabled={busy}><RoomIcon name="apps" />Сменить категорию</button></>}<button type="button" onClick={onExit}><RoomIcon name="exit" />Выйти</button></div></section>
}
