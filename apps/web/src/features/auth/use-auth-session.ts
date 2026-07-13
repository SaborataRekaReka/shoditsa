import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'

export const AUTH_SESSION_CHANGE_EVENT = 'seans:auth-session-change'

export type AuthSession = {
  id: string | null
  name: string | null
  email: string | null
  isAnonymous: boolean
  hasPassword: boolean
  providers: string[]
}

export const getAuthSession = async (): Promise<AuthSession | null> => {
  try {
    const { user, auth } = await api.me()
    return {
      id: user.id || null,
      name: user.name?.trim() || null,
      email: user.email?.trim() || null,
      isAnonymous: user.isAnonymous,
      hasPassword: auth.hasPassword,
      providers: auth.providers,
    }
  } catch {
    return null
  }
}

export const notifyAuthSessionChanged = () => window.dispatchEvent(new Event(AUTH_SESSION_CHANGE_EVENT))

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setSession(await getAuthSession())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, refresh)
    return () => window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, refresh)
  }, [refresh])

  return { session, loading, refresh }
}
