import { describe, expect, it } from 'vitest'
import type { TitleItem } from '@shoditsa/contracts'
import { compareCharacters } from '../src/index.js'

const character = (overrides: Partial<TitleItem>): TitleItem => ({
  id: 'character:test',
  mode: 'character',
  titleRu: 'Тест',
  titleOriginal: 'Test',
  alternativeTitles: [],
  popularityScore: 1,
  characterEra: 'XIX век',
  characterEraOrder: 1812,
  characterSourceTypes: ['Роман'],
  characterOriginCultures: ['Русская литература'],
  characterNature: 'Человек',
  characterGender: 'Мужчина',
  characterAgeGroup: 'Взрослый',
  characterRoles: ['Путешественник'],
  characterArchetypes: ['Искатель'],
  characterAbilities: ['Красноречие'],
  characterSettings: ['Россия XIX века'],
  ...overrides,
})

describe('character comparison', () => {
  it('never shows opposite arrows for the same visible era', () => {
    const hint = compareCharacters(
      character({ characterEra: 'XIX век', characterEraOrder: 1812 }),
      character({ id: 'character:answer', characterEra: 'XIX век', characterEraOrder: 1888 }),
    ).find((entry) => entry.key === 'character_era')

    expect(hint).toMatchObject({ status: 'match', direction: null, value: 'XIX век' })
  })

  it('orders eras by the displayed bucket rather than a hidden publication year', () => {
    const answer = character({ id: 'character:answer', characterEra: 'XX век', characterEraOrder: 1905 })
    const older = compareCharacters(character({ characterEra: 'XIX век', characterEraOrder: 1899 }), answer)
      .find((entry) => entry.key === 'character_era')
    const newer = compareCharacters(character({ characterEra: 'XXI век', characterEraOrder: 2001 }), answer)
      .find((entry) => entry.key === 'character_era')

    expect(older).toMatchObject({ status: 'close', direction: 'up' })
    expect(newer).toMatchObject({ status: 'close', direction: 'down' })
  })

  it('returns the exact overlapping tokens for partial list fields', () => {
    const hint = compareCharacters(
      character({ characterRoles: ['Мореплаватель', 'Воин'] }),
      character({ id: 'character:answer', characterRoles: ['Мореплаватель', 'Правитель'] }),
    ).find((entry) => entry.key === 'character_roles')

    expect(hint).toMatchObject({ status: 'partial', matchedValues: ['Мореплаватель'] })
  })
})
