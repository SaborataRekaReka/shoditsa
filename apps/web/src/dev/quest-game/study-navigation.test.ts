import { afterEach, describe, expect, it, vi } from 'vitest'
import { studyLinkView, transitionStudyPage } from './study-navigation'
import { finishRouteLoading, isRouteLoading } from '../../app/route-loading'

afterEach(() => { finishRouteLoading(); vi.unstubAllGlobals() })

describe('application section transitions', () => {
  it('soft-navigates only implemented local sections, preserving native game, account and external links', () => {
    const origin = 'http://localhost'
    expect(studyLinkView('/', origin)).toBe('games')
    expect(studyLinkView('/#home-games', origin)).toBe('games')
    expect(studyLinkView('/?variant=b#home-games', origin)).toBe('games')
    expect(studyLinkView('/shoditsa-home.html?variant=a#home-games', origin)).toBe('games')
    expect(studyLinkView('/shoditsa-title.html#archive', origin)).toBe('archive')
    expect(studyLinkView('/shoditsa-title.html#club', origin)).toBe('club')
    expect(studyLinkView('/shoditsa-title.html#club-offer', origin)).toBe('club-offer')
    expect(studyLinkView('/?preview=reference#/club?preview=reference&section=library', origin)).toBe('club')
    expect(studyLinkView('/shoditsa-title.html#play', origin)).toBe('games')
    for (const href of ['https://example.org/', 'https://example.org/shoditsa-home.html', '/login', '/games/series', '/?studyMode=anime#/play/anime', '/#home-guide', '/shoditsa-home.html#home-guide', '/shoditsa-title.html?panel=settings#profile']) expect(studyLinkView(href, origin)).toBeUndefined()
  })
  it('still navigates when the browser has no View Transitions API', () => {
    vi.stubGlobal('document', {})
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const update = vi.fn()
    transitionStudyPage(update)
    expect(update).toHaveBeenCalledOnce()
  })
  it('keeps the previous screen until code is ready and ignores an obsolete slow destination', async () => {
    vi.stubGlobal('document', {})
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    let ready!: () => void
    const pending = new Promise<void>(resolve => { ready = resolve })
    const first = vi.fn(), last = vi.fn()
    transitionStudyPage(first, () => pending)
    expect(first).not.toHaveBeenCalled()
    expect(isRouteLoading()).toBe(true)
    transitionStudyPage(last)
    expect(isRouteLoading()).toBe(false)
    ready()
    await pending
    expect(first).not.toHaveBeenCalled()
    expect(last).toHaveBeenCalledOnce()
  })
  it('keeps the loader visible when an obsolete request finishes before the latest request', async () => {
    vi.stubGlobal('document', {})
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    let resolveFirst!: () => void, resolveLast!: () => void
    const first = new Promise<void>(resolve => { resolveFirst = resolve })
    const last = new Promise<void>(resolve => { resolveLast = resolve })
    const firstUpdate = vi.fn(), lastUpdate = vi.fn()
    transitionStudyPage(firstUpdate, () => first)
    transitionStudyPage(lastUpdate, () => last)
    resolveFirst()
    await first
    expect(firstUpdate).not.toHaveBeenCalled()
    expect(isRouteLoading()).toBe(true)
    resolveLast()
    await last
    expect(lastUpdate).toHaveBeenCalledOnce()
    expect(isRouteLoading()).toBe(false)
  })
  it('commits after preparation, including failures so the error boundary can recover', async () => {
    vi.stubGlobal('document', {})
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const update = vi.fn()
    transitionStudyPage(update, () => Promise.resolve())
    expect(update).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(update).toHaveBeenCalledOnce()
    const failed = vi.fn()
    transitionStudyPage(failed, () => Promise.reject(new Error('offline')))
    await Promise.resolve()
    expect(failed).toHaveBeenCalledOnce()
    expect(isRouteLoading()).toBe(false)
  })
  it('respects reduced motion without delaying the state update', () => {
    const startViewTransition = vi.fn()
    vi.stubGlobal('document', { startViewTransition, documentElement: { dataset: {}, setAttribute: vi.fn(), removeAttribute: vi.fn() } })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const update = vi.fn()
    transitionStudyPage(update)
    expect(update).toHaveBeenCalledOnce()
    expect(startViewTransition).not.toHaveBeenCalled()
  })
  it('keeps the latest destination when navigation is clicked rapidly', async () => {
    const callbacks: Array<() => void> = []
    const transitions: Array<{ skipTransition: ReturnType<typeof vi.fn>; ready: Promise<void>; finished: Promise<void> }> = []
    const startViewTransition = (update: () => void) => {
      callbacks.push(update)
      const transition = { skipTransition: vi.fn(), ready: Promise.resolve(), finished: Promise.resolve() }
      transitions.push(transition)
      return transition
    }
    vi.stubGlobal('document', { startViewTransition, documentElement: { dataset: {}, setAttribute: vi.fn(), removeAttribute: vi.fn() } })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const first = vi.fn(), last = vi.fn()
    transitionStudyPage(first)
    transitionStudyPage(last)
    callbacks.forEach(update => update())
    expect(transitions[0].skipTransition).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    expect(last).toHaveBeenCalledOnce()
    await Promise.resolve()
  })
})
