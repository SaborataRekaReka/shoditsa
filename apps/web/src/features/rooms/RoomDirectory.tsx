import { useState } from 'react'
import { ArrowRight, Check, Copy, Crown, DoorOpen, History, LogOut, Plus, UsersRound, X } from 'lucide-react'
import { QuestButton, QuestOptionGroup } from '../../components/ui/QuestPrimitives'
import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { publicAssetUrl } from '../../app/public-asset'
import { friendsRoomPhaseLabel } from '../friends-room/friends-room-summary'
import { canRejoinRoom, isCurrentRoom, roomDirectoryAction, roomDirectoryHref, roomDirectoryTitle, roomLeavePresentation, type DirectoryRoom } from './room-directory-model'
import './room-directory.css'

type Filter = 'all' | 'host' | 'player'
type Props = {
  rooms: DirectoryRoom[]
  busy: boolean
  hasCurrentRoom: boolean
  copiedId: string | null
  onCopy: (room: DirectoryRoom) => void
  onLeave: (room: DirectoryRoom) => void
  onCreate: () => void
}
const dateLabel = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }).format(date)
}

function RoomDirectoryRow({ room, busy, hasCurrentRoom, copiedId, onCopy, onLeave }: Omit<Props, 'rooms' | 'onCreate'> & { room: DirectoryRoom }) {
  const current = isCurrentRoom(room)
  const rejoin = canRejoinRoom(room)
  const rejoinHref = room.gameType === 'svoyak' && room.phase === 'lobby' ? `/svoyak/join/${room.code}` : roomDirectoryHref(room)
  const rejoinLabel = room.phase === 'lobby' ? 'Войти' : 'Вернуться'
  const full = room.players >= room.capacity && !(room.gameType === 'svoyak' && room.phase !== 'lobby')
  const art = room.gameType === 'svoyak' ? 'svoyak' : room.gameType === 'territory' ? 'territory' : room.gameType === 'danetki' ? 'yes-no' : room.packs.length > 1 ? 'game' : room.mode
  const status = room.closedAt ? 'Закрыта' : room.phase === 'finished' ? 'Игра завершена' : room.leftAt ? 'Ты вышел' : friendsRoomPhaseLabel(room.phase)
  const leave = roomLeavePresentation(room)
  return <li className={`room-directory-row${current ? ' is-current' : ''}`}>
    <div className="room-directory-row__identity">
      <ThemedArtwork src={publicAssetUrl(`images/home-doodle/${art}.webp`)} alt="" width="58" height="58" />
      <div><div className="room-directory-row__role">{room.isHost ? <Crown size={13} aria-hidden="true" /> : <UsersRound size={13} aria-hidden="true" />}{room.isHost ? 'Ты создатель' : 'Ты игрок'}</div><h3>{roomDirectoryTitle(room)}</h3><div className="room-directory-row__meta"><span>Код <b>{room.code}</b></span><span><UsersRound size={13} aria-hidden="true" />{current || rejoin ? `${room.players} / ${room.capacity}` : `Участников: ${room.participantCount ?? room.players}`}</span></div></div>
    </div>
    <div className="room-directory-row__state"><span className="room-directory-status" data-tone={current && room.phase !== 'finished' ? 'live' : 'past'}><i aria-hidden="true" />{status}</span>{!current && <time dateTime={room.updatedAt}>{dateLabel(room.updatedAt)}</time>}</div>
    {(current || rejoin) && <div className="room-directory-row__actions">
      {current ? <a className={`quest-button quest-button--${room.phase === 'finished' ? 'outline' : 'primary'} quest-button--compact`} href={roomDirectoryHref(room)}>{roomDirectoryAction(room)}<ArrowRight size={16} aria-hidden="true" /></a> : hasCurrentRoom || full ? <QuestButton kind="outline" size="compact" disabled title={hasCurrentRoom ? 'Сначала выйди из текущей комнаты' : 'В комнате нет свободных мест'}><DoorOpen size={16} />{full ? 'Нет мест' : rejoinLabel}</QuestButton> : <a className="quest-button quest-button--outline quest-button--compact" href={rejoinHref}><DoorOpen size={16} />{rejoinLabel}</a>}
      {(current || rejoin) && room.phase === 'lobby' && <QuestButton kind="outline" size="compact" disabled={busy} aria-label={`Скопировать приглашение в комнату ${room.code}`} onClick={() => onCopy(room)}>{copiedId === room.id ? <Check size={16} /> : <Copy size={16} />}{copiedId === room.id ? 'Скопировано' : 'Ссылка'}</QuestButton>}
      {current && <QuestButton kind="text" size="compact" disabled={busy} aria-label={`${leave.action}: ${room.code}`} onClick={() => onLeave(room)}>{room.isHost && room.phase !== 'finished' && leave.action === 'Закрыть комнату' ? <X size={16} /> : <LogOut size={16} />}{leave.action}</QuestButton>}
    </div>}
  </li>
}

export function RoomDirectory(props: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const visible = props.rooms.filter(room => filter === 'all' || (filter === 'host' ? room.isHost : !room.isHost))
  const current = visible.filter(isCurrentRoom)
  const recent = visible.filter(room => !isCurrentRoom(room))
  const row = (room: DirectoryRoom) => <RoomDirectoryRow key={room.id} {...props} room={room} />
  return <section className="room-lobby-directory" aria-label="Комнаты">
    {!props.hasCurrentRoom && <QuestButton className="room-directory-create" kind="outline" size="compact" onClick={props.onCreate}><Plus size={17} />Новая комната</QuestButton>}
    {props.rooms.length > 1 && <QuestOptionGroup label="Какие комнаты показать" value={filter} options={[{ value: 'all', label: 'Все' }, { value: 'host', label: 'Созданы тобой' }, { value: 'player', label: 'Ты игрок' }]} onChange={setFilter} />}
    {current.length > 0 && <div className="room-directory-group"><ul aria-label="Текущие комнаты">{current.map(row)}</ul></div>}
    {recent.length > 0 && <div className="room-directory-group"><h3><History size={15} aria-hidden="true" />Недавние</h3><ul aria-label="Недавние комнаты">{recent.map(row)}</ul><p className="room-directory-note">Здесь хранятся последние 30 комнат. Доступные комнаты можно открыть снова.</p></div>}
    {!visible.length && <p className="room-directory-empty">{props.rooms.length ? 'В этой категории пока нет комнат.' : 'Здесь появятся комнаты, которые ты создашь или в которые войдёшь.'}</p>}
  </section>
}
