import type { Attempt, TitleMode } from '../types'

export type MatchSummaryTag = {
  id: string
  label: string
  value: string
}

const normalize = (value: string) => value
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

// The game card presents these fields as the compact comparison itself.
// Steam categories and platforms have their own verbose, scrollable clouds
// below the card, so repeating every raw value in the summary makes it noisy.
const GAME_CARD_SUMMARY_HINT_KEYS = new Set([
  'year',
  'rank',
  'players',
  'genres',
  'developer',
  'publisher',
  'steam_positive',
  'metacritic',
  'reviews',
  'price',
  'age',
])

const isSummaryHint = (mode: TitleMode, hintKey: string) =>
  mode !== 'game' || GAME_CARD_SUMMARY_HINT_KEYS.has(hintKey)

export const collectMatchSummaryTags = (attempts: Attempt[], mode: TitleMode): MatchSummaryTag[] => {
  const tags: MatchSummaryTag[] = []
  const seenValues = new Set<string>()

  const add = (hintKey: string, label: string, value: string) => {
    const cleanValue = value.trim()
    const normalizedValue = normalize(cleanValue)
    if (!normalizedValue || cleanValue === '—' || cleanValue === 'Нет данных' || seenValues.has(normalizedValue)) return
    seenValues.add(normalizedValue)
    tags.push({ id: `${hintKey}:${normalizedValue}`, label, value: cleanValue })
  }

  for (const attempt of attempts) {
    for (const hint of attempt.hints) {
      if (!isSummaryHint(mode, hint.key)) continue

      const matchedValues = (hint.matchedValues ?? []).map((value) => value.trim()).filter(Boolean)
      for (const value of matchedValues) add(hint.key, hint.label, value)

      if (matchedValues.length || hint.status !== 'match') continue
      if (['creator', 'cast'].includes(hint.key)) continue
      add(hint.key, hint.label, hint.value)
    }
  }

  return tags
}
