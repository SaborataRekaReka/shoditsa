import type { UserBadge } from '@shoditsa/contracts'
import './UserBadgeList.css'

type UserBadgeListProps = {
  badges: UserBadge[]
}

export function UserBadgeList({ badges }: UserBadgeListProps) {
  if (!badges.length) return null

  return <ul className="user-badges" aria-label="Бейджи пользователя">
    {badges.map((badge) => <li key={badge.key}>
      <span
        className="user-badge"
        data-style={badge.styleKey}
        title={badge.description}
        aria-label={`${badge.name}: ${badge.description}`}
      >
        {badge.shortLabel}
      </span>
    </li>)}
  </ul>
}
