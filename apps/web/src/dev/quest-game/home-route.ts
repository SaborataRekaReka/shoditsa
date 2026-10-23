export const STUDY_HOME_VARIANT_KEY = 'shoditsa:study-home-variant'

/** Recognize home without stealing challenge, account or legacy session entries. */
export function isStudyRootHomeLocation({ pathname, search, hash }: { pathname: string; search: string; hash: string }): boolean {
  if (!['/', '/index.html'].includes(pathname)) return false
  // The browser includes '#'; the application router passes the fragment alone.
  const anchor = hash && !hash.startsWith('#') ? `#${hash}` : hash
  if (!['', '#', '#/', '#games', '#home-main', '#home-games', '#home-guide',
    '#home-quiz', '#home-logic', '#home-company', '#home-specials',
    '#world-culture', '#world-discover', '#world-logic',
  ].includes(anchor)) return false
  const params = new URLSearchParams(search)
  // Existing game, challenge and account entries must reach the application router.
  return !['studyMode', 'play', 'challenge', 'token', 'tab'].some(key => params.has(key))
}

/** Home composition affects its query, while section navigation uses plain paths. */
export function studyHomeHref(variant: string | null, catalogue = false): string | undefined {
  return variant && ['a', 'b', 'c'].includes(variant)
    ? `/${variant === 'a' ? '' : `?variant=${variant}`}`
    : undefined
}
