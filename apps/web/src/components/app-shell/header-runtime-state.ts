export type HeaderRuntimeState = 'loading' | 'ready' | 'unavailable'

export const headerRuntimeState = (input: {
  serverRuntime: boolean
  authLoading: boolean
  runtimeLoading: boolean
  hasDashboard: boolean
}): HeaderRuntimeState => {
  if (!input.serverRuntime) return 'ready'
  if (input.authLoading || input.runtimeLoading) return 'loading'
  return input.hasDashboard ? 'ready' : 'unavailable'
}
