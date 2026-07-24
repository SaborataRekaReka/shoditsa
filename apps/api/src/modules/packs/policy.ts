export const DTF_COMMENTS_PACK_ID = 'dtf-game-comments-25-v1'

const ADMIN_ONLY_PACK_IDS = new Set<string>()
const REQUIRED_BADGE_BY_PACK = new Map<string, string>([
  [DTF_COMMENTS_PACK_ID, 'dtf'],
])

export const isAdminOnlyPack = (packId: string) => ADMIN_ONLY_PACK_IDS.has(packId)
export const requiredBadgeForPack = (packId: string) => REQUIRED_BADGE_BY_PACK.get(packId) ?? null
