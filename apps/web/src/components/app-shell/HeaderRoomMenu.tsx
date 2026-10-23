import { useEffect, useRef, useState } from 'react'
import { ChevronDown, DoorOpen, Plus, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FriendsRoomListResponse, FriendsRoomSummary } from '@shoditsa/contracts'
import { api, queryKeys } from '../../api/client'
import { ActionButton, IconButton } from '../ui/UiControls'
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
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
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
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      menuTriggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [open])

  if (!room) {
    return <div className="header-room-menu">
      <ActionButton className="header-create-room" variant="secondary" onClick={onCreateRoom}>
        <Plus /><span>Создать комнату</span>
      </ActionButton>
    </div>
  }

  const returnToRoom = () => {
    setOpen(false)
    if (isCurrentRoomPage) return
    window.location.assign(`/games/together?room=${encodeURIComponent(room.code)}`)
  }

  return <div className="header-room-menu" ref={wrapRef}>
    <div className="header-room-active" role="group" aria-label="Текущая комната">
      <ActionButton className={`header-return-room${isCurrentRoomPage ? ' is-current' : ''}`} variant="secondary" onClick={returnToRoom} aria-current={isCurrentRoomPage ? 'page' : undefined}>
        <DoorOpen /><span>{isCurrentRoomPage ? `Комната ${room.code}` : 'Вернуться в комнату'}</span>
      </ActionButton>
      <IconButton
        ref={menuTriggerRef}
        className="header-return-room__menu"
        onClick={() => setOpen((value) => !value)}
        label="Действия с текущей комнатой"
        aria-haspopup="menu"
        aria-expanded={open}
      ><ChevronDown /></IconButton>
    </div>
    {open && <div className="header-room-dropdown" role="menu">
      <header><span>Текущая комната</span><strong>{room.code}</strong></header>
      <div className="header-room-summary">
        <span className={`header-room-dropdown__mark is-${room.gameType}`} aria-hidden="true">{room.gameType === 'danetki' ? '?' : '№'}</span>
        <span>
          <strong>{friendsRoomSummaryTitle(room)}</strong>
          <small>{friendsRoomPhaseLabel(room.phase)}</small>
          <small><Users /> {room.players} из {room.capacity}, {room.isHost ? 'вы ведущий' : 'вы игрок'}</small>
        </span>
      </div>
      {actionError && <p className="header-room-dropdown__error" role="alert">{actionError}</p>}
      <ActionButton
        className="header-room-dropdown__leave-current"
        variant="danger"
        role="menuitem"
        disabled={leave.isPending}
        onClick={() => { setActionError(''); leave.mutate(room.id) }}
      ><DoorOpen /><span><strong>{leave.isPending ? 'Выходим…' : 'Покинуть комнату'}</strong><small>После этого можно создать новую</small></span></ActionButton>
    </div>}
  </div>
}
