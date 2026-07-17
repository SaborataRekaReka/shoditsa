import { describe, expect, it } from 'vitest'
import { cityPool, compareCities, dailyCity, searchCities, type CityItem } from './city-game'

const city = (overrides: Partial<CityItem>): CityItem => ({
  id: 'city:test', titleRu: 'Тест', titleOriginal: 'Test', country: 'Страна', countryFlagUrl: null,
  continent: 'Европа', languages: ['Русский'], population: 1_000_000, cityFlagUrl: null, coatOfArmsUrl: null,
  alternativeTitles: [], ranks: { economy: 100, humanCapital: 100, qualityOfLife: 100, ecology: 100, governance: 100 },
  timezone: 'GMT+03:00', popular: false, capital: false, ...overrides,
})

describe('city game', () => {
  const items = [
    city({ id: 'city:capital', titleRu: 'Столица', capital: true }),
    city({ id: 'city:popular', titleRu: 'Популярный', popular: true }),
    city({ id: 'city:other', titleRu: 'Обычный' }),
  ]

  it('builds the three requested pools', () => {
    expect(cityPool(items, 'capitals').map((item) => item.id)).toEqual(['city:capital'])
    expect(cityPool(items, 'capitals-popular')).toHaveLength(2)
    expect(cityPool(items, 'all')).toHaveLength(3)
  })

  it('picks a stable daily city', () => {
    expect(dailyCity(items, 'all', '2026-07-18')?.id).toBe(dailyCity(items, 'all', '2026-07-18')?.id)
  })

  it('searches Russian, original and alternative names', () => {
    const searchable = city({ id: 'city:new-york', titleRu: 'Нью-Йорк', titleOriginal: 'New York City', alternativeTitles: ['Big Apple'] })
    expect(searchCities([searchable], 'big app')).toEqual([searchable])
  })

  it('compares city properties and gives useful directions', () => {
    const guess = city({ population: 500_000, ranks: { economy: 200, humanCapital: 100, qualityOfLife: 100, ecology: 100, governance: 100 } })
    const answer = city({ population: 1_000_000, ranks: { economy: 50, humanCapital: 100, qualityOfLife: 100, ecology: 100, governance: 100 } })
    const hints = compareCities(guess, answer)
    expect(hints.find((hint) => hint.key === 'population')?.direction).toBe('up')
    expect(hints.find((hint) => hint.key === 'economy')?.direction).toBe('up')
  })
})
