import { useSyncExternalStore } from 'react'

export const STUDY_PANELS_KEY = 'shoditsa:study:panels'
const changed = 'shoditsa:study:panels-change'
type Panels = { left: 'auto' | 'expanded' | 'collapsed'; right: 'expanded' | 'collapsed' }
type PanelViewport = { compact: boolean; hasRightColumn: boolean }
const defaults: Panels = { left: 'auto', right: 'expanded' }
const serverSnapshot = () => JSON.stringify(defaults)
let current: Panels | undefined

export function resolveStudyPanels(value: string | null): Panels {
  try {
    const parsed = JSON.parse(value ?? 'null')
    return {
      left: parsed?.left === 'expanded' || parsed?.left === 'collapsed' ? parsed.left : 'auto',
      right: parsed?.right === 'collapsed' ? 'collapsed' : 'expanded',
    }
  } catch { return { ...defaults } }
}

function snapshot() {
  if (typeof window === 'undefined') return serverSnapshot()
  if (!current) {
    try { current = resolveStudyPanels(window.localStorage.getItem(STUDY_PANELS_KEY)) }
    catch { current = { ...defaults } }
  }
  return JSON.stringify(current)
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== STUDY_PANELS_KEY && event.key !== null) return
    current = resolveStudyPanels(event.key === null ? null : event.newValue)
    notify()
  }
  window.addEventListener(changed, notify)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(changed, notify); window.removeEventListener('storage', storage) }
}

/** Saved desktop choices are independent from the layout that currently fits. */
export function studyPanelLayout(preferences: Panels, { compact, hasRightColumn }: PanelViewport) {
  const leftCollapsed = preferences.left === 'collapsed' || (preferences.left === 'auto' && compact)
  const desktopRight = hasRightColumn && (leftCollapsed || !compact)
  // Stacked widgets are visible content, never a collapsed desktop rail.
  const rightCollapsed = desktopRight && preferences.right === 'collapsed'
  return { leftCollapsed, desktopRight, rightCollapsed }
}

/** Read the latest store at click time, including several clicks before React renders. */
export function toggleStudyPanel(side: keyof Panels) {
  const preferences = resolveStudyPanels(snapshot())
  const viewport = { compact: compactSnapshot(), hasRightColumn: rightSnapshot() }
  const collapsed = side === 'left' ? studyPanelLayout(preferences, viewport).leftCollapsed : preferences.right === 'collapsed'
  current = { ...preferences, [side]: collapsed ? 'expanded' : 'collapsed' }
  try { window.localStorage.setItem(STUDY_PANELS_KEY, JSON.stringify(current)) } catch { /* Keep the choice for this document. */ }
  window.dispatchEvent(new Event(changed))
}

const compactSnapshot = () => window.matchMedia('(max-width: 1200px)').matches
const expandedSnapshot = () => false
const rightSnapshot = () => window.matchMedia('(min-width: 1001px)').matches
const subscribeRight = (notify: () => void) => {
  const query = window.matchMedia('(min-width: 1001px)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const subscribeCompact = (notify: () => void) => {
  const query = window.matchMedia('(max-width: 1200px)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

export function useStudyPanels() {
  const preferences = resolveStudyPanels(useSyncExternalStore(subscribe, snapshot, serverSnapshot))
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, expandedSnapshot)
  const hasRightColumn = useSyncExternalStore(subscribeRight, rightSnapshot, expandedSnapshot)
  const layout = studyPanelLayout(preferences, { compact, hasRightColumn })
  return { ...layout, toggleLeft: () => toggleStudyPanel('left'), toggleRight: () => toggleStudyPanel('right') }
}
