import { musicActivityStartYear, musicTypeLabel } from '../game'
import type { TitleItem, TitleMode } from '../types'

type SearchItem = Pick<
  TitleItem,
  | 'mode'
  | 'titleRu'
  | 'titleOriginal'
  | 'year'
  | 'activityStartYear'
  | 'country'
  | 'continent'
  | 'platforms'
  | 'editionType'
  | 'releaseScope'
  | 'releaseLabel'
  | 'icd10'
  | 'icdGroup'
  | 'musicType'
>

const meaningful = (values: Array<string | number | null | undefined>) =>
  values.map((value) => String(value ?? '').trim()).filter(Boolean)

const originalTitle = (item: SearchItem) => {
  const value = item.titleOriginal?.trim()
  return value && value.toLocaleLowerCase('ru-RU') !== item.titleRu.trim().toLocaleLowerCase('ru-RU')
    ? value
    : null
}

export const searchResultMeta = (item: SearchItem) => {
  if (item.mode === 'city') {
    return meaningful([originalTitle(item), item.country, item.continent]).join(' · ')
  }
  if (item.mode === 'diagnosis') {
    return meaningful([originalTitle(item), ...(item.icd10 ?? []), item.icdGroup]).join(' · ')
  }
  if (item.mode === 'game') {
    const edition = item.editionType && item.editionType !== 'original' ? item.editionType : null
    const release = item.releaseScope === 'release' ? item.releaseLabel : null
    return meaningful([originalTitle(item), item.year, edition, release, ...(item.platforms ?? []).slice(0, 2)]).join(' · ')
  }
  if (item.mode === 'music') {
    const startYear = musicActivityStartYear(item)
    return meaningful([
      originalTitle(item),
      startYear != null ? `с ${startYear}` : null,
      item.musicType ? musicTypeLabel(item.musicType) : null,
    ]).join(' · ')
  }
  return meaningful([originalTitle(item), item.year]).join(' · ')
}

export const searchMediaAlt = (item: Pick<SearchItem, 'mode' | 'titleRu'>) => {
  if (item.mode === 'city') return `Символ города «${item.titleRu}»`
  if (item.mode === 'diagnosis') return `Иллюстрация диагноза «${item.titleRu}»`
  if (item.mode === 'music') return `Фото артиста «${item.titleRu}»`
  if (item.mode === 'game') return `Обложка игры «${item.titleRu}»`
  if (item.mode === 'anime') return `Обложка аниме «${item.titleRu}»`
  return `Постер «${item.titleRu}»`
}

const MODE_EMPTY_SUBJECT: Record<TitleMode, string> = {
  movie: 'фильм',
  series: 'сериал',
  anime: 'аниме',
  game: 'игра',
  city: 'город',
  music: 'артист',
  diagnosis: 'диагноз',
}

export const searchEmptyMessage = (mode: TitleMode) =>
  `В текущем пуле ${MODE_EMPTY_SUBJECT[mode]} не найден. Проверьте написание или выберите другой режим игры.`
