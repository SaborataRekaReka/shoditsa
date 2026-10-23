const listeners = new Set<() => void>()
let active: symbol | undefined

export const isRouteLoading = () => active !== undefined
export function subscribeRouteLoading(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function finishRouteLoading() {
  if (!active) return
  active = undefined
  listeners.forEach(listener => listener())
}

/** A superseded request cannot dismiss the indicator belonging to a newer navigation. */
export function beginRouteLoading() {
  const token = Symbol()
  active = token
  listeners.forEach(listener => listener())
  return () => { if (active === token) finishRouteLoading() }
}
