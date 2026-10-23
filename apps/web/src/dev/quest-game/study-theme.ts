export type StudyTheme = 'light' | 'dark'
export const STUDY_THEME_KEY = 'shoditsa:study:theme'
const THEME_EVENT = 'study-theme-change'
let current: StudyTheme | undefined

export function resolveStudyTheme(requested: string | null, saved: string | null): StudyTheme {
  return requested === 'dark' || requested === 'light' ? requested : saved === 'dark' ? 'dark' : 'light'
}

export function getStudyTheme(): StudyTheme {
  if (current) return current
  if (typeof window === 'undefined') return 'light'
  let saved: string | null = null
  try { saved = window.localStorage.getItem(STUDY_THEME_KEY) } catch { /* The preference still works for this document. */ }
  current = resolveStudyTheme(new URLSearchParams(window.location.search).get('tone'), saved)
  return current
}

export function applyStudyTheme(theme = getStudyTheme()) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.questTone = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1a191b' : '#ffffff')
}

export function setStudyTheme(theme: StudyTheme) {
  current = theme
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(STUDY_THEME_KEY, theme) } catch { /* Keep the in-memory preference if storage is unavailable. */ }
  // An explicit preview URL must not revert the user's choice after a reload.
  const url = new URL(window.location.href)
  if (url.searchParams.has('tone')) {
    url.searchParams.set('tone', theme)
    window.history.replaceState(window.history.state, '', url)
  }
  applyStudyTheme(theme)
  window.dispatchEvent(new Event(THEME_EVENT))
}

export function subscribeStudyTheme(notify: () => void) {
  if (typeof window === 'undefined') return () => {}
  const sync = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage || (event.key !== STUDY_THEME_KEY && event.key !== null)) return
    current = resolveStudyTheme(null, event.newValue)
    applyStudyTheme(current)
    notify()
  }
  window.addEventListener(THEME_EVENT, notify)
  window.addEventListener('storage', sync)
  return () => {
    window.removeEventListener(THEME_EVENT, notify)
    window.removeEventListener('storage', sync)
  }
}
