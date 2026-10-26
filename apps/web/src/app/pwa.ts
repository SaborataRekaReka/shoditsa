import { useState, useSyncExternalStore } from 'react'

type InstallPrompt = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
type InstallState = 'unavailable' | 'prompt' | 'ios' | 'installed'
const listeners = new Set<() => void>()
let state: InstallState = 'unavailable'
let deferredPrompt: InstallPrompt | null = null
let initialized = false
const publish = (value: InstallState) => { state = value; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export const isIosInstallDevice = (userAgent: string, platform: string, touchPoints: number) =>
  /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1)

export function initPwa() {
  if (initialized || !import.meta.env.PROD || import.meta.env.MODE === 'yandex' || !window.isSecureContext || window.top !== window.self) return
  initialized = true
  const standalone = window.matchMedia('(display-mode: standalone)')
  const installed = () => standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const fallback = () => installed() ? 'installed' : isIosInstallDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) ? 'ios' : 'unavailable'
  publish(fallback())
  window.addEventListener('beforeinstallprompt', event => {
    if (installed()) return
    event.preventDefault()
    deferredPrompt = event as InstallPrompt
    publish('prompt')
  })
  window.addEventListener('appinstalled', () => { deferredPrompt = null; publish('installed') })
  standalone.addEventListener('change', () => publish(installed() ? 'installed' : deferredPrompt ? 'prompt' : fallback()))

  if (!('serviceWorker' in navigator)) return
  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      let lastUpdate = Date.now()
      const update = () => {
        if (document.visibilityState !== 'visible' || Date.now() - lastUpdate < 60_000) return
        lastUpdate = Date.now()
        void registration.update().catch(() => {})
      }
      // Let a new worker activate after existing windows close. Never reload a game.
      window.addEventListener('online', update)
      window.addEventListener('focus', update)
      document.addEventListener('visibilitychange', update)
    } catch { /* Installation is optional; network or storage failures must not stop the app. */ }
  }
  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', () => { void register() }, { once: true })
}

export function usePwaInstall() {
  const current = useSyncExternalStore(subscribe, () => state, () => 'unavailable' as const)
  const [instructions, setInstructions] = useState(false)
  const [installing, setInstalling] = useState(false)
  const install = async () => {
    if (current === 'ios') { setInstructions(true); return }
    const prompt = deferredPrompt
    if (!prompt || installing) return
    deferredPrompt = null
    setInstalling(true)
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      publish(choice.outcome === 'accepted' ? 'installed' : 'unavailable')
    } catch { publish('unavailable') }
    finally { setInstalling(false) }
  }
  return { available: current === 'prompt' || current === 'ios', install, installing, instructions, closeInstructions: () => setInstructions(false) }
}
