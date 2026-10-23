import { useCallback, useContext, useSyncExternalStore } from 'react'
import { QueryClientContext, type QueryKey } from '@tanstack/react-query'

/** Observe the existing account cache without starting another session or request. */
export function useStudyAccountCache<T>(key: QueryKey) {
  const client = useContext(QueryClientContext)
  const subscribe = useCallback((notify: () => void) => client?.getQueryCache().subscribe(notify) ?? (() => {}), [client])
  const snapshot = useCallback(() => client?.getQueryData<T>(key) ?? null, [client, key])
  return useSyncExternalStore(subscribe, snapshot, () => null)
}
