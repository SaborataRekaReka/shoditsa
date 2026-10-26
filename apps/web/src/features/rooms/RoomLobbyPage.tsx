import { ApplicationDialog } from '../application/ApplicationDialog'
import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MeResponse, MetaResponse } from '@shoditsa/contracts'
import { ArrowRight, ChevronDown, History, KeyRound } from 'lucide-react'
import { ApplicationFrame } from '../application/ApplicationFrame'
import { PageHeading } from '../../components/ui/PageHeading'
import { InlineAlert } from '../../components/ui'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { api, ApiClientError, queryKeys } from '../../api/client'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { useStudyAccountCache } from '../../dev/quest-game/study-account-cache'
import { navigateApplication } from '../../app/application-navigation'
import { PlayerLocation } from '../../app/PlayerLocation'
import { STUDY_CLUB_OFFER_HREF } from '../../dev/quest-game/account-routing'
import { SVOYAK_ENABLED } from '../svoyak/SvoyakHomeCard'
import { LOBBY_HREF } from './room-navigation'
import { useRoomCreationAccess } from './RoomCreationAccess'
import { RoomModePicker, RoomSetup } from './RoomSetup'
import { RoomCompanyPanel, RoomJoinForm } from './RoomCompanyPanel'
import { roomSetupPayload, type SetupMode } from './room-setup-model'
import { parseRoomDraft, ROOM_DRAFT_KEY } from './room-lobby-draft'
import { friendsRoomPhaseLabel } from '../friends-room/friends-room-summary'
import { RoomDirectory } from './RoomDirectory'
import { RoomCreationFooter } from './RoomCreationFooter'
import { isCurrentRoom, mergeRoomDirectory, roomInvitationHref, roomLeavePresentation, type DirectoryRoom } from './room-directory-model'
import { loadSvoyakDirectory, svoyakDirectoryKey } from '../svoyak/room-directory-client'
import { roomCredentials, svoyakClient } from '../svoyak/client'
import { deterministicClientEventId, trackClientEvent } from '../../app/client-events'
import { trackTerritoryEvent } from '../territory/territory-analytics'
import { trackMetrikaGoal } from '../../app/metrics'
import './room-lobby.css'

const SvoyakRoomCreation = lazy(() => import('../svoyak/SvoyakPage').then(module => ({ default: module.SvoyakRoomCreation })))
const initialDraft = () => {
  let raw = null
  try { raw = sessionStorage.getItem(ROOM_DRAFT_KEY) } catch { /* Storage is optional. */ }
  return parseRoomDraft(raw, typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('mode'), SVOYAK_ENABLED)
}

