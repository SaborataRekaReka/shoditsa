import { Film, Gamepad2, MapPin, Music2, Sparkles, SquarePlus, Tv, type LucideIcon } from 'lucide-react'
import type { TitleMode } from '../../types'

export type CategoryTicketMode = TitleMode | 'city'

export type CategoryTicketConfig = {
  mode: CategoryTicketMode
  title: string
  description: string
  color: string
  icon: LucideIcon
  watermarkUrl: string
}

export const CATEGORY_TICKET_CONFIG: CategoryTicketConfig[] = [
  { mode: 'movie', title: 'Кино', description: 'Угадайте фильм по актёрам, жанрам, году и рейтингам.', color: '#69B779', icon: Film, watermarkUrl: './images/category-stubs/movie-stub.webp' },
  { mode: 'series', title: 'Сериалы', description: 'Найдите сериал по создателям, касту и периоду.', color: '#D6A33F', icon: Tv, watermarkUrl: './images/category-stubs/series-stub.webp' },
  { mode: 'anime', title: 'Аниме', description: 'Угадайте аниме по формату, студии и рейтингу.', color: '#D97B63', icon: Sparkles, watermarkUrl: './images/category-stubs/anime-stub.webp' },
  { mode: 'game', title: 'Игры', description: 'Угадайте игру по жанрам, рейтингу и Steam.', color: '#6684C7', icon: Gamepad2, watermarkUrl: './images/category-stubs/game-stub.webp' },
  { mode: 'city', title: 'Города', description: 'Найдите город по стране, населению, часовому поясу и рейтингам.', color: '#AD5E49', icon: MapPin, watermarkUrl: './images/category-stubs/city-stub-v1.webp' },
  { mode: 'music', title: 'Музыка', description: 'Найдите артиста по стране, эпохе и жанрам.', color: '#8177BF', icon: Music2, watermarkUrl: './images/category-stubs/music-stub.webp' },
  { mode: 'diagnosis', title: 'Диагнозы', description: 'Определите диагноз по симптомам и системе органов.', color: '#CF6E63', icon: SquarePlus, watermarkUrl: './images/category-stubs/diagnosis-stub.webp' },
]
