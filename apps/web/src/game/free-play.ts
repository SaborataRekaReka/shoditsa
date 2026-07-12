const FREE_PLAY_SALT_OFFSET = 1_000_000

const normalizeLaunch = (launch: number) => Math.max(1, Math.trunc(Number(launch) || 1))

/**
 * Keeps a paid free-play run separate from the daily game and from every
 * previous paid run. The launch number is persisted in localStorage by the
 * economy layer, so it remains stable even after a reload.
 */
export const freePlayGameKey = (baseKey: string, launch: number) => `${baseKey}|free:${normalizeLaunch(launch)}`

export const freePlayAnswerSalt = (launch: number) => FREE_PLAY_SALT_OFFSET + normalizeLaunch(launch)

export const freePlayLaunchFromGameKey = (key: string): number | null => {
  const match = /\|free:(\d+)$/.exec(key)
  if (!match) return null

  const launch = Number(match[1])
  return Number.isSafeInteger(launch) && launch > 0 ? launch : null
}
