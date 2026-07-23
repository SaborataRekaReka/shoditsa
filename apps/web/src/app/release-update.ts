export const RELEASE_SHA_META_NAME = 'shoditsa-build-sha'

type ReleaseManifest = { commitSha?: unknown }
type ReleaseLocation = Pick<Location, 'pathname' | 'hash'>

export const releaseShaChanged = (currentSha: string, manifest: ReleaseManifest) => {
  const nextSha = typeof manifest.commitSha === 'string' ? manifest.commitSha.trim() : ''
  return /^[0-9a-f]{40}$/i.test(currentSha) && /^[0-9a-f]{40}$/i.test(nextSha) && nextSha !== currentSha
}

export const releaseReloadIsSafe = ({ pathname, hash }: ReleaseLocation) => {
  const hashPath = hash.startsWith('#/') ? hash.slice(1).split(/[?#]/, 1)[0] : ''
  const route = (hashPath || pathname).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  return !/^\/(?:sessions|play)\//.test(route)
}

const fetchReleaseManifest = async () => {
  const response = await fetch(`/build-manifest.json?release-check=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' },
  })
  if (!response.ok) throw new Error(`Release manifest returned HTTP ${response.status}`)
  return response.json() as Promise<ReleaseManifest>
}

export const initReleaseUpdateWatcher = () => {
  const currentSha = document.querySelector<HTMLMetaElement>(`meta[name="${RELEASE_SHA_META_NAME}"]`)?.content.trim() ?? ''
  if (!/^[0-9a-f]{40}$/i.test(currentSha)) return

  let checking = false
  let reloading = false
  const check = async () => {
    if (checking || reloading) return
    checking = true
    try {
      if (releaseShaChanged(currentSha, await fetchReleaseManifest())) {
        // Keep the currently rendered attempt stable. A later focus/pageshow
        // check will apply the release after the player leaves the session.
        if (!releaseReloadIsSafe(window.location)) return
        reloading = true
        window.location.reload()
      }
    } catch {
      // A transient network failure must not interrupt the game.
    } finally {
      checking = false
    }
  }
  const checkWhenVisible = () => {
    if (document.visibilityState === 'visible') void check()
  }

  void check()
  window.addEventListener('focus', checkWhenVisible)
  window.addEventListener('pageshow', checkWhenVisible)
  document.addEventListener('visibilitychange', checkWhenVisible)
}
