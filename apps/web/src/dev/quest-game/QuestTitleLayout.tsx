import type { ReactNode } from 'react'
import { getMoscowDate, prettyDate } from '@shoditsa/game-core'
import type { SeoGameMode } from '../../app/seo-content'
import { PageBackline } from '../../components/ui/PageBackline'
import { dayNumber } from '../../game/day-number'
import { QuestTitleContent } from './QuestTitleContent'
import './quest-title.css'
import { QuestTitleHero } from './QuestTitleHero'
import { TITLE_HERO_COPY } from './title-hero-presentation'

export { QuestTitleHero } from './QuestTitleHero'

/** Shared appearance; local and server launch controllers keep their own behavior. */
export function QuestTitleLayout({ mode, date = getMoscowDate(), allGamesHref = '/', showBackline = true, children, extra }: {
  mode: SeoGameMode
  date?: string
  allGamesHref?: string
  showBackline?: boolean
  children: ReactNode
  extra?: ReactNode
}) {
  const copy = TITLE_HERO_COPY[mode]
  return <div className={`qt-title qt-title--${mode}`} data-puzzle-date={date}>
    {showBackline && <PageBackline href={allGamesHref} label="Все игры" trailing={<time dateTime={date}>{prettyDate(date)}, {date.slice(0, 4)}</time>} />}
    <QuestTitleHero mode={mode} kicker={mode === 'danetki' ? 'Ежедневная история с ведущим' : `Игра дня №${dayNumber(date)}`} title={copy.title} lead={copy.lead}>
      {children}
      {extra && <div className="qt-connected-extra">{extra}</div>}
    </QuestTitleHero>
    <QuestTitleContent mode={mode} />
  </div>
}
