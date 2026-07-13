import type { LegacyImportBody } from '@shoditsa/contracts'
import { allGames, loadPeriodUnlocks, loadWallet } from '../../storage'

const DEVICE_ID_KEY = 'seans:v1:legacy-device-id'
const MARKER_PREFIX = 'seans:v1:legacy-imported:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const legacyImportMarkerKey = (userId: string) => `${MARKER_PREFIX}${userId}`

const deviceId = () => {
  const stored = localStorage.getItem(DEVICE_ID_KEY)?.trim() ?? ''
  if (UUID_PATTERN.test(stored)) return stored
  const created = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, created)
  return created
}

export const buildLegacyImport = (): LegacyImportBody | null => {
  const games = allGames().map((game) => ({
    mode: game.mode,
    period: game.period,
    date: game.date,
    difficulty: game.difficulty === 'experimental' ? 'expert' as const : game.difficulty ?? null,
    attemptTitleIds: (game.attemptTitleIds?.length ? game.attemptTitleIds : game.attempts.map((attempt) => attempt.titleId)).slice(0, 10),
    attempts: game.attempts.slice(0, 10).map((attempt) => ({ titleId: attempt.titleId })),
  }))
  const wallet = loadWallet()
  const periodUnlocks = Object.fromEntries(Object.entries(loadPeriodUnlocks()).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Array.isArray(entry[1])))
  if (!games.length && wallet.tickets <= 0 && !Object.values(periodUnlocks).some((periods) => periods.length)) return null
  return { consent: true, deviceId: deviceId(), schemaVersion: 1, games, wallet: { tickets: wallet.tickets }, periodUnlocks }
}

export const legacyImportCompleted = (userId: string) => localStorage.getItem(legacyImportMarkerKey(userId)) === '1'
export const markLegacyImportCompleted = (userId: string) => localStorage.setItem(legacyImportMarkerKey(userId), '1')
