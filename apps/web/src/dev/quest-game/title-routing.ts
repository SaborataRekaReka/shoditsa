import type { SeoGameMode } from '../../app/seo-content'
import liveCopy from './live-title-copy.json'

// Keep this helper independent of the app runtime: Vite loads it in Node.
const modes = Object.keys(liveCopy) as SeoGameMode[]

export function studyTitleMode(pathname: string, search: string): SeoGameMode {
  const pathMode = modes.find(mode => `/games/${mode}` === pathname)
  if (pathMode) return pathMode
  const requested = new URLSearchParams(search).get('mode')
  return modes.find(mode => mode === requested) ?? 'anime'
}

/** Used only by the explicitly enabled local study server. */
export function studyTitleRequest(requestUrl: string): string | undefined {
  const url = new URL(requestUrl, 'http://localhost')
  const mode = modes.find(mode => `/games/${mode}` === url.pathname)
  if (!mode) return undefined
  url.searchParams.set('mode', mode)
  return `/shoditsa-title.html?${url.searchParams.toString()}`
}
