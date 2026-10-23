import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { mascotAsset } from '../../components/mascot/Mascot'
import { publicAssetUrl } from '../../app/public-asset'
import { ControlButton } from '../../components/ui/UiControls'
import { StudyClubJoinDialog } from './StudyClubJoinDialog'
import { useStudyClubActive } from './use-study-club'
import './study-club-mini.css'

export function clubSidebarPromo(context: 'club' | 'club-offer' | undefined, active: boolean, rotation: number) {
  if (!context && !active) return 'club'
  return active && rotation % 2 === 0 ? 'specials' : 'friends'
}

const copy = {
  club: { title: 'Вступи в клуб', detail: 'Больше возможностей с Клубом', action: 'О Клубе', href: '/club/membership', label: 'Вступи в клуб', art: mascotAsset('club') },
  specials: { title: 'Истории для тебя', detail: 'Попробуй тематические спецпоказы', action: 'К спецпоказам', href: '/specials', label: 'Попробуй клубные спецпоказы', art: publicAssetUrl('images/home-doodle/movie.webp') },
  friends: { title: 'Играем вместе', detail: 'Создай комнату и пригласи друзей', action: 'Играть вместе', href: '/games/together', label: 'Создать игру с друзьями', art: publicAssetUrl('images/home-doodle/together-invite-v1.webp') },
} as const

export function StudyClubMiniBanner({ context, active = false }: { context?: 'club' | 'club-offer'; active?: boolean }) {
  const hasClub = useStudyClubActive(active)
  // Change between visits, never rotate while someone is reading the banner.
  const [rotation] = useState(() => Math.floor(Date.now() / 3_600_000))
  const [joinOpen, setJoinOpen] = useState(false)
  const variant = clubSidebarPromo(context, hasClub, rotation)
  const item = copy[variant]
  const body = <><span><strong>{item.title}</strong><small>{item.detail}</small><b>{item.action} <ArrowRight size={14} /></b></span><ThemedArtwork src={item.art} alt="" width="100" height="112" /></>
  if (variant === 'club') return <>
    <ControlButton className="study-club-mini study-club-mini--club" aria-label={item.label} aria-haspopup="dialog" aria-expanded={joinOpen} onClick={() => setJoinOpen(true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}>{body}</ControlButton>
    {joinOpen && <StudyClubJoinDialog onClose={() => setJoinOpen(false)} />}
  </>
  return <a className={`study-club-mini study-club-mini--${variant}`} href={item.href} aria-label={item.label} title={item.label}>{body}</a>
}
