import { HOME_SEO, PUBLIC_INDEXABLE_GAME_SEO, SITE_ORIGIN } from './seo-content'
import { LEGAL_DOCUMENT_SLUGS } from '../features/legal/legal'
import { DANETKI_CATALOG_ITEMS, danetkiStoryPath } from '../features/danetki/danetki-catalog'
import { DANETKI_COLLECTION_DEFINITIONS } from '../features/danetki/danetki-collections'

export const INDEXABLE_UTILITY_PATHS = ['/partners', '/specials', '/club'] as const

export const STATIC_INDEXABLE_PATHS = [
  HOME_SEO.canonicalPath,
  ...PUBLIC_INDEXABLE_GAME_SEO.map((game) => game.canonicalPath),
  '/danetki',
  ...DANETKI_COLLECTION_DEFINITIONS.map((collection) => collection.canonicalPath),
  ...DANETKI_CATALOG_ITEMS.map(danetkiStoryPath),
  ...INDEXABLE_UTILITY_PATHS,
  ...LEGAL_DOCUMENT_SLUGS.map((slug) => `/legal/${slug}`),
] as const

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

/** Only published canonical documents get a trailing-slash redirect. */
export const renderPublicTrailingSlashRedirects = (
  canonicalPaths: readonly string[] = STATIC_INDEXABLE_PATHS,
) => {
  const paths = canonicalPaths.filter((path) => path !== '/')
    .map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return `# Generated from the sitemap; unknown and private URLs keep their own routing.\nlocation ~ "^(${paths.join('|')})/$" {\n    return 301 ${SITE_ORIGIN}$1$is_args$args;\n}\n`
}

export const renderSitemap = (
  canonicalPaths: readonly string[] = STATIC_INDEXABLE_PATHS,
  siteOrigin = SITE_ORIGIN,
) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${canonicalPaths
  .map((canonicalPath) => `  <url><loc>${escapeXml(new URL(canonicalPath, `${siteOrigin}/`).toString())}</loc></url>`)
  .join('\n')}\n</urlset>\n`
