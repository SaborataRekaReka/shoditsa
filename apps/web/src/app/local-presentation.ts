import { resolvePresentation, isPublicPresentationPath, type PresentationMode } from './presentation-policy'
import { PLAYABLE_MODE_IDS } from '@shoditsa/contracts'
import { APPLICATION_DESIGN } from './application-design'

export const LOCAL_PRESENTATION = import.meta.env.DEV && import.meta.env.VITE_LOCAL_REDESIGN === '1'
export const CONNECTED_PRESENTATION = import.meta.env.DEV && import.meta.env.VITE_REFERENCE_API === '1'
export const PRESENTATION_PREVIEW = import.meta.env.DEV && (LOCAL_PRESENTATION || CONNECTED_PRESENTATION || !!import.meta.env.VITE_PUBLIC_THEME)
const presentationKey = 'shoditsa:public-presentation'

function initialPresentation(): PresentationMode {
  if (APPLICATION_DESIGN) return resolvePresentation({ dev: import.meta.env.DEV, application: true })
  if (!import.meta.env.DEV || typeof window === 'undefined') return 'legacy'
  let saved: string | null = null
  try { saved = window.sessionStorage.getItem(presentationKey) } catch { /* Private browser storage may be unavailable. */ }
  const presentation = resolvePresentation({ dev: true, configured: import.meta.env.VITE_PUBLIC_THEME, requested: new URLSearchParams(window.location.search).get('preview'), saved })
  try { window.sessionStorage.setItem(presentationKey, presentation) } catch { /* The configured profile remains authoritative. */ }
  return presentation
}

export const PUBLIC_PRESENTATION = initialPresentation()
export const REFERENCE_PRESENTATION = PUBLIC_PRESENTATION === 'reference'
export const isReferencePresentationPath = (pathname: string) => REFERENCE_PRESENTATION && isPublicPresentationPath(pathname)

export function applyPublicPresentation(pathname: string) {
  if (typeof document === 'undefined') return
  if (APPLICATION_DESIGN && isPublicPresentationPath(pathname)) document.documentElement.dataset.publicTheme = 'quest-study'
  else if (isReferencePresentationPath(pathname)) document.documentElement.dataset.publicTheme = 'reference'
  else delete document.documentElement.dataset.publicTheme
}

/** The isolated study can also be entered through its older hash-based Club link. */
export function applyLocalStudyPresentation() {
  if (LOCAL_PRESENTATION && import.meta.env.VITE_QUEST_STUDY === '1' && typeof document !== 'undefined') document.documentElement.dataset.publicTheme = 'quest-study'
}

export function applyApplicationPresentation() {
  if (APPLICATION_DESIGN && typeof document !== 'undefined') document.documentElement.dataset.publicTheme = 'quest-study'
}

export const localPresentationLink = (href: string) => {
  if (APPLICATION_DESIGN) return href
  if (!LOCAL_PRESENTATION) return href
  if (import.meta.env.VITE_QUEST_STUDY === '1' && PLAYABLE_MODE_IDS.some(mode => href.split(/[?#]/, 1)[0] === `/games/${mode}`)) return href
  const preview = REFERENCE_PRESENTATION ? 'reference' : 'afisha'
  return `/?preview=${preview}#${href}${href.includes('?') ? '&' : '?'}preview=${preview}`
}
