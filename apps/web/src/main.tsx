import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { initMetrikaDataLayer, initWebVitalsObservers, markAppBootStart } from './app/metrics'
import { AppErrorBoundary } from './components/app-shell/AppErrorBoundary'
import './styles.css'
import { initClientEvents } from './app/client-events'

markAppBootStart()
initMetrikaDataLayer()
initWebVitalsObservers()
initClientEvents()

// Initialize Yandex Games SDK before mounting the app.
// YaGames is injected globally by /sdk.js loaded in index.html.
const mountApp = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: false } } })
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><App /></QueryClientProvider></AppErrorBoundary></React.StrictMode>,
  )
}

if (typeof YaGames !== 'undefined') {
  YaGames.init().then(mountApp).catch(mountApp)
} else {
  mountApp()
}
