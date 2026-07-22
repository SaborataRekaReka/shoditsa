import { describe, expect, it } from 'vitest'
import type { PlayableMode, TitleItem } from '@shoditsa/contracts'
import { scoreFriendsRoomGuess } from '../src/modules/friends-room/scoring.js'

const sharedByMode: Record<PlayableMode, Partial<TitleItem>> = {
  movie: { year: 2014, countries: ['Россия'], genres: ['драма'], directors: [{ nameRu: 'Режиссёр', nameOriginal: '' }] },
  series: { year: 2014, countries: ['Россия'], genres: ['драма'], seasonsCount: 3, showrunners: [{ nameRu: 'Шоураннер', nameOriginal: '' }] },
  anime: { year: 2014, genres: ['драма'], studios: ['Studio A'], animeKind: 'TV', episodes: 24 },
  game: { year: 2014, genres: ['RPG'], developers: ['Studio A'], platforms: ['PC'] },
  city: { country: 'Россия', continent: 'Европа', languages: ['русский'], population: 1_000_000, timezone: 'UTC+3' },
  music: { activityStartYear: 2014, countries: ['RU'], genres: ['рок'], musicType: 'Group', musicIsActive: true },
  diagnosis: { bodySystems: ['Дыхательная система'], keySymptoms: ['Кашель'], icdGroup: 'J00–J99', diseaseTypes: ['Инфекционное'] },
}

const title = (mode: PlayableMode, id: string): TitleItem => ({
  id,
  mode,
  titleRu: id,
  titleOriginal: '',
  popularityScore: 1,
  ...sharedByMode[mode],
} as TitleItem)

describe('friends room weighted scoring', () => {
  it('reserves most points for an exact answer and rewards speed', () => {
    const answer = title('movie', 'answer')
    expect(scoreFriendsRoomGuess({ answer, guess: answer, elapsedSeconds: 0, answerTimeSeconds: 30 }).points).toBe(1000)
    expect(scoreFriendsRoomGuess({ answer, guess: answer, elapsedSeconds: 30, answerTimeSeconds: 30 }).points).toBe(700)
  })

  it.each(Object.keys(sharedByMode) as PlayableMode[])('awards bounded partial points for matching %s attributes', (mode) => {
    const result = scoreFriendsRoomGuess({
      answer: title(mode, `${mode}-answer`),
      guess: title(mode, `${mode}-guess`),
      elapsedSeconds: 10,
      answerTimeSeconds: 30,
    })
    expect(result.correct).toBe(false)
    expect(result.points).toBeGreaterThan(0)
    expect(result.points).toBeLessThanOrEqual(650)
    expect(result.breakdown.reduce((sum, part) => sum + part.points, 0)).toBe(result.points)
  })

  it('gives a specific creator match more weight than a visible genre match', () => {
    const result = scoreFriendsRoomGuess({
      answer: title('movie', 'answer'),
      guess: title('movie', 'guess'),
      elapsedSeconds: 10,
      answerTimeSeconds: 30,
    })
    const creator = result.breakdown.find((part) => part.key === 'creator')
    const genres = result.breakdown.find((part) => part.key === 'genres')
    expect(creator?.points).toBeGreaterThan(genres?.points ?? 0)
  })
})
