import { afterEach, describe, expect, it, vi } from 'vitest'
import { studyPanelLayout } from './study-panels'

afterEach(() => vi.unstubAllGlobals())

describe('responsive sidebar layout', () => {
  it('shows stacked widgets at full width when a saved collapsed right rail stops fitting', () => {
    const saved = { left: 'expanded' as const, right: 'collapsed' as const }
    expect(studyPanelLayout(saved, { compact: true, hasRightColumn: true })).toEqual({ leftCollapsed: false, desktopRight: false, rightCollapsed: false })
    expect(studyPanelLayout(saved, { compact: false, hasRightColumn: true })).toEqual({ leftCollapsed: false, desktopRight: true, rightCollapsed: true })
  })
  it('restores the saved right collapse when the left menu shrinks and space becomes available', () => {
    expect(studyPanelLayout({ left: 'collapsed', right: 'collapsed' }, { compact: true, hasRightColumn: true })).toEqual({ leftCollapsed: true, desktopRight: true, rightCollapsed: true })
  })
  it('never hides mobile/tablet widgets because of a desktop preference', () => {
    for (const left of ['auto', 'expanded', 'collapsed'] as const) {
      for (const right of ['expanded', 'collapsed'] as const) {
        const layout = studyPanelLayout({ left, right }, { compact: true, hasRightColumn: false })
        expect(layout.desktopRight).toBe(false)
        expect(layout.rightCollapsed).toBe(false)
      }
    }
  })
  it('keeps auto left navigation compact only in a compact viewport', () => {
    const saved = { left: 'auto' as const, right: 'expanded' as const }
    expect(studyPanelLayout(saved, { compact: true, hasRightColumn: true }).leftCollapsed).toBe(true)
    expect(studyPanelLayout(saved, { compact: false, hasRightColumn: true }).leftCollapsed).toBe(false)
  })
})

describe('rapid sidebar toggles', () => {
  async function store(left: 'auto' | 'expanded' | 'collapsed', compact = false) {
    vi.resetModules()
    let saved = JSON.stringify({ left, right: 'expanded' })
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', {
      localStorage: { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } },
      matchMedia: (query: string) => ({ matches: query.includes('max-width') ? compact : true }),
      dispatchEvent,
    })
    const { toggleStudyPanel } = await import('./study-panels')
    return { toggle: toggleStudyPanel, read: () => JSON.parse(saved), dispatchEvent }
  }
  it('applies every click even when the component has not rendered between clicks', async () => {
    const prefs = await store('expanded')
    for (let index = 0; index < 10; index++) { prefs.toggle('left'); prefs.toggle('right') }
    expect(prefs.read()).toEqual({ left: 'expanded', right: 'expanded' })
    expect(prefs.dispatchEvent).toHaveBeenCalledTimes(20)
  })
  it('resolves the first auto toggle using the current viewport and preserves the other preference', async () => {
    const prefs = await store('auto', true)
    prefs.toggle('right')
    prefs.toggle('left')
    expect(prefs.read()).toEqual({ left: 'expanded', right: 'collapsed' })
    prefs.toggle('left')
    expect(prefs.read()).toEqual({ left: 'collapsed', right: 'collapsed' })
  })
})
