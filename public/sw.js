// Increment when the offline page or icons change. App releases stay network-first.
const CACHE = 'shoditsa-pwa-v1'
const OFFLINE = '/offline.html'
const PRECACHE = [OFFLINE, '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/icon-maskable-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('shoditsa-pwa-') && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // API, credentials, payments, game data, build manifests and HTML are never cached.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/') || url.pathname.startsWith('/city-content/')) return
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request) }
      catch {
        const fallback = await caches.match(OFFLINE)
        return fallback || Response.error()
      }
    })())
    return
  }
  if (!PRECACHE.includes(url.pathname) || url.search) return
  event.respondWith((async () => {
    const cached = await caches.match(request)
    return cached || fetch(request)
  })())
})
