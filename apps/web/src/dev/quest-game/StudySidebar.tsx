import { useId, type ComponentType, type ReactNode } from 'react'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { Tooltip } from '../../components/ui/Tooltip'
import type { GlyphName } from './QuestArt'
import { studyNavItems, studyMenuView, type StudyView } from './navigation'
import { StudyProfileIcon } from './StudyProfileArt'
import { StudyBrandLogo } from './StudyBrandLogo'
import { StudyGamesCounter } from './StudyGamesCounter'
import { useStudyPanels } from './study-panels'
import { StudyPanelGripIcon } from './StudyPanelGripIcon'
import './study-shell.css'
import { applicationHref } from '../../features/application/routes'
import { StudyClubMiniBanner } from './StudyClubMiniBanner'
import { StudyLobbyIcon } from './StudyLobbyIcon'

type Props = {
  view: StudyView
  currentPage?: 'club' | 'club-offer'
  clubActive?: boolean
  refreshKey?: string
  shoditsa: boolean
  homeHref: string
  Glyph: ComponentType<{ name: GlyphName; size?: number; className?: string }>
  onNavigate?: (view: StudyView) => void
  onSettings?: () => void
  hrefFor?: (view: StudyView) => string
  more?: ReactNode
  children?: ReactNode
}

/** The same left rail and responsive bottom bar on home, titles and play. */
export function StudySidebar({ view, currentPage, clubActive, refreshKey, shoditsa, homeHref, Glyph, onNavigate, hrefFor, more, children }: Props) {
  const panels = useStudyPanels()
  const gamesDescription = useId()
  return <aside className="qg-rail" data-study-shell data-study-left={shoditsa ? panels.leftCollapsed ? 'collapsed' : 'expanded' : undefined}>
    <a className="qg-wordmark" href={homeHref} aria-label="Сходится! — играть" onClick={onNavigate ? event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(studyMenuView('play', shoditsa)) } } : undefined}>{shoditsa ? <><StudyBrandLogo /><StudyBrandLogo compact /></> : <>сходится!<span>с!</span></>}</a>
    <nav aria-label="Основная навигация">{studyNavItems(shoditsa).map(item => {
      const selected = currentPage ? currentPage === 'club' && item.id === 'club' : view === item.id || ((view === 'title' || view === 'games') && item.id === 'play')
      const label = item.label
      const body = <>{shoditsa && item.id === 'profile' ? <StudyProfileIcon size={36} /> : item.id === 'lobby' ? <StudyLobbyIcon size={36} /> : <Glyph name={item.glyph} size={36} />}<span className="study-nav-label">{label}</span>{shoditsa && item.id === 'play' && <StudyGamesCounter descriptionId={gamesDescription} refreshKey={refreshKey} />}</>
      if (shoditsa) return <Tooltip key={item.id} label={label} disabled={!panels.leftCollapsed} minViewportWidth={700}>{(tooltip, tooltipId) => <a {...tooltip} className={`quest-button quest-button--nav qg-nav-item${selected ? ' is-selected' : ''}`} href={applicationHref(item.id)} aria-current={selected ? 'page' : undefined} aria-label={label} aria-describedby={[item.id === 'play' ? gamesDescription : '', tooltipId].filter(Boolean).join(' ') || undefined} onClick={onNavigate && item.id !== 'lobby' ? event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(studyMenuView(item.id, shoditsa)) } } : undefined}>{body}</a>}</Tooltip>
      if (item.id === 'club' && !onNavigate) return <a key={item.id} className={`quest-button quest-button--nav qg-nav-item${selected ? ' is-selected' : ''}`} href={item.href} aria-current={selected ? 'page' : undefined} aria-label={label}>{body}</a>
      return onNavigate
        ? <QuestButton key={item.id} kind="nav" selected={selected} className="qg-nav-item" aria-current={selected ? 'page' : undefined} aria-label={label} aria-describedby={shoditsa && item.id === 'play' ? gamesDescription : undefined} onClick={() => onNavigate(studyMenuView(item.id, shoditsa))}>{body}</QuestButton>
        : <a key={item.id} className={`quest-button quest-button--nav qg-nav-item${selected ? ' is-selected' : ''}`} href={hrefFor!(studyMenuView(item.id, shoditsa))} aria-current={selected ? 'page' : undefined} aria-label={label} aria-describedby={shoditsa && item.id === 'play' ? gamesDescription : undefined}>{body}</a>
    })}{!shoditsa && more}</nav>
    {!shoditsa && children}
    {shoditsa && <StudyClubMiniBanner context={currentPage} active={clubActive} />}
    {shoditsa && <QuestButton kind="icon" className="study-panel-grip study-panel-grip--left" aria-label={panels.leftCollapsed ? 'Развернуть левое меню' : 'Свернуть левое меню'} aria-expanded={!panels.leftCollapsed} title={panels.leftCollapsed ? 'Развернуть меню' : 'Свернуть меню'} onClick={panels.toggleLeft}><StudyPanelGripIcon direction={panels.leftCollapsed ? 'right' : 'left'} /></QuestButton>}
  </aside>
}
