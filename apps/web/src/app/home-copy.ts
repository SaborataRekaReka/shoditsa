import { GAME_MODE_MANIFEST } from '@shoditsa/contracts'

/** Existing public-home copy shared by its legacy and reference presentations. */
export const HOME_HERO_COPY = {
  heading: 'Все сойдется!',
  lead: 'Угадывайте фильмы, сериалы, аниме, видеоигры, города, исполнителей, диагнозы, животных, книги и персонажей — или решайте связи и данетки. Каждый день — новая загадка.',
  playLabel: 'Играть сейчас',
  rulesLabel: 'Как это работает',
} as const

export const HOME_PUZZLE_COPY = {
  connections: {
    title: GAME_MODE_MANIFEST.connections.label,
    description: 'Соберите 16 слов в четыре связанные группы',
  },
  danetki: {
    title: GAME_MODE_MANIFEST.danetki.label,
    description: 'Раскройте необычную историю вопросами — самостоятельно или вместе с друзьями.',
  },
} as const
