import type { ReactNode } from 'react'
import type { TitleMode } from '../../types'
import { PosterReel } from '../../components/poster-reel/PosterReel'
import { CatalogEntryHero } from './CatalogEntryHero'
import { CatalogEntryDetails } from './CatalogEntryDetails'
import { catalogEntryCovers } from './catalog-entry-presentation'
import { MODE_CONFIG } from '../../app/mode-config'
import './CatalogEntryTemplate.css'

export function CatalogEntryTemplate({ mode, date, dayNumber, launchControls, extra }: { mode: TitleMode; date: string; dayNumber: number; launchControls: ReactNode; extra?: ReactNode }) {
  return <div className={`catalog-entry catalog-entry--${mode}`} data-puzzle-date={date} data-day-number={dayNumber}>
    <CatalogEntryHero mode={mode} launchControls={launchControls} extra={extra} />
    <PosterReel key={mode} posters={catalogEntryCovers(mode)} fallbackIcon={mode} label={`Примеры из каталога: ${MODE_CONFIG[mode].plural}`} />
    <div className="catalog-entry__details"><CatalogEntryDetails mode={mode} /></div>
  </div>
}
