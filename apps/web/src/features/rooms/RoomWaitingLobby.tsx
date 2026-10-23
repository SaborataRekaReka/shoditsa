import { useState, type FormEvent } from 'react'
import { Check, Copy, LogOut, MessageCircle, Play, Send, SlidersHorizontal, UsersRound } from 'lucide-react'
import { FRIENDS_ROOM_PACK_VARIANTS, type FriendsRoomConfigBody, type FriendsRoomSnapshot } from '@shoditsa/contracts'
import { PageHeading } from '../../components/ui/PageHeading'
import { PageBackline } from '../../components/ui/PageBackline'
import { QuestButton, QuestInput } from '../../components/ui/QuestPrimitives'
import { InlineAlert } from '../../components/ui'
import { ApplicationDialog } from '../application/ApplicationDialog'
import { RoomParticipants } from './RoomCompanyPanel'
import { RoomSetup } from './RoomSetup'
import { ROOM_CATEGORIES, ROOM_SETUP_MODES, roomSetupPayload } from './room-setup-model'
import './room-lobby.css'
import './room-waiting.css'

type Props = { room: FriendsRoomSnapshot; members: FriendsRoomSnapshot['members']; copied: boolean; busy: boolean; saving: boolean; territoryEnabled: boolean; ticketBalance: number; message: string; messageSending: boolean; error?: string; onMessage: (value: string) => void; onSend: (event: FormEvent) => void; onCopy: () => void; onStart: () => void; onLeave: () => void; onConfigure: (value: FriendsRoomConfigBody) => void }
export function RoomWaitingLobby({ room, members, copied, busy, saving, territoryEnabled, ticketBalance, message, messageSending, error, onMessage, onSend, onCopy, onStart, onLeave, onConfigure }: Props) {
  const [editing, setEditing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const connected = members.filter(member => member.connected).length
  const territoryReady = members.length === 2 && connected === 2
  const shortage = room.gameType === 'territory' ? false : room.gameType === 'danetki' ? room.danetkiLaunchCost > ticketBalance : (room.continuation?.shortage ?? 0) > 0
  const blocked = busy || saving || editing || shortage || room.gameType === 'territory' && !territoryReady
  const solo = connected < 2 && room.gameType !== 'territory'
  const launchLabel = busy ? 'Запускаем…' : saving ? 'Сохраняем настройки…' : editing ? 'Заверши настройку' : shortage ? 'Не хватает билетов' : room.gameType === 'territory' && !territoryReady ? 'Ждём второго игрока' : solo ? 'Начать одному' : room.gameType === 'danetki' ? 'Начать расследование' : 'Начать игру'
  const mode = ROOM_SETUP_MODES.find(item => item.id === room.gameType)!
  return <main className="room-ready room-lobby-page" id="room-waiting-main">
    <PageBackline href="/lobby" label="Лобби" />
    <PageHeading title={room.isHost ? 'Комната готова' : 'Ты в комнате'} description={room.isHost ? 'Пригласи друзей. Когда все соберутся, начинай игру.' : 'Дождись остальных. Игру запустит создатель комнаты.'} />
    {error && !leaving && <InlineAlert tone="danger">{error}</InlineAlert>}
    <section className="room-ready-invite" aria-label="Приглашение в комнату"><div><span>Код комнаты</span><strong>{room.code}</strong></div><QuestButton kind="outline" onClick={onCopy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</QuestButton><p>Отправь друзьям ссылку или код. Они смогут войти бесплатно.</p></section>
    <section className="room-ready-people" aria-label="Участники комнаты"><header><h2><UsersRound size={21} />Кто играет</h2><span>{members.length} из {room.capacity}</span></header><RoomParticipants room={room} members={members} />{connected < 2 && <p className="room-ready-note" role="status">{members.length < 2 ? 'Пока ты здесь один. Присоединившиеся друзья появятся здесь автоматически.' : 'Ждём подключения остальных участников.'}</p>}</section>
    <section className="room-ready-summary" aria-label="Настройки комнаты"><header><div><span>Во что играем</span><h2>{mode.title}</h2></div>{room.isHost && <QuestButton kind="outline" size="compact" disabled={busy || saving} aria-expanded={editing} aria-controls="room-settings-editor" onClick={() => setEditing(current => !current)}><SlidersHorizontal size={17} />{editing ? 'Готово' : 'Изменить'}</QuestButton>}</header>
      {editing && room.isHost ? <div id="room-settings-editor" className="room-ready-editor"><RoomSetup value={{ gameType: room.gameType, packs: room.packs, roundsTotal: room.roundsTotal, answerTimeSeconds: room.answerTimeSeconds, shufflePacks: room.shufflePacks }} territoryEnabled={territoryEnabled} disabled={busy} roundsEditable={room.continuation?.accessSource === 'club'} onChange={value => onConfigure(roomSetupPayload(value))} /><p role="status">{saving ? 'Сохраняем изменения…' : 'Изменения сохраняются автоматически.'}</p><QuestButton kind="outline" disabled={saving || busy} onClick={() => setEditing(false)}>Готово</QuestButton></div> : room.gameType === 'quiz' ? <><ul className="room-ready-categories">{room.packs.map(pack => <li key={pack.mode}><strong>{ROOM_CATEGORIES.find(category => category.id === pack.mode)?.label}</strong><span>{FRIENDS_ROOM_PACK_VARIANTS[pack.mode]?.find(variant => variant.id === pack.variant)?.label}</span></li>)}</ul><div className="room-ready-rules"><span>{room.roundsTotal} раундов</span><span>{room.answerTimeSeconds} с на ответ</span><span>{room.shufflePacks ? 'Категории вперемешку' : 'Категории по очереди'}</span></div></> : <p>{room.gameType === 'territory' ? 'Дуэль на двоих. Отвечайте на вопросы и захватывайте клетки карты.' : 'Одна история для всей компании. Задавайте вопросы по очереди и найдите разгадку.'}</p>}
      {!room.isHost && <p className="room-ready-note">Настройки меняет создатель комнаты.</p>}
    </section>
    <footer className="room-lobby-launch room-ready-launch">{room.isHost ? <><QuestButton disabled={blocked} onClick={onStart}><Play size={18} />{launchLabel}</QuestButton><p>{room.gameType === 'territory' ? territoryReady ? 'Оба игрока на связи. Нажми, чтобы начать дуэль.' : 'Для запуска нужны два игрока на связи.' : solo ? 'Можно потренироваться одному или дождаться друзей.' : 'Нажми, когда вся компания будет готова.'}{room.gameType === 'danetki' && room.danetkiLaunchCost > 0 ? ` При запуске спишется ${room.danetkiLaunchCost} билетов.` : ''}</p></> : <p role="status">Ждём, когда создатель начнёт игру.</p>}</footer>
    <details className="room-ready-chat"><summary><MessageCircle size={19} />Чат комнаты<span>{room.messages.length}</span></summary><div className="room-ready-messages" aria-live="polite">{room.messages.length ? room.messages.slice(-30).map(entry => <p key={entry.id}><strong>{entry.displayName}</strong><span>{entry.text}</span></p>) : <p>Поздоровайтесь, пока компания собирается.</p>}</div><form onSubmit={onSend}><QuestInput aria-label="Сообщение в чат" placeholder="Напиши друзьям…" value={message} onChange={event => onMessage(event.target.value)} maxLength={300} /><QuestButton kind="icon" type="submit" aria-label="Отправить сообщение" disabled={messageSending || !message.trim()}><Send size={19} /></QuestButton></form></details>
    <QuestButton kind="text" className="room-ready-leave" disabled={busy || saving} onClick={() => setLeaving(true)}><LogOut size={17} />{room.isHost ? 'Закрыть комнату' : 'Выйти из комнаты'}</QuestButton>
    {leaving && <ApplicationDialog variant="confirmation" title={room.isHost ? 'Закрыть комнату?' : 'Выйти из комнаты?'} description={room.isHost ? 'Приглашение перестанет работать, и всем участникам придётся собраться в новой комнате.' : 'Ты сможешь вернуться по приглашению, пока комната открыта.'} onClose={() => { if (!busy) setLeaving(false) }} footer={<><QuestButton kind="outline" disabled={busy} onClick={() => setLeaving(false)}>Остаться</QuestButton><QuestButton disabled={busy} onClick={onLeave}>{busy ? 'Выходим…' : room.isHost ? 'Закрыть комнату' : 'Выйти'}</QuestButton></>}>{error && <InlineAlert tone="danger">{error}</InlineAlert>}</ApplicationDialog>}
  </main>
}

