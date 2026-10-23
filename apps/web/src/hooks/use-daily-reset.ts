import { useEffect, useState } from 'react'
import { getDailyReset } from '../app/daily-reset'

export function useDailyReset() {
  const [reset, setReset] = useState(getDailyReset)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const now = Date.now()
      setReset(getDailyReset(now))
      // Align to minute boundaries, including midnight. No per-second updates.
      timer = setTimeout(refresh, 60_000 - now % 60_000 + 20)
    }
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return reset
}
