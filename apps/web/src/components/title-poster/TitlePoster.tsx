import { useState } from 'react'
import { Music2 } from 'lucide-react'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { canUseAsArtistPortrait } from '../../game'
import { searchMediaAlt } from '../../game/search-presentation'
import type { TitleItem } from '../../types'
import {
  defaultDiagnosisSystemIcon,
  diagnosisSystemIconByKey,
  normalizeDiagnosisSystemKey,
} from '../../features/game-session/diagnosis-presentation'

const artistInitials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase()

export function TitlePoster({ item, className = '' }: { item: TitleItem; className?: string }) {
  const [failed, setFailed] = useState(false)
  const kpopPortraitUrl = item.cardType === 'kpop_artist' && item.id.startsWith('kpop:')
    ? `/images/kpop/artists/${encodeURIComponent(item.id.slice('kpop:'.length))}.webp`
    : null
  const portraitSource = item.mode === 'city'
    ? [item.coatOfArmsUrl, item.cityFlagUrl, item.posterUrl, item.countryFlagUrl].find(Boolean) ?? null
    : item.mode === 'music'
      ? [kpopPortraitUrl, item.posterUrl, item.headerUrl, item.backdropUrl, ...(item.screenshots ?? [])].find((url) => canUseAsArtistPortrait(url ?? null)) ?? null
      : [item.posterUrl, item.headerUrl, item.backdropUrl, ...(item.screenshots ?? [])].find(Boolean) ?? null
  const diagnosisIcon = item.mode === 'diagnosis'
    ? diagnosisSystemIconByKey.get(normalizeDiagnosisSystemKey(item.bodySystems?.[0] ?? '')) ?? defaultDiagnosisSystemIcon
    : ''
  const initials = artistInitials(item.titleRu || item.titleOriginal || '')
  const ModeIcon = MODE_PRESENTATION[item.mode].icon

  return portraitSource && !failed
    ? <img className={className} src={portraitSource} alt={searchMediaAlt(item)} onError={() => setFailed(true)} />
    : <div className={`${className} poster-fallback${item.mode === 'diagnosis' ? ' poster-fallback--diagnosis' : ''}`} role="img" aria-label={searchMediaAlt(item)}>
      {item.mode === 'music'
        ? <><Music2 /><span>{initials || '♪'}</span></>
        : item.mode === 'diagnosis'
          ? <><img className="poster-fallback__dx" src={diagnosisIcon} alt="" aria-hidden="true" loading="lazy" /><span>{item.titleRu}</span></>
          : <><ModeIcon /><span>{item.titleRu}</span></>}
    </div>
}
