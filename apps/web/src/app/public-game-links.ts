import { INDEXABLE_GAME_SEO, type GameSeoContent, type SeoGameMode } from './seo-content'

export type PublicGameLink = {
  mode: SeoGameMode
  href: string
  label: string
}

/**
 * Public navigation is derived from the same indexable-game registry as SEO
 * metadata. A newly published mode therefore cannot be omitted from the home
 * guide or footer while still appearing in the sitemap.
 */
export const PUBLIC_GAME_LINKS: readonly PublicGameLink[] = (INDEXABLE_GAME_SEO as readonly GameSeoContent[]).map((game) => ({
  mode: game.mode,
  href: game.canonicalPath,
  label: game.internalLinkLabel ?? game.shortName,
}))
