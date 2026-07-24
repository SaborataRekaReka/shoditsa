import type { ActiveSessionSummary, GameSessionSnapshot } from '@shoditsa/contracts'

export type CatalogGameBackTarget = 'title' | 'rewatch' | 'hub'

export type GameExperience =
  | { source: 'catalog'; backTarget: CatalogGameBackTarget }
  | { source: 'pack'; packId: string }

export const catalogGameExperience = (backTarget: CatalogGameBackTarget): GameExperience => ({
  source: 'catalog',
  backTarget,
})

export const gameExperienceForSession = (
  session: Pick<GameSessionSnapshot, 'kind' | 'packId'>,
  catalogBackTarget: CatalogGameBackTarget,
): GameExperience => session.kind === 'pack' && session.packId
  ? { source: 'pack', packId: session.packId }
  : catalogGameExperience(catalogBackTarget)

export const catalogActiveSessions = (sessions: ActiveSessionSummary[]) =>
  sessions.filter((session) => session.kind !== 'pack')
