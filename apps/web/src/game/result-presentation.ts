import {
  canonicalMusicGenreLabel,
  localizeMusicCountry,
  musicYearMeta,
  musicTypeLabel,
} from '../game'
import type { TitleItem } from '../types'

type ResultItem = Pick<
  TitleItem,
  | 'mode'
  | 'titleOriginal'
  | 'year'
  | 'activityStartYear'
  | 'musicDebutYear'
  | 'genres'
  | 'icd10'
  | 'icdGroup'
  | 'bodySystems'
  | 'steamCategories'
  | 'platforms'
  | 'releaseScope'
  | 'releaseLabel'
  | 'country'
  | 'continent'
  | 'population'
  | 'languages'
  | 'timezone'
  | 'musicType'
  | 'countries'
  | 'scientificName'
  | 'taxonomicClass'
  | 'animalOrder'
  | 'animalFamily'
  | 'habitats'
  | 'animalContinents'
  | 'diets'
  | 'bookAuthors'
  | 'bookPublicationYear'
  | 'bookGenres'
  | 'bookCountry'
  | 'bookOriginalLanguage'
>

const values = (items: Array<string | number | null | undefined>) =>
  items.map((value) => String(value ?? '').trim()).filter(Boolean)

export const resultCardMeta = (item: ResultItem) => {
  if (item.mode === 'diagnosis') {
    return values([item.titleOriginal, ...(item.icd10 ?? []), item.icdGroup]).join(' · ')
  }
  if (item.mode === 'animal') {
    return values([item.scientificName || item.titleOriginal, item.taxonomicClass, item.animalOrder]).join(' · ')
  }
  if (item.mode === 'book') {
    return values([...(item.bookAuthors ?? []).slice(0, 2), item.bookPublicationYear, item.bookCountry]).join(' · ')
  }
  if (item.mode === 'game') {
    return values([
      item.year,
      item.releaseScope === 'release' ? item.releaseLabel : null,
      ...(item.platforms ?? []).slice(0, 2),
    ]).join(' · ')
  }
  if (item.mode === 'city') {
    return values([
      item.country,
      item.continent,
      item.population ? `${new Intl.NumberFormat('ru-RU').format(item.population)} жителей` : null,
    ]).join(' · ')
  }
  if (item.mode === 'music') {
    return values([
      musicYearMeta(item),
      item.musicType ? musicTypeLabel(item.musicType) : null,
      ...(item.countries ?? []).slice(0, 2).map(localizeMusicCountry),
    ]).join(' · ')
  }
  return values([item.year, ...(item.genres ?? []).slice(0, 1)]).join(' · ')
}

export const resultCardTags = (item: ResultItem) => {
  if (item.mode === 'diagnosis') {
    return [...(item.bodySystems ?? []).slice(0, 2), ...(item.icd10 ?? []).slice(0, 1)]
  }
  if (item.mode === 'animal') {
    return [...(item.habitats ?? []).slice(0, 2), ...(item.animalContinents ?? []).slice(0, 2), ...(item.diets ?? []).slice(0, 1)]
  }
  if (item.mode === 'book') {
    return [...(item.bookGenres ?? []).slice(0, 3), item.bookOriginalLanguage].filter((value): value is string => Boolean(value))
  }
  if (item.mode === 'game') {
    return [...(item.genres ?? []).slice(0, 2), ...(item.platforms ?? []).slice(0, 2)]
  }
  if (item.mode === 'city') {
    return [...(item.languages ?? []).slice(0, 3), item.timezone].filter((value): value is string => Boolean(value))
  }
  if (item.mode === 'music') {
    return (item.genres ?? []).slice(0, 3).map(canonicalMusicGenreLabel)
  }
  return (item.genres ?? []).slice(0, 3)
}
