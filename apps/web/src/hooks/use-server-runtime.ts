import { useQuery } from '@tanstack/react-query'
import { ApiClientError, api, queryKeys } from '../api/client'

export const SERVER_RUNTIME = import.meta.env.MODE !== 'yandex'

const createOrReadSession = async () => {
  try {
    return await api.me()
  } catch (error) {
    if (!(error instanceof ApiClientError) || (error.status !== 401 && error.code !== 'AUTH_REQUIRED')) throw error
    await api.guest()
    return api.me()
  }
}

let sessionRequest: Promise<Awaited<ReturnType<typeof api.me>>> | null = null

export const ensureServerSession = () => {
  if (!sessionRequest) {
    sessionRequest = createOrReadSession().finally(() => { sessionRequest = null })
  }
  return sessionRequest
}

export const useServerRuntime = () => {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: ensureServerSession, enabled: SERVER_RUNTIME, retry: 1 })
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, enabled: SERVER_RUNTIME, retry: 1 })
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.dashboard, enabled: SERVER_RUNTIME && me.isSuccess, retry: 1 })
  return {
    enabled: SERVER_RUNTIME,
    me: me.data ?? null,
    meta: meta.data ?? null,
    dashboard: dashboard.data ?? null,
    loading: SERVER_RUNTIME && (me.isLoading || meta.isLoading || dashboard.isLoading),
    error: me.error ?? meta.error ?? dashboard.error ?? null,
  }
}
