const fallback = '/'
export const STUDY_CLUB_HREF = '/club'
export const STUDY_CLUB_OFFER_HREF = '/club/membership'
export const studyHeaderClubHref = (active: boolean) => active ? STUDY_CLUB_HREF : STUDY_CLUB_OFFER_HREF

/** Only same-origin destinations can be carried through an account screen. */
export function studyReturnUrl(value: string | null | undefined, origin = 'http://localhost'): string {
  if (!value) return fallback
  try {
    const url = new URL(value, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch { return fallback }
}

export function studyAccountHref(screen: 'login' | 'register' | 'admin', returnUrl?: string) {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const from = studyReturnUrl(returnUrl ?? (typeof window === 'undefined' ? undefined : window.location.href), origin)
  return `/${screen}?${new URLSearchParams({ [screen === 'admin' ? 'from' : 'returnUrl']: from })}`
}

export function studyPasswordRecoveryHref(returnUrl?: string) {
  return `${studyAccountHref('login', returnUrl)}&flow=forgot`
}

/** This rewrite is installed only in the isolated, development-only study. */
export function studyAccountRequest(request: string): string | undefined {
  const url = new URL(request, 'http://localhost')
  if (!['/login', '/register', '/admin', '/admin/'].includes(url.pathname)) return undefined
  url.searchParams.set('screen', url.pathname.startsWith('/admin') ? 'admin' : url.pathname.slice(1))
  return `/shoditsa-auth.html?${url.searchParams}`
}
