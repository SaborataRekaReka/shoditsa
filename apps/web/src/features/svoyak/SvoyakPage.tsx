import { SvoyakQuestionContent } from './SvoyakQuestionContent'
import { ApplicationDialog } from '../application/ApplicationDialog'
import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { PageHeading } from '../../components/ui/PageHeading'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, BellRing, Check, Copy, Eye, LogOut, RefreshCw, SlidersHorizontal, X } from 'lucide-react'
import { PageBackline } from '../../components/ui/PageBackline'
import { ApplicationFrame } from '../application/ApplicationFrame'
import { ApplicationAside } from '../application/ApplicationAside'
import { RoomCompanyPanel } from '../rooms/RoomCompanyPanel'
import { QuestButton, QuestCountdown, QuestOptionGroup, QuestSwitch } from '../../components/ui/QuestPrimitives'
import { QuestionPriceButton } from '../../components/ui/QuestionPriceButton'
import { PlayerIdentityField } from '../../components/ui/PlayerIdentityField'
import { SelectControl } from '../../components/ui/UiControls'
import { publicAssetUrl } from '../../app/public-asset'
import { SVOYAK_AVATARS, svoyakHref, type AvatarId, type Catalog, type Command, type Credentials, type Preferences, type RoomSettings, type RoomView } from './contracts'
import { rememberRoom, roomCredentials, svoyakClient, SvoyakError } from './client'
import { useVoteAutosave } from './use-vote-autosave'
import { SvoyakWelcome } from './SvoyakWelcome'
import { RoomCreationFooter } from '../rooms/RoomCreationFooter'
import { parseSvoyakDraft, SVOYAK_DRAFT_KEY } from './creation-draft'
import { observeSvoyakRoom } from './room-directory-storage'
import { assertRoomEntryAvailable } from '../rooms/room-entry'
import { LOBBY_HREF } from '../rooms/room-navigation'
import { navigateApplication } from '../../app/application-navigation'
import { STUDY_CLUB_OFFER_HREF } from '../../dev/quest-game/account-routing'
import './svoyak-flow.css'
import './svoyak-game.css'
import './svoyak-lobby.css'

