import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeMovieRecord } from './movie-hint-sanitize.mjs'

const movie = (overrides = {}) => ({
  id: 'kp_test',
  mode: 'movie',
  titleRu: 'Тестовый фильм',
  titleOriginal: 'Test Movie',
  alternativeTitles: [],
  genres: ['драма'],
  facts: [],
  ...overrides,
})

test('finishes cropped plot hints with a period instead of an ellipsis', () => {
  const source = 'Группа исследователей отправляется в долгую экспедицию, где сталкивается с неожиданными препятствиями и вынуждена принимать сложные решения под давлением обстоятельств, постепенно теряя связь с привычным миром и надежду на лёгкое возвращение домой.'
  const result = sanitizeMovieRecord(movie({ plotHint: source, description: source }))

  assert.ok(result.plotHint.length <= 190)
  assert.match(result.plotHint, /\.$/)
  assert.doesNotMatch(result.plotHint, /(?:\.\.\.|…)$/)
})

test('normalizes a source fact that ends with a Unicode ellipsis', () => {
  const fact = 'Натурные съёмки проходили зимой в нескольких областях, а декорации готовили больше трёх месяцев…'
  const result = sanitizeMovieRecord(movie({ plotHint: 'История о сложном выборе.', facts: [fact] }))

  assert.equal(result.facts[0], 'Натурные съёмки проходили зимой в нескольких областях, а декорации готовили больше трёх месяцев.')
})
