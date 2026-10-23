import { describe, expect, it, vi } from 'vitest'
import { preloadableScreen } from './preloadable-screen'

describe('preloadable route code', () => {
  it('shares an in-flight request and renders synchronously after preparation', async () => {
    const Component = (_props: { label: string }) => null
    const loader = vi.fn(async () => ({ default: Component }))
    const Screen = preloadableScreen(loader)
    const first = Screen.preload()
    expect(Screen.preload()).toBe(first)
    await first
    expect(Screen.preload()).toBeUndefined()
    const element = Screen({ label: 'Архив' })
    expect(element.type).toBe(Component)
    expect(element.props.label).toBe('Архив')
    expect(loader).toHaveBeenCalledOnce()
  })
  it('propagates a failed import to the error boundary rather than suspending forever', async () => {
    const failure = new Error('offline')
    const Screen = preloadableScreen(async () => { throw failure })
    await expect(Screen.preload()).rejects.toBe(failure)
    expect(() => Screen({})).toThrow(failure)
  })
})
