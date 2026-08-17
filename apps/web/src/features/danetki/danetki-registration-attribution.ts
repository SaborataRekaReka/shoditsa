export type DanetkiRegistrationPlacement = 'investigation' | 'result' | 'catalog'

export type DanetkiRegistrationIntent = {
  source: 'danetki'
  placement: DanetkiRegistrationPlacement
  returnUrl: string
  createdAt: string
  story?: string
  entrySource?: string
  collection?: string
}

export type DanetkiTrafficContext = {
  entrySource: string
  collection?: string
}

const STORAGE_KEY = 'shoditsa:danetki-registration-intent:v1'
const TRAFFIC_STORAGE_KEY = 'shoditsa:danetki-traffic-context:v1'
const MAX_AGE_MS = 7 * 86_400_000
const PLACEMENTS: DanetkiRegistrationPlacement[] = ['investigation', 'result', 'catalog']
const isPlacement = (value: unknown): value is DanetkiRegistrationPlacement =>
  typeof value === 'string' && PLACEMENTS.includes(value as DanetkiRegistrationPlacement)

const safeLocalReturnUrl = (value: string) => {
  if (typeof window === 'undefined') return '/games/danetki'
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/games/danetki'
  } catch {
    return value.startsWith('/') && !value.startsWith('//') ? value : '/games/danetki'
  }
}

const safeDimension = (value: unknown) => typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value) ? value : undefined

export const rememberDanetkiTrafficContext = (entrySource: string, collection?: string) => {
  if (typeof window === 'undefined') return null
  const safeSource = safeDimension(entrySource) ?? 'direct'
  const safeCollection = safeDimension(collection)
  const context: DanetkiTrafficContext = { entrySource: safeSource, ...(safeCollection ? { collection: safeCollection } : {}) }
  try { window.sessionStorage.setItem(TRAFFIC_STORAGE_KEY, JSON.stringify(context)) } catch { /* unavailable storage */ }
  return context
}

export const readDanetkiTrafficContext = (): DanetkiTrafficContext | null => {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(TRAFFIC_STORAGE_KEY) ?? 'null') as Partial<DanetkiTrafficContext> | null
    const entrySource = safeDimension(parsed?.entrySource)
    const collection = safeDimension(parsed?.collection)
    return entrySource ? { entrySource, ...(collection ? { collection } : {}) } : null
  } catch {
    return null
  }
}

export const rememberDanetkiRegistrationIntent = (placement: DanetkiRegistrationPlacement, returnUrl: string, story?: string) => {
  if (typeof window === 'undefined') return null
  const traffic = readDanetkiTrafficContext()
  const intent: DanetkiRegistrationIntent = {
    source: 'danetki',
    placement,
    returnUrl: safeLocalReturnUrl(returnUrl),
    createdAt: new Date().toISOString(),
    ...(story ? { story } : {}),
    ...(traffic?.entrySource ? { entrySource: traffic.entrySource } : {}),
    ...(traffic?.collection ? { collection: traffic.collection } : {}),
  }
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent)) } catch { /* unavailable storage */ }
  return intent
}

export const readDanetkiRegistrationIntent = (): DanetkiRegistrationIntent | null => {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<DanetkiRegistrationIntent> | null
    if (parsed?.source !== 'danetki' || !isPlacement(parsed.placement) || !parsed.returnUrl || !parsed.createdAt) return null
    if (Date.now() - Date.parse(parsed.createdAt) > MAX_AGE_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return {
      source: 'danetki',
      placement: parsed.placement,
      returnUrl: safeLocalReturnUrl(parsed.returnUrl),
      createdAt: parsed.createdAt,
      ...(parsed.story ? { story: parsed.story } : {}),
      ...(safeDimension(parsed.entrySource) ? { entrySource: safeDimension(parsed.entrySource) } : {}),
      ...(safeDimension(parsed.collection) ? { collection: safeDimension(parsed.collection) } : {}),
    }
  } catch {
    return null
  }
}

export const clearDanetkiRegistrationIntent = () => {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* unavailable storage */ }
}

export const danetkiRegistrationHref = (placement: DanetkiRegistrationPlacement, returnUrl: string, story?: string) => {
  const safeReturnUrl = safeLocalReturnUrl(returnUrl)
  const params = new URLSearchParams({ returnUrl: safeReturnUrl, source: 'danetki', placement })
  if (story) params.set('story', story)
  return `/register?${params.toString()}`
}

export const currentDanetkiReturnUrl = () => typeof window === 'undefined'
  ? '/games/danetki'
  : safeLocalReturnUrl(`${window.location.pathname}${window.location.search}${window.location.hash}`)
