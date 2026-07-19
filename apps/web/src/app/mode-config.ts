import type { TitleMode } from '../types'
import { DAILY_MODE_IDS } from '@shoditsa/contracts'

export type ModeConfig = {
  title: string
  plural: string
  subject: string
  subjectGenitive: string
  daily: string
  lower: string
  searchPlaceholder: string
  dataFile: 'movies' | 'series' | 'animes' | 'games' | 'cities' | 'music' | 'diagnoses'
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
  anime: {
    title: 'Аниме',
    plural: 'Аниме',
    subject: 'аниме',
    subjectGenitive: 'аниме',
    daily: 'Аниме',
    lower: 'аниме',
    searchPlaceholder: 'Найти аниме…',
    dataFile: 'animes',
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
  city: {
    title: 'Города',
    plural: 'Города',
    subject: 'город',
    subjectGenitive: 'города',
    daily: 'Город',
    lower: 'города',
    searchPlaceholder: 'Найти город…',
    dataFile: 'cities',
    emptyArticle: 'любой',
  },
  music: {
    title: 'Музыка',
    plural: 'Музыка',
    subject: 'артиста',
    subjectGenitive: 'артиста',
    daily: 'Артист',
    lower: 'музыка',
    searchPlaceholder: 'Найти артиста…',
    dataFile: 'music',
    emptyArticle: 'любого',
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

export const MODE_TABS: TitleMode[] = [...DAILY_MODE_IDS]
