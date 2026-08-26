import { DANETKI_CATALOG_ITEMS, danetkiStoryPath } from '../features/danetki/danetki-catalog'
import { DANETKI_COLLECTION_DEFINITIONS } from '../features/danetki/danetki-collections'

export type DanetkiDiscoveryLink = {
  href: string
  label: string
  kind: 'hub' | 'collection' | 'story'
}

const FEATURED_STORY_SLUGS = ['albatros', 'stakan-vody', 'spichka-v-pustyne'] as const

const featuredStories = FEATURED_STORY_SLUGS.flatMap((slug) => {
  const story = DANETKI_CATALOG_ITEMS.find((item) => item.slug === slug)
  return story ? [{ href: danetkiStoryPath(story), label: story.titleRu, kind: 'story' as const }] : []
})

/**
 * A small, stable crawl path to the Danetki pages with proven search demand.
 * It is shared by runtime navigation and server-rendered SEO fallbacks so that
 * crawlers do not have to execute the application before discovering them.
 */
export const DANETKI_DISCOVERY_LINKS: readonly DanetkiDiscoveryLink[] = [
  { href: '/danetki', label: 'Все данетки с ответами', kind: 'hub' },
  ...DANETKI_COLLECTION_DEFINITIONS.map((collection) => ({
    href: collection.canonicalPath,
    label: collection.internalLinkLabel,
    kind: 'collection' as const,
  })),
  ...featuredStories,
]
