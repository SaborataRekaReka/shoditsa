import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveStudyTheme } from './study-theme'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function browser(saved: string | null = null, url = 'http://localhost/shoditsa-home.html?variant=a') {
  const values = new Map(saved ? [['shoditsa:study:theme', saved]] : [])
  const listeners = new Map<string, Set<(event?: unknown) => void>>()
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
  const location = new URL(url)
  const root = { dataset: {} as Record<string, string> }
  const meta = { setAttribute: vi.fn() }
  const history = { state: { view: 'home' }, replaceState: vi.fn() }
  vi.stubGlobal('document', { documentElement: root, querySelector: () => meta })
  vi.stubGlobal('window', {
    location, localStorage, history,
    addEventListener: (type: string, listener: (event?: unknown) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener) },
    removeEventListener: (type: string, listener: (event?: unknown) => void) => listeners.get(type)?.delete(listener),
    dispatchEvent: (event: Event) => listeners.get(event.type)?.forEach(listener => listener(event)),
  })
  return { localStorage, root, history, emitStorage: (key: string, value: string | null) => listeners.get('storage')?.forEach(listener => listener({ key, newValue: value, storageArea: localStorage })) }
}

describe('shared study theme preference', () => {
  it('uses the light brand default, saved choice and explicit preview override', () => {
    expect(resolveStudyTheme(null, null)).toBe('light')
    expect(resolveStudyTheme(null, 'dark')).toBe('dark')
    expect(resolveStudyTheme('light', 'dark')).toBe('light')
    expect(resolveStudyTheme('invalid', 'invalid')).toBe('light')
  })

  it('saves the choice, updates the document and restores it in a new page module', async () => {
    const env = browser()
    let theme = await import('./study-theme')
    const notify = vi.fn()
    const unsubscribe = theme.subscribeStudyTheme(notify)
    theme.setStudyTheme('dark')
    expect(env.root.dataset.questTone).toBe('dark')
    expect(env.localStorage.getItem(theme.STUDY_THEME_KEY)).toBe('dark')
    expect(notify).toHaveBeenCalledOnce()
    unsubscribe()
    vi.resetModules()
    theme = await import('./study-theme')
    expect(theme.getStudyTheme()).toBe('dark')
  })

  it('keeps explicit preview URLs consistent with a subsequent user choice', async () => {
    const env = browser(null, 'http://localhost/shoditsa-title.html?tone=dark#profile')
    const theme = await import('./study-theme')
    expect(theme.getStudyTheme()).toBe('dark')
    theme.setStudyTheme('light')
    const [state, , url] = env.history.replaceState.mock.calls[0]
    expect(state).toEqual({ view: 'home' })
    expect(url.searchParams.get('tone')).toBe('light')
    expect(url.hash).toBe('#profile')
  })

  it('synchronizes other tabs while ignoring unrelated storage changes', async () => {
    const env = browser()
    const theme = await import('./study-theme')
    const notify = vi.fn()
    const unsubscribe = theme.subscribeStudyTheme(notify)
    env.emitStorage('game-progress', 'dark')
    expect(notify).not.toHaveBeenCalled()
    env.emitStorage(theme.STUDY_THEME_KEY, 'dark')
    expect(theme.getStudyTheme()).toBe('dark')
    expect(env.root.dataset.questTone).toBe('dark')
    unsubscribe()
    env.emitStorage(theme.STUDY_THEME_KEY, 'light')
    expect(notify).toHaveBeenCalledOnce()
  })

  it('remains usable when browser storage is blocked', async () => {
    const env = browser()
    env.localStorage.getItem = () => { throw new Error('blocked') }
    env.localStorage.setItem = () => { throw new Error('blocked') }
    const theme = await import('./study-theme')
    expect(theme.getStudyTheme()).toBe('light')
    expect(() => theme.setStudyTheme('dark')).not.toThrow()
    expect(theme.getStudyTheme()).toBe('dark')
    expect(env.root.dataset.questTone).toBe('dark')
  })
})
