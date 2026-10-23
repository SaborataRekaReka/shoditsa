import type { Hint } from '../../types'
import json from '../game-screen-concepts/examples.json'

export type DemoEntry = Omit<typeof json[number], 'hints'> & { hints: Hint[] }
export const entries = json as DemoEntry[]
export const initialIds = entries.slice(0, 3).map(entry => entry.id)

export function confirmedFacts(attempts: DemoEntry[]) {
  const found = new Map<string, { label: string; values: string[] }>()
  for (const entry of attempts) for (const hint of entry.hints) {
    const values = hint.matchedValues?.length ? hint.matchedValues : hint.status === 'match' && ['anime_kind', 'anime_status', 'studio', 'age'].includes(hint.key) ? [hint.value] : []
    if (values.length) found.set(hint.key, { label: hint.label, values: [...new Set([...(found.get(hint.key)?.values ?? []), ...values])] })
  }
  return [...found].map(([key, value]) => ({ key, ...value }))
}

export const statusLabel = (hint: Hint) => hint.status === 'match' ? 'Совпадает' : hint.direction === 'up' ? 'У ответа больше' : hint.direction === 'down' ? 'У ответа меньше' : hint.status === 'partial' ? 'Частично совпало' : hint.status === 'close' ? 'Близко' : hint.status === 'unknown' ? 'Нет данных' : 'Не совпало'
