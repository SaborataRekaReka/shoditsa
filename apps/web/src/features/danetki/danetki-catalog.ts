import catalogItems from '../../../../../public/data/libraries/danetki/items.json'

export type DanetkiCatalogDifficulty = 'easy' | 'medium' | 'hard'

export type DanetkiCatalogItem = {
  id: string
  mode: 'danetki'
  slug: string
  titleRu: string
  titleOriginal: string
  alternativeTitles: string[]
  condition: string
  solution: string
  difficulty: DanetkiCatalogDifficulty
  genres: string[]
  tags: string[]
  starterQuestions: string[]
  contentWarnings: string[]
  audience: 'family' | 'teen' | 'adult'
  tone: 'light' | 'warm' | 'wonder' | 'mystery' | 'tense' | 'dark'
  estimatedMinutes: number
  isClassic: boolean
  sourceNote: string
  publishedAt: string
  indexable: boolean
  contentStatus: string
  allowedInGame: boolean
  popularityScore: number
}

const TRANSLITERATION: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export const danetkiSlug = (title: string) => Array.from(title.toLocaleLowerCase('ru-RU'))
  .map((character) => TRANSLITERATION[character] ?? character)
  .join('')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

export const danetkiStoryPath = (item: Pick<DanetkiCatalogItem, 'slug'>) => `/danetki/${item.slug}`

export const danetkiCatalogPlayState = (
  access: { dailyRoomsStarted: number; nextSoloCost: number } | undefined,
  ticketBalance: number,
) => {
  const dailyAvailable = (access?.dailyRoomsStarted ?? 0) === 0
  const cost = dailyAvailable ? 0 : access?.nextSoloCost ?? 0
  const shortage = Math.max(0, cost - ticketBalance)
  return { dailyAvailable, cost, shortage, allowed: shortage === 0 }
}

export const DANETKI_CATALOG_ITEMS = (catalogItems as DanetkiCatalogItem[])
  .filter((item) => item.allowedInGame && item.indexable && item.contentStatus === 'ready' && item.slug.trim() && item.titleRu.trim() && item.condition.trim() && item.solution.trim())
  .sort((left, right) => right.popularityScore - left.popularityScore || left.titleRu.localeCompare(right.titleRu, 'ru-RU'))

export const danetkiCatalogItemBySlug = (slug: string | null | undefined) => {
  const normalized = String(slug ?? '').trim().toLocaleLowerCase('ru-RU')
  return DANETKI_CATALOG_ITEMS.find((item) => item.slug === normalized) ?? null
}

export const danetkiRelatedItems = (item: DanetkiCatalogItem, limit = 3) => DANETKI_CATALOG_ITEMS
  .filter((candidate) => candidate.id !== item.id)
  .map((candidate) => ({
    candidate,
    score: candidate.genres.filter((genre) => item.genres.includes(genre)).length * 4
      + candidate.tags.filter((tag) => item.tags.includes(tag)).length * 2
      + Number(candidate.difficulty === item.difficulty)
      + Number(candidate.audience === item.audience),
  }))
  .sort((left, right) => right.score - left.score || right.candidate.popularityScore - left.candidate.popularityScore)
  .slice(0, limit)
  .map(({ candidate }) => candidate)

export const danetkiDifficultyLabel = (difficulty: DanetkiCatalogDifficulty) => difficulty === 'easy'
  ? 'Лёгкая'
  : difficulty === 'hard'
    ? 'Сложная'
    : 'Средняя'

export const danetkiStoryDescription = (item: DanetkiCatalogItem) => {
  const teaser = item.condition.replace(/\s+/g, ' ').trim()
  const suffix = ' Прочитайте условие, попробуйте разгадать историю и откройте ответ.'
  return `${teaser.slice(0, Math.max(80, 155 - suffix.length)).replace(/[,:;\s]+$/g, '')}.${suffix}`.slice(0, 180)
}
