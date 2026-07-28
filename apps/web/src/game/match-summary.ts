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

const isPlayerCategory = (value: string) => {
  const text = normalize(value)
  return text.includes('player')
    || text.includes('игрок')
    || text.includes('single')
    || text.includes('multiplayer')
    || text.includes('одиноч')
    || text.includes('мультиплеер')
    || text.includes('coop')
    || text.includes('кооп')
}

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
    const hasDedicatedPlayerHint = mode === 'game' && attempt.hints.some((hint) => hint.key === 'players')
    for (const hint of attempt.hints) {
      const matchedValues = (hint.matchedValues ?? []).map((value) => value.trim()).filter(Boolean)
      for (const value of matchedValues) {
        if (hasDedicatedPlayerHint && hint.key === 'steam_categories' && isPlayerCategory(value)) continue
        add(hint.key, hint.label, value)
      }

      if (matchedValues.length || hint.status !== 'match') continue
      if (['creator', 'cast'].includes(hint.key)) continue
      if (hasDedicatedPlayerHint && hint.key === 'steam_categories' && isPlayerCategory(hint.value)) continue
      add(hint.key, hint.label, hint.value)
    }
  }

  return tags
}
