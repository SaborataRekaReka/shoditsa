import type { FriendsRoomScorePart, Hint, PlayableCatalogGuessModeId, TitleItem } from '@shoditsa/contracts'
import { compareTitles } from '@shoditsa/game-core'

type ScoreStatus = FriendsRoomScorePart['status']

const COMMON_WEIGHTS: Record<string, number> = {
  year: 20,
  country: 20,
  continent: 15,
  genres: 15,
  languages: 20,
  runtime: 25,
  age: 15,
  rank: 25,
  creator: 90,
  cast: 70,
  studio: 85,
  developer: 90,
  publisher: 70,
  platforms: 20,
  steam_categories: 35,
  similar_artists: 90,
  music_origin: 75,
  icd: 100,
  localization: 70,
  diagnostics: 55,
  symptoms: 15,
  body_systems: 20,
  disease_types: 45,
  population: 30,
  timezone: 45,
}

const MODE_WEIGHTS: Record<PlayableCatalogGuessModeId, Record<string, number>> = {
  movie: { kp: 25, imdb: 25 },
  series: { seasons: 35, series_status: 20, kp: 25, imdb: 25 },
  anime: { anime_kind: 30, anime_status: 20, episodes: 30, episodes_aired: 25, anime_source: 65, shiki: 25 },
  game: { players: 35, steam_positive: 25, metacritic: 30, reviews: 25, price: 20 },
  city: { economy: 45, humanCapital: 45, qualityOfLife: 45, ecology: 45, governance: 45 },
  music: { activity_start_year: 25, decade: 25, music_type: 45, music_active: 15 },
  diagnosis: { course: 45, contagiousness: 45, typical_age: 40, risk_factors: 60 },
  animal: { animal_class: 25, animal_order: 55, animal_family: 70, body_coverings: 30, habitats: 35, animal_continents: 25, diets: 35, locomotion: 25, reproduction: 30, body_mass: 35, leg_count: 25 },
  book: { book_authors: 90, book_country: 45, book_language: 45, book_year: 30, book_genres: 35, book_series: 20, book_adaptation: 25, book_adaptation_count: 25, book_awards: 25 },
  character: { character_era: 35, character_source_types: 45, character_origin_cultures: 50, character_nature: 60, character_gender: 20, character_age_group: 25, character_roles: 35, character_archetypes: 45, character_abilities: 35, character_settings: 30 },
}

const statusFactor = (hint: Hint): { status: ScoreStatus; factor: number } | null => {
  if (hint.status === 'match') return { status: 'match', factor: 1 }
  if (hint.status === 'close') return { status: 'close', factor: 0.55 }
  if (hint.status === 'partial') {
    const matches = hint.matchedValues?.length ?? 1
    return { status: 'partial', factor: Math.min(0.75, 0.35 + matches * 0.12) }
  }
  return null
}

export const scoreFriendsRoomGuess = ({ answer, guess, elapsedSeconds, answerTimeSeconds }: {
  answer: TitleItem
  guess: TitleItem | null
  elapsedSeconds: number
  answerTimeSeconds: number
}): { correct: boolean; points: number; breakdown: FriendsRoomScorePart[] } => {
  if (guess?.id === answer.id) {
    const speedPoints = Math.max(0, Math.round(300 * (1 - Math.min(elapsedSeconds, answerTimeSeconds) / answerTimeSeconds)))
    return {
      correct: true,
      points: 700 + speedPoints,
      breakdown: [
        { key: 'answer', label: 'Точный ответ', status: 'exact', points: 700, maxPoints: 700 },
        { key: 'speed', label: 'Скорость', status: 'exact', points: speedPoints, maxPoints: 300 },
      ],
    }
  }
  if (!guess || guess.mode !== answer.mode) return { correct: false, points: 0, breakdown: [] }

  const breakdown = compareTitles(guess, answer).flatMap((hint) => {
    const result = statusFactor(hint)
    if (!result) return []
    const maxPoints = (MODE_WEIGHTS[answer.mode as PlayableCatalogGuessModeId] ?? {})[hint.key] ?? COMMON_WEIGHTS[hint.key] ?? 30
    const points = Math.round(maxPoints * result.factor)
    return points > 0 ? [{ key: hint.key, label: hint.label, status: result.status, points, maxPoints }] : []
  })
  const rawPoints = breakdown.reduce((sum, part) => sum + part.points, 0)
  if (rawPoints <= 650) return { correct: false, points: rawPoints, breakdown }

  const scale = 650 / rawPoints
  const scaled = breakdown.map((part) => ({ ...part, points: Math.round(part.points * scale) }))
  const roundingDelta = 650 - scaled.reduce((sum, part) => sum + part.points, 0)
  if (scaled[0]) scaled[0].points += roundingDelta
  return { correct: false, points: 650, breakdown: scaled }
}
