import { flushSync } from 'react-dom'
import { studyViewFromHash, type StudyView } from './navigation'
import { isStudyRootHomeLocation } from './home-route'
import { applicationSection } from '../../features/application/routes'
import { beginRouteLoading, finishRouteLoading } from '../../app/route-loading'
import { runViewTransition } from '../../app/view-transition'

/** Only destinations implemented by the shared study app are soft navigations. */
export function studyLinkView(href: string, origin: string): StudyView | undefined {
  try {
    const url = new URL(href, origin)
    if (url.origin !== origin || url.searchParams.has('panel')) return undefined
    const section = applicationSection(url.pathname)
    if (section && section !== 'games' && !url.hash) return section
    if (isStudyRootHomeLocation(url) && ['', '#games', '#home-games'].includes(url.hash)) return 'games'
    if (url.pathname === '/shoditsa-home.html' && ['', '#home-games'].includes(url.hash)) return 'games'
    if (url.pathname === '/shoditsa-title.html') return studyViewFromHash(url.hash, true, true)
    if (url.pathname === '/' && /^#\/club(?:\?|$)/.test(url.hash)) return studyViewFromHash(url.hash, true, true)
  } catch { /* Invalid links keep normal browser handling. */ }
  return undefined
}

let generation = 0

/** Keep the shared shell still while React commits the next section atomically. */
export function transitionStudyPage(update: () => void, prepare?: () => Promise<unknown> | undefined) {
  const own = ++generation
  finishRouteLoading()
  const commit = (finish?: () => void) => {
    if (own !== generation) { finish?.(); return }
    const render = () => { finish?.(); update() }
    runViewTransition(() => {
      if (own === generation) {
        flushSync(render)
        document.documentElement.dataset.studyTransition = 'same-document'
      }
    })
  }
  const pending = prepare?.()
  // Failed imports reach the existing error boundary instead of leaving navigation stuck.
  if (pending) {
    const finish = beginRouteLoading()
    const prepared = () => commit(finish)
    void pending.then(prepared, prepared)
  }
  else commit()
}
