import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { captureAnalyticsEntry, initMetrikaDataLayer, initMetrikaFromStoredConsent, initWebVitalsObservers, markAppBootStart } from './app/metrics'
import { AppErrorBoundary } from './components/app-shell/AppErrorBoundary'
import './styles.css'
import { initClientEvents } from './app/client-events'
import { applyRuntimeSeo } from './app/seo'
import { initReleaseUpdateWatcher } from './app/release-update'
import { initPwa } from './app/pwa'
import { applyPublicPresentation, PRESENTATION_PREVIEW } from './app/local-presentation'
import { APPLICATION_DESIGN } from './app/application-design'
import { canonicalApplicationHref } from './features/application/routes'
import { RoutePending } from './app/RoutePending'
import { applyStudyTheme } from './dev/quest-game/study-theme'

if (APPLICATION_DESIGN) {
  const canonical = canonicalApplicationHref(window.location)
  if (canonical) window.history.replaceState(window.history.state, '', canonical)
  document.documentElement.dataset.questSkin = 'shoditsa'
  applyStudyTheme()
}

applyPublicPresentation(window.location.hash.startsWith('#/') ? window.location.hash.slice(1).split('?')[0] : window.location.pathname)
markAppBootStart()
if (!PRESENTATION_PREVIEW) {
captureAnalyticsEntry()
initMetrikaDataLayer()
initMetrikaFromStoredConsent()
initWebVitalsObservers()
initClientEvents()
initReleaseUpdateWatcher()
}
applyRuntimeSeo()
initPwa()

const root = ReactDOM.createRoot(document.getElementById('root')!)
if (APPLICATION_DESIGN) root.render(<RoutePending />)

// Initialize Yandex Games SDK before mounting the app.
// YaGames is injected globally by /sdk.js loaded in index.html.
const mountApp = async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: false } } })
  const { appRouter } = await import('./app/router')
  root.render(
    <React.StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><RouterProvider router={appRouter} context={{ queryClient }} /></QueryClientProvider></AppErrorBoundary></React.StrictMode>,
  )
}

function BootstrapFailure({ error }: { error: unknown }): never { throw error }
const startApp = () => mountApp().catch(error => {
  root.render(<AppErrorBoundary><BootstrapFailure error={error} /></AppErrorBoundary>)
})

if (typeof YaGames !== 'undefined') YaGames.init().then(startApp, startApp)
else void startApp()
