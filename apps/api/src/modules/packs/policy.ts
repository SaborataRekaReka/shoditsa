export const REDDIT_COMMENTS_PACK_ID = 'reddit-games-comments-25-v1'

const ADMIN_ONLY_PACK_IDS = new Set<string>([
  REDDIT_COMMENTS_PACK_ID,
])

export const isAdminOnlyPack = (packId: string) => ADMIN_ONLY_PACK_IDS.has(packId)
