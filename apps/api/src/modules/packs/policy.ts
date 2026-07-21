export const DTF_COMMENTS_PACK_ID = 'dtf-game-comments-25-v1'

const ADMIN_ONLY_PACK_IDS = new Set<string>([
  DTF_COMMENTS_PACK_ID,
])

export const isAdminOnlyPack = (packId: string) => ADMIN_ONLY_PACK_IDS.has(packId)
