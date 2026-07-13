import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMovieHint } from './adapters/movie.mjs'

const movie = {
  titleRu: 'Тестовый фильм', titleOriginal: 'Example Movie', alternativeTitles: ['Example'],
  directors: [{ nameRu: 'Иван Режиссёр', nameOriginal: 'Ivan Director' }],
  cast: [{ nameRu: 'Анна Актриса', nameOriginal: 'Anna Actor' }],
}

test('movie hint accepts a sourced Russian production fact', () => {
  const result = validateMovieHint({
    text: 'Для ключевой сцены построили полноразмерную декорацию, а съёмочная группа работала в ней почти три месяца.',
    sourceUrls: ['https://example.com/interview'],
  }, movie)
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('movie hint rejects title and credited-person spoilers', () => {
  const titleLeak = validateMovieHint({ text: 'Тестовый фильм снимали в большой студийной декорации почти три месяца подряд.', sourceUrls: ['https://example.com'] }, movie)
  const personLeak = validateMovieHint({ text: 'Иван Режиссёр построил для ключевой сцены огромную декорацию и снимал её почти три месяца.', sourceUrls: ['https://example.com'] }, movie)
  assert.ok(titleLeak.errors.includes('hint_contains_answer_or_person'))
  assert.ok(personLeak.errors.includes('hint_contains_answer_or_person'))
})
