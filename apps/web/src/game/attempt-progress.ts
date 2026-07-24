import type { Attempt } from '../types'

const hintHasMatch = (hint: Attempt['hints'][number]) =>
  hint.status === 'match'
  || (hint.matchedValues ?? []).some(Boolean)
  || (hint.people ?? []).some((person) => person.matched)

export const attemptProgressStats = (hints: Attempt['hints']) => {
  const matchedFields = hints.filter(hintHasMatch).length
  return {
    matchedCount: matchedFields,
    matchedFields,
    totalFields: hints.length,
  }
}
