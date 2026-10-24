import { PUBLIC_INDEXABLE_GAME_SEO, type PublicSeoGameMode } from './seo-content'

export type PublicGameLink = {
  mode: PublicSeoGameMode
  href: string
  label: string
  shortName: string
}

/**
 * Public navigation is derived from the same indexable-game registry as SEO
 * metadata. A newly published mode therefore cannot be omitted from the home
 * guide or footer while still appearing in the sitemap.
 */
export const PUBLIC_GAME_LINKS: readonly PublicGameLink[] = PUBLIC_INDEXABLE_GAME_SEO.map((game) => ({
  mode: game.mode,
  href: game.canonicalPath,
  label: game.internalLinkLabel ?? game.shortName,
  shortName: game.shortName,
}))
