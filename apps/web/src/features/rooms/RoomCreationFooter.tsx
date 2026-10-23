import type { ReactNode } from 'react'
import { UsersRound } from 'lucide-react'
import './room-creation-footer.css'

export function RoomCreationFooter({ children, summary, svoyak = false }: { children: ReactNode; summary?: ReactNode; svoyak?: boolean }) {
  return <div className="room-creation-footer"><div className="room-creation-footer__info">{summary && <strong>{summary}</strong>}<span><UsersRound size={15} aria-hidden="true" />{svoyak ? 'От 3 человек: ведущий и минимум 2 игрока' : 'Пригласи друзей после создания комнаты'}</span><small>Клуб нужен создателю. Друзья входят бесплатно.</small></div><div className="room-creation-footer__action">{children}</div></div>
}
