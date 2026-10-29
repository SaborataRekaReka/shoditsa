import { useLayoutEffect, type ReactNode } from 'react'
import { StudySidebar } from '../../dev/quest-game/StudySidebar'
import { StudyHeader } from '../../dev/quest-game/StudyHeader'
import { StudyRightSidebar } from '../../dev/quest-game/StudyRightSidebar'
import { StudySectionAside } from '../../dev/quest-game/StudySectionAside'
import { GeneratedShoditsaGlyph } from '../../dev/quest-game/GeneratedShoditsaArt'
import { applyApplicationPresentation } from '../../app/local-presentation'
import { useStudyTheme } from '../../dev/quest-game/StudyTheme'
import { EmbeddedApplicationContext } from './EmbeddedApplicationContext'
import { applicationSection } from './routes'
import type { StudyView } from '../../dev/quest-game/navigation'
import { isSvoyakPath } from '../rooms/room-navigation'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import '../../styles/quest-study-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import '../../dev/quest-game/quest-game.css'
import '../../dev/quest-game/shoditsa-game.css'
import './ApplicationFrame.css'

/** Shared product shell for supporting feature controllers. */
export function ApplicationFrame({ pathname, children, aside, focused = false }: { pathname: string; children: ReactNode; aside?: ReactNode; focused?: boolean }) {
  useStudyTheme()
  // Direct entry to supporting pages must populate the same account cache as
  // the home/game controllers; the header and sidebars only observe that cache.
  useServerRuntime()
  const view = applicationSection(pathname) ?? (isSvoyakPath(pathname) || pathname === '/games/together' ? 'lobby' : 'title')
  useLayoutEffect(() => {
    document.documentElement.dataset.questSkin = 'shoditsa'
    document.documentElement.dataset.localStudy = 'app'
    applyApplicationPresentation()
    return () => { if (document.documentElement.dataset.localStudy === 'app') delete document.documentElement.dataset.localStudy }
  }, [])
  return <EmbeddedApplicationContext.Provider value>
    <div className={`qg-app application-frame${focused ? ' application-frame--focused' : ''}`} data-public-theme="quest-study" data-quest-skin="shoditsa">
      <StudySidebar view={view as StudyView} shoditsa homeHref="/" Glyph={GeneratedShoditsaGlyph} />
      <div className="qg-layout study-layout">
        <StudyHeader Glyph={GeneratedShoditsaGlyph} />
        <div className="qg-main application-content">{children}</div>
        {!focused && <StudyRightSidebar label={view === 'lobby' ? 'Компания и приглашение' : 'Аккаунт и игры'} contextual={view === 'lobby'}>{view === 'lobby' ? <><div className="application-aside-slot" /><div className="application-aside-fallback">{aside}</div></> : aside ?? <StudySectionAside view={view as StudyView} homeHref="/" goalsDone={0} factsFound={0} onContinue={() => window.location.assign('/')} />}</StudyRightSidebar>}
      </div>
    </div>
  </EmbeddedApplicationContext.Provider>
}
