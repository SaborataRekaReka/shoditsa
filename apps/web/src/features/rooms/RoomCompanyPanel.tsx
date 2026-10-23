import { useState, type ReactNode } from 'react'
import { ArrowRight, Check, Crown, KeyRound, Plus, UsersRound } from 'lucide-react'
import type { FriendsRoomSnapshot } from '@shoditsa/contracts'
import { QuestButton, QuestInput } from '../../components/ui/QuestPrimitives'
import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { publicAssetUrl } from '../../app/public-asset'
import { navigateApplication } from '../../app/application-navigation'
import { roomJoinHref } from './room-navigation'
import './room-company.css'

export function RoomJoinForm({ svoyakEnabled = false }: { svoyakEnabled?: boolean }) {
  const [code, setCode] = useState('')
  const join = roomJoinHref(code, svoyakEnabled)
  return <form className="room-company-join" onSubmit={event => { event.preventDefault(); if (join) void navigateApplication(join) }}>
    <label htmlFor="room-join-code"><KeyRound size={18} />Уже есть код?</label>
    <div><QuestInput id="room-join-code" aria-label="Код комнаты" placeholder="Введи код" value={code} maxLength={svoyakEnabled ? 6 : 5} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={event => setCode(event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} required /><QuestButton type="submit" kind="outline" aria-label="Войти по коду" disabled={!join}><ArrowRight size={20} /></QuestButton></div>
    <small>Вход по приглашению бесплатный.</small>
  </form>
}

export function RoomParticipants({ room, members, scores = false }: { room: FriendsRoomSnapshot; members: FriendsRoomSnapshot['members']; scores?: boolean }) {
  return <div className="room-company-members">{members.map(member => <div className="room-company-person" key={member.userId}>
    <span className="room-company-avatar" aria-hidden="true">{member.displayName.trim().slice(0, 1).toLocaleUpperCase('ru')}</span><div><strong>{member.displayName}{member.userId === room.currentUserId ? ' (ты)' : ''}</strong><small>{member.role === 'owner' ? 'Создатель' : member.connected ? 'На связи' : 'Не в сети'}</small></div>{scores ? <b className="room-company-score">{member.score.toLocaleString('ru')}</b> : member.role === 'owner' ? <Crown size={17} aria-label="Создатель" /> : <i className="room-company-presence" data-connected={member.connected} aria-label={member.connected ? 'На связи' : 'Не в сети'} />}
  </div>)}</div>
}

export function RoomCompanyPanel({ room, members = [], capacity = 8, scores = false, children, roster, count, status }: { room?: FriendsRoomSnapshot; members?: FriendsRoomSnapshot['members']; capacity?: number; scores?: boolean; children?: ReactNode; roster?: ReactNode; count?: number; status?: string }) {
  return <div className="room-company-panel">
    <section className="room-company" aria-label="Твоя компания">
      <div className="room-company-scene" aria-hidden="true"><span className="room-company-orbit" /><ThemedArtwork src={publicAssetUrl('images/home-doodle/together.svg')} width="150" height="104" /><span className="room-company-sticker"><UsersRound size={15} />{room ? `${members.length} / ${room.capacity}` : count !== undefined ? `${count} / ${capacity}` : `До ${capacity} игроков`}</span></div>
      <header><h2>Твоя компания</h2>{(room || status) && <span className="room-company-live"><i />{status ?? (room?.phase === 'lobby' ? 'Комната открыта' : room?.phase === 'finished' ? 'Игра завершена' : 'Игра идёт')}</span>}</header>
      {roster ?? (room ? <><RoomParticipants room={room} members={members} scores={scores} />{room.phase === 'lobby' && members.length < room.capacity && <div className="room-company-empty"><span aria-hidden="true"><Plus size={19} /></span><p>Есть место для друзей<small>Отправь им ссылку или код комнаты</small></p></div>}</> : <>
        <p className="room-company-intro">Лучшие соперники — свои люди. Собирай друзей, близких и коллег.</p>
        <div className="room-company-seats" aria-hidden="true"><span><UsersRound size={23} /></span><span><Plus size={20} /></span><span><Plus size={20} /></span><span><Plus size={20} /></span></div>
        <p className="room-company-note">Создай комнату — получишь ссылку и код приглашения.</p>
      </>)}
      <div className="room-company-perk"><Check size={17} /><p>Друзья играют бесплатно<small>Клуб нужен только создателю</small></p></div>
    </section>{children}
  </div>
}
