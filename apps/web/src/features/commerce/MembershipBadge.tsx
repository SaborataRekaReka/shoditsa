import { Sparkles } from 'lucide-react'
import type { MembershipSummary } from '@shoditsa/contracts'

const formatDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))

export function MembershipBadge({ membership, compact = false }: { membership: MembershipSummary | { active: boolean; endsAt: string | null }; compact?: boolean }) {
  if (!membership.active) return null
  return <span className={`membership-badge ${compact ? 'membership-badge--compact' : ''}`}><Sparkles /> Клуб активен{membership.endsAt ? ` до ${formatDate(membership.endsAt)}` : ''}</span>
}
