import { describe, expect, it } from 'vitest'
import type { AppConfig } from '@shoditsa/config'
import type { TitleItem } from '@shoditsa/contracts'
import { ApiError } from '../src/lib/errors.js'
import {
  assertFriendsRoomAccess,
  assertFriendsRoomCreator,
  buildFriendsRoomHints,
  isFriendsRoomAnswerCorrect,
  normalizeFriendsRoomAnswer,
} from '../src/modules/friends-room/service.js'

const movie = {
  id: 'movie-1',
  mode: 'movie',
  titleRu: 'Ёлки',
  titleOriginal: 'Six Degrees of Celebration',
  alternativeTitles: ['Елки'],
  aliases: ['Новогодние ёлки'],
  year: 2010,
  countries: ['Россия'],
  genres: ['комедия'],
  directors: [{ nameRu: 'Тимур Бекмамбетов', nameOriginal: '' }],
  popularityScore: 1,
} as TitleItem

const accessConfig = (production: boolean, friendsRoomPreview: boolean) => ({
  production,
  friendsRoomPreview,
} as AppConfig)

describe('friends room service helpers', () => {
  it('normalizes human answers and accepts localized aliases', () => {
    expect(normalizeFriendsRoomAnswer('  НОВОГОДНИЕ-ЁЛКИ! ')).toBe('новогодние елки')
    expect(isFriendsRoomAnswerCorrect('ёлки', movie)).toBe(true)
    expect(isFriendsRoomAnswerCorrect('Six Degrees of Celebration', movie)).toBe(true)
    expect(isFriendsRoomAnswerCorrect('Новогодние елки', movie)).toBe(true)
    expect(isFriendsRoomAnswerCorrect('Ирония судьбы', movie)).toBe(false)
  })

  it('shares punctuation and original-name rules with catalog search', () => {
    const band = {
      id: 'music:236_даите-танк',
      mode: 'music',
      titleRu: 'Дайте танк (!)',
      titleOriginal: 'Daite Tank (!)',
      alternativeTitles: ['ДТ!'],
      aliases: [],
      popularityScore: 1,
    } as TitleItem

    expect(isFriendsRoomAnswerCorrect('Дайте танк(!)', band)).toBe(true)
    expect(isFriendsRoomAnswerCorrect('Daite Tank (!)', band)).toBe(true)
  })

  it('builds concise, non-answer hints from content metadata', () => {
    const hints = buildFriendsRoomHints(movie)
    expect(hints.length).toBeGreaterThanOrEqual(3)
    expect(hints.join(' ')).toContain('2010')
    expect(hints.join(' ')).not.toContain(movie.titleRu)
  })

  it('allows anonymous guests but requires a permanent creator account', () => {
    expect(() => assertFriendsRoomAccess(accessConfig(false, false), true)).not.toThrow()
    expect(() => assertFriendsRoomAccess(accessConfig(true, true), true)).not.toThrow()
    expect(() => assertFriendsRoomAccess(accessConfig(true, false), false)).not.toThrow()
    expect(() => assertFriendsRoomAccess(accessConfig(true, false), true)).not.toThrow()

    try {
      assertFriendsRoomCreator(true)
      throw new Error('expected anonymous room creation to be denied')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).statusCode).toBe(403)
      expect((error as ApiError).code).toBe('FRIENDS_ROOM_ACCOUNT_REQUIRED')
    }
    expect(() => assertFriendsRoomCreator(false)).not.toThrow()
  })
})
