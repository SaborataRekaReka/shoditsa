import { publicAssetUrl } from '../../app/public-asset'

/** Local art direction only; published pack metadata and original artwork stay intact. */
export function clubLibraryCover(pack: { id: string; coverUrl: string | null; mode: string }) {
  const covers: Record<string, string> = {
    'dtf-game-comments-25-v1': 'images/club-library/dtf-comments-scene-v6.webp',
    'kpop-artists-admin-v1': 'images/club-library/kpop-stage-scene-v2.webp',
  }
  const localCover = covers[pack.id]
  if (localCover) return publicAssetUrl(localCover)
  if (pack.coverUrl) return /^https?:\/\//i.test(pack.coverUrl) ? pack.coverUrl : publicAssetUrl(pack.coverUrl)
  return publicAssetUrl(`images/home-doodle/${pack.mode}.webp`)
}
