import { useState } from 'react'
import { Star, UserRound } from 'lucide-react'
import './UserAvatar.css'

export function avatarInitials(name: string | null | undefined) {
  return (name?.trim().split(/\s+/).filter(Boolean).slice(0, 2) ?? []).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('ru')
}

/** The same account portrait in the header and profile, with a personal fallback. */
export function UserAvatar({ name, src, size = 'small', club = false, className = '' }: { name?: string | null; src?: string | null; size?: 'small' | 'large'; club?: boolean; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const safeSrc = src && /^(https:\/\/|\/media\/|\/images\/)/i.test(src) ? src : null
  const initials = avatarInitials(name)
  return <span className={`user-avatar${club ? ' user-avatar--club' : ''} ${className}`} data-size={size} aria-hidden="true">
    <span className="user-avatar__portrait">{safeSrc && failedSrc !== safeSrc ? <img src={safeSrc} alt="" referrerPolicy="no-referrer" onError={() => setFailedSrc(safeSrc)} /> : initials ? <span>{initials}</span> : <UserRound strokeWidth={1.8} />}</span>
    {club && <span className="user-avatar__club-star"><Star strokeWidth={2.5} /></span>}
  </span>
}
