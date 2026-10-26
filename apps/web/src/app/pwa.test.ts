import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { isIosInstallDevice } from './pwa'

const workerSource = readFileSync(new URL('../../../../public/sw.js', import.meta.url), 'utf8')
function worker() {
  const handlers = new Map<string, (event: any) => void>()
  const cache = { addAll: vi.fn().mockResolvedValue(undefined) }
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(['shoditsa-pwa-v0', 'another-app-cache', 'shoditsa-pwa-v1']),
    delete: vi.fn().mockResolvedValue(true),
    match: vi.fn<() => Promise<Response | undefined>>().mockResolvedValue(new Response('offline page')),
  }
  const fetch = vi.fn().mockResolvedValue(new Response('live page'))
  const claim = vi.fn().mockResolvedValue(undefined)
  runInNewContext(workerSource, { self: { location: { origin: 'https://shoditsa.ru' }, clients: { claim }, addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler) }, caches, fetch, URL, Response })
  const dispatch = (name: string, properties = {}) => {
    let response: Promise<Response> | undefined
    let work: Promise<unknown> | undefined
    handlers.get(name)!({ ...properties, respondWith: (value: Promise<Response>) => { response = value }, waitUntil: (value: Promise<unknown>) => { work = value } })
    return { response, work }
  }
  const request = (path: string, mode = 'cors', method = 'GET') => ({ url: new URL(path, 'https://shoditsa.ru').href, method, mode })
  return { caches, cache, fetch, claim, dispatch, request }
}

describe('PWA network and storage boundaries', () => {
  it('precaches only the fallback and app icons; cleans up only its own obsolete caches', async () => {
    const w = worker()
    await w.dispatch('install').work
    expect(w.cache.addAll).toHaveBeenCalledWith(['/offline.html', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/icon-maskable-512.png'])
    await w.dispatch('activate').work
    expect(w.caches.delete.mock.calls).toEqual([['shoditsa-pwa-v0']])
    expect(w.claim).toHaveBeenCalledOnce()
  })
  it.each(['/api/v1/me', '/api/auth/session', '/api/v1/checkout', '/data/answers.json', '/city-content/cities.json', '/build-manifest.json', '/assets/app-abc123.js', 'https://another.example/script.js'])('leaves %s to the network', path => {
    const w = worker()
    expect(w.dispatch('fetch', { request: w.request(path) }).response).toBeUndefined()
    expect(w.caches.match).not.toHaveBeenCalled()
  })
  it('never intercepts writes, even to a precached URL', () => {
    const w = worker()
    expect(w.dispatch('fetch', { request: w.request('/offline.html', 'cors', 'POST') }).response).toBeUndefined()
  })
  it('loads navigation from the network and preserves HTTP errors', async () => {
    const w = worker()
    w.fetch.mockResolvedValue(new Response('not found', { status: 404 }))
    const response = await w.dispatch('fetch', { request: w.request('/not-a-page', 'navigate') }).response
    expect(response?.status).toBe(404)
    expect(w.caches.match).not.toHaveBeenCalled()
  })
  it('serves a generic offline page for failed deep links without storing personal HTML', async () => {
    const w = worker()
    w.fetch.mockRejectedValue(new TypeError('offline'))
    const response = await w.dispatch('fetch', { request: w.request('/sessions/private-session', 'navigate') }).response
    expect(await response?.text()).toBe('offline page')
    expect(w.caches.match).toHaveBeenCalledWith('/offline.html')
    expect(w.caches.open).not.toHaveBeenCalled()
  })
  it('uses cached offline assets, with network recovery if storage was evicted', async () => {
    const w = worker()
    await w.dispatch('fetch', { request: w.request('/pwa/icon-192.png') }).response
    expect(w.fetch).not.toHaveBeenCalled()
    w.caches.match.mockResolvedValue(undefined)
    await w.dispatch('fetch', { request: w.request('/pwa/icon-192.png') }).response
    expect(w.fetch).toHaveBeenCalledOnce()
  })
  it('recognizes iPhone and desktop-mode iPad without treating touch laptops as iPads', () => {
    expect(isIosInstallDevice('iPhone', 'iPhone', 5)).toBe(true)
    expect(isIosInstallDevice('Macintosh', 'MacIntel', 5)).toBe(true)
    expect(isIosInstallDevice('Windows', 'Win32', 10)).toBe(false)
    expect(isIosInstallDevice('Macintosh', 'MacIntel', 0)).toBe(false)
  })
})
