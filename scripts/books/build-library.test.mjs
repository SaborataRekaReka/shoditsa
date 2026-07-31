import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBookItem, normalizeCountry, normalizeGenres, normalizeLanguage } from './build-library.mjs'

test('normalizes source vocabularies', () => {
  assert.equal(normalizeLanguage('американский английский язык'), 'Английский')
  assert.equal(normalizeCountry('СССР'), 'Россия')
  assert.deepEqual(normalizeGenres(['киберпанк-роман', 'психологический триллер']), ['Фантастика', 'Триллер'])
})

test('builds a safe playable card and removes title leakage', () => {
  const item = buildBookItem({
    'ID книги': 'book-test',
    'Название': { 'На русском': 'Тестовая книга', 'На языке оригинала': 'Test Book' },
    'Автор': 'Автор',
    'Язык оригинала': 'английский язык',
    'Страна происхождения': 'США',
    'Год публикации': 2000,
    'Жанры': ['научная фантастика'],
    'Ссылка на обложку': 'https://example.com/cover.jpg',
    'Часть цикла': 'нет',
    'Премии': 'Премия А; Премия Б',
    'Главные персонажи': ['Герой'],
    'Экранизации': { 'Есть': 'да', 'Годы основных экранизаций': [2010] },
    'Аннотация': 'Тестовая книга рассказывает о герое.',
  }, 0)
  assert.equal(item.mode, 'book')
  assert.equal(item.plotHint.includes('Тестовая книга'), false)
  assert.deepEqual(item.bookGenres, ['Фантастика'])
  assert.equal(item.hasAwards, true)
  assert.equal(item.hasAdaptation, true)
})

test('never emits a contradictory adaptation count', () => {
  const base = {
    'ID книги': 'book-adaptation-test',
    'Название': { 'На русском': 'Книга', 'На языке оригинала': 'Book' },
    'Автор': 'Автор',
    'Экранизации': { 'Есть': 'да', 'Годы основных экранизаций': [] },
  }

  const declared = buildBookItem(base, 0)
  assert.equal(declared.hasAdaptation, true)
  assert.equal(declared.bookAdaptationCount, 1)

  const absent = buildBookItem({ ...base, 'Экранизации': { 'Есть': 'нет', 'Годы основных экранизаций': [] } }, 0)
  assert.equal(absent.hasAdaptation, false)
  assert.equal(absent.bookAdaptationCount, 0)
})
