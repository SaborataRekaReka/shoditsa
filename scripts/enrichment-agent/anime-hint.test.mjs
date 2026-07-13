import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAnimeHint } from './adapters/anime.mjs'

const anime = {
  titleRu: 'Тестовое аниме',
  titleEn: 'Example Anime',
  titleOriginal: 'テストアニメ',
  alternativeTitles: ['Example'],
  creators: [{ nameRu: 'Иван Режиссёр', nameOriginal: 'Ivan Director' }],
  cast: [{ nameRu: 'Анна Актриса', nameOriginal: 'Anna Actor' }],
}

test('anime hint accepts a sourced Russian production fact', () => {
  const result = validateAnimeHint({
    text: 'Для ключевой сцены команда вручную нарисовала несколько сотен фоновых элементов, а финальный монтаж занял почти три месяца.',
    sourceUrls: ['https://example.com/interview'],
  }, anime)
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('anime hint rejects title, character and credited-person spoilers', () => {
  const titleLeak = validateAnimeHint({ text: 'Тестовое аниме создавали с помощью нескольких сотен вручную нарисованных фоновых элементов.', sourceUrls: ['https://example.com'] }, anime)
  const personLeak = validateAnimeHint({ text: 'Иван Режиссёр руководил созданием нескольких сотен вручную нарисованных фоновых элементов.', sourceUrls: ['https://example.com'] }, anime)
  const characterLeak = validateAnimeHint({ text: 'Главный герой Наруто появляется в сцене с несколькими сотнями вручную нарисованных фоновых элементов.', sourceUrls: ['https://example.com'] }, anime, ['Наруто'])
  assert.ok(titleLeak.errors.includes('hint_contains_answer_character_or_actor'))
  assert.ok(personLeak.errors.includes('hint_contains_answer_character_or_actor'))
  assert.ok(characterLeak.errors.includes('hint_contains_answer_character_or_actor'))
})
