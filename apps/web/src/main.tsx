import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LoginScreen } from './features/auth/LoginScreen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { initMetrikaDataLayer, initWebVitalsObservers, markAppBootStart } from './app/metrics'
import { AppErrorBoundary } from './components/app-shell/AppErrorBoundary'
import './styles.css'
import { initClientEvents } from './app/client-events'
import { applyRuntimeSeo } from './app/seo'
import { initReleaseUpdateWatcher } from './app/release-update'

markAppBootStart()
initMetrikaDataLayer()
initWebVitalsObservers()
initClientEvents()
applyRuntimeSeo()
initReleaseUpdateWatcher()

// Initialize Yandex Games SDK before mounting the app.
// YaGames is injected globally by /sdk.js loaded in index.html.
const mountApp = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: false } } })
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname.replace(/\/+$/, '') || '/'
  const authRoute = pathname === '/login' || pathname === '/register'
  const authMode = pathname === '/register' ? 'register' : 'login'
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}>{authRoute ? <LoginScreen mode={authMode} /> : <App />}</QueryClientProvider></AppErrorBoundary></React.StrictMode>,
  )
}

if (typeof YaGames !== 'undefined') {
  YaGames.init().then(mountApp).catch(mountApp)
} else {
  mountApp()
}
