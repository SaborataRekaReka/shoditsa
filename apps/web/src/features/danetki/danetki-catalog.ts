import catalogItems from '../../../../../public/data/libraries/danetki/items.json'

export type DanetkiCatalogDifficulty = 'easy' | 'medium' | 'hard'

export type DanetkiCatalogItem = {
  id: string
  mode: 'danetki'
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

export const danetkiStoryPath = (item: Pick<DanetkiCatalogItem, 'titleRu'>) => `/danetki/${danetkiSlug(item.titleRu)}`

export const DANETKI_CATALOG_ITEMS = (catalogItems as DanetkiCatalogItem[])
  .filter((item) => item.allowedInGame && item.titleRu.trim() && item.condition.trim() && item.solution.trim())
  .sort((left, right) => right.popularityScore - left.popularityScore || left.titleRu.localeCompare(right.titleRu, 'ru-RU'))

export const danetkiCatalogItemBySlug = (slug: string | null | undefined) => {
  const normalized = String(slug ?? '').trim().toLocaleLowerCase('ru-RU')
  return DANETKI_CATALOG_ITEMS.find((item) => danetkiSlug(item.titleRu) === normalized) ?? null
}

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
