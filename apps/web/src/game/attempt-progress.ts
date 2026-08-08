import type { Attempt } from '../types'

const hintHasPartialMatch = (hint: Attempt['hints'][number]) =>
  hint.status === 'partial'
  || (hint.status !== 'match' && (hint.matchedValues ?? []).some(Boolean))
  || (hint.status !== 'match' && (hint.people ?? []).some((person) => person.matched))

export const attemptProgressStats = (hints: Attempt['hints']) => {
  const matchedFields = hints.filter((hint) => hint.status === 'match').length
  const partialFields = hints.filter(hintHasPartialMatch).length
  return {
    matchedCount: matchedFields,
    matchedFields,
    partialFields,
    totalFields: hints.length,
  }
}
