import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ERA_QUOTAS,
  answerVariants,
  completeTruncatedExcerpt,
  containsObfuscatedNumberedAnswer,
  eraKeyFor,
  naturalGameReference,
  normalizeTitle,
  selectDailyPool,
  technicalReason,
} from './enrichment-lib.mjs'

test('normalizes Russian spelling, punctuation and safe number variants deterministically', () => {
  assert.equal(normalizeTitle('  S.T.A.L.K.E.R.: Зов Припяти  '), 's t a l k e r зов припяти')
  assert.equal(normalizeTitle('Ёлка — II'), 'елка ii')
  const variants = answerVariants('Divinity: Original Sin II')
  assert.ok(variants.includes('Divinity: Original Sin 2'))
  assert.equal(new Set(variants.map(normalizeTitle)).size, variants.length)
})

test('rephrases a hidden game title naturally for its sentence context', () => {
  assert.equal(naturalGameReference('База. ', ' не имеет ничего общего'), 'Эта игра')
  assert.equal(naturalGameReference('Началась арка ', ', всех поздравляю'), 'этой игры')
  assert.equal(naturalGameReference('Новости про ', ' всё смешнее'), 'эту игру')
  assert.equal(naturalGameReference('Я не мог играть в ', ' с читами'), 'эту игру')
  assert.equal(naturalGameReference('Разработчики ', ' выпустили патч'), 'этой игры')
  assert.equal(naturalGameReference('По сравнению с историей ', ', исправление багов'), 'этой игры')
  assert.equal(naturalGameReference('ДЛСС ', ' нужен был как воздух'), 'этой игре')
  assert.equal(naturalGameReference('', ' 2 сегодня анонсируют', true), 'Продолжение этой игры')
})

test('completes a truncated verified DTF excerpt at the next real sentence boundary', () => {
  assert.equal(
    completeTruncatedExcerpt(
      'Персонажа ставят во временные рамки и...',
      'Персонажа ставят во временные рамки и... Игрок всё равно отвлекается на побочные задания. Следующая мысль.',
    ),
    'Персонажа ставят во временные рамки и... Игрок всё равно отвлекается на побочные задания.',
  )
  assert.equal(
    completeTruncatedExcerpt('Автор закончил мысль...', 'Автор закончил мысль...'),
    'Автор закончил мысль...',
  )
  assert.equal(
    completeTruncatedExcerpt('Обычный полный комментарий.', 'Обычный полный комментарий. Продолжение'),
    'Обычный полный комментарий.',
  )
})

test('detects a numbered game title hidden behind a distorted nickname', () => {
  const aliases = ['Cyberpunk 2077', 'Киберпанк 2077']
  assert.equal(
    containsObfuscatedNumberedAnswer('Кибер кал 2077 может и хорошая, не играл', aliases),
    true,
  )
  assert.equal(
    containsObfuscatedNumberedAnswer('Эта игра стала флагманом жанра киберпанк', aliases),
    false,
  )
  assert.equal(
    containsObfuscatedNumberedAnswer('Игра вышла в 2020 году', aliases),
    false,
  )
})

test('rejects technical Steam applications', () => {
  assert.equal(technicalReason('Example Game Demo'), 'demo')
  assert.equal(technicalReason('Example Dedicated Server'), 'server')
  assert.equal(technicalReason('Example Game'), null)
  assert.equal(technicalReason('Example Game', 'game', true), 'unreleased')
})

test('builds exactly 1000 daily entries with the requested era composition', () => {
  const years = {
    before_2000: 1998,
    '2000_2009': 2005,
    '2010_2016': 2014,
    '2017_2021': 2019,
    '2022_current': 2024,
  }
  const catalog = []
  for (const [era, quota] of Object.entries(ERA_QUOTAS)) {
    for (let index = 0; index < quota + 10; index += 1) {
      catalog.push({
        id: `${era}-${index}`,
        titleRu: `${era} ${index}`,
        titleOriginal: `${era} ${index}`,
        alternativeTitles: [],
        year: years[era],
        genres: ['Action'],
        developers: [`Developer ${index}`],
        publishers: [`Publisher ${index}`],
        platforms: ['PC'],
        dailyEligible: true,
        reviewStatus: 'machine_verified',
        recognitionScore: 100 - index / 100,
        scoreConfidence: 1,
        franchiseKey: null,
      })
    }
  }
  const result = selectDailyPool(catalog)
  assert.equal(result.selected.length, 1000)
  assert.deepEqual(result.eraCounts, ERA_QUOTAS)
  assert.deepEqual(
    Object.fromEntries(Object.keys(ERA_QUOTAS).map((era) => [
      era,
      result.selected.filter((item) => eraKeyFor(item.year) === era).length,
    ])),
    ERA_QUOTAS,
  )
})

test('fills a short curated pool after applying the soft franchise cap', () => {
  const catalog = Array.from({ length: 1000 }, (_, index) => ({
    id: `franchise-${index}`,
    titleRu: `Игра ${index}`,
    titleOriginal: `Game ${index}`,
    alternativeTitles: [],
    year: 2019,
    genres: ['Action'],
    developers: ['Developer'],
    publishers: ['Publisher'],
    platforms: ['PC'],
    dailyEligible: true,
    reviewStatus: 'machine_verified',
    recognitionScore: 100 - index / 100,
    scoreConfidence: 1,
    franchiseKey: 'one-franchise',
  }))

  const result = selectDailyPool(catalog)
  assert.equal(result.selected.length, 1000)
  assert.equal(result.franchiseFallbackIds.length, 997)
})
