import { useEffect, useRef, useState } from 'react'
import { ChevronDown, DoorOpen, Plus, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FriendsRoomListResponse, FriendsRoomSummary } from '@shoditsa/contracts'
import { api, queryKeys } from '../../api/client'
import {
  friendsRoomPhaseLabel,
  friendsRoomSummaryTitle,
} from '../../features/friends-room/friends-room-summary'

const idempotencyKey = () => crypto.randomUUID()

export function HeaderRoomMenu({ onCreateRoom, rooms }: { onCreateRoom: () => void; rooms: FriendsRoomSummary[] }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const room = rooms[0]
  const isCurrentRoomPage = Boolean(room)
    && window.location.pathname === '/games/together'
    && new URLSearchParams(window.location.search).get('room') === room?.code
  const leave = useMutation({
    mutationFn: (roomId: string) => api.friendsRoomLeave(roomId, idempotencyKey()),
    onSuccess: async () => {
      setOpen(false)
      client.setQueryData<FriendsRoomListResponse>(queryKeys.friendsRooms, { rooms: [] })
      await client.invalidateQueries({ queryKey: queryKeys.friendsRooms })
      if (new URLSearchParams(window.location.search).get('room') === room?.code) {
        window.location.assign('/games/together')
      }
    },
    onError: (reason) => setActionError(reason instanceof Error ? reason.message : 'Не удалось покинуть комнату'),
  })

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!room) {
    return <div className="header-room-menu">
      <button className="header-create-room" type="button" onClick={onCreateRoom}>
        <Plus /><span>Создать комнату</span>
      </button>
    </div>
  }

  const returnToRoom = () => {
    setOpen(false)
    if (isCurrentRoomPage) return
    window.location.assign(`/games/together?room=${encodeURIComponent(room.code)}`)
  }

  return <div className="header-room-menu" ref={wrapRef}>
    <div className="header-room-active" role="group" aria-label="Текущая комната">
      <button className={`header-return-room${isCurrentRoomPage ? ' is-current' : ''}`} type="button" onClick={returnToRoom} aria-current={isCurrentRoomPage ? 'page' : undefined}>
        <DoorOpen /><span>{isCurrentRoomPage ? `Комната ${room.code}` : 'Вернуться в комнату'}</span>
      </button>
      <button
        className="header-return-room__menu"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Действия с текущей комнатой"
        aria-haspopup="menu"
        aria-expanded={open}
      ><ChevronDown /></button>
    </div>
    {open && <div className="header-room-dropdown" role="menu">
      <header><span>Текущая комната</span><strong>{room.code}</strong></header>
      <div className="header-room-summary">
        <span className={`header-room-dropdown__mark is-${room.gameType}`} aria-hidden="true">{room.gameType === 'danetki' ? '?' : '№'}</span>
        <span>
          <strong>{friendsRoomSummaryTitle(room)}</strong>
          <small>{friendsRoomPhaseLabel(room.phase)}</small>
          <small><Users /> {room.players} из {room.capacity} · {room.isHost ? 'вы ведущий' : 'вы игрок'}</small>
        </span>
      </div>
      {actionError && <p className="header-room-dropdown__error" role="alert">{actionError}</p>}
      <button
        className="header-room-dropdown__leave-current"
        type="button"
        role="menuitem"
        disabled={leave.isPending}
        onClick={() => { setActionError(''); leave.mutate(room.id) }}
      ><DoorOpen /><span><strong>{leave.isPending ? 'Выходим…' : 'Покинуть комнату'}</strong><small>После этого можно создать новую</small></span></button>
    </div>}
  </div>
}
