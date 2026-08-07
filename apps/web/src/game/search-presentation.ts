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
  | 'scientificName'
  | 'taxonomicClass'
  | 'animalOrder'
  | 'bookAuthors'
  | 'bookPublicationYear'
  | 'characterSourceWork'
  | 'characterEra'
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
  if (item.mode === 'city') return meaningful([originalTitle(item), item.country, item.continent]).join(' · ')
  if (item.mode === 'diagnosis') return meaningful([originalTitle(item), ...(item.icd10 ?? []), item.icdGroup]).join(' · ')
  if (item.mode === 'animal') return meaningful([item.scientificName || originalTitle(item), item.taxonomicClass, item.animalOrder]).join(' · ')
  if (item.mode === 'book') return meaningful([originalTitle(item), ...(item.bookAuthors ?? []).slice(0, 2), item.bookPublicationYear]).join(' · ')
  if (item.mode === 'character') return meaningful([originalTitle(item), item.characterSourceWork, item.characterEra]).join(' · ')
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
  if (item.mode === 'animal') return `Иллюстрация животного «${item.titleRu}»`
  if (item.mode === 'book') return `Обложка книги «${item.titleRu}»`
  if (item.mode === 'character') return `Иллюстрация персонажа «${item.titleRu}»`
  if (item.mode === 'music') return `Фото артиста «${item.titleRu}»`
  if (item.mode === 'game') return `Обложка игры «${item.titleRu}»`
  if (item.mode === 'anime') return `Обложка аниме «${item.titleRu}»`
  return `Постер «${item.titleRu}»`
}

const MODE_EMPTY_COPY: Record<TitleMode, { subject: string; missing: string }> = {
  movie: { subject: 'фильм', missing: 'не найден' },
  series: { subject: 'сериал', missing: 'не найден' },
  anime: { subject: 'аниме', missing: 'не найдено' },
  game: { subject: 'игра', missing: 'не найдена' },
  city: { subject: 'город', missing: 'не найден' },
  music: { subject: 'артист', missing: 'не найден' },
  diagnosis: { subject: 'диагноз', missing: 'не найден' },
  animal: { subject: 'животное', missing: 'не найдено' },
  book: { subject: 'книга', missing: 'не найдена' },
  character: { subject: 'персонаж', missing: 'не найден' },
}

export const searchEmptyMessage = (mode: TitleMode, fixedMode = false) => {
  if (mode === 'music') return 'Ничего не найдено.'
  const copy = MODE_EMPTY_COPY[mode]
  return `В текущем пуле ${copy.subject} ${copy.missing}. ${fixedMode
    ? 'Проверьте написание или попробуйте другой вариант.'
    : 'Проверьте написание или выберите другой режим игры.'}`
}
