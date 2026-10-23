import type { TitleMode } from '../../types'
import type { ReferenceIconName } from '../../components/ui/ReferenceIcon'
import type { ReelPoster } from '../../components/poster-reel/PosterReel'
import { LOCAL_PRESENTATION } from '../../app/local-presentation'
import { publicAssetUrl } from '../../app/public-asset'
import covers from './catalog-entry-covers.json'

type EntryCriterion = { label: string; icon: ReferenceIconName }
type EntryPresentation = { subject: string; invitation: string; searchTitle: string; criteria: EntryCriterion[] }
const criterion = (label: string, icon: ReferenceIconName): EntryCriterion => ({ label, icon })

export const CATALOG_ENTRY_PRESENTATION: Record<TitleMode, EntryPresentation> = {
  movie: { subject: 'фильм', invitation: 'Найди фильм дня.', searchTitle: 'Начни со знакомого фильма', criteria: [criterion('Год', 'calendar'), criterion('Жанры', 'movie'), criterion('Актёры', 'user'), criterion('Страна', 'globe'), criterion('Рейтинг', 'idea')] },
  series: { subject: 'сериал', invitation: 'Найди сериал дня.', searchTitle: 'Начни со знакомого сериала', criteria: [criterion('Период', 'calendar'), criterion('Жанры', 'movie'), criterion('Создатели', 'user'), criterion('Актёры', 'user'), criterion('Рейтинг', 'idea')] },
  anime: { subject: 'аниме', invitation: 'Найди тайтл дня.', searchTitle: 'Начни со знакомого тайтла', criteria: [criterion('Формат', 'anime'), criterion('Студия', 'city'), criterion('Эпизоды', 'series'), criterion('Сэйю', 'user'), criterion('Рейтинг', 'idea')] },
  game: { subject: 'видеоигру', invitation: 'Найди игру дня.', searchTitle: 'Вспомни знакомую игру', criteria: [criterion('Год', 'calendar'), criterion('Жанры', 'game'), criterion('Категории', 'guide'), criterion('Место в топе', 'flame'), criterion('Рейтинг', 'idea')] },
  city: { subject: 'город', invitation: 'Найди город дня.', searchTitle: 'Предложи город', criteria: [criterion('Страна', 'globe'), criterion('Континент', 'globe'), criterion('Население', 'user'), criterion('Языки', 'guide'), criterion('Часовой пояс', 'calendar')] },
  music: { subject: 'артиста', invitation: 'Найди артиста дня.', searchTitle: 'Вспомни артиста', criteria: [criterion('Страна', 'globe'), criterion('Дебют', 'calendar'), criterion('Жанры', 'music'), criterion('Тип артиста', 'user'), criterion('Карьера', 'flame')] },
  diagnosis: { subject: 'диагноз', invitation: 'Изучи анамнез и найди ответ.', searchTitle: 'Начни с анамнеза', criteria: [criterion('Симптомы', 'diagnosis'), criterion('Система органов', 'diagnosis'), criterion('Диагностика', 'search'), criterion('Код МКБ', 'guide')] },
  animal: { subject: 'животное', invitation: 'Найди животное дня.', searchTitle: 'Предположи животное', criteria: [criterion('Класс', 'animal'), criterion('Среда', 'globe'), criterion('Ареал', 'globe'), criterion('Питание', 'animal'), criterion('Размер', 'idea')] },
  book: { subject: 'книгу', invitation: 'Найди книгу дня.', searchTitle: 'Вспомни знакомую книгу', criteria: [criterion('Автор', 'user'), criterion('Год', 'calendar'), criterion('Жанры', 'book'), criterion('Страна', 'globe'), criterion('Экранизации', 'movie')] },
  character: { subject: 'персонажа', invitation: 'Найди персонажа дня.', searchTitle: 'Предложи знакомого персонажа', criteria: [criterion('Эпоха', 'calendar'), criterion('Источник', 'book'), criterion('Природа', 'character'), criterion('Роль', 'user'), criterion('Способности', 'idea')] },
}

/** Catalog teasers contain public names/covers only, never puzzle answers or comparison data. */
export function entryCoverUrl(mode: TitleMode, source?: string, local = LOCAL_PRESENTATION) {
  if (!source) return undefined
  if (/^https?:\/\//.test(source)) return source
  const normalized = source.replace(/^\.\//, '/')
  const library = normalized.match(/^\/data\/libraries\/[^/]+\/img\/(.+)$/)
  if (library && !local) return `/media/content/${mode}/${library[1]}`
  return publicAssetUrl(normalized)
}

export function catalogEntryCovers(mode: TitleMode): ReelPoster[] {
  return (covers[mode] as ReelPoster[]).map(cover => ({ ...cover, src: entryCoverUrl(mode, cover.src) }))
}