const face = (id: string) => SVOYAK_AVATARS.find(a => a.id === id)?.face ?? '🐱'
const questionCount = (count: number) => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? 'вопросов' : count % 10 === 1 ? 'вопрос' : count % 10 >= 2 && count % 10 <= 4 ? 'вопроса' : 'вопросов'}`
const errorText = (error: unknown) => error instanceof Error && !/fetch failed|failed to fetch|timed out|timeout/i.test(error.message) ? error.message : 'Не удалось загрузить данные. Повтори попытку.'
const ownIdentity = () => { try { return JSON.parse(sessionStorage.getItem('svoyak:identity') ?? 'null') as { name: string; avatar: AvatarId } | null } catch { return null } }
function saveIdentity(name: string, avatar: AvatarId) { try { sessionStorage.setItem('svoyak:identity', JSON.stringify({ name, avatar })) } catch { /* Optional convenience. */ } }
function parseRoute(path: string) {
  const match = path.match(/^\/svoyak\/(?:join|rooms)\/([a-fA-F0-9]{6})(?:\/result)?\/?$/)
  return { code: match?.[1].toUpperCase() ?? '', create: path === svoyakHref.create }
}
function SettingsFields({ value, onChange, disabled }: { value: RoomSettings; onChange: (value: RoomSettings) => void; disabled?: boolean }) {
  return <div className="svoyak-settings-grid">
    <QuestOptionGroup label="Раунды" value={value.rounds} options={[1, 2, 3].map(n => ({ value: n, label: String(n) }))} disabled={disabled} onChange={rounds => onChange({ ...value, rounds })} />
    <label className="svoyak-field"><span>Тем в раунде</span><SelectControl variant="soft" aria-label="Тем в раунде" disabled={disabled} value={value.themesPerRound} onChange={event => onChange({ ...value, themesPerRound: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</SelectControl></label>
    <QuestOptionGroup label="Время на вопрос, сек." value={value.secondsPerQuestion} options={[15, 30, 45, 60].map(n => ({ value: n, label: String(n) }))} disabled={disabled} onChange={secondsPerQuestion => onChange({ ...value, secondsPerQuestion })} />
    <div className="svoyak-field"><span>Компания</span><QuestSwitch label="Контент 18+" checked={value.age === 18} disabled={disabled} onChange={adult => onChange({ ...value, age: adult ? 18 : 16 })} /></div>
  </div>
}
function IdentityForm({ submit, busy, host = false, initialName = '', canSubmit = true, unavailableAction, error }: { submit: (name: string, avatar: AvatarId, settings: RoomSettings) => void; busy: boolean; host?: boolean; initialName?: string; canSubmit?: boolean; unavailableAction?: ReactNode; error?: string }) {
  const [draft] = useState(() => {
    let raw = null
    try { if (host) raw = sessionStorage.getItem(SVOYAK_DRAFT_KEY) } catch { /* Storage is optional. */ }
    return parseSvoyakDraft(raw, ownIdentity()?.name ?? initialName)
  })
  const [name, setName] = useState(draft.name)
  const [avatar, setAvatar] = useState<AvatarId>(host ? draft.avatar : ownIdentity()?.avatar ?? 'cat')
  const [settings, setSettings] = useState(draft.settings)
  useEffect(() => { if (host) { try { sessionStorage.setItem(SVOYAK_DRAFT_KEY, JSON.stringify({ name, avatar, settings })) } catch { /* Storage is optional. */ } } }, [host, name, avatar, settings])
  const action = !canSubmit && unavailableAction ? unavailableAction : <QuestButton type="submit" disabled={busy || !name.trim() || !canSubmit}>{busy ? 'Подключаемся…' : host ? 'Создать комнату' : 'Войти в комнату'}<ArrowRight size={19} /></QuestButton>
  return <form className="svoyak-form" onSubmit={e => { e.preventDefault(); saveIdentity(name, avatar); submit(name.trim(), avatar, settings) }}>
    <PlayerIdentityField name={name} avatar={avatar} avatars={SVOYAK_AVATARS} disabled={busy} onNameChange={setName} onAvatarChange={setAvatar} />
    {host && <SettingsFields value={settings} onChange={setSettings} disabled={busy} />}
    {error && <p className="svoyak-notice svoyak-notice--error" role="alert">{error}</p>}
    {host ? <RoomCreationFooter svoyak summary={questionCount(settings.rounds * settings.themesPerRound * 5)}>{action}</RoomCreationFooter> : action}
  </form>
}
export function SvoyakRoomCreation({ initialName = '', allowed, unavailableAction, beforeCreate, onBusyChange }: { initialName?: string; allowed: boolean; unavailableAction?: ReactNode; beforeCreate: () => Promise<boolean>; onBusyChange: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const create = async (name: string, avatar: AvatarId, settings: RoomSettings) => {
    if (!allowed || busy) return
    setBusy(true); onBusyChange(true); setError('')
    try {
      if (!await beforeCreate()) return
      const result = await svoyakClient.create(name, avatar, settings)
      rememberRoom(result.credentials)
      await navigateApplication(svoyakHref.room(result.room.code))
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false); onBusyChange(false) }
  }
  return <section className="svoyak-flow svoyak-create-embedded" aria-label="Настройки своей игры"><IdentityForm host initialName={initialName} canSubmit={allowed} error={error} unavailableAction={unavailableAction ?? <a className="quest-button quest-button--primary" href={STUDY_CLUB_OFFER_HREF}>Открыть с Клубом</a>} busy={busy} submit={(name, avatar, settings) => void create(name, avatar, settings)} /></section>
}
function Members({ room, scores = false, kick }: { room: RoomView; scores?: boolean; kick?: (id: string) => void }) {
  const members = room.members.filter(m => scores ? m.role === 'player' : true)
  return <div className={scores ? 'svoyak-company' : 'svoyak-lobby-members'} aria-label={scores ? 'Игроки и очки' : 'Участники комнаты'}>{members.map((member, index) => <div key={member.id} className={`svoyak-person${member.id === (room.current?.answeringId ?? room.chooserId) ? ' svoyak-person--current' : ''}`}>
    <span className={`svoyak-person__portrait svoyak-person__portrait--${index % 4}`} aria-hidden="true">{face(member.avatar)}</span><span className="svoyak-person__name"><strong>{member.name}</strong><small>{member.id === room.me?.id ? 'Ты' : member.role === 'host' ? 'Ведущий' : ''}</small></span>
    {scores ? <strong className="svoyak-person__score">{member.score.toLocaleString('ru-RU')}</strong> : <span className={`svoyak-member-status${member.ready ? ' is-ready' : ''}`}>{member.role === 'host' ? 'Ведущий' : member.ready ? <><Check size={16} />Готов</> : 'Выбирает'}</span>}
    {kick && member.role !== 'host' && <QuestButton kind="icon" aria-label={`Убрать игрока ${member.name}`} onClick={() => kick(member.id)}><X size={16} /></QuestButton>}
  </div>)}</div>
}
const themeCount = (count: number) => `${count} ${count === 1 ? 'тема' : count < 5 ? 'темы' : 'тем'}`
function Lobby({ room, catalog, busy, command, savePreferences }: { room: RoomView; catalog: Catalog | null; busy: boolean; command: (command: Command) => Promise<boolean>; savePreferences: (value: Preferences) => Promise<void> }) {
  const member = room.me!
  const host = member.role === 'host'
  const [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false)
  const [dialog, setDialog] = useState<'profile' | 'settings' | 'plan' | null>(null)
  const [draftSettings, setDraftSettings] = useState(room.settings)
  const [name, setName] = useState(member.name), [avatar, setAvatar] = useState<AvatarId>(member.avatar)
  const votes = useVoteAutosave(member, savePreferences)
  const preferences = votes.value, dirty = votes.pending
  const players = room.members.filter(m => m.role === 'player'), ready = players.filter(m => m.ready && !(m.id === member.id && dirty)).length
  const share = new URL(svoyakHref.join(room.code), location.origin).href
  const topics = catalog?.topics.filter(t => t.playable) ?? []
  const priority = ['cinema', 'games', 'geography', 'music', 'internet']
  const orderedTopics = [...topics].sort((a, b) => (priority.includes(a.id) ? priority.indexOf(a.id) : 99) - (priority.includes(b.id) ? priority.indexOf(b.id) : 99))
  const toggleTopic = votes.toggle
  const topicChoice = (topic: Catalog['topics'][number]) => {
    const selected = preferences.topics.includes(topic.id)
    const voters = room.members.filter(m => m.id === member.id ? selected : m.preferences.topics.includes(topic.id))
    const voterNames = voters.map(m => m.id === member.id ? `${m.name} (ты)` : m.name).join(', ')
    return <QuestButton key={topic.id} kind="choice" size="compact" aria-label={topic.label} aria-pressed={selected} aria-describedby={voters.length ? `svoyak-voters-${topic.id}` : undefined} disabled={busy} onClick={() => toggleTopic(topic.id)}><span>{topic.label}</span>{voters.length > 0 && <span id={`svoyak-voters-${topic.id}`} className="svoyak-lobby__voters" role="img" aria-label={`Выбрали: ${voterNames}`} title={voterNames}>{voters.slice(0, 3).map(voter => <span key={voter.id} className={`svoyak-lobby__avatar svoyak-lobby__avatar--${room.members.findIndex(m => m.id === voter.id) % 4} svoyak-lobby__avatar--vote`} aria-hidden="true"><span className="svoyak-lobby__emoji">{face(voter.avatar)}</span></span>)}{voters.length > 3 && <span className="svoyak-lobby__avatar svoyak-lobby__avatar--vote svoyak-lobby__avatar--overflow" aria-hidden="true">+{voters.length - 3}</span>}</span>}</QuestButton>
  }
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (await command({ type: 'profile', name, avatar })) { saveIdentity(name, avatar); setDialog(null) }
  }
  const openProfile = () => { setName(member.name); setAvatar(member.avatar); setDialog('profile') }
  const status = votes.failed ? 'Повторяем сохранение твоего выбора…' : dirty ? 'Сохраняем выбор…'
    : players.length < 2 ? 'Пригласи хотя бы двух игроков'
      : room.preparation?.status === 'error' ? room.preparation.message
        : !room.plan ? 'Подбираем вопросы…' : ready === players.length ? 'Все готовы. Можно начинать!' : member.ready && !host ? 'Ты готов. Ждём остальных' : 'Отметьте готовность, когда выберете темы'
  return <section className="svoyak-lobby" aria-label="Лобби своей игры">
    <header className="svoyak-lobby__header">
      <div className="svoyak-lobby__title"><ThemedArtwork src={publicAssetUrl('images/home-doodle/svoyak.webp')} width="44" height="44" alt="" /><div><h1>Собираемся играть</h1><p>Своя игра, комната {room.code}</p></div></div>
      <div className="svoyak-lobby__tools"><QuestButton kind="outline" size="compact" onClick={() => { void navigator.clipboard.writeText(share).then(() => { setCopied(true); setCopyFailed(false) }).catch(() => setCopyFailed(true)) }}><Copy size={16} />{copied ? 'Скопировано' : 'Пригласить'}</QuestButton>{host && <QuestButton kind="icon" aria-label="Настройки комнаты" onClick={() => { setDraftSettings(room.settings); setDialog('settings') }}><SlidersHorizontal size={20} /></QuestButton>}</div>
    </header>
    {copyFailed && <p className="svoyak-lobby__copy">Ссылка для приглашения: <a href={share}>{share}</a></p>}
    <ApplicationAside><RoomCompanyPanel capacity={12} count={room.members.length} status="Комната открыта" roster={<div className="svoyak-lobby__roster" role="region" tabIndex={0} aria-label="Участники комнаты">
      {room.members.map((person, index) => {
        const isReady = person.role === 'player' && person.ready && !(person.id === member.id && dirty)
        const portrait = <span className="svoyak-lobby__portrait"><span className={`svoyak-lobby__avatar svoyak-lobby__avatar--${index % 4}`} aria-hidden="true">{face(person.avatar)}</span>{isReady && <span className="svoyak-lobby__ready" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>}</span>
        return <div key={person.id} className={`svoyak-lobby__person${person.id === member.id ? ' is-you' : ''}`}>
          {person.id === member.id ? <QuestButton kind="icon" aria-label="Изменить имя и аватар" title="Изменить имя и аватар" onClick={openProfile}>{portrait}</QuestButton> : portrait}
          <span className="svoyak-lobby__person-name"><strong>{person.name}{person.id === member.id && <small>ты</small>}</strong><span>{person.connected === false ? 'Не в сети' : person.role === 'host' ? 'Ведущий' : isReady ? 'Готов' : 'Выбирает'}</span></span>
        </div>
      })}
    </div>} /></ApplicationAside>
    <section className="svoyak-lobby__selection" aria-labelledby="svoyak-topic-heading">
      <div className="svoyak-lobby__section-head"><h2 id="svoyak-topic-heading">Темы на выбор</h2></div>
      {catalog ? <div className="svoyak-lobby__topic-options">{orderedTopics.map(topicChoice)}</div> : <p className="svoyak-help" role="status">Загружаем темы…</p>}
    </section>
    <footer className="svoyak-lobby__footer"><div className="svoyak-lobby__status" role="status">
      <div className="svoyak-lobby__summary">
        <div className="svoyak-lobby__readiness">
          {players.length > 0 && <span className="svoyak-lobby__ready-meter" aria-hidden="true">{players.map((player, index) => <i key={player.id} className={index < ready ? 'is-ready' : undefined} />)}</span>}
          <strong>{players.length ? `Готовы ${ready} из ${players.length}` : 'Ждём игроков'}</strong>
        </div>
        <span className="svoyak-lobby__question-count">{questionCount(room.settings.rounds * room.settings.themesPerRound * 5)}</span>
      </div>
      <p>{status}</p>
    </div>
      <div className="svoyak-lobby__actions">{room.plan && !dirty && <QuestButton kind="text" size="compact" onClick={() => setDialog('plan')}>Состав</QuestButton>}
        {host ? <QuestButton disabled={busy || dirty || !room.plan || players.length < 2 || ready !== players.length} onClick={() => void command({ type: 'start' })}>Начать игру<ArrowRight size={18} /></QuestButton>
          : <QuestButton kind={member.ready && !dirty ? 'outline' : 'primary'} disabled={busy || dirty || !catalog} onClick={() => void command({ type: 'ready', ready: !member.ready })}>{member.ready && !dirty ? 'Не готов' : 'Я готов'}{!(member.ready && !dirty) && <Check size={18} />}</QuestButton>}
      </div>
    </footer>
    {dialog === 'plan' && room.plan && <ApplicationDialog className="svoyak-flow" title="Состав игры" description={`${questionCount(room.plan.questions)}, ${themeCount(room.plan.themes.length)}, ~${room.plan.estimatedMinutes} мин`} onClose={() => setDialog(null)}><div className="svoyak-lobby__distribution">{room.plan.distribution?.map(item => <div key={item.topic}><span>{topics.find(t => t.id === item.topic)?.label ?? item.topic}</span><strong>{questionCount(item.questions)}</strong></div>)}</div><ol className="svoyak-plan-themes">{room.plan.themes.map(theme => <li key={theme.id}><strong>{theme.name}</strong><span>{theme.packTitle}</span></li>)}</ol><div className="svoyak-coverage">{room.plan.coverage.map(p => <span key={p.playerId}><Check size={14} />{p.name}: {themeCount(p.themes)}</span>)}</div></ApplicationDialog>}
    {dialog === 'profile' && <ApplicationDialog className="svoyak-flow" title="Имя и аватар" onClose={() => setDialog(null)} footer={<QuestButton type="submit" form="svoyak-lobby-profile" disabled={busy}>Сохранить профиль</QuestButton>}><form id="svoyak-lobby-profile" className="svoyak-form" onSubmit={saveProfile}><PlayerIdentityField name={name} avatar={avatar} avatars={SVOYAK_AVATARS} disabled={busy} onNameChange={setName} onAvatarChange={setAvatar} /></form></ApplicationDialog>}
    {dialog === 'settings' && <ApplicationDialog className="svoyak-flow" title="Настройки комнаты" onClose={() => setDialog(null)} footer={<QuestButton disabled={busy || JSON.stringify(draftSettings) === JSON.stringify(room.settings)} onClick={async () => { if (await command({ type: 'settings', settings: draftSettings })) setDialog(null) }}>Применить настройки</QuestButton>}><SettingsFields value={draftSettings} onChange={setDraftSettings} disabled={busy} /><div className="svoyak-lobby__manage"><h3>Участники</h3>{players.map(player => <div key={player.id}><span>{face(player.avatar)} {player.name}</span><QuestButton kind="icon" disabled={busy} aria-label={`Убрать игрока ${player.name}`} onClick={() => void command({ type: 'kick', memberId: player.id })}><X size={17} /></QuestButton></div>)}</div></ApplicationDialog>}
  </section>
}
function useTime(room: RoomView) {
  const [now, setNow] = useState(Date.now())
  const offset = useRef(0)
  useEffect(() => { offset.current = room.serverNow - Date.now(); setNow(Date.now()) }, [room.serverNow])
  useEffect(() => { if (room.current?.phase !== 'reading') return; const timer = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(timer) }, [room.current?.phase, room.current?.id])
  return room.current?.phase === 'reading' && room.current.deadline ? Math.max(0, room.current.deadline - now - offset.current) : room.current?.remainingMs ?? 0
}
function Game({ room, busy, command }: { room: RoomView; busy: boolean; command: (command: Command) => Promise<boolean> }) {
  const current = room.current, remaining = useTime(room), host = room.me?.role === 'host'
  const [confirmFinish, setConfirmFinish] = useState(false)
  const heading = useRef<HTMLDivElement>(null)
  const currentId = current?.id
  useEffect(() => { if (currentId) heading.current?.querySelector('h2')?.focus({ preventScroll: true }) }, [currentId])
  const canBuzz = !host && !!room.me && current?.phase === 'reading' && remaining > 0 && !current.rejectedIds.includes(room.me.id)
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || !canBuzz || busy || confirmFinish) return
      if (event.target instanceof Element && event.target.closest('button,input,textarea,select,a,[contenteditable]')) return
      event.preventDefault(); void command({ type: 'buzz' })
    }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key)
  }, [canBuzz, busy, confirmFinish, command])
  const round = room.board.find(t => t.questions.some(q => !q.played))?.round ?? room.settings.rounds
  const answerer = room.members.find(m => m.id === current?.answeringId)
  const phase = current?.phase ?? 'board'
  const status = current?.phase === 'buzzed' ? `${answerer?.name ?? 'Игрок'} отвечает`
    : current?.phase === 'resolved' ? current.result === 'correct' ? `Верно! +${current.points}` : 'Никто не ответил'
      : room.me && current?.phase === 'reading' && current.rejectedIds.includes(room.me.id) ? 'Ты уже отвечал. Сейчас очередь остальных.' : null
  const showActions = !!current && (host || canBuzz || status)
  const choose = host || room.me?.id === room.chooserId
  return <><section className={`qg-card svoyak-room svoyak-room--${phase}`} aria-label="Своя игра">
    <header className="svoyak-room__head"><div className="svoyak-room__title"><ThemedArtwork src={publicAssetUrl('images/home-doodle/svoyak.webp')} width="48" height="48" alt="" /><div><h1>Своя игра</h1><p>Пак вашей компании</p></div></div><span className="svoyak-role">{host ? 'Ты ведущий' : 'Ты игрок'}</span></header>
    <div className="svoyak-stage"><div className="svoyak-stage__head"><div>{current ? <><span>{current.theme}</span><strong>{current.points} очков</strong></> : <h2>Раунд {round}</h2>}</div>{!current && <span className="svoyak-progress">{room.played} / {room.total}</span>}</div>
      {current && current.phase !== 'resolved' && <div className="svoyak-countdown"><QuestCountdown remainingMs={remaining} durationMs={current.durationMs} paused={current.phase === 'buzzed'} /></div>}
      {current ? <div ref={heading}><SvoyakQuestionContent current={current} host={host} /></div>
      : <div className="svoyak-board" aria-label="Темы и стоимость вопросов">{room.board.filter(t => t.round === round).map((theme, index) => <div className={`svoyak-board__row svoyak-board__row--${index % 3}`} key={theme.id}><div className="svoyak-board__theme"><h2>{theme.name}</h2></div>{theme.questions.map(q => <QuestionPriceButton price={q.points} played={q.played} disabled={!choose || busy} key={q.id} aria-label={`${theme.name}, ${q.points} очков${q.played ? ', разыгран' : ''}`} onClick={() => void command({ type: 'choose', questionId: q.id })} />)}</div>)}</div>}
    </div>
    {showActions && <div className={`svoyak-actionbar${canBuzz ? ' svoyak-actionbar--buzzer' : ''}`}>{status && <div className={`svoyak-turn${current?.result === 'correct' ? ' svoyak-turn--correct' : ''}`} role="status"><strong>{status}</strong></div>}<div className="svoyak-actions">
      {host ? current!.phase === 'resolved' ? <QuestButton disabled={busy} onClick={() => void command({ type: 'next' })}>{room.played === room.total ? 'К результатам' : 'К полю'}<ArrowRight size={20} /></QuestButton> : !current!.answer ? <QuestButton disabled={busy} onClick={() => void command({ type: 'reveal' })}><Eye size={18} />Открыть ответ</QuestButton> : current!.phase === 'buzzed' ? <><QuestButton kind="outline" disabled={busy} onClick={() => void command({ type: 'judge', correct: false })}>Неверно<X size={18} /></QuestButton><QuestButton disabled={busy} onClick={() => void command({ type: 'judge', correct: true })}>Верно +{current!.points}<Check size={18} /></QuestButton></> : <QuestButton disabled={busy} onClick={() => void command({ type: 'judge', correct: null })}>Закрыть вопрос<ArrowRight size={18} /></QuestButton>
      : canBuzz && <QuestButton size="buzzer" aria-keyshortcuts="Space" disabled={busy} onClick={() => void command({ type: 'buzz' })}><BellRing size={25} /><span>Отвечаю!</span><kbd>Пробел</kbd></QuestButton>}
    </div></div>}
    <div className="svoyak-room__players" tabIndex={0} role="region" aria-label="Карточки игроков"><Members room={room} scores /></div>
  </section>{!current && <p className="svoyak-help svoyak-chooser">{choose ? 'Твой выбор: открой тему и стоимость.' : `${room.members.find(m => m.id === room.chooserId)?.name ?? 'Ведущий'} выбирает вопрос.`}</p>}{host && <div className="svoyak-game-tools"><QuestButton kind="text" disabled={busy} onClick={() => setConfirmFinish(true)}>Завершить игру</QuestButton></div>}
    {confirmFinish && <ApplicationDialog variant="confirmation" title="Завершить игру?" description={`Разыграно ${room.played} из ${room.total} вопросов. Сохраним набранные очки и подведём итоги.`} onClose={() => { if (!busy) setConfirmFinish(false) }} footer={<><QuestButton kind="outline" disabled={busy} onClick={() => setConfirmFinish(false)}>Продолжить игру</QuestButton><QuestButton disabled={busy} onClick={async () => { if (await command({ type: 'finish' })) setConfirmFinish(false) }}>Показать результаты</QuestButton></>} />}
  </>
}
function Result({ room, busy, command, navigate }: { room: RoomView; busy: boolean; command: (command: Command) => Promise<boolean>; navigate: (href: string) => void }) {
  const players = room.members.filter(m => m.role === 'player').sort((a, b) => b.score - a.score)
  const best = players[0]?.score ?? 0, winners = players.filter(p => p.score === best), tied = winners.length > 1
  const won = winners.some(p => p.id === room.me?.id)
  return <><section className="svoyak-result"><span className="svoyak-result-art" aria-hidden="true">🏆</span><span className="svoyak-eyebrow">{room.completed ? 'Все вопросы разыграны' : 'Игра завершена досрочно'}</span><h1>{tied ? 'Ничья!' : won ? 'Ты победил!' : `${winners[0]?.name ?? 'Компания'} побеждает!`}</h1><p>{tied ? winners.map(p => p.name).join(', ') : winners[0]?.name} — {best.toLocaleString('ru-RU')} очков.</p><ol className="svoyak-final-scores">{players.map(member => <li key={member.id} className={member.score === best ? 'is-winner' : undefined}><span>{players.findIndex(player => player.score === member.score) + 1}</span><span aria-hidden="true">{face(member.avatar)}</span><strong>{member.name}{member.id === room.me?.id && <small>Ты</small>}</strong><b>{member.score.toLocaleString('ru-RU')}</b></li>)}</ol><p className="svoyak-help">Разыграно {room.played} из {room.total} вопросов. Результат сохранён в комнате.</p><div className="svoyak-form-actions">{room.me?.role === 'host' ? <QuestButton disabled={busy} onClick={() => void command({ type: 'rematch' })}>Ещё игру<RefreshCw size={18} /></QuestButton> : <p className="svoyak-help">Ведущий может запустить новую игру с тем же составом.</p>}<QuestButton kind="outline" onClick={() => navigate('/')}>Все игры</QuestButton></div></section><section className="svoyak-panel"><h2>Пак этой игры</h2><ul className="svoyak-plan-themes">{room.plan?.themes.map(t => <li key={t.id}><strong>{t.name}</strong><span>{t.packTitle}</span></li>)}</ul></section></>
}

export function SvoyakPage({ pathname, onNavigate }: { pathname?: string; onNavigate?: (href: string, replace?: boolean) => Promise<void> } = {}) {
  const [localPath, setPath] = useState(location.pathname), [room, setRoom] = useState<RoomView | null>(null)
  const path = pathname ?? localPath
  const [catalog, setCatalog] = useState<Catalog | null>(null), [catalogError, setCatalogError] = useState('')
  const [error, setError] = useState(''), [connection, setConnection] = useState(''), [busy, setBusy] = useState(false)
  const route = parseRoute(path), [credentials, setCredentials] = useState<Credentials | null>(() => roomCredentials(route.code))
  const [leaving, setLeaving] = useState(false)
  const navigate = useCallback((href: string, replace = false) => {
    setError('')
    if (onNavigate) { void onNavigate(href, replace); return }
    if (!href.startsWith('/svoyak/') && href !== svoyakHref.title) { void navigateApplication(href); return }
    if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href)
    setPath(location.pathname); window.scrollTo({ top: 0 })
  }, [onNavigate])
  useEffect(() => { const pop = () => setPath(location.pathname); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop) }, [])
  useEffect(() => { if (route.create) navigate(`${LOBBY_HREF}?mode=svoyak`, true) }, [route.create, navigate])
  const loadCatalog = useCallback(() => { setCatalogError(''); void svoyakClient.catalog().then(setCatalog).catch(error => setCatalogError(errorText(error))) }, [])
  useEffect(() => { if (route.code) loadCatalog() }, [route.code, loadCatalog])
  useEffect(() => { setRoom(null); setCredentials(route.code ? roomCredentials(route.code) : null); setConnection('') }, [route.code])
  useEffect(() => {
    if (!route.code) return
    let disposed = false, first = true, timer: number | undefined
    const poll = async () => {
      try { const result = await svoyakClient.room(route.code, credentials?.token); if (!disposed) { if (credentials) observeSvoyakRoom(result, credentials, false, first); first = false; setRoom(current => !current || result.revision >= current.revision ? result : current); setConnection('') } }
      catch (error) { if (!disposed) { if (error instanceof SvoyakError && [401,403,404].includes(error.status)) { setError(error.message); disposed = true } else setConnection('Соединение прервалось. Пытаемся подключиться снова…') } }
      finally { if (!disposed) timer = window.setTimeout(poll, 800) }
    }
    void poll(); return () => { disposed = true; window.clearTimeout(timer) }
  }, [route.code, credentials?.token])
  useEffect(() => {
    if (!room?.me) return
    const href = room.stage === 'result' ? svoyakHref.result(room.code) : svoyakHref.room(room.code)
    if (path !== href) navigate(href, true)
  }, [room?.code, room?.stage, room?.me?.id, path, navigate])
  useEffect(() => { if (room?.stage) window.scrollTo({ top: 0 }) }, [room?.stage])
  const command = useCallback(async (value: Command) => {
    if (!credentials || busy) return false
    setBusy(true); setError('')
    try { const next = await svoyakClient.command(credentials, value); setRoom(current => !current || next.revision >= current.revision ? next : current); return true }
    catch (error) { setError(errorText(error)); return false }
    finally { setBusy(false) }
  }, [credentials, busy])
  const savePreferences = useCallback(async (value: Preferences) => {
    if (!credentials) throw new Error('Войдите в комнату')
    const next = await svoyakClient.command(credentials, { type: 'preferences', preferences: value })
    setRoom(current => !current || next.revision >= current.revision ? next : current)
  }, [credentials])
  const enter = async (name: string, avatar: AvatarId, settings: RoomSettings) => {
    setBusy(true); setError('')
    try { if (route.code) await assertRoomEntryAvailable(route.code); const result = route.code ? await svoyakClient.join(route.code, name, avatar) : await svoyakClient.create(name, avatar, settings); rememberRoom(result.credentials); setCredentials(result.credentials); setRoom(result.room); navigate(svoyakHref.room(result.room.code)) }
    catch (error) { if (error instanceof SvoyakError && error.code === 'CLUB_REQUIRED') navigate(STUDY_CLUB_OFFER_HREF); else setError(errorText(error)) }
    finally { setBusy(false) }
  }
  const needsJoin = route.code && room && !room.me && room.stage === 'lobby'
  return <ApplicationFrame pathname={path} aside={<RoomCompanyPanel capacity={13} count={room?.members.length} status={room ? room.stage === 'lobby' ? 'Комната открыта' : room.stage === 'result' ? 'Игра завершена' : room.stage === 'closed' ? 'Комната закрыта' : 'Игра идёт' : undefined} roster={room ? <div className="room-company-members"><Members room={room} scores={room.stage === 'playing' || room.stage === 'result'} /></div> : undefined} />}><main className="svoyak-main svoyak-preview svoyak-flow" id="svoyak-main">
    <PageBackline href={LOBBY_HREF} label="Лобби" trailing={route.code ? <span>Своя игра</span> : undefined} />
    {room?.stage === 'playing' && room.members.find(member => member.id === room.hostId)?.connected === false && <p className="svoyak-notice" role="status">Ведущий не в сети. Комната и очки сохранены — ждём его возвращения.</p>}
    {connection && <p className="svoyak-notice" role="status">{connection}</p>}{error && !leaving && <p className="svoyak-notice svoyak-notice--error" role="alert">{error}</p>}{catalogError && <div className="svoyak-notice" role="alert"><p>{catalogError}</p><QuestButton kind="text" onClick={loadCatalog}>Повторить загрузку тем</QuestButton></div>}
    {route.create ? <p role="status">Открываем настройки комнаты…</p>
      : needsJoin ? <><PageHeading title="Тебя ждут в комнате" description={<>Код {room.code}. Выбери имя и аватар — интересы настроишь в лобби.</>} /><section className="svoyak-panel"><IdentityForm submit={enter} busy={busy} /></section></>
        : route.code && !room ? !error && <section className="svoyak-panel" role="status">Подключаемся к комнате…</section>
          : room?.stage === 'closed' ? <section className="svoyak-panel"><h1>Комната закрыта</h1><p>Можно собраться в новой.</p><QuestButton onClick={() => navigate(svoyakHref.create)}>Создать комнату</QuestButton></section>
            : room && !room.me ? <section className="svoyak-panel"><h1>Игра уже идёт</h1><p>Войти могут участники с сохранённым входом в этом браузере.</p><QuestButton onClick={() => navigate(svoyakHref.title)}>К своей игре</QuestButton></section>
              : room?.stage === 'lobby' ? <Lobby key={room.me!.id} room={room} catalog={catalog} busy={busy} command={command} savePreferences={savePreferences} />
                : room?.stage === 'playing' ? <Game room={room} busy={busy} command={command} />
                  : room?.stage === 'result' ? <Result room={room} busy={busy} command={command} navigate={navigate} />
                    : <SvoyakWelcome navigate={navigate} />}
    {room?.me && room.stage !== 'closed' && <QuestButton kind="text" disabled={busy} onClick={() => { setError(''); setLeaving(true) }}><LogOut size={17} />{room.me.role === 'host' ? 'Закрыть комнату' : 'Выйти из комнаты'}</QuestButton>}
    {leaving && <ApplicationDialog variant="confirmation" title={room?.me?.role === 'host' ? 'Закрыть комнату?' : 'Выйти из комнаты?'} description={room?.me?.role === 'host' ? 'Комната закроется для всех участников и останется в истории. Продолжить игру в ней не получится.' : room?.stage === 'lobby' ? 'Ты сможешь вернуться по приглашению, пока комната открыта и есть свободные места.' : 'Твоё место и очки сохранятся. Вернуться можно по той же ссылке в этом браузере.'} onClose={() => { if (!busy) setLeaving(false) }} footer={<><QuestButton kind="outline" disabled={busy} onClick={() => setLeaving(false)}>Остаться</QuestButton><QuestButton disabled={busy} onClick={async () => { if (await command({ type: 'leave' })) navigate(LOBBY_HREF) }}>{busy ? 'Выходим…' : room?.me?.role === 'host' ? 'Закрыть комнату' : 'Выйти'}</QuestButton></>}>{error && <p className="svoyak-notice svoyak-notice--error" role="alert">{error}</p>}</ApplicationDialog>}
  </main></ApplicationFrame>
}
