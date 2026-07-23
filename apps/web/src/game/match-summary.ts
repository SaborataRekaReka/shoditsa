import type { Attempt } from '../types'

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

export const collectMatchSummaryTags = (attempts: Attempt[]): MatchSummaryTag[] => {
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
      const matchedValues = (hint.matchedValues ?? []).map((value) => value.trim()).filter(Boolean)
      for (const value of matchedValues) add(hint.key, hint.label, value)

      if (matchedValues.length || hint.status !== 'match') continue
      if (['creator', 'cast'].includes(hint.key)) continue
      add(hint.key, hint.label, hint.value)
    }
  }

  return tags
}
