import type { WordGuess } from '@shoditsa/contracts'
const plurals = new Intl.PluralRules('ru-RU')
export const wordCountLabel = (count: number, forms: [string, string, string]) => `${count} ${forms[plurals.select(count) === 'one' ? 0 : plurals.select(count) === 'few' ? 1 : 2]}`
/** A visual rank scale, not a probability of guessing the answer. */
export const wordRankWidth = (rank: number, vocabularySize: number) => vocabularySize <= 1 ? 100 : Math.max(3, 100 * (1 - Math.log(Math.min(vocabularySize, Math.max(1, rank))) / Math.log(vocabularySize)))
export const wordRankTone = (rank: number) => rank <= 100 ? 'hot' : rank <= 1000 ? 'warm' : 'cold'
export const sortedWordGuesses = (guesses: WordGuess[]) => [...guesses].sort((a, b) => a.rank - b.rank || a.position - b.position)
