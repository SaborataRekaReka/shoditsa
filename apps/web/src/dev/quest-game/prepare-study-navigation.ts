/** Development-only, render-blocking bootstrap injected by the study server.
 * It keeps the outgoing snapshot until the React shell and local fonts exist.
 * No links are intercepted: downloads, modified clicks and browser history stay native.
 */
import { applyStudyTheme } from './study-theme'
import { isStudyRootHomeLocation } from './home-route'
import { applicationSection } from '../../features/application/routes'

if (isStudyRootHomeLocation(window.location) || applicationSection(window.location.pathname)) {
  document.documentElement.dataset.questSkin = 'shoditsa'
  document.documentElement.dataset.questEntry = 'home'
}

const studyPage = document.documentElement.dataset.questSkin === 'shoditsa'
  || /^#\/(?:club|play\/)/.test(window.location.hash)

if (studyPage) {
  applyStudyTheme()
  document.documentElement.dataset.studyViewApi = typeof document.startViewTransition
  document.documentElement.dataset.studyDocument = String(performance.timeOrigin)
  window.addEventListener('pageswap', event => {
    const transition = (event as Event & { viewTransition?: ViewTransition }).viewTransition
    if (transition) void transition.ready.catch(() => {})
  })
  window.addEventListener('pagereveal', event => {
    const transition = (event as Event & { viewTransition?: ViewTransition }).viewTransition
    document.documentElement.dataset.studyTransition = transition ? 'cross-document' : 'initial'
    if (transition) {
      document.documentElement.setAttribute('data-study-transitioning', '')
      void transition.ready.catch(() => {})
      void transition.finished.finally(() => document.documentElement.removeAttribute('data-study-transitioning'))
    }
  })
  const shellReady = new Promise<void>(resolve => {
    const ready = () => document.getElementById('study-screen-ready') || document.querySelector('[data-page-pending]')
    if (ready()) return resolve()
    const observer = new MutationObserver(() => {
      if (ready()) { observer.disconnect(); resolve() }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    window.setTimeout(() => { observer.disconnect(); resolve() }, 1800)
  })
  await Promise.race([
    shellReady.then(() => Promise.all([
      document.fonts.load('400 15px "Reference Nunito"'),
      document.fonts.load('800 15px "Reference Nunito"'),
      document.fonts.load('800 25px "Reference Manrope"'),
      document.fonts.load('700 30px "Reference Caveat"'),
    ]).catch(() => {})),
    new Promise(resolve => window.setTimeout(resolve, 2000)),
  ])
  document.documentElement.dataset.studyNavigation = 'ready'
  performance.mark('study-shell-ready')
}

delete document.documentElement.dataset.studyBooting

export {}
