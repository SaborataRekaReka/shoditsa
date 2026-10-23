import { Children, isValidElement, type ReactNode } from 'react'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { useStudyPanels } from './study-panels'
import { StudyPanelGripIcon } from './StudyPanelGripIcon'
import { StudyFooter } from './StudyTheme'
import { ApplicationGamesWidget } from '../../features/application/ApplicationGamesWidget'
import { StudyRoomsWidget, StudyTodayWidget } from './StudySidebarWidgets'

export function StudyRightSidebar({ children, className = '', label, enabled = true, gamesFirst = false, showToday = true, contextual = false, refreshKey }: { children: ReactNode; className?: string; label: string; enabled?: boolean; gamesFirst?: boolean; showToday?: boolean; contextual?: boolean; refreshKey?: string }) {
  const panels = useStudyPanels()
  if (!enabled) return <aside className={`qg-right ${className}`} aria-label={label}>{children}</aside>
  const hidden = panels.rightCollapsed
  const content = Children.toArray(children).filter(child => !isValidElement(child) || child.type !== StudyFooter)
  return <><aside className={`qg-right study-right-panel ${className}`} aria-label={label} data-study-right={panels.rightCollapsed ? 'collapsed' : 'expanded'} data-study-right-layout={panels.desktopRight ? 'side' : 'stacked'}>
    <QuestButton kind="icon" className="study-panel-grip study-panel-grip--right" aria-label={panels.rightCollapsed ? 'Развернуть правую панель' : 'Свернуть правую панель'} aria-expanded={!panels.rightCollapsed} title={panels.rightCollapsed ? 'Показать панель' : 'Свернуть панель'} onClick={panels.toggleRight}><StudyPanelGripIcon direction={panels.rightCollapsed ? 'left' : 'right'} /></QuestButton>
    <div className="study-right-content" inert={hidden} aria-hidden={hidden || undefined}>
      <div className="study-right-header-slot" />
      {contextual ? content : <>{!gamesFirst && content[0]}{showToday && <StudyTodayWidget refreshKey={refreshKey} />}<ApplicationGamesWidget refreshKey={refreshKey} /><StudyRoomsWidget />{gamesFirst ? content : content.slice(1)}</>}<StudyFooter />
    </div>
  </aside>{hidden && <div className="study-collapsed-footer"><StudyFooter /></div>}</>
}
