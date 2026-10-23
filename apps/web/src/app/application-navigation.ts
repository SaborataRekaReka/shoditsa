import { isCatalogGuessModeId } from '@shoditsa/contracts'
import { applicationSection } from '../features/application/routes'
import { isSvoyakPath } from '../features/rooms/room-navigation'

/** Only URLs owned by the shared player router. Downloads, auth and previews stay native. */
export function applicationLink(href: string, origin: string): string | undefined {
  try {
    const url = new URL(href, origin)
    if (url.origin !== origin || url.searchParams.has('panel')) return undefined
    const mode = url.pathname.match(/^\/(?:games|play)\/([^/]+)$/)?.[1]
    const friends = url.pathname === '/games/together'
    const community = /^\/(?:support|blog(?:\/[^/]+)?)\/?$/.test(url.pathname)
    const special = /^\/specials(?:\/[^/]+)?\/?$/.test(url.pathname)
    if (!applicationSection(url.pathname) && !friends && !community && !special && !isSvoyakPath(url.pathname) && !(mode && isCatalogGuessModeId(mode)) && !/^\/sessions\/[^/]+$/.test(url.pathname)) return undefined
    if (url.hash && !(url.pathname === '/' && ['#games', '#home-games'].includes(url.hash))) return undefined
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return undefined }
}

type Navigator = (href: string, replace?: boolean) => Promise<void>
let navigator: Navigator | undefined
export function installApplicationNavigator(next: Navigator) {
  navigator = next
  return () => { if (navigator === next) navigator = undefined }
}

export function navigateApplication(href: string, replace = false): Promise<void> {
  const target = applicationLink(href, window.location.origin)
  if (navigator && target) return navigator(target, replace)
  if (replace) window.location.replace(href)
  else window.location.assign(href)
  return Promise.resolve()
}
