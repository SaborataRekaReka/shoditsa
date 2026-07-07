import type { TitleMode } from '../types'

export type ModeConfig = {
  title: string
  plural: string
  subject: string
  subjectGenitive: string
  daily: string
  lower: string
  searchPlaceholder: string
  dataFile: 'movies' | 'series' | 'games' | 'diagnoses'
  emptyArticle: 'любой' | 'любого'
}

export const MODE_CONFIG: Record<TitleMode, ModeConfig> = {
  movie: {
    title: 'Кино',
    plural: 'Фильмы',
    subject: 'фильм',
    subjectGenitive: 'фильма',
    daily: 'Фильм',
    lower: 'кино',
    searchPlaceholder: 'Найти фильм…',
    dataFile: 'movies',
    emptyArticle: 'любого',
  },
  series: {
    title: 'Сериалы',
    plural: 'Сериалы',
    subject: 'сериал',
    subjectGenitive: 'сериала',
    daily: 'Сериал',
    lower: 'сериалы',
    searchPlaceholder: 'Найти сериал…',
    dataFile: 'series',
    emptyArticle: 'любого',
  },
  game: {
    title: 'Игры',
    plural: 'Игры',
    subject: 'игру',
    subjectGenitive: 'игры',
    daily: 'Игра',
    lower: 'игры',
    searchPlaceholder: 'Найти игру…',
    dataFile: 'games',
    emptyArticle: 'любой',
  },
  diagnosis: {
    title: 'Диагнозы',
    plural: 'Диагнозы',
    subject: 'диагноз',
    subjectGenitive: 'диагноза',
    daily: 'Диагноз',
    lower: 'диагнозы',
    searchPlaceholder: 'Найти диагноз…',
    dataFile: 'diagnoses',
    emptyArticle: 'любого',
  },
}

export const MODE_TABS: TitleMode[] = ['movie', 'series', 'game', 'diagnosis']
