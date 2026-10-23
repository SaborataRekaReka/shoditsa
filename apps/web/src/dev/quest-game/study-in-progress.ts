import type { ActiveSessionSummary } from '@shoditsa/contracts'
import { KPOP_ARTISTS_PACK_ID } from '@shoditsa/contracts'
import { INDEXABLE_GAME_SEO } from '../../app/seo-content'
import type { GameAvailabilityMap } from '../quest-home/game-availability'

export type StudyInProgressGame = { id: string; title: string; mode: string; href: string; detail: string }

/** Account sessions are authoritative online; local daily saves are used only offline. */
export function studyInProgressGames(availability: GameAvailabilityMap, sessions: readonly ActiveSessionSummary[] | null, connected: boolean): StudyInProgressGame[] {
  if (!connected) return INDEXABLE_GAME_SEO.filter(game => availability[game.mode] === 'in-progress').map(game => ({
    id: game.mode, title: game.shortName, mode: game.mode, href: game.canonicalPath, detail: 'Загадка дня',
  }))
  const seen = new Set<string>()
  return [...(sessions ?? [])].filter(session => {
    if (!['playing', 'final_choice'].includes(session.status) || seen.has(session.id)) return false
    seen.add(session.id)
    return true
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).flatMap(session => {
    const game = INDEXABLE_GAME_SEO.find(game => game.mode === session.mode)
    if (!game) return []
    return [{
      id: session.id, title: session.variantKey === KPOP_ARTISTS_PACK_ID ? 'K-pop: угадай артиста' : game.shortName,
      mode: session.mode, href: `/sessions/${encodeURIComponent(session.id)}`,
      detail: session.kind === 'daily' ? 'Загадка дня' : session.kind === 'archive' ? 'Из архива' : session.kind === 'pack' ? 'Спецпоказ' : 'Свободная партия',
    }]
  })
}
