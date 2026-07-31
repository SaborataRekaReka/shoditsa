import { KPOP_ARTISTS_PACK_ID, isCatalogGuessModeId, type ActiveSessionSummary, type GameSessionSnapshot, type PlayableCatalogGuessModeId } from '@shoditsa/contracts'

export type CatalogGameBackTarget = 'title' | 'rewatch' | 'hub'

export type GameExperience =
  | { source: 'catalog'; backTarget: CatalogGameBackTarget }
  | { source: 'pack'; packId: string }

export const catalogGameExperience = (backTarget: CatalogGameBackTarget): GameExperience => ({
  source: 'catalog',
  backTarget,
})

export const gameExperienceForSession = (
  session: Pick<GameSessionSnapshot, 'kind' | 'packId' | 'variantKey'>,
  catalogBackTarget: CatalogGameBackTarget,
): GameExperience => {
  if (session.variantKey === KPOP_ARTISTS_PACK_ID) {
    return { source: 'pack', packId: KPOP_ARTISTS_PACK_ID }
  }
  return session.kind === 'pack' && session.packId
    ? { source: 'pack', packId: session.packId }
    : catalogGameExperience(catalogBackTarget)
}

export const catalogActiveSessions = (sessions: ActiveSessionSummary[]) =>
  sessions.filter((session): session is ActiveSessionSummary & { mode: PlayableCatalogGuessModeId } => (
    session.kind !== 'pack' && isCatalogGuessModeId(session.mode)
  ))
