import type { SeoGameMode } from '../../app/seo-content'

/** Short catalogue copy belongs to this presentation; canonical SEO copy stays intact. */
export const REFERENCE_HOME_CARD_COPY = {
  movie: 'Фильм по подсказкам',
  series: 'Сериал по деталям',
  anime: 'Аниме по подсказкам',
  game: 'Видеоигра по деталям',
  city: 'Город по признакам',
  music: 'Узнай исполнителя',
  diagnosis: 'Диагноз по симптомам',
  animal: 'Животное по признакам',
  book: 'Книга по подсказкам',
  character: 'Герой по признакам',
  danetki: 'Загадка с вопросами',
  connections: 'Собери группы слов',
} satisfies Record<SeoGameMode, string>

export const REFERENCE_HOME_INTRO = 'Угадывай по подсказкам, находи связи и раскрывай истории. Каждый день — новая загадка.'
