import { describe, expect, it } from 'vitest'
import { headerRuntimeState } from './header-runtime-state'

describe('headerRuntimeState', () => {
  it('never treats an unfinished server request as real zero-valued data', () => {
    expect(headerRuntimeState({
      serverRuntime: true,
      authLoading: true,
      runtimeLoading: true,
      hasDashboard: false,
    })).toBe('loading')
  })

  it('requires the dashboard after server hydration finishes', () => {
    expect(headerRuntimeState({
      serverRuntime: true,
      authLoading: false,
      runtimeLoading: false,
      hasDashboard: false,
    })).toBe('unavailable')
    expect(headerRuntimeState({
      serverRuntime: true,
      authLoading: false,
      runtimeLoading: false,
      hasDashboard: true,
    })).toBe('ready')
  })

  it('keeps the synchronous local runtime immediately ready', () => {
    expect(headerRuntimeState({
      serverRuntime: false,
      authLoading: true,
      runtimeLoading: true,
      hasDashboard: false,
    })).toBe('ready')
  })
})
