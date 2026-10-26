import { trackClientEvent } from './client-events'

let active: ViewTransition | undefined
const handled = new WeakMap<ViewTransition, Set<() => void>>()
let observingDocuments = false

const reportTransitionError = (reason: unknown, phase: string) => {
  trackClientEvent('client_error', {
    message: reason instanceof Error ? reason.message : String(reason),
    error_name: reason instanceof Error ? reason.name : 'Error',
    component: 'view_transition',
    phase,
  })
}

/** Abort/skip only cancels the animation. Callback failures still need reporting. */
export const observeViewTransition = (transition: ViewTransition, cleanup: () => void = () => {}) => {
  const existing = handled.get(transition)
  if (existing) { existing.add(cleanup); return }
  const callbacks = new Set([cleanup])
  handled.set(transition, callbacks)
  const finish = () => { for (const callback of callbacks) callback() }
  let updateFailed = false
  void transition.updateCallbackDone.then(undefined, reason => {
    updateFailed = true
    reportTransitionError(reason, 'update')
  })
  void transition.ready.then(undefined, reason => {
    // Wait for the callback to distinguish a skipped animation from failed navigation.
    void transition.updateCallbackDone.then(() => {
      const expected = reason instanceof DOMException && (reason.name === 'AbortError'
        || reason.name === 'InvalidStateError' && (document.visibilityState === 'hidden' || /(?:document|visibility).*hidden/i.test(reason.message)))
      if (!expected) reportTransitionError(reason, 'ready')
    }, () => {})
  })
  // finally() creates another rejecting promise; use both branches and consume it instead.
  void transition.finished.then(finish, reason => {
    finish()
    if (!updateFailed) {
      void transition.updateCallbackDone.then(() => reportTransitionError(reason, 'finished'), () => {})
    }
  })
}

/** Register during bootstrap, before React's first effect and cross-document reveal. */
export const initViewTransitionObservers = () => {
  if (observingDocuments) return
  observingDocuments = true
  const observe = (event: Event) => {
    const transition = (event as Event & { viewTransition?: ViewTransition }).viewTransition
    if (transition) observeViewTransition(transition)
  }
  window.addEventListener('pagereveal', observe)
  window.addEventListener('pageswap', observe)
}

/** Shared owner for router and preview transitions. A new navigation supersedes only animation. */
export const runViewTransition = (update: () => void | Promise<void>, animate = true) => {
  active?.skipTransition()
  const commit = () => {
    try { return Promise.resolve(update()) } catch (error) { return Promise.reject(error) }
  }
  if (!animate || typeof document.startViewTransition !== 'function'
    || document.visibilityState === 'hidden' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    void commit().catch(reason => reportTransitionError(reason, 'update'))
    return
  }
  let transition: ViewTransition
  try { transition = document.startViewTransition(commit) }
  catch (error) {
    reportTransitionError(error, 'start')
    void commit().catch(reason => reportTransitionError(reason, 'update'))
    return
  }
  active = transition
  document.documentElement.setAttribute('data-study-transitioning', '')
  observeViewTransition(transition, () => {
    if (active !== transition) return
    active = undefined
    document.documentElement.removeAttribute('data-study-transitioning')
  })
}
