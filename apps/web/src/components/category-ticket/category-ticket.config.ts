import { Film, Gamepad2, Music2, Sparkles, SquarePlus, Tv, type LucideIcon } from 'lucide-react'
import type { TitleMode } from '../../types'

export type CategoryTicketConfig = {
  mode: TitleMode
  title: string
  description: string
  color: string
  icon: LucideIcon
  watermarkUrl: string
}

export const CATEGORY_TICKET_CONFIG: CategoryTicketConfig[] = [
  { mode: 'movie', title: 'Кино', description: 'Угадайте фильм по актёрам, жанрам, году и рейтингам.', color: '#69B779', icon: Film, watermarkUrl: './images/category-stubs/movie-watermark.svg' },
  { mode: 'series', title: 'Сериалы', description: 'Найдите сериал по создателям, касту и периоду.', color: '#D6A33F', icon: Tv, watermarkUrl: './images/category-stubs/series-watermark.svg' },
  { mode: 'anime', title: 'Аниме', description: 'Угадайте аниме по формату, студии и рейтингу.', color: '#D97B63', icon: Sparkles, watermarkUrl: './images/category-stubs/anime-watermark.svg' },
  { mode: 'game', title: 'Игры', description: 'Угадайте игру по жанрам, рейтингу и Steam.', color: '#6684C7', icon: Gamepad2, watermarkUrl: './images/category-stubs/game-watermark.svg' },
  { mode: 'music', title: 'Музыка', description: 'Найдите артиста по стране, эпохе и жанрам.', color: '#8177BF', icon: Music2, watermarkUrl: './images/category-stubs/music-watermark.svg' },
  { mode: 'diagnosis', title: 'Диагнозы', description: 'Определите диагноз по симптомам и системе органов.', color: '#CF6E63', icon: SquarePlus, watermarkUrl: './images/category-stubs/diagnosis-watermark.svg' },
]