export default function RoomLobbyPage() {
  const access = useRoomCreationAccess()
  const client = useQueryClient()
  const meta = useStudyAccountCache<MetaResponse>(['meta'])
  const identity = useStudyAccountCache<MeResponse>(queryKeys.me)
  const retryRooms = (count: number, error: Error) => !(error instanceof ApiClientError && error.status === 401) && count < 1
  const rooms = useQuery({ queryKey: queryKeys.friendsRooms, queryFn: api.friendsRoomList, enabled: SERVER_RUNTIME, refetchInterval: 30_000, retry: retryRooms })
  const directory = useQuery({ queryKey: queryKeys.friendsRoomDirectory, queryFn: api.friendsRoomDirectory, enabled: SERVER_RUNTIME, refetchInterval: 30_000, retry: retryRooms })
  const svoyakRooms = useQuery({ queryKey: svoyakDirectoryKey, queryFn: loadSvoyakDirectory, enabled: SVOYAK_ENABLED, refetchOnMount: 'always', refetchInterval: 15_000, retry: 1 })
  const location = useContext(PlayerLocation)
  const [draft] = useState(initialDraft)
  const [mode, setMode] = useState<SetupMode>(draft.mode)
  const [setup, setSetup] = useState(draft.setup)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [leaving, setLeaving] = useState<DirectoryRoom | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFallback, setCopyFallback] = useState('')
  const directoryRooms = mergeRoomDirectory([...(rooms.data?.rooms ?? []), ...(SVOYAK_ENABLED ? svoyakRooms.data?.filter(isCurrentRoom) ?? [] : [])], [...(directory.data?.rooms ?? []), ...(SVOYAK_ENABLED ? svoyakRooms.data ?? [] : [])])
  const currentRoom = directoryRooms.find(isCurrentRoom)
  const recentRooms = directoryRooms.filter(room => !isCurrentRoom(room))
  const leavePresentation = leaving ? roomLeavePresentation(leaving) : null
  const authenticationRequired = identity?.user.isAnonymous === true || access.status === 'auth-required' || rooms.error instanceof ApiClientError && rooms.error.status === 401
  const standardReady = !SERVER_RUNTIME || rooms.isSuccess || authenticationRequired
  const directoryReady = standardReady && (!SVOYAK_ENABLED || svoyakRooms.isSuccess)
  const territoryLandingVisible = useRef(false)
  const visibleSetupMode = useRef<SetupMode | null>(null)
  useEffect(() => {
    const setupVisible = directoryReady && !currentRoom && (mode !== 'territory' || meta?.features.territoryEnabled === true)
    if (setupVisible && visibleSetupMode.current !== mode) trackClientEvent('mode_opened', { mode, source_surface: 'lobby', surface: 'room_setup' })
    visibleSetupMode.current = setupVisible ? mode : null
    const visible = directoryReady && !currentRoom && mode === 'territory' && meta?.features.territoryEnabled === true
    if (visible && !territoryLandingVisible.current) trackTerritoryEvent('territory_landing_view', { sourceSurface: 'lobby' })
    territoryLandingVisible.current = visible
  }, [directoryReady, currentRoom, mode, meta?.features.territoryEnabled])
  useEffect(() => {
    try { sessionStorage.setItem(ROOM_DRAFT_KEY, JSON.stringify({ mode, setup })) } catch { /* Storage is optional. */ }
  }, [mode, setup])
  useEffect(() => {
    const requested = new URLSearchParams(location?.search).get('mode')
    if (!requested || !['quiz', 'danetki', 'territory', 'svoyak'].includes(requested) || requested === 'svoyak' && !SVOYAK_ENABLED) return
    setMode(requested as SetupMode)
    if (requested !== 'svoyak') setSetup(current => ({ ...current, gameType: requested as 'quiz' | 'danetki' | 'territory' }))
  }, [location?.search])
  useEffect(() => {
    if (mode === 'territory' && meta && !meta.features.territoryEnabled) { setMode('quiz'); setSetup(current => ({ ...current, gameType: 'quiz' })) }
  }, [meta, mode])
  const copyInvitation = async (room: DirectoryRoom) => {
    const link = new URL(roomInvitationHref(room), window.location.origin).toString()
    setCopiedId(null); setCopyFallback('')
    try { await navigator.clipboard.writeText(link); setCopiedId(room.id) }
    catch { setCopyFallback(link) }
  }
  const canCreateRoom = async () => {
    if (!access.allowed || access.status !== 'ready' || !directoryReady || currentRoom) return false
    const results = await Promise.all([rooms.refetch(), ...(SVOYAK_ENABLED ? [svoyakRooms.refetch()] : [])])
    if (results.some(result => !result.isSuccess)) throw new Error('Не удалось проверить текущую комнату. Повтори попытку.')
    return !results.some(result => Array.isArray(result.data) ? result.data.some(isCurrentRoom) : result.data?.rooms.length)
  }
  const createRoom = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!await canCreateRoom()) { setBusy(false); return }
      const { room } = await api.friendsRoomCreate(roomSetupPayload(setup))
      trackClientEvent('friends_room_created', { roomId: room.id, gameType: room.gameType, rulesVersion: room.rulesVersion }, { eventId: deterministicClientEventId(room.id, 'friends_room_created') })
      if (room.gameType === 'territory') trackTerritoryEvent('territory_room_created', { roomId: room.id, rulesVersion: room.rulesVersion, sourceSurface: 'lobby' }, { eventId: deterministicClientEventId(room.id, 'territory_room_created') })
      await client.invalidateQueries({ queryKey: queryKeys.friendsRooms })
      await navigateApplication(`/games/together?room=${encodeURIComponent(room.code)}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать комнату. Повтори попытку.'); setBusy(false) }
  }
  const leaveRoom = async () => {
    if (!leaving || busy) return
    setBusy(true); setError('')
    try {
      if (leaving.gameType === 'svoyak') {
        const credentials = roomCredentials(leaving.code)
        if (!credentials) throw new Error('Не удалось восстановить вход в комнату. Открой её по ссылке.')
        await svoyakClient.command(credentials, { type: 'leave' })
      } else await api.friendsRoomLeave(leaving.id, crypto.randomUUID())
      setCopiedId(null); setCopyFallback('')
      setLeaving(null)
      await client.invalidateQueries({ queryKey: queryKeys.friendsRooms })
      await client.invalidateQueries({ queryKey: svoyakDirectoryKey })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выйти из комнаты.') }
    finally { setBusy(false) }
  }
  const company = currentRoom ? <RoomCompanyPanel capacity={currentRoom.capacity} count={currentRoom.players} status={friendsRoomPhaseLabel(currentRoom.phase)} roster={<p className="room-company-intro">{currentRoom.phase === 'finished' ? 'Результаты уже в комнате. Когда будешь готов к новой игре, выйди из неё — она останется в недавних.' : 'Твоя комната под рукой. Возвращайся к компании или отправь друзьям приглашение из списка.'}</p>} /> : <RoomCompanyPanel capacity={mode === 'danetki' ? 4 : mode === 'territory' ? 2 : mode === 'svoyak' ? 12 : 8}>
    {!joining && <RoomJoinForm svoyakEnabled={SVOYAK_ENABLED} />}
  </RoomCompanyPanel>
  return <ApplicationFrame pathname={LOBBY_HREF} aside={company}><main className="room-lobby-page" id="room-lobby-main" tabIndex={-1}>
    <PageHeading title="Лобби" description="Твои игры с друзьями: создай комнату или вернись к компании." actions={<QuestButton kind="outline" size="compact" onClick={() => setJoining(true)}><KeyRound size={17} />Есть код?</QuestButton>} />
    {error && !leaving && <InlineAlert tone="danger">{error}</InlineAlert>}
    {!currentRoom && access.status === 'error' && <InlineAlert tone="warning">Не удалось проверить клубный билет.<QuestButton kind="text" onClick={access.retry}>Повторить</QuestButton></InlineAlert>}
    {currentRoom && <RoomDirectory rooms={directoryRooms.filter(isCurrentRoom)} busy={busy} hasCurrentRoom copiedId={copiedId} onCopy={room => void copyInvitation(room)} onLeave={room => { setError(''); setLeaving(room) }} />}
    {copiedId && <p className="room-directory-note room-directory-feedback" role="status">Приглашение скопировано — отправь ссылку друзьям.</p>}
    {copyFallback && <div className="room-directory-feedback"><InlineAlert tone="warning">Не удалось скопировать автоматически. Выдели и скопируй ссылку:<code>{copyFallback}</code></InlineAlert></div>}
    {!authenticationRequired && (currentRoom || rooms.isSuccess) && directory.isError && <div className="room-directory-feedback"><InlineAlert tone="warning">Не удалось загрузить недавние комнаты.<QuestButton kind="text" onClick={() => void directory.refetch()}>Повторить</QuestButton></InlineAlert></div>}
    {!currentRoom && (!directoryReady ? <section className="room-lobby-config">{rooms.isError || svoyakRooms.isError ? <InlineAlert tone="warning">Не удалось проверить текущую комнату.<QuestButton kind="text" onClick={() => { void rooms.refetch(); if (SVOYAK_ENABLED) void svoyakRooms.refetch() }}>Повторить</QuestButton></InlineAlert> : <p role="status">Проверяем текущую комнату…</p>}</section> : <section className="room-lobby-config" id="room-lobby-create" tabIndex={-1} aria-label="Настройка игры">
      <RoomModePicker value={mode} territoryEnabled={meta?.features?.territoryEnabled === true} svoyakEnabled={SVOYAK_ENABLED} disabled={busy} onChange={next => { if (next !== mode) trackMetrikaGoal('select_mode', { mode: next, source_surface: 'lobby' }); setMode(next); setError(''); if (next !== 'svoyak') setSetup(current => ({ ...current, gameType: next })); void navigateApplication(`${LOBBY_HREF}?mode=${next}`, true) }} />
      {mode === 'svoyak' ? <Suspense fallback={<p role="status">Загружаем настройки…</p>}><SvoyakRoomCreation beforeCreate={canCreateRoom} onBusyChange={setBusy} initialName={identity?.user.name ?? ''} allowed={access.allowed && access.status === 'ready'} unavailableAction={authenticationRequired ? <a className="quest-button quest-button--primary" href="/login?returnUrl=%2Flobby%3Fmode%3Dsvoyak">Войти и создать комнату<ArrowRight size={19} /></a> : access.status !== 'ready' ? <QuestButton disabled>{access.status === 'loading' ? 'Проверяем доступ…' : 'Доступ не проверен'}</QuestButton> : undefined} /></Suspense> : <>
        <RoomSetup value={setup} onChange={setSetup} hideModePicker compact disabled={busy} />
        <RoomCreationFooter summary={mode === 'quiz' ? `${setup.packs.length} ${setup.packs.length === 1 ? 'категория' : setup.packs.length < 5 ? 'категории' : 'категорий'}, ${setup.roundsTotal} раундов` : mode === 'territory' ? 'Дуэль на двоих' : 'Расследование для компании'}>{authenticationRequired ? <a className="quest-button quest-button--primary" href="/login?returnUrl=%2Flobby">Войти и создать комнату<ArrowRight size={19} /></a> : access.status === 'ready' ? access.allowed ? <QuestButton onClick={() => void createRoom()} disabled={busy}>{busy ? 'Создаём комнату…' : 'Создать комнату'}<ArrowRight size={19} /></QuestButton> : <a className="quest-button quest-button--primary" href={STUDY_CLUB_OFFER_HREF}>Открыть с Клубом<ArrowRight size={19} /></a> : <QuestButton disabled>{access.status === 'loading' ? 'Проверяем доступ…' : 'Доступ не проверен'}</QuestButton>}</RoomCreationFooter>
      </>}
    </section>)}
    {recentRooms.length > 0 && <details className="room-lobby-history"><summary><History size={17} aria-hidden="true" /><span>История комнат</span><small>{recentRooms.length}</small><ChevronDown size={17} aria-hidden="true" /></summary><RoomDirectory rooms={recentRooms} busy={busy} hasCurrentRoom={Boolean(currentRoom)} copiedId={copiedId} onCopy={room => void copyInvitation(room)} onLeave={room => { setError(''); setLeaving(room) }} /></details>}
    {leaving && leavePresentation && <ApplicationDialog variant="confirmation" title={leavePresentation.title} description={leavePresentation.description} onClose={() => { if (!busy) setLeaving(null) }} footer={<><QuestButton kind="outline" disabled={busy} onClick={() => setLeaving(null)}>Остаться</QuestButton><QuestButton disabled={busy} onClick={() => void leaveRoom()}>{busy ? 'Выходим…' : leavePresentation.action}</QuestButton></>}>{error && <InlineAlert tone="danger">{error}</InlineAlert>}</ApplicationDialog>}
    {joining && <ApplicationDialog title="Войти в комнату" description={currentRoom ? 'Сначала выйди из текущей комнаты, чтобы присоединиться к другой компании.' : 'Попроси код у того, кто собирает компанию.'} onClose={() => setJoining(false)}><div className="room-lobby-join-dialog">{currentRoom ? <QuestButton kind="outline" onClick={() => { setJoining(false); setError(''); setLeaving(currentRoom) }}>Выйти из текущей комнаты</QuestButton> : <RoomJoinForm svoyakEnabled={SVOYAK_ENABLED} />}</div></ApplicationDialog>}
  </main></ApplicationFrame>
}
