import type { TitleMode } from '../types'

export const DANETKI_RECOMMENDATIONS: readonly {
  mode: TitleMode
  kicker: string
  title: string
  description: string
}[] = [
  { mode: 'diagnosis', kicker: 'Стройте версию по уликам', title: 'Угадайте диагноз', description: 'Сопоставляйте симптомы, систему органов и диагностические признаки.' },
  { mode: 'character', kicker: 'Новое досье каждый день', title: 'Угадайте персонажа', description: 'Ищите героя по происхождению, роли, эпохе и способностям.' },
  { mode: 'animal', kicker: 'Наблюдение вместо допроса', title: 'Угадайте животное', description: 'Сверяйте среду обитания, строение, питание и ареал.' },
]
