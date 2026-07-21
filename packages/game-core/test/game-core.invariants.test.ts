import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GAME_MODE_MANIFEST, PLAYABLE_MODE_IDS, type TitleItem, type TitleMode } from '@shoditsa/contracts'
import { compareTitles, resultText, searchTitles } from '../src/index.js'

const libraryDirs = Object.fromEntries(PLAYABLE_MODE_IDS.map((mode) => [mode, GAME_MODE_MANIFEST[mode].dataDir])) as Record<TitleMode, string>

const modes = Object.keys(libraryDirs) as TitleMode[]

const libraries = Object.fromEntries(
  modes.map((mode) => [
    mode,
    JSON.parse(readFileSync(new URL(`../../../public/data/libraries/${libraryDirs[mode]}/items.json`, import.meta.url), 'utf8')) as TitleItem[],
  ]),
) as Record<TitleMode, TitleItem[]>

const validStatuses = new Set(['match', 'close', 'partial', 'miss', 'unknown'])
const validDirections = new Set(['up', 'down', null])

const sampleItems = (items: TitleItem[], max = 24) => {
  if (items.length <= max) return items
  const step = Math.max(1, Math.floor(items.length / max))
  const result: TitleItem[] = []
  for (let index = 0; index < items.length && result.length < max; index += step) {
    result.push(items[index])
  }
  return result
}

const probeQuery = (item: TitleItem) => {
  const names = [
    item.titleRu,
    item.titleOriginal,
    ...(item.alternativeTitles ?? []),
    ...(item.aliases ?? []),
  ].filter((value): value is string => Boolean(value && value.trim()))

  const candidate = names[0]?.trim() ?? ''
  if (candidate.length >= 2) return candidate.slice(0, 2)
  if (candidate.length === 1) return candidate
  return 'а'
}

const firstSearchWithResults = (items: TitleItem[]) => {
  for (const item of sampleItems(items, 12)) {
    const query = probeQuery(item)
    const results = searchTitles(items, query, new Set())
    if (results.length) return { query, results }
  }
  const fallback = searchTitles(items, 'а', new Set())
  return { query: 'а', results: fallback }
}

describe('game-core invariants', () => {
  for (const mode of modes) {
    it(`${mode}: self-compare always returns only match statuses`, () => {
      const items = sampleItems(libraries[mode], 20)
      expect(items.length).toBeGreaterThan(0)

      for (const item of items) {
        const hints = compareTitles(item, item)
        expect(hints.length).toBeGreaterThan(0)
        for (const hint of hints) {
          expect(hint.status).toBe('match')
          expect(hint.direction).toBeNull()
        }
      }
    })

    it(`${mode}: compareTitles keeps status and direction within contract`, () => {
      const items = sampleItems(libraries[mode], 24)
      expect(items.length).toBeGreaterThan(1)

      for (let index = 0; index < items.length; index += 1) {
        const guess = items[index]
        const answer = items[(index + 5) % items.length]
        const hints = compareTitles(guess, answer)
        expect(hints.length).toBeGreaterThan(0)

        for (const hint of hints) {
          expect(validStatuses.has(hint.status)).toBe(true)
          expect(validDirections.has(hint.direction)).toBe(true)
        }
      }
    })

    it(`${mode}: resultText format is stable for won and lost rounds`, () => {
      const items = sampleItems(libraries[mode], 6)
      expect(items.length).toBeGreaterThan(1)

      const attempts = items.slice(0, 4).map((guess, index) => compareTitles(guess, items[(index + 1) % items.length]))
      const lost = resultText(mode, '2026-07-14', 'all', attempts, false)
      const won = resultText(mode, '2026-07-14', 'all', attempts, true)
      const special = resultText(mode, '2026-07-14', 'all', attempts, true, 6)

      const lostLines = lost.split('\n')
      const wonLines = won.split('\n')

      expect(lostLines.length).toBe(3 + attempts.length)
      expect(wonLines.length).toBe(3 + attempts.length)
      expect(lostLines[2]).toContain('X/10')
      expect(wonLines[2]).toContain(`${attempts.length}/10`)
      expect(special.split('\n')[2]).toContain(`${attempts.length}/6`)
    })

    it(`${mode}: searchTitles never returns excluded ids`, () => {
      const items = libraries[mode]
      expect(items.length).toBeGreaterThan(0)

      const { query, results } = firstSearchWithResults(items)
      if (!results.length) {
        expect(results).toEqual([])
        return
      }

      const excluded = new Set(results.slice(0, Math.min(2, results.length)).map((item) => item.id))
      const filtered = searchTitles(items, query, excluded)

      for (const item of filtered) {
        expect(excluded.has(item.id)).toBe(false)
      }
      expect(new Set(filtered.map((item) => item.id)).size).toBe(filtered.length)
    })
  }
})
