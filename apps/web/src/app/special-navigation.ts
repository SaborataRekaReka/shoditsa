import type { ContentPack } from '@shoditsa/contracts'
import { STUDY_CLUB_OFFER_HREF } from '../dev/quest-game/account-routing'

export function hasSpecialAccess(access: ContentPack['access'] | null): boolean {
  return access === 'club' || access === 'personal' || access === 'admin'
}

/** Public metadata never grants access. Both destinations stay in the application. */
export function specialDestination(packId: string, access: ContentPack['access'] | null): string {
  return hasSpecialAccess(access) ? `/specials/${encodeURIComponent(packId)}` : STUDY_CLUB_OFFER_HREF
}
