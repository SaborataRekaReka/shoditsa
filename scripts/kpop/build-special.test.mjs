import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKpopSpecial, generationForDebutYear, transformKpopArtist } from './build-special.mjs'

const sourceArtist = (overrides = {}) => ({
  'ID артиста': 'sample',
  'Имя на английском': 'Sample Unit',
  'Имя на русском': null,
  'Имя на хангыле': '샘플',
  'Тип исполнителя': 'Саб-юнит',
  'Родительская группа': 'Parent',
  'Альтернативные названия': [{ 'Название': 'SU' }],
  'Год дебюта': 2018,
  'Статус активности': 'Карьера продолжается',
  'Пол': 'смешанный',
  'Корейский лейбл на дебюте': 'Old Label',
  'Текущий корейский лейбл': 'New Label',
  'Логотип текущего лейбла': { 'Прямая ссылка на изображение': 'https://example.com/logo.png' },
  'Участников на дебюте': 4,
  'Лидер': ['Leader'],
  'Макнэ': ['Maknae'],
  'Название фандома': 'Fans',
  'Официальные цвета': ['Cyan'],
  'Дебютный релиз': 'First EP',
  'Дебютная песня': 'First Song',
  'Фотография': { 'Имя файла': 'Sample Unit photo.png' },
  ...overrides,
})

test('uses the requested K-pop generation boundaries', () => {
  assert.deepEqual(
    [1990, 2004, 2005, 2011, 2012, 2017, 2018, 2022, 2023, 2026].map(generationForDebutYear),
    [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  )
})

test('maps the K-pop source to a separate non-regular card type', () => {
  const item = transformKpopArtist(sourceArtist())
  assert.equal(item.id, 'kpop:sample')
  assert.equal(item.cardType, 'kpop_artist')
  assert.equal(item.allowedInGame, false)
  assert.equal(item.kpopGeneration, 4)
  assert.equal(item.kpopCurrentLabel, 'New Label')
  assert.equal(item.kpopClues.debutLabel, 'Old Label')
  assert.equal(item.posterUrl, '/media/kpop/artists/Sample%20Unit%20photo.png')
  assert.deepEqual(item.alternativeTitles, ['샘플', 'SU'])
})

test('builds a deterministic admin-only daily special document', () => {
  const document = buildKpopSpecial([
    sourceArtist(),
    sourceArtist({ 'ID артиста': 'second', 'Имя на английском': 'Second', 'Год дебюта': 2023 }),
  ])
  assert.equal(document.pack.adminOnly, true)
  assert.equal(document.pack.cadence, 'daily')
  assert.equal(document.pack.status, 'draft')
  assert.equal(document.counts.items, 2)
  assert.deepEqual(document.counts.generations, { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 })
})
