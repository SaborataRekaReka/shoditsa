import { BookOpen, Drama, Film, Gamepad2, MapPin, Music2, PawPrint, Sparkles, SquarePlus, Tv, type LucideIcon } from 'lucide-react'
import type { TitleMode } from '../types'
import { publicAssetUrl } from './public-asset'

export type ModePresentation = {
  icon: LucideIcon
  color: string
  watermarkUrl: string
  description: string
  emptyHint: string
}

/** Exhaustive React/UI registry. Domain capabilities live in contracts. */
export const MODE_PRESENTATION: Record<TitleMode, ModePresentation> = {
  movie: { icon: Film, color: 'var(--mode-movie-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/movie-stub.webp'), description: 'Угадайте фильм по актёрам, жанрам, году и рейтингам.', emptyHint: 'После ответа появятся сравнения по году, жанрам, актёрам, стране и рейтингам.' },
  series: { icon: Tv, color: 'var(--mode-series-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/series-stub.webp'), description: 'Найдите сериал по создателям, касту и периоду.', emptyHint: 'После ответа появятся сравнения по периоду, создателям, касту и рейтингам.' },
  anime: { icon: Sparkles, color: 'var(--mode-anime-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/anime-stub.webp'), description: 'Угадайте аниме по формату, студии и рейтингу.', emptyHint: 'После ответа появятся сравнения по формату, статусу, эпизодам, студии, сэйю и рейтингу Shikimori.' },
  game: { icon: Gamepad2, color: 'var(--mode-game-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/game-stub.webp'), description: 'Угадайте видеоигру по описанию, жанрам и рейтингу.', emptyHint: 'После ответа появятся сравнения по году, месту в топе, жанрам, категориям Steam и рейтингу.' },
  city: { icon: MapPin, color: 'var(--mode-city-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/city-stub-v1.webp'), description: 'Найдите город по стране, населению, часовому поясу и рейтингам.', emptyHint: 'После ответа появятся сравнения по стране, континенту, языкам, населению, часовому поясу и рейтингам.' },
  music: { icon: Music2, color: 'var(--mode-music-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/music-stub.webp'), description: 'Угадайте исполнителя по песне, стране, эпохе и жанрам.', emptyHint: 'После ответа появятся сравнения по стране, старту карьеры, десятилетию, типу артиста, сцене и жанрам.' },
  diagnosis: { icon: SquarePlus, color: 'var(--mode-diagnosis-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/diagnosis-stub.webp'), description: 'Определите диагноз по симптомам и системе органов.', emptyHint: 'После ответа появятся сравнения по системе, симптомам, диагностике и коду МКБ.' },
  animal: { icon: PawPrint, color: 'var(--mode-animal-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/animal-stub.webp'), description: 'Угадайте животное по классу, среде обитания, ареалу и строению.', emptyHint: 'После ответа появятся сравнения по классификации, покрову тела, среде, ареалу, питанию, движению и размеру.' },
  book: { icon: BookOpen, color: 'var(--mode-book-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/book-stub-v2.webp'), description: 'Угадайте книгу по автору, эпохе, жанрам и экранизациям.', emptyHint: 'После ответа появятся сравнения по автору, стране, языку, году публикации, жанрам, циклу, премиям и экранизациям.' },
  character: { icon: Drama, color: 'var(--mode-character-brand)', watermarkUrl: publicAssetUrl('images/category-stubs/character-stub.webp'), description: 'Угадайте персонажа по эпохе, происхождению, роли и способностям.', emptyHint: 'После ответа появятся сравнения по эпохе, источнику, культуре, природе, возрасту, роли, архетипу, способностям и миру.' },
}
