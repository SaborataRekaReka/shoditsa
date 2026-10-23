import { KPOP_ARTISTS_PACK_ID, type ContentPack, type DashboardResponse, type EconomyRuleSet } from '@shoditsa/contracts'
import catalog from './club-library-catalog.json'

export type ClubLibraryItem = Pick<ContentPack, 'id' | 'title' | 'subtitle' | 'description' | 'mode' | 'coverUrl' | 'totalItems'> & {
  completedItems: number | null
  access: ContentPack['access'] | null
  cadence: 'daily' | 'collection'
}

export type ClubLibraryFilter = 'all' | 'in-progress' | 'completed'

const cadence = (id: string): ClubLibraryItem['cadence'] => id === KPOP_ARTISTS_PACK_ID ? 'daily' : 'collection'

export const specialPackItem = (pack: ContentPack): ClubLibraryItem => ({ ...pack, cadence: cadence(pack.id) })

/** A public metadata snapshot cannot establish a player's access or progress. */
export function clubLibraryItems(packs: readonly ContentPack[] | null): ClubLibraryItem[] {
  if (packs === null) return catalog.items.filter(item => item.includedInClub).map(item => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    description: item.description,
    mode: item.mode as ContentPack['mode'],
    coverUrl: item.coverUrl,
    totalItems: item.totalItems,
    completedItems: null,
    access: null,
    cadence: cadence(item.id),
  }))

  return packs.filter(pack => pack.includedInClub).map(specialPackItem)
}

export function clubLibraryFilter(items: readonly ClubLibraryItem[], filter: ClubLibraryFilter): ClubLibraryItem[] {
  return items.filter(item => {
    if (filter === 'all') return true
    // A daily show's total is its answer pool, not a collection to finish.
    if (item.cadence === 'daily' || item.completedItems === null || item.totalItems <= 0) return false
    return filter === 'completed'
      ? item.completedItems >= item.totalItems
      : item.completedItems > 0 && item.completedItems < item.totalItems
  })
}

export function clubDanetkiRemaining(access: DashboardResponse['danetkiAccess'] | null, active: boolean, rules: EconomyRuleSet): number | null {
  if (!access || !active) return null
  return Math.max(0, rules.danetki.dailyFreeRooms - access.dailyRoomsStarted) + Math.max(0, access.clubRoomsRemaining)
}
