import { Film, Gamepad2, MapPin, Music2, Sparkles, SquarePlus, Tv, type LucideIcon } from 'lucide-react'
import type { TitleMode } from '../types'

export type ModePresentation = {
  icon: LucideIcon
  color: string
  watermarkUrl: string
  description: string
  emptyHint: string
}

/** Exhaustive React/UI registry. Domain capabilities live in contracts. */
export const MODE_PRESENTATION: Record<TitleMode, ModePresentation> = {
  movie: { icon: Film, color: '#69B779', watermarkUrl: './images/category-stubs/movie-stub.webp', description: 'Угадайте фильм по актёрам, жанрам, году и рейтингам.', emptyHint: 'После ответа появятся сравнения по году, жанрам, актёрам, стране и рейтингам.' },
  series: { icon: Tv, color: '#D6A33F', watermarkUrl: './images/category-stubs/series-stub.webp', description: 'Найдите сериал по создателям, касту и периоду.', emptyHint: 'После ответа появятся сравнения по периоду, создателям, касту и рейтингам.' },
  anime: { icon: Sparkles, color: '#D97B63', watermarkUrl: './images/category-stubs/anime-stub.webp', description: 'Угадайте аниме по формату, студии и рейтингу.', emptyHint: 'После ответа появятся сравнения по формату, статусу, эпизодам, студии, сэйю и рейтингу Shikimori.' },
  game: { icon: Gamepad2, color: '#6684C7', watermarkUrl: './images/category-stubs/game-stub.webp', description: 'Угадайте игру по жанрам, рейтингу и Steam.', emptyHint: 'После ответа появятся сравнения по году, месту в топе, жанрам, категориям Steam и рейтингу.' },
  city: { icon: MapPin, color: '#AD5E49', watermarkUrl: './images/category-stubs/city-stub-v1.webp', description: 'Найдите город по стране, населению, часовому поясу и рейтингам.', emptyHint: 'После ответа появятся сравнения по стране, континенту, языкам, населению, часовому поясу и рейтингам.' },
  music: { icon: Music2, color: '#8177BF', watermarkUrl: './images/category-stubs/music-stub.webp', description: 'Найдите артиста по стране, эпохе и жанрам.', emptyHint: 'После ответа появятся сравнения по стране, старту карьеры, десятилетию, типу артиста, сцене и жанрам.' },
  diagnosis: { icon: SquarePlus, color: '#CF6E63', watermarkUrl: './images/category-stubs/diagnosis-stub.webp', description: 'Определите диагноз по симптомам и системе органов.', emptyHint: 'После ответа появятся сравнения по системе, симптомам, диагностике и коду МКБ.' },
}
